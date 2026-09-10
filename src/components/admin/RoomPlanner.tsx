import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { AppIcon } from "@/components/AppIcon";
import { AppModal } from "@/components/AppModal";
import { RoomMap } from "@/components/admin/RoomMap";
import type { Registration } from "@/types";
import { fillForesteriaModule } from "@/utils/foresteriaModule";
import { readRoomFile, type RoomImport } from "@/utils/roomImport";
import { pickLayout, readRoomLayoutFile, type RoomLayout } from "@/utils/roomLayout";
import {
  ageAt, assignmentProblem, buildPreferenceLinks, categoryLabels, eligibleRegistrations,
  proposeRoomPlan, roomSummary, validateRoomPlan, type Room, type RoomPlan,
} from "../../../functions/lib/roomPlannerCore.mjs";
import "@/styles/roomPlanner.css";

interface Props {
  initialPlan: RoomPlan;
  registrations: Registration[];
  referenceDate: string;
  onSave: (plan: RoomPlan) => Promise<RoomPlan>;
  onDirtyChange?: (dirty: boolean) => void;
  onReload: () => void;
  layouts: RoomLayout[];
  unreadableLayouts: string[];
  layoutsFailed: boolean;
  onSaveLayout: (layout: RoomLayout) => Promise<void>;
}

const isAdult = (person: Registration) => ["dirigente", "accompagnatore"].includes(person.genderRoleCategory);
const nameOf = (person: Registration) => person.fullName || `${person.firstName} ${person.lastName}`.trim();
const copy = (plan: RoomPlan) => structuredClone(plan);
const normalize = (value: string) => value.toLocaleLowerCase("it").normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();

function CategorySelect({ value, onChange, label }: { value: Room["category"]; onChange: (value: Room["category"]) => void; label: string }) {
  return <select aria-label={label} value={value} onChange={(event) => onChange(event.target.value as Room["category"])}>
    {Object.entries(categoryLabels).map(([key, text]) => <option key={key} value={key}>{text}</option>)}
  </select>;
}

const VIEW_KEY = "gugd-room-planner-view";
function savedView(): "list" | "map" {
  try { return localStorage.getItem(VIEW_KEY) === "map" ? "map" : "list"; } catch { return "list"; }
}

