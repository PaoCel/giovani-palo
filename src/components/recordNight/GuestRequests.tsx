import type { Ref } from "react";

import {
  CATEGORY_ICONS,
  MEASURE_ICONS,
  RecordNightIcon,
} from "@/components/recordNight/RecordNightIcon";
import type { RecordNightGuestRequest, RecordNightPublicRecord } from "@/types";
import {
  getRecordNightCategoryLabel,
  getRecordNightMeasureShortLabel,
} from "@/utils/recordNight";
import {
  GUEST_COPY,
  GUEST_STATE_TEXTS,
  getGuestStateText,
  sortGuestRequestsByPerson,
  stripBidi,
} from "@/utils/recordNightGuest";

type RecordsById = ReadonlyMap<string, RecordNightPublicRecord>;

// Il titolo di un record sfidato lo dà solo `mine`: se il server non lo manda
// (`null` o vuoto: record non più pubblico, interruttore spento) si scrive un
// testo neutro, senza cercarlo altrove e senza segnalare errori.
function getChallengeTitle(request: RecordNightGuestRequest) {
  return typeof request.recordTitle === "string" ? stripBidi(request.recordTitle).trim() : "";
}

// Il record dell'elenco pubblico per categoria e come si misura: solo se il
// server ha mandato anche il titolo.
function getPublicRecord(request: RecordNightGuestRequest, recordsById: RecordsById) {
  if (request.kind !== "challenge" || !request.recordId || !getChallengeTitle(request)) return undefined;
  return recordsById.get(request.recordId);
}

// Testo con cui una richiesta si riconosce negli avvisi ("Ritiro fatto: ..."): il
// titolo del record sfidato, oppure le parole di chi ha proposto.
export function getGuestRequestLabel(request: RecordNightGuestRequest) {
  if (request.kind === "challenge") return getChallengeTitle(request) || "Un record";
  return stripBidi(request.text).trim() || "Un record";
}

// Nome e unità come li ha digitati chi ha inviato la richiesta: testo di
// sconosciuti, senza caratteri di verso e libero di andare a capo (nessun pezzo
// si schiaccia: scorre come una frase dentro la pillola).
function Who({ request }: { request: RecordNightGuestRequest }) {
  return (
    <div className="rn-pills">
      <span className="rn-pill rn-pill--flow">
        <RecordNightIcon name="user" />
        <span className="rn-pill__text">
          <bdi>{stripBidi(`${request.firstName} ${request.lastName}`)}</bdi> ·{" "}
          <bdi>{stripBidi(request.unitName)}</bdi>
        </span>
      </span>
    </div>
  );
}

// Il record sfidato dentro una richiesta. La categoria si legge dall'elenco
// pubblico, se il record c'è ancora.
function RecordBlock({
  request,
  recordsById,
}: {
  request: RecordNightGuestRequest;
  recordsById: RecordsById;
}) {
  const record = getPublicRecord(request, recordsById);
  return (
    <div className={record ? `rn-req-record rn-cat--${record.category}` : "rn-req-record"}>
      <span className="rn-req-record__kind">
        <RecordNightIcon name="bolt" />
        Sfida
      </span>
      {record ? (
        <span className="rn-rec__measure">
          {getRecordNightCategoryLabel(record.category)} ·{" "}
          {getRecordNightMeasureShortLabel(record.measure, record.durationSeconds)}
        </span>
      ) : null}
      <strong>{getGuestRequestLabel(request)}</strong>
    </div>
  );
}

function Body({
  request,
  recordsById,
  muted = false,
}: {
  request: RecordNightGuestRequest;
  recordsById: RecordsById;
  muted?: boolean;
}) {
  if (request.kind === "challenge") return <RecordBlock recordsById={recordsById} request={request} />;
  return (
    <>
      <p className={muted ? "rn-quote rn-quote--muted" : "rn-quote"}>{stripBidi(request.text)}</p>
      {request.measure ? (
        <div className="rn-pills">
          <span className="rn-pill">
            <RecordNightIcon name={MEASURE_ICONS[request.measure]} />
            {getRecordNightMeasureShortLabel(request.measure, request.durationSeconds)}
          </span>
          {request.needs ? (
            <span className="rn-pill rn-pill--flow">
              <RecordNightIcon name="bag" />
              <span className="rn-pill__text">
                Serve: <bdi>{stripBidi(request.needs)}</bdi>
              </span>
            </span>
          ) : null}
        </div>
      ) : null}
    </>
  );
}

