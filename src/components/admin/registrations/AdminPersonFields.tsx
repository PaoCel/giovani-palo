import { useId } from "react";

import { AppIcon } from "@/components/AppIcon";
import { ISCRITTI } from "@/copy/iscritti";
import { fillCopy } from "@/copy/parole";
import type { GenderRoleCategory, Unit } from "@/types";
import type {
  AdminParentDraft,
  AdminPersonDraft,
  ManualAddProblem,
} from "@/utils/adminRegistration";
import "@/styles/registerFlow.css";

const CATEGORIES: Array<{ value: GenderRoleCategory; label: string }> = [
  { value: "giovane_uomo", label: ISCRITTI.giovaneUomo },
  { value: "giovane_donna", label: ISCRITTI.giovaneDonna },
  { value: "dirigente", label: ISCRITTI.dirigente },
  { value: "accompagnatore", label: ISCRITTI.accompagnatore },
];

const BIRTH_DATE_MIN = "1920-01-01";

const PROBLEM_TEXT: Record<ManualAddProblem, string> = {
  nome: ISCRITTI.erroreNome,
  cognome: ISCRITTI.erroreCognome,
  dataNascita: ISCRITTI.erroreDataNascita,
  categoria: ISCRITTI.erroreCategoria,
  unita: ISCRITTI.erroreUnitaScelta,
  emailPersona: ISCRITTI.erroreEmail,
  emailGenitore: ISCRITTI.erroreEmail,
};

function FieldError({ id, problem }: { id: string; problem: ManualAddProblem | null }) {
  return problem ? (
    <small className="field-error" id={id} role="alert">
      {PROBLEM_TEXT[problem]}
    </small>
  ) : null;
}

function Label({ text, optional }: { text: string; optional?: string }) {
  return (
    <span>
      {text}
      {optional ? <span className="admin-person-fields__optional"> · {optional}</span> : null}
    </span>
  );
}

interface AdminPersonFieldsProps {
  person: AdminPersonDraft;
  onChange: (patch: Partial<AdminPersonDraft>) => void;
  units: Unit[];
  // Problemi da mostrare (dopo il primo tentativo di salvare).
  problems: ManualAddProblem[];
  // Valori di prima (Modifica dati): i campi cambiati lo dicono.
  previous?: AdminPersonDraft;
  // Sotto la data: cosa ne segue per il consenso.
  birthDateNotice?: string | null;
  // Sotto l'unità: chi la vedrà.
  unitNotice?: string | null;
  disabled?: boolean;
}

// Dati della persona in "Aggiungi a mano" e "Modifica dati"
// (docs/ADMIN_ISCRITTI.md, B e D): stessi campi e classi del foglio del figlio
// in Famiglia (ChildForm).
export function AdminPersonFields({
  person,
  onChange,
  units,
  problems,
  previous,
  birthDateNotice,
  unitNotice,
  disabled = false,
}: AdminPersonFieldsProps) {
  const ids = useId();
  const problemFor = (key: ManualAddProblem) => (problems.includes(key) ? key : null);
  const todayValue = new Date().toISOString().slice(0, 10);
  // L'unità attuale, se non è più fra le attive, resta scelta e visibile.
  const unitOptions =
    person.unitId && !units.some((unit) => unit.id === person.unitId)
      ? [{ id: person.unitId, name: person.unitName || person.unitId }, ...units]
      : units;
  const changed = (key: keyof AdminPersonDraft) =>
    Boolean(previous) && previous?.[key] !== person[key];
  const inputClass = (key: keyof AdminPersonDraft) =>
    changed(key) ? "input admin-person-fields__changed" : "input";
  const before = (key: keyof AdminPersonDraft, value?: string) =>
    previous && changed(key) ? (
      <small className="admin-person-fields__before">
        {fillCopy(ISCRITTI.prima, { valore: value ?? (previous[key] || "—") })}
      </small>
    ) : null;

  return (
    <fieldset className="admin-person-fields" disabled={disabled}>
      <div className="flow-name-row">
        <label className="field">
          <Label text={ISCRITTI.nome} />
          <input
            aria-describedby={problemFor("nome") ? `${ids}-nome` : undefined}
            aria-invalid={problemFor("nome") ? true : undefined}
            autoCapitalize="words"
            autoComplete="off"
            className={inputClass("firstName")}
            value={person.firstName}
            onChange={(event) => onChange({ firstName: event.target.value })}
          />
          {before("firstName")}
          <FieldError id={`${ids}-nome`} problem={problemFor("nome")} />
        </label>
        <label className="field">
          <Label text={ISCRITTI.cognome} />
          <input
            aria-describedby={problemFor("cognome") ? `${ids}-cognome` : undefined}
            aria-invalid={problemFor("cognome") ? true : undefined}
            autoCapitalize="words"
            autoComplete="off"
            className={inputClass("lastName")}
            value={person.lastName}
            onChange={(event) => onChange({ lastName: event.target.value })}
          />
          {before("lastName")}
          <FieldError id={`${ids}-cognome`} problem={problemFor("cognome")} />
        </label>
      </div>

      <label className="field">
        <Label text={ISCRITTI.dataNascita} />
        <input
          aria-describedby={`${ids}-data-nota ${ids}-data`}
          aria-invalid={problemFor("dataNascita") ? true : undefined}
          className={inputClass("birthDate")}
          max={todayValue}
          min={BIRTH_DATE_MIN}
          type="date"
          value={person.birthDate}
          onChange={(event) => onChange({ birthDate: event.target.value })}
        />
        {before("birthDate")}
        {birthDateNotice ? (
          <small className="child-form__warning" id={`${ids}-data-nota`}>
            {birthDateNotice}
          </small>
        ) : null}
        <FieldError id={`${ids}-data`} problem={problemFor("dataNascita")} />
      </label>

      <fieldset className="flow-pills">
        <legend>{ISCRITTI.categoria}</legend>
        <div className="flow-pills__options">
          {CATEGORIES.map((category) => {
            const selected = person.genderRoleCategory === category.value;
            return (
              <label
                className={selected ? "flow-pill flow-pill--selected" : "flow-pill"}
                key={category.value}
              >
                <input
                  checked={selected}
                  name={`${ids}-categoria`}
                  onChange={() => onChange({ genderRoleCategory: category.value })}
                  type="radio"
                  value={category.value}
                />
                {selected ? <AppIcon name="check" /> : null}
                <span>{category.label}</span>
              </label>
            );
          })}
        </div>
        <FieldError id={`${ids}-categoria`} problem={problemFor("categoria")} />
      </fieldset>

      <label className="field">
        <Label text={ISCRITTI.unita} />
        <select
          aria-describedby={`${ids}-unita-nota ${ids}-unita`}
          aria-invalid={problemFor("unita") ? true : undefined}
          className={inputClass("unitId")}
          disabled={unitOptions.length === 0}
          value={person.unitId}
          onChange={(event) => {
            const unit = unitOptions.find((option) => option.id === event.target.value);
            onChange({ unitId: event.target.value, unitName: unit?.name ?? "" });
          }}
        >
          <option value="">
            {unitOptions.length > 0 ? ISCRITTI.selezionaUnita : ISCRITTI.nessunaUnita}
          </option>
          {unitOptions.map((unit) => (
            <option key={unit.id} value={unit.id}>
              {unit.name}
            </option>
          ))}
        </select>
        {before("unitId", previous?.unitName || "—")}
        {unitOptions.length === 0 ? (
          <small className="admin-person-fields__note">{ISCRITTI.aiutoNessunaUnita}</small>
        ) : unitNotice ? (
          <small className="admin-person-fields__note" id={`${ids}-unita-nota`}>
            {unitNotice}
          </small>
        ) : null}
        <FieldError id={`${ids}-unita`} problem={problemFor("unita")} />
      </label>

      <div className="flow-name-row">
        <label className="field">
          <Label optional={ISCRITTI.facoltativa} text={ISCRITTI.email} />
          <input
            aria-describedby={problemFor("emailPersona") ? `${ids}-email` : undefined}
            aria-invalid={problemFor("emailPersona") ? true : undefined}
            autoComplete="off"
            className={inputClass("email")}
            inputMode="email"
            type="email"
            value={person.email}
            onChange={(event) => onChange({ email: event.target.value })}
          />
          {before("email")}
          <FieldError id={`${ids}-email`} problem={problemFor("emailPersona")} />
        </label>
        <label className="field">
          <Label optional={ISCRITTI.facoltativo} text={ISCRITTI.telefono} />
          <input
            autoComplete="off"
            className={inputClass("phone")}
            inputMode="tel"
            type="tel"
            value={person.phone}
            onChange={(event) => onChange({ phone: event.target.value })}
          />
          {before("phone")}
        </label>
      </div>
    </fieldset>
  );
}