function downloadFile(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a"); anchor.href = url; anchor.download = fileName; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function RoomPlanner({ initialPlan, registrations, referenceDate, onSave, onDirtyChange, onReload, layouts, unreadableLayouts, layoutsFailed, onSaveLayout }: Props) {
  const [plan, setPlan] = useState(() => copy(initialPlan));
  const [savedPlan, setSavedPlan] = useState(() => copy(initialPlan));
  const [history, setHistory] = useState<RoomPlan[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [warning, setWarning] = useState("");
  const [conflict, setConflict] = useState(false);
  const [search, setSearch] = useState("");
  const [showAssigned, setShowAssigned] = useState(false);
  const [category, setCategory] = useState("all");
  const [floor, setFloor] = useState("all");
  const [selectedPersonId, setSelectedPersonId] = useState<string | null>(null);
  const [pickerRoomId, setPickerRoomId] = useState<string | null>(null);
  const [roomEditor, setRoomEditor] = useState<Room | null>(null);
  const [importDraft, setImportDraft] = useState<RoomImport | null>(null);
  const [proposal, setProposal] = useState<RoomPlan | null>(null);
  const [autoOpen, setAutoOpen] = useState(false);
  const [recalculate, setRecalculate] = useState(false);
  const [partnerId, setPartnerId] = useState("");
  const [coupleConfirmed, setCoupleConfirmed] = useState(false);
  const [view, setView] = useState(savedView);
  const [armedId, setArmedId] = useState<string | null>(null);
  const [layoutList, setLayoutList] = useState(layouts);
  const fileInput = useRef<HTMLInputElement>(null);
  const moduleInput = useRef<HTMLInputElement>(null);
  const layoutInput = useRef<HTMLInputElement>(null);
  const people = useMemo(() => eligibleRegistrations(registrations) as Registration[], [registrations]);
  const peopleById = useMemo(() => new Map(registrations.map((person) => [person.id, person])), [registrations]);
  const links = useMemo(() => buildPreferenceLinks(people), [people]);
  const summary = roomSummary(plan, people);
  const problems = validateRoomPlan(plan, registrations, referenceDate);
  const dirty = JSON.stringify(plan) !== JSON.stringify(savedPlan);
  const selectedPerson = selectedPersonId ? peopleById.get(selectedPersonId) : undefined;
  const pickerRoom = plan.rooms.find((room) => room.id === pickerRoomId);
  const unassigned = people.filter((person) => !plan.assignments[person.id]);
  const notesCount = unassigned.filter((person) => String(person.answers?.roomNotes || "").trim()).length;
  const shownPeople = people.filter((person) => (showAssigned || !plan.assignments[person.id]) && normalize(nameOf(person)).includes(normalize(search)))
    .sort((a, b) => nameOf(a).localeCompare(nameOf(b), "it"));
  const visibleRooms = plan.rooms.filter((room) => (category === "all" || room.category === category) && (floor === "all" || room.floor === floor));
  const floors = [...new Set(plan.rooms.map((room) => room.floor).filter(Boolean))];
  const layoutMatch = pickLayout(layoutList, plan.rooms);
  const armedPerson = armedId ? peopleById.get(armedId) : undefined;

  useEffect(() => { onDirtyChange?.(dirty); }, [dirty, onDirtyChange]);
  useEffect(() => {
    const couple = plan.couples.find((pair) => pair.firstId === selectedPersonId || pair.secondId === selectedPersonId);
    setPartnerId(couple ? (couple.firstId === selectedPersonId ? couple.secondId : couple.firstId) : "");
    setCoupleConfirmed(Boolean(couple?.confirmed));
  }, [selectedPersonId, plan.couples]);

  function change(next: RoomPlan, notice = "") {
    setHistory((previous) => [...previous.slice(-19), copy(plan)]);
    setPlan(next); setError(""); setWarning(""); setMessage(notice);
  }

  function addRoom() {
    setRoomEditor({ id: crypto.randomUUID(), name: "", capacity: 2, floor: "", category: plan.rooms.length ? "unassigned" : "staff_male", accessible: false, notes: "", minAge: null, maxAge: null });
  }

  function saveRoom(event: FormEvent) {
    event.preventDefault();
    if (!roomEditor) return;
    const room = { ...roomEditor, name: roomEditor.name.trim(), floor: roomEditor.floor.trim(), notes: roomEditor.notes.trim() };
    const next = copy(plan);
    const index = next.rooms.findIndex((item) => item.id === room.id);
    if (index < 0) next.rooms.push(room); else next.rooms[index] = room;
    const errors = validateRoomPlan(next, registrations, referenceDate);
    if (errors.length) { setError(errors[0]); return; }
    change(next); setRoomEditor(null);
  }

  function movePerson(person: Registration, room: Room | null) {
    if (room) {
      const reason = assignmentProblem(person, room, plan, registrations, referenceDate);
      if (reason) { setError(reason); return; }
    }
    const next = copy(plan);
    if (room) {
      next.assignments[person.id] = room.id;
      next.lockedIds = [...new Set([...next.lockedIds, person.id])];
    } else {
      delete next.assignments[person.id];
      next.lockedIds = next.lockedIds.filter((id) => id !== person.id);
    }
    change(next, room ? `${nameOf(person)} assegnato alla stanza ${room.name}.` : `${nameOf(person)} torna tra i partecipanti da assegnare.`);
    setSelectedPersonId(null);
  }

  async function savePlan() {
    setBusy(true); setError(""); setWarning(""); setMessage("");
    try {
      const saved = await onSave(plan);
      setPlan(copy(saved)); setSavedPlan(copy(saved)); setHistory([]); setConflict(false);
      setMessage("Bozza salvata. Visibile solo agli amministratori.");
    } catch (cause) {
      const code = (cause as { code?: string }).code;
      if (code === "functions/aborted") {
        setConflict(true); setError("Un altro amministratore ha modificato le stanze. Le tue modifiche sono ancora qui: ricarica la versione aggiornata prima di salvare.");
      } else if (code === "functions/permission-denied" || code === "functions/unauthenticated") {
        setError("Accesso non autorizzato. Accedi con un account amministratore.");
      } else if (code === "functions/invalid-argument" || code === "functions/failed-precondition") {
        setError(cause instanceof Error ? cause.message : "La bozza contiene assegnazioni non valide.");
      } else setError("Salvataggio non riuscito. Le modifiche sono ancora qui: controlla la connessione e riprova.");
    } finally { setBusy(false); }
  }

  async function importFile(file?: File) {
    if (!file) return;
    setBusy(true); setError("");
    try { setImportDraft(await readRoomFile(file)); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Impossibile leggere il file."); }
    finally { setBusy(false); if (fileInput.current) fileInput.current.value = ""; }
  }

  function acceptImport() {
    if (!importDraft) return;
    const names = new Set(plan.rooms.map((room) => normalize(room.name)));
    const duplicate = importDraft.rooms.find((room) => names.has(normalize(room.name)));
    if (duplicate) { setError(`La stanza ${duplicate.name} esiste già. Modificala dalla sua scheda.`); return; }
    const next = { ...copy(plan), rooms: [...plan.rooms, ...importDraft.rooms] };
    const errors = validateRoomPlan(next, registrations, referenceDate);
    if (errors.length) { setError(errors[0]); return; }
    change(next, `${importDraft.rooms.length} stanze importate nella bozza.`); setImportDraft(null);
  }

  function generate() {
    try { setProposal(proposeRoomPlan(plan, registrations, referenceDate, { recalculate })); setError(""); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Impossibile generare la proposta."); }
  }

  function exportCsv() {
    const cell = (value: unknown) => `"${String(value ?? "").replace(/^[=+@\-\t\r]/, "'$&").replace(/"/g, '""')}"`;
    const rows: unknown[][] = [["Stanza", "Piano", "Categoria", "Capienza", "Partecipante", "Bloccato"]];
    for (const room of plan.rooms) {
      const occupants = registrations.filter((person) => plan.assignments[person.id] === room.id);
      if (!occupants.length) rows.push([room.name, room.floor, categoryLabels[room.category], room.capacity, "", ""]);
      for (const person of occupants) rows.push([room.name, room.floor, categoryLabels[room.category], room.capacity, nameOf(person), plan.lockedIds.includes(person.id) ? "Sì" : "No"]);
    }
    for (const person of unassigned) rows.push(["Da assegnare", "", "", "", nameOf(person), ""]);
    downloadFile(new Blob(["\uFEFF", rows.map((row) => row.map(cell).join(";")).join("\r\n")], { type: "text/csv;charset=utf-8" }), "bozza-stanze.csv");
  }

  function chooseModule() {
    setMessage(""); setWarning("");
    if (dirty) { setError("Salva la bozza prima di compilare il modulo della Foresteria."); return; }
    if (problems.length) { setError("Sistema prima i problemi segnalati nella bozza."); return; }
    if (!Object.keys(plan.assignments).length) { setError("Assegna prima le persone alle stanze."); return; }
    setError(""); moduleInput.current?.click();
  }

  async function fillModule(file?: File) {
    if (!file) return;
    setBusy(true); setError(""); setMessage(""); setWarning("");
    try {
      const namesForRoom = (roomId: string) => people.filter((person) => plan.assignments[person.id] === roomId).map(nameOf).sort((a, b) => a.localeCompare(b, "it"));
      const result = await fillForesteriaModule(file, plan, namesForRoom);
      downloadFile(result.blob, result.fileName);
      setMessage(`Modulo compilato: ${result.people} ${result.people === 1 ? "persona" : "persone"} in ${result.rooms} ${result.rooms === 1 ? "stanza" : "stanze"}${result.nights > 1 ? ` per ${result.nights} notti` : ""}. Controllalo prima di inviarlo alla Foresteria.`);
      if (result.night && result.night !== referenceDate.slice(0, 10)) setWarning(`Il file si riferisce alla notte del ${result.night}, mentre l\u2019attivit\u00E0 inizia il ${referenceDate.slice(0, 10)}. Verifica di aver scelto il modulo giusto.`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Impossibile compilare il modulo."); }
    finally { setBusy(false); if (moduleInput.current) moduleInput.current.value = ""; }
  }

  function changeView(next: "list" | "map") {
    setView(next); setArmedId(null);
    try { localStorage.setItem(VIEW_KEY, next); } catch { /* The chosen view is only a per-viewer convenience. */ }
  }

  async function importLayout(file?: File) {
    if (layoutInput.current) layoutInput.current.value = "";
    if (!file) return;
    setBusy(true); setError(""); setMessage(""); setWarning("");
    try {
      const layout = await readRoomLayoutFile(file);
      await onSaveLayout(layout);
      setLayoutList((current) => [...current.filter((item) => item.id !== layout.id), layout]);
      const rooms = layout.floors.reduce((sum, item) => sum + item.rooms.length, 0);
      setMessage(`Pianta “${layout.name}” salvata: ${layout.floors.length} ${layout.floors.length === 1 ? "piano" : "piani"} e ${rooms} stanze. La vedono solo gli admin del palo.`);
    } catch (cause) {
      const code = (cause as { code?: string }).code;
      if (code === "permission-denied") setError("Accesso non autorizzato. Accedi con un account amministratore.");
      else if (code) setError("Salvataggio non riuscito. Controlla la connessione e riprova.");
      else setError(cause instanceof Error ? cause.message : "Impossibile leggere il file della pianta.");
    } finally { setBusy(false); }
  }

  function mapRoom(room: Room) {
    if (armedPerson) {
      const reason = assignmentProblem(armedPerson, room, plan, registrations, referenceDate);
      if (reason) { setError(reason); return; }
      movePerson(armedPerson, room); setArmedId(null); return;
    }
    const taken = Object.values(plan.assignments).filter((id) => id === room.id).length;
    setError("");
    if (taken < room.capacity && room.category !== "unassigned") setPickerRoomId(room.id); else setRoomEditor({ ...room });
  }

  function recordCouple() {
    if (!selectedPerson || !partnerId || !coupleConfirmed) return;
    const next = copy(plan);
    const existing = next.couples.find((pair) => [pair.firstId, pair.secondId].includes(partnerId) && ![pair.firstId, pair.secondId].includes(selectedPerson.id));
    if (existing) { setError("L’accompagnatore scelto fa già parte di un’altra coppia."); return; }
    const old = next.couples.find((pair) => [pair.firstId, pair.secondId].includes(selectedPerson.id));
    if (old && ![old.firstId, old.secondId].includes(partnerId)) {
      setError("Rimuovi prima la coppia precedente."); return;
    }
    next.couples = next.couples.filter((pair) => ![pair.firstId, pair.secondId].includes(selectedPerson.id));
    next.couples.push({ firstId: selectedPerson.id, secondId: partnerId, confirmed: true });
    change(next, "Richiesta della coppia registrata. Ora puoi assegnare entrambi alla matrimoniale.");
  }

  const errorNotice = error ? <div className="rp-notice rp-notice--error" role="alert">{error}</div> : null;
  const selectedPair = selectedPerson ? plan.couples.find((pair) => [pair.firstId, pair.secondId].includes(selectedPerson.id)) : undefined;
  const mapView = <div className="rp-map-view">
    {layoutsFailed ? <p className="rp-notice rp-notice--error" role="alert">Impossibile caricare le piante del palo. Controlla la connessione e riprova.</p> : null}
    {unreadableLayouts.length ? <p className="rp-notice rp-notice--warning">Una pianta salvata non si legge più ({unreadableLayouts.join(", ")}): caricala di nuovo.</p> : null}
    {armedPerson ? <div className="rp-armed" role="status"><span><strong>{nameOf(armedPerson)}</strong>Tocca una stanza evidenziata per assegnarla.</span>
      <div className="rp-actions"><button type="button" className="button button--ghost button--small" onClick={() => { setSelectedPersonId(armedPerson.id); setArmedId(null); }}>Apri scheda</button>
        <button type="button" className="button button--ghost button--small" onClick={() => setArmedId(null)}>Annulla</button></div></div> : null}
    {!plan.rooms.length ? <p className="rp-empty-small">Importa prima le stanze: la pianta mostra quelle della bozza.</p>
      : layoutMatch ? <RoomMap layout={layoutMatch.layout} plan={plan} peopleById={peopleById} nameOf={nameOf}
        problemFor={armedPerson ? (room) => assignmentProblem(armedPerson, room, plan, registrations, referenceDate) : undefined}
        onRoom={mapRoom} onPerson={(id) => { setArmedId(null); setSelectedPersonId(id); }} />
      : <div className="rp-empty"><span><AppIcon name="map-pin" /></span><h3>{layoutList.length ? "La pianta non corrisponde" : "Nessuna pianta"}</h3>
        <p>{layoutList.length ? "Le piante salvate non contengono le stanze di questa bozza. Carica quella della struttura giusta." : "Carica il file della pianta della struttura. Si prepara una volta e la vedono solo gli admin del palo."}</p>
        <button type="button" className="button button--primary" onClick={() => layoutInput.current?.click()}>Carica pianta</button><small>File .json con piani, stanze e spazi.</small></div>}
    {layoutMatch ? <div className="rp-map-footer"><small>{layoutMatch.layout.name}</small><button type="button" className="button button--ghost button--small" onClick={() => layoutInput.current?.click()}><AppIcon name="refresh" />Aggiorna pianta</button></div> : null}
    <input ref={layoutInput} type="file" accept=".json,application/json" hidden aria-label="File della pianta" onChange={(event) => void importLayout(event.target.files?.[0])} />
  </div>;

  return <section className="room-planner" aria-label="Gestione stanze">
    <header className="rp-header">
      <div><span className="rp-eyebrow"><AppIcon name="key" /> Pernottamento</span><h2>Organizza le stanze</h2><p>Organizza i posti, rispetta le preferenze e rifinisci la bozza insieme agli altri admin.</p></div>
      <span className={`rp-status ${dirty ? "rp-status--dirty" : ""}`}><span />{dirty ? "Modifiche da salvare" : "Bozza riservata"}</span>
    </header>
    <div className="rp-stats">
      <div><strong>{summary.assigned}<small> / {people.length}</small></strong><span>partecipanti assegnati</span></div>
      <div><strong>{summary.freeBeds}<small> / {summary.totalBeds}</small></strong><span>posti ancora liberi</span></div>
      <div><strong>{summary.preferencesMet}<small> / {summary.preferencesTotal}</small></strong><span>preferenze soddisfatte</span></div>
      <div><strong>{plan.rooms.length}</strong><span>stanze disponibili</span></div>
    </div>
    {errorNotice}
    {message ? <p className="rp-notice" role="status">{message}</p> : null}
    {warning ? <p className="rp-notice rp-notice--warning" role="status">{warning}</p> : null}
    {problems.length ? <div className="rp-notice rp-notice--warning"><strong>Da sistemare prima del salvataggio</strong><ul>{problems.slice(0, 8).map((problem, index) => <li key={index}>{problem}</li>)}</ul>
      {Object.keys(plan.assignments).some((id) => !people.some((person) => person.id === id)) ? <button className="button button--ghost button--small" onClick={() => {
        const next = copy(plan); const activeIds = new Set(people.map((person) => person.id));
        for (const id of Object.keys(next.assignments)) if (!activeIds.has(id)) delete next.assignments[id];
        next.lockedIds = next.lockedIds.filter((id) => activeIds.has(id));
        next.adultGenders = Object.fromEntries(Object.entries(next.adultGenders).filter(([id]) => activeIds.has(id)));
        next.couples = next.couples.filter((pair) => activeIds.has(pair.firstId) && activeIds.has(pair.secondId));
        change(next, "Rimosse dalla bozza le iscrizioni non più disponibili.");
      }}>Rimuovi iscrizioni non più disponibili</button> : null}
    </div> : null}
    <fieldset className="rp-workspace" disabled={busy}>
      <div className="rp-toolbar">
        <div className="rp-actions"><button className="button button--primary" disabled={!plan.rooms.length || problems.length > 0} onClick={() => { setProposal(null); setAutoOpen(true); }}><AppIcon name="sparkles" />Assegna automaticamente</button>
          <button className="button button--secondary" onClick={() => fileInput.current?.click()}><AppIcon name="download" />Importa stanze</button>
          <button className="button button--ghost" onClick={addRoom}><AppIcon name="plus" />Aggiungi stanza</button>
          <input ref={fileInput} type="file" accept=".xlsx,.xls,.csv" hidden aria-label="File delle stanze" onChange={(event) => void importFile(event.target.files?.[0])} />
        </div>
        <div className="rp-actions"><button className="button button--ghost button--small" onClick={exportCsv} disabled={!plan.rooms.length}><AppIcon name="download" />Esporta bozza</button>
          <button className="button button--ghost button--small" onClick={chooseModule} disabled={!plan.rooms.length}><AppIcon name="download" />Compila modulo Foresteria</button>
          <input ref={moduleInput} type="file" accept=".xlsx" hidden aria-label="Modulo della Foresteria" onChange={(event) => void fillModule(event.target.files?.[0])} />
        </div>
      </div>
      <div className="rp-board">
        <aside className="rp-people">
          <div className="rp-people__title"><h3>Da assegnare</h3><span>{unassigned.length}</span></div>
          <label className="rp-search"><span>Cerca partecipante</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Nome e cognome" type="search" /></label>
          <label className="rp-checkbox"><input type="checkbox" checked={showAssigned} onChange={(event) => setShowAssigned(event.target.checked)} />Mostra anche gli assegnati</label>
          <div className="rp-people__list">
            {shownPeople.map((person) => <button className={`rp-person${armedId === person.id ? " is-armed" : ""}`} key={person.id} aria-pressed={view === "map" ? armedId === person.id : undefined}
              onClick={() => (view === "map" ? setArmedId(armedId === person.id ? null : person.id) : setSelectedPersonId(person.id))}>
              <span className={`rp-avatar rp-avatar--${person.genderRoleCategory}`}>{nameOf(person).split(/\s+/).map((word) => word[0]).slice(0, 2).join("")}</span>
              <span><strong>{nameOf(person)}</strong><small>{isAdult(person) ? "Accompagnatore" : person.genderRoleCategory === "giovane_donna" ? "Ragazza" : person.genderRoleCategory === "giovane_uomo" ? "Ragazzo" : "Categoria da verificare"}{ageAt(person.birthDate, referenceDate) !== null ? ` · ${ageAt(person.birthDate, referenceDate)} anni` : ""}</small>
                {person.answers?.roomNotes ? <em>Nota stanza da leggere</em> : null}
                {plan.assignments[person.id] ? <small>Stanza {plan.rooms.find((room) => room.id === plan.assignments[person.id])?.name}</small> : null}
              </span><AppIcon name="plus" />
            </button>)}
            {!shownPeople.length ? <p className="rp-empty-small">{search ? "Nessun partecipante trovato." : "Tutti i partecipanti sono assegnati."}</p> : null}
          </div>
          <p className="rp-aside-note">{view === "map" ? "Sulla pianta: tocca una persona, poi una stanza evidenziata. " : ""}Le assegnazioni manuali vengono bloccate, così il calcolo automatico le conserva.</p>
        </aside>
        <div className="rp-rooms">
          <div className="rp-filters"><h3>Le stanze</h3>
            <div className="rp-view" role="group" aria-label="Vista delle stanze"><button type="button" className={view === "list" ? "is-on" : ""} aria-pressed={view === "list"} onClick={() => changeView("list")}><AppIcon name="list" />Elenco</button>
              <button type="button" className={view === "map" ? "is-on" : ""} aria-pressed={view === "map"} onClick={() => changeView("map")}><AppIcon name="map-pin" />Pianta</button></div>
            {view === "list" ? <><select aria-label="Filtra per categoria" value={category} onChange={(event) => setCategory(event.target.value)}><option value="all">Tutte le categorie</option>{Object.entries(categoryLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select>
            {floors.length > 1 ? <select aria-label="Filtra per piano" value={floor} onChange={(event) => setFloor(event.target.value)}><option value="all">Tutti i piani</option>{floors.map((item) => <option key={item}>{item}</option>)}</select> : null}</> : null}
          </div>
          {view === "map" ? mapView : <>{!plan.rooms.length ? <div className="rp-empty"><span><AppIcon name="building" /></span><h3>Partiamo dalle stanze.</h3><p>Importa il file dell’ostello. Troverai qui ogni stanza con i suoi letti, pronta da organizzare.</p><button className="button button--primary" onClick={() => fileInput.current?.click()}>Importa file Excel o CSV</button><small>Compatibile con il modulo della Foresteria del Tempio di Roma.</small></div> : null}
          {plan.rooms.length > 0 && !visibleRooms.length ? <p className="rp-empty-small">Nessuna stanza per questi filtri.</p> : null}
          <div className="rp-room-grid">{visibleRooms.map((room) => {
            const ids = Object.keys(plan.assignments).filter((id) => plan.assignments[id] === room.id);
            return <article className={`rp-room rp-room--${room.category}`} key={room.id} aria-label={`Stanza ${room.name}`}>
              <header><div><small>{room.floor || "Piano non indicato"}</small><h4>{room.name}</h4></div><button className="icon-button icon-button--soft" aria-label={`Modifica stanza ${room.name}`} onClick={() => { setError(""); setRoomEditor({ ...room }); }}><AppIcon name="pencil" /></button></header>
              <div className="rp-room__meta"><span className="rp-category">{categoryLabels[room.category]}</span><strong>{ids.length}<span>/{room.capacity}</span></strong></div>
              <div className="rp-bed-bar" aria-label={`${ids.length} ${ids.length === 1 ? "posto occupato" : "posti occupati"} su ${room.capacity}`}>{Array.from({ length: room.capacity }, (_, index) => <i key={index} className={index < ids.length ? "is-occupied" : ""} />)}</div>
              {room.accessible ? <p className="rp-room__note">Stanza accessibile</p> : null}
              {room.minAge !== null || room.maxAge !== null ? <p className="rp-room__note">Età: {room.minAge ?? "nessun minimo"} – {room.maxAge ?? "nessun massimo"}</p> : null}
              {room.notes ? <p className="rp-room__note">{room.notes}</p> : null}
              <div className="rp-occupants">{ids.map((id) => {
                const person = peopleById.get(id);
                const met = links.some((link) => link.fromId === id && link.toId && plan.assignments[link.toId] === room.id);
                return <div className="rp-occupant" key={id}><button onClick={() => setSelectedPersonId(id)}><strong>{person ? nameOf(person) : "Iscrizione non più disponibile"}</strong>{met ? <small><AppIcon name="check" />Preferenza soddisfatta</small> : null}</button><button className={`rp-lock ${plan.lockedIds.includes(id) ? "is-locked" : ""}`} aria-label={`${plan.lockedIds.includes(id) ? "Sblocca" : "Blocca"} ${person ? nameOf(person) : id}`} onClick={() => { const next = copy(plan); next.lockedIds = next.lockedIds.includes(id) ? next.lockedIds.filter((item) => item !== id) : [...next.lockedIds, id]; change(next); }}><AppIcon name="lock" /></button></div>;
              })}</div>
              {ids.length < room.capacity ? <button className="rp-add-person" onClick={() => { if (room.category === "unassigned") setRoomEditor({ ...room }); else setPickerRoomId(room.id); }}><AppIcon name="plus" />{room.capacity - ids.length} {room.capacity - ids.length === 1 ? "posto libero" : "posti liberi"}</button> : <div className="rp-full"><AppIcon name="check" />Stanza completa</div>}
            </article>;
          })}</div></>}
        </div>
      </div>
      <div className="rp-savebar"><div><strong>{dirty ? "La bozza ha modifiche non salvate" : "Bozza visibile solo agli admin"}</strong><small>{busy ? "Operazione in corso..." : "Nessuna assegnazione viene comunicata ai partecipanti."}</small></div><div className="rp-actions"><button className="button button--ghost" disabled={!history.length} onClick={() => { const previous = history[history.length - 1]; setPlan(previous); setHistory(history.slice(0, -1)); setError(""); setMessage("Ultima modifica annullata."); }}>Annulla ultima modifica</button><button className="button button--primary" disabled={!dirty || problems.length > 0 || conflict} onClick={() => void savePlan()}>{busy ? "Salvataggio..." : "Salva bozza"}</button></div></div>
    </fieldset>
    {conflict ? <button className="button button--secondary" onClick={onReload}>Ricarica la bozza condivisa</button> : null}

    {pickerRoom ? <AppModal title={`Aggiungi alla stanza ${pickerRoom.name}`} subtitle="Solo partecipanti ancora da assegnare" onClose={() => setPickerRoomId(null)}>
      <div className="rp-destinations">{unassigned.filter((person) => !assignmentProblem(person, pickerRoom, plan, registrations, referenceDate)).map((person) => <button key={person.id} onClick={() => { setPickerRoomId(null); setSelectedPersonId(person.id); }}><span><strong>{nameOf(person)}</strong><small>{String(person.answers.roomNotes || "Apri preferenze e assegnazione")}</small></span><AppIcon name="arrow-right" width={20} /></button>)}</div>
      {!unassigned.some((person) => !assignmentProblem(person, pickerRoom, plan, registrations, referenceDate)) ? <p className="rp-aside-note">Nessun partecipante compatibile. Per gli accompagnatori, verifica prima genere e richiesta della coppia dalla scheda personale.</p> : null}
    </AppModal> : null}

    {roomEditor ? <AppModal title={plan.rooms.some((room) => room.id === roomEditor.id) ? `Modifica stanza ${roomEditor.name}` : "Aggiungi stanza"} onClose={() => { setRoomEditor(null); setError(""); }} size="compact">
      {errorNotice}<form className="rp-form" onSubmit={saveRoom}>
        <label>Numero o nome<input autoFocus value={roomEditor.name} maxLength={80} required onChange={(event) => setRoomEditor({ ...roomEditor, name: event.target.value })} /></label>
        <div className="rp-form-row"><label>Posti letto<input type="number" min={1} max={50} required value={roomEditor.capacity} onChange={(event) => setRoomEditor({ ...roomEditor, capacity: Number(event.target.value) })} /></label><label>Piano<input value={roomEditor.floor} maxLength={80} onChange={(event) => setRoomEditor({ ...roomEditor, floor: event.target.value })} /></label></div>
        <label>Riservata a<CategorySelect label="Categoria stanza" value={roomEditor.category} onChange={(value) => setRoomEditor({ ...roomEditor, category: value })} /></label>
        <div className="rp-form-row"><label>Età minima<input type="number" min={0} max={120} value={roomEditor.minAge ?? ""} onChange={(event) => setRoomEditor({ ...roomEditor, minAge: event.target.value === "" ? null : Number(event.target.value) })} /></label><label>Età massima<input type="number" min={0} max={120} value={roomEditor.maxAge ?? ""} onChange={(event) => setRoomEditor({ ...roomEditor, maxAge: event.target.value === "" ? null : Number(event.target.value) })} /></label></div>
        <label className="rp-checkbox"><input type="checkbox" checked={roomEditor.accessible} onChange={(event) => setRoomEditor({ ...roomEditor, accessible: event.target.checked })} />Stanza accessibile</label>
        <label>Note<textarea value={roomEditor.notes} maxLength={1000} onChange={(event) => setRoomEditor({ ...roomEditor, notes: event.target.value })} /></label>
        {roomEditor.category === "couple" ? <p className="rp-notice">Solo due accompagnatori sposati che abbiano chiesto esplicitamente di stare insieme. Registra la coppia dalla scheda del partecipante.</p> : null}
        <div className="rp-actions"><button type="submit" className="button button--primary">Applica alla bozza</button>{plan.rooms.some((room) => room.id === roomEditor.id) ? <button type="button" className="button button--ghost" disabled={Object.values(plan.assignments).includes(roomEditor.id)} onClick={() => { const next = { ...copy(plan), rooms: plan.rooms.filter((room) => room.id !== roomEditor.id) }; const errors = validateRoomPlan(next, registrations, referenceDate); if (errors.length) { setError(errors[0]); return; } change(next); setRoomEditor(null); }}>Rimuovi stanza vuota</button> : null}</div>
      </form>
    </AppModal> : null}

    {importDraft ? <AppModal title="Controlla le stanze da importare" subtitle={`${importDraft.rooms.length} stanze · ${importDraft.rooms.reduce((sum, room) => sum + room.capacity, 0)} posti letto`} onClose={() => { setImportDraft(null); setError(""); }} size="wide" footer={<button className="button button--primary" onClick={acceptImport}>Importa nella bozza</button>}>
      {errorNotice}{importDraft.night && importDraft.night !== referenceDate.slice(0, 10) ? <p className="rp-notice rp-notice--warning">Il file si riferisce alla notte del {importDraft.night}, mentre l’attività inizia il {referenceDate.slice(0, 10)}. Verifica che siano le stanze corrette.</p> : null}
      {importDraft.warnings.map((warning) => <p className="rp-notice" key={warning}>{warning}</p>)}
      <p className="rp-aside-note">“Da decidere” lascia al calcolatore la scelta tra ragazzi e ragazze. Le stanze accompagnatori e le matrimoniali rimangono riservate.</p>
      <div className="rp-import-table"><table><thead><tr><th>Stanza</th><th>Piano</th><th>Posti</th><th>Riservata a</th></tr></thead><tbody>{importDraft.rooms.map((room, index) => <tr key={room.id}><td><strong>{room.name}</strong>{room.accessible ? <small>Accessibile</small> : null}</td><td>{room.floor}</td><td>{room.capacity}</td><td><CategorySelect label={`Categoria stanza ${room.name}`} value={room.category} onChange={(value) => setImportDraft({ ...importDraft, rooms: importDraft.rooms.map((item, itemIndex) => itemIndex === index ? { ...item, category: value } : item) })} /></td></tr>)}</tbody></table></div>
    </AppModal> : null}

    {selectedPerson ? <AppModal title={nameOf(selectedPerson)} subtitle="Preferenze e assegnazione manuale" onClose={() => { setSelectedPersonId(null); setError(""); }}>
      {errorNotice}<div className="rp-form">
        <div className="rp-preferences">{links.filter((link) => link.fromId === selectedPerson.id).map((link) => <p key={link.key}><strong>{link.label}: {String(selectedPerson.answers[link.key] || "")}</strong><small>{link.toId ? `Iscritto riconosciuto: ${peopleById.get(link.toId)?.fullName ?? ""}` : "Nome da verificare: nessun abbinamento univoco"}</small></p>)}
          {!links.some((link) => link.fromId === selectedPerson.id) ? <p>Nessuna preferenza compagno indicata.</p> : null}
          {selectedPerson.answers?.roomNotes ? <p className="rp-notice rp-notice--warning"><strong>Note stanza</strong><span>{String(selectedPerson.answers.roomNotes)}</span></p> : null}
        </div>
        {isAdult(selectedPerson) ? <>
          <label>Genere dell’accompagnatore<select value={plan.adultGenders[selectedPerson.id] ?? ""} onChange={(event) => { const next = copy(plan); if (event.target.value) next.adultGenders[selectedPerson.id] = event.target.value as "male" | "female"; else delete next.adultGenders[selectedPerson.id]; const assigned = next.rooms.find((room) => room.id === next.assignments[selectedPerson.id]); if (assigned) { const reason = assignmentProblem(selectedPerson, assigned, next, registrations, referenceDate); if (reason) { setError("Rimuovi prima l’assegnazione incompatibile con questo genere."); return; } } change(next); }}><option value="">Da verificare</option><option value="male">Uomo</option><option value="female">Donna</option></select></label>
          <details className="rp-couple"><summary>Coppia di accompagnatori</summary><p>Usa questa opzione solo per marito e moglie che abbiano richiesto di stare insieme.</p><label>Coniuge<select value={partnerId} onChange={(event) => { setPartnerId(event.target.value); setCoupleConfirmed(false); }}><option value="">Scegli accompagnatore</option>{people.filter((person) => isAdult(person) && person.id !== selectedPerson.id).map((person) => <option value={person.id} key={person.id}>{nameOf(person)}</option>)}</select></label>
            {partnerId && peopleById.get(partnerId) ? <p className="rp-notice">Richieste del coniuge: {[peopleById.get(partnerId)?.answers.roomPreference1Name, peopleById.get(partnerId)?.answers.roomPreference2Name, peopleById.get(partnerId)?.answers.roomNotes].filter(Boolean).join(" · ") || "Nessuna richiesta nelle note dell’iscrizione."}</p> : null}
            <label className="rp-checkbox"><input type="checkbox" checked={coupleConfirmed} onChange={(event) => setCoupleConfirmed(event.target.checked)} />Ho verificato che sono marito e moglie e hanno richiesto esplicitamente di stare insieme.</label>
            <button className="button button--secondary" disabled={!partnerId || !coupleConfirmed} onClick={recordCouple}>Registra richiesta della coppia</button>
            {selectedPair ? <button className="button button--ghost" onClick={() => { const next = copy(plan); const ids = [selectedPair.firstId, selectedPair.secondId]; const inCoupleRoom = ids.some((id) => next.rooms.some((room) => room.id === next.assignments[id] && room.category === "couple")); if (inCoupleRoom) { setError("Rimuovi prima entrambi dalla stanza matrimoniale."); return; } next.couples = next.couples.filter((pair) => pair !== selectedPair && ![pair.firstId, pair.secondId].includes(selectedPerson.id)); change(next); }}>Rimuovi richiesta della coppia</button> : null}
          </details>
        </> : null}
        <h3>{plan.assignments[selectedPerson.id] ? "Sposta in un’altra stanza" : "Scegli la stanza"}</h3>
        <div className="rp-destinations">{plan.rooms.map((room) => {
          const reason = assignmentProblem(selectedPerson, room, plan, registrations, referenceDate);
          const current = plan.assignments[selectedPerson.id] === room.id;
          const freeBeds = room.capacity - Object.values(plan.assignments).filter((id) => id === room.id).length;
          return <button key={room.id} disabled={Boolean(reason) || current} onClick={() => movePerson(selectedPerson, room)}><span><strong>{room.name}</strong><small>{categoryLabels[room.category]} · {room.floor}</small></span><span>{current ? "Stanza attuale" : reason || `${freeBeds} ${freeBeds === 1 ? "posto libero" : "posti liberi"}`}</span></button>;
        })}</div>
        {plan.assignments[selectedPerson.id] ? <button className="button button--secondary" onClick={() => movePerson(selectedPerson, null)}>Rimuovi assegnazione</button> : null}
        {!plan.rooms.length ? <p>Importa o aggiungi prima le stanze.</p> : null}
      </div>
    </AppModal> : null}

    {autoOpen ? <AppModal title="Proposta automatica" subtitle="Rivedi il risultato prima di applicarlo alla bozza" onClose={() => { setAutoOpen(false); setError(""); }}>
      {errorNotice}<div className="rp-form"><p>Il calcolo cerca di tenere insieme i compagni richiesti, rispettando capienza, separazione ragazzi/ragazze ed eventuali fasce d’età. Gli accompagnatori si sistemano a mano.</p>
        <label className="rp-checkbox"><input type="checkbox" checked={recalculate} onChange={(event) => { setRecalculate(event.target.checked); setProposal(null); }} />Ricalcola anche le assegnazioni non bloccate</label>
        <p className="rp-aside-note">{recalculate ? "Le assegnazioni bloccate e quelle degli accompagnatori saranno conservate." : "Tutte le assegnazioni presenti saranno conservate. Il calcolo completa solo i posti mancanti."}</p>
        {notesCount > 0 ? <p className="rp-notice rp-notice--warning">{notesCount} partecipanti hanno note stanza da leggere: rimarranno da assegnare a mano.</p> : null}
        <button className="button button--secondary" onClick={generate}><AppIcon name="sparkles" />{proposal ? "Ricalcola proposta" : "Calcola proposta"}</button>
        {proposal ? (() => {
          const result = roomSummary(proposal, people); const remaining = people.filter((person) => !proposal.assignments[person.id]);
          return <div className="rp-proposal"><div className="rp-stats"><div><strong>{result.assigned}</strong><span>assegnati</span></div><div><strong>{result.preferencesMet}<small>/{result.preferencesTotal}</small></strong><span>preferenze soddisfatte</span></div></div>
            {remaining.length ? <><h4>{remaining.length} partecipanti da sistemare a mano</h4><ul>{remaining.map((person) => <li key={person.id}>{nameOf(person)}<small>{isAdult(person) ? "Accompagnatore: assegnazione manuale" : person.answers?.roomNotes ? "Nota stanza da verificare" : "Posti compatibili insufficienti o dati da verificare"}</small></li>)}</ul></> : <p>Tutti i partecipanti hanno un posto.</p>}
            {result.unresolvedPreferences ? <p className="rp-notice">{result.unresolvedPreferences} preferenze contengono nomi da verificare.</p> : null}
            <p className="rp-aside-note">Le preferenze sono obiettivi del calcolo: non sempre possono essere soddisfatte tutte.</p>
            <button className="button button--primary" onClick={() => { change(proposal, "Proposta applicata. Puoi ancora spostare i partecipanti prima di salvare."); setAutoOpen(false); setProposal(null); }}>Applica proposta</button>
          </div>;
        })() : null}
      </div>
    </AppModal> : null}
  </section>;
}