interface GuestRequestCardProps {
  request: RecordNightGuestRequest;
  recordsById: RecordsById;
  // Finestra chiusa: tutto in sola lettura.
  closed: boolean;
  busy: boolean;
  onWithdraw: (request: RecordNightGuestRequest) => void;
}

// Una carta per richiesta, con lo stato che il server ha calcolato per questo
// telefono (docs/NOTTE_DEI_RECORD_SENZA_ACCOUNT.md, "Stato mostrato al richiedente").
// Mai dati dell'iscrizione collegata. "withdrawn" non ha carta: sta nella riga
// "Ritirate".
export function GuestRequestCard({
  request,
  recordsById,
  closed,
  busy,
  onWithdraw,
}: GuestRequestCardProps) {
  switch (request.state) {
    case "received": {
      // Senza `canWithdraw` la finestra è chiusa anche per il server.
      const late = closed || !request.canWithdraw;
      const text = getGuestStateText("received", { closed: late });
      return (
        <article className={late ? "rn-mine rn-mine--wait rn-mine--late" : "rn-mine rn-mine--wait"}>
          <span className="rn-wait-label">
            <i aria-hidden="true" className={late ? "rn-led rn-led--off" : "rn-led"} />
            {GUEST_STATE_TEXTS.received.title}
          </span>
          <Who request={request} />
          <Body recordsById={recordsById} request={request} />
          {late ? (
            <p className="rn-state-line">
              <RecordNightIcon name="lock" />
              <span>
                {text.title}. {text.description}
              </span>
            </p>
          ) : (
            <>
              <p className="rn-private">
                <RecordNightIcon name="clock" />
                {text.description}
              </p>
              <div className="rn-actions">
                <button
                  aria-label={`Ritira: ${getGuestRequestLabel(request)}`}
                  className="rn-btn"
                  disabled={busy}
                  onClick={() => onWithdraw(request)}
                  type="button"
                >
                  <RecordNightIcon name="x" />
                  Ritira
                </button>
              </div>
            </>
          )}
        </article>
      );
    }
    case "not_linked": {
      const text = getGuestStateText("not_linked");
      return (
        <article className="rn-mine rn-mine--no">
          <span className="rn-no-label rn-no-label--soft">
            <RecordNightIcon name="alert" />
            {text.title}
          </span>
          <Who request={request} />
          <Body muted recordsById={recordsById} request={request} />
          <p className="rn-state-line">
            <RecordNightIcon name="alert" />
            <span>{text.description}</span>
          </p>
        </article>
      );
    }
    case "pending": {
      const text = getGuestStateText("pending");
      return (
        <article className="rn-mine rn-mine--wait">
          <span className="rn-wait-label">
            <i aria-hidden="true" className="rn-led" />
            {text.title}
          </span>
          <Who request={request} />
          <Body recordsById={recordsById} request={request} />
          <p className="rn-private rn-private--read">
            <RecordNightIcon name="user" />
            {text.description}
          </p>
        </article>
      );
    }
    case "approved": {
      const text = getGuestStateText("approved");
      // Una sfida porta il record (categoria e come si misura dall'elenco pubblico,
      // se c'è ancora); una proposta approvata solo le parole di chi l'ha scritta.
      const record = getPublicRecord(request, recordsById);
      const measure = record ? record.measure : request.measure;
      const durationSeconds = record ? record.durationSeconds : request.durationSeconds;
      const tag = [
        record ? getRecordNightCategoryLabel(record.category) : "",
        measure ? getRecordNightMeasureShortLabel(measure, durationSeconds) : "",
      ]
        .filter(Boolean)
        .join(" · ");
      const tagIcon = record
        ? CATEGORY_ICONS[record.category]
        : measure
          ? MEASURE_ICONS[measure]
          : null;
      return (
        <article className={record ? `rn-mine rn-mine--in rn-cat--${record.category}` : "rn-mine rn-mine--in rn-mine--plain"}>
          <div className="rn-mine__top">
            {tag && tagIcon ? (
              <span className="rn-tag">
                <RecordNightIcon name={tagIcon} />
                {tag}
              </span>
            ) : null}
            <span className="rn-stamp">
              <RecordNightIcon name="check" />
              {text.title}
            </span>
          </div>
          <h3 className="rn-mine__title">{getGuestRequestLabel(request)}</h3>
          <Who request={request} />
          <div className="rn-mine__bottom">
            <p className="rn-private rn-private--read">
              <RecordNightIcon name="user" />
              {text.description}
            </p>
          </div>
        </article>
      );
    }
    case "rejected": {
      const text = getGuestStateText("rejected", { reason: request.reason });
      return (
        <article className="rn-mine rn-mine--no">
          <span className="rn-no-label">
            <RecordNightIcon name="x" />
            {text.title}
          </span>
          <Who request={request} />
          <Body muted recordsById={recordsById} request={request} />
          {text.description ? (
            <div className="rn-reason">
              <span className="rn-reason__lbl">Il motivo</span>
              <p>{text.description}</p>
            </div>
          ) : null}
        </article>
      );
    }
    case "removed": {
      const text = getGuestStateText("removed");
      return (
        <article className="rn-mine rn-mine--no rn-mine--gone">
          <span className="rn-wait-label">
            <i aria-hidden="true" className="rn-led rn-led--off" />
            {text.title}
          </span>
          <Who request={request} />
          <Body muted recordsById={recordsById} request={request} />
          <p className="rn-state-line">
            <RecordNightIcon name="alert" />
            <span>{text.description}</span>
          </p>
        </article>
      );
    }
    default:
      return null;
  }
}