interface AdminParentFieldsProps {
  parent: AdminParentDraft;
  onChange: (patch: Partial<AdminParentDraft>) => void;
  subtitle?: string;
  problems: ManualAddProblem[];
  // "Chiedi l'autorizzazione": l'email è il motivo del foglio, non facoltativa.
  emailRequired?: boolean;
  disabled?: boolean;
}

// Blocco "Genitore": solo per chi ha meno di 18 anni in un'attività che chiede
// l'autorizzazione. I dati finiscono nella richiesta (answers.
// parentAuthorizationRequest) che il trigger delle autorizzazioni legge.
export function AdminParentFields({
  parent,
  onChange,
  subtitle,
  problems,
  emailRequired = false,
  disabled = false,
}: AdminParentFieldsProps) {
  const ids = useId();
  const emailProblem = problems.includes("emailGenitore") ? "emailGenitore" : null;

  return (
    <fieldset className="admin-person-fields admin-parent-fields" disabled={disabled}>
      <legend>{ISCRITTI.genitore}</legend>
      {subtitle ? <p className="admin-person-fields__note">{subtitle}</p> : null}
      <div className="flow-name-row">
        <label className="field">
          <Label text={ISCRITTI.nomeGenitore} />
          <input
            autoCapitalize="words"
            autoComplete="off"
            className="input"
            value={parent.firstName}
            onChange={(event) => onChange({ firstName: event.target.value })}
          />
        </label>
        <label className="field">
          <Label text={ISCRITTI.cognome} />
          <input
            autoCapitalize="words"
            autoComplete="off"
            className="input"
            value={parent.lastName}
            onChange={(event) => onChange({ lastName: event.target.value })}
          />
        </label>
      </div>
      <label className="field">
        <Label optional={emailRequired ? undefined : ISCRITTI.facoltativa} text={ISCRITTI.email} />
        <input
          aria-describedby={emailProblem ? `${ids}-email` : undefined}
          aria-invalid={emailProblem ? true : undefined}
          autoComplete="off"
          className="input"
          inputMode="email"
          type="email"
          value={parent.email}
          onChange={(event) => onChange({ email: event.target.value })}
        />
        <FieldError id={`${ids}-email`} problem={emailProblem} />
      </label>
      <label className="field">
        <Label optional={ISCRITTI.facoltativo} text={ISCRITTI.telefono} />
        <input
          autoComplete="off"
          className="input"
          inputMode="tel"
          type="tel"
          value={parent.phone}
          onChange={(event) => onChange({ phone: event.target.value })}
        />
      </label>
    </fieldset>
  );
}