interface GuestRequestsProps {
  requests: ReadonlyArray<RecordNightGuestRequest>;
  recordsById: RecordsById;
  closed: boolean;
  busy: boolean;
  // Titolo della sezione: dopo l'invio la pagina vi porta il focus.
  headingRef?: Ref<HTMLHeadingElement>;
  onWithdraw: (request: RecordNightGuestRequest) => void;
  onRestore: (request: RecordNightGuestRequest) => void;
}

// "Le tue richieste da questo telefono": una carta per richiesta, poi "Ritirate"
// con Ripristina. Ritira e Ripristina compaiono solo dove il server li consente
// (`canWithdraw`, `canRestore`: finestra aperta); dopo il collegamento le carte
// sono in sola lettura.
export function GuestRequests({
  requests,
  recordsById,
  closed,
  busy,
  headingRef,
  onWithdraw,
  onRestore,
}: GuestRequestsProps) {
  // Per persona, poi dalla più recente: su un telefono usato da più persone le
  // loro richieste non si mescolano.
  const sorted = sortGuestRequestsByPerson(requests);
  const cards = sorted.filter((request) => request.state !== "withdrawn");
  // Dopo la chiusura le ritirate non si mostrano più (come "Ritirati" di MyRecords):
  // vale anche se la finestra si chiude a pagina aperta, prima di una nuova lettura.
  const withdrawn = sorted.filter(
    (request) => request.state === "withdrawn" && request.canRestore && !closed,
  );

  if (cards.length === 0 && withdrawn.length === 0) return null;

  return (
    <section aria-labelledby="rn-reqs-title" className="rn-section">
      <div className="rn-section__head">
        <h2 className="rn-h2" id="rn-reqs-title" ref={headingRef} tabIndex={-1}>
          Le tue richieste da questo telefono
        </h2>
      </div>
      <p className="rn-sub">{GUEST_COPY.phoneOnlyNote}</p>

      {cards.length > 0 ? (
        <div className="rn-req-list">
          {cards.map((request) => (
            <GuestRequestCard
              busy={busy}
              closed={closed}
              key={request.requestId}
              onWithdraw={onWithdraw}
              recordsById={recordsById}
              request={request}
            />
          ))}
        </div>
      ) : null}

      {withdrawn.length > 0 ? (
        <div className={cards.length === 0 ? "rn-withdrawn rn-withdrawn--first" : "rn-withdrawn"}>
          <h3 className="rn-h3">Ritirate</h3>
          <ul>
            {withdrawn.map((request) => (
              <li className="rn-withdrawn__row" key={request.requestId}>
                <span className="rn-withdrawn__label">{getGuestRequestLabel(request)}</span>
                <button
                  aria-label={`Ripristina: ${getGuestRequestLabel(request)}`}
                  className="rn-btn rn-btn--sm"
                  disabled={busy}
                  onClick={() => onRestore(request)}
                  type="button"
                >
                  <RecordNightIcon name="undo" />
                  Ripristina
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
