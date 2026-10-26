import { EVENT_CREATION as COPY } from "@/copy/eventCreation";
import type { Event, EventFormConfig } from "@/types";
import { getPublicationIssues } from "@/utils/eventCreation";
import { getEventAudienceLabel } from "@/utils/events";
import { formatDateRange, formatDateTime } from "@/utils/formatters";
import { getStandardFieldDefinition } from "@/utils/formFields";

const dateLabel = (value: string) => value && Number.isFinite(Date.parse(value)) ? formatDateTime(value) : "Da scegliere";

export function EventPublicationPreview({ event, config }: {
  event: Event; config: EventFormConfig | null;
}) {
  const issues = getPublicationIssues(event);
  return <div className="event-creation">
    <p className="event-creation__hint">Controlla le informazioni che saranno visibili e le condizioni per iscriversi.</p>
    <article className="event-creation__preview">
      {event.heroImageUrl ? <img src={event.heroImageUrl} alt="Locandina dell'attività" /> : null}
      <div><span className="surface-chip">{getEventAudienceLabel(event.audience)}</span><h3>{event.title}</h3>
        <p>{event.startDate && event.endDate && Number.isFinite(Date.parse(event.startDate)) && Number.isFinite(Date.parse(event.endDate)) ? formatDateRange(event.startDate, event.endDate) : "Date da scegliere"}</p>
        <p>{event.location}</p><p className="event-creation__description">{event.description || "Descrizione da aggiungere"}</p>
        {event.program ? <div><strong>Programma / riepilogo</strong><p className="event-creation__description">{event.program}</p></div> : null}
        {([
          ["Note pubbliche", event.publicNotes], ["Menu", event.menuInfo],
          ["Allergie e indicazioni", event.allergiesInfo], ["Tende / logistica", event.roomsInfo],
        ] as const).filter(([, value]) => value).map(([label, value]) => <div key={label}><strong>{label}</strong><p className="event-creation__description">{value}</p></div>)}
        {event.whatToBring ? <div><strong>Cosa portare</strong><p className="event-creation__description">{event.whatToBring}</p></div> : null}
      </div>
    </article>
    <dl className="event-creation__facts">
      <div><dt>Apertura iscrizioni</dt><dd>{dateLabel(event.registrationOpen)}</dd></div>
      <div><dt>Chiusura iscrizioni</dt><dd>{dateLabel(event.registrationClose)}</dd></div>
      <div><dt>Posti</dt><dd>{event.maxParticipants ?? "Nessun limite"}</dd></div>
      <div><dt>Account per iscriversi</dt><dd>{event.requiresAccount || !(config?.allowGuestRegistration ?? event.allowGuestRegistration) ? "Richiesto" : "Facoltativo"}</dd></div>
      <div><dt>Autorizzazione del genitore per chi ha meno di 18 anni</dt><dd>{event.requiresParentAuthorization ? "Richiesta via email" : "Non richiesta via email"}</dd></div>
      <div><dt>Contatti di emergenza</dt><dd>{event.requiresEmergencyContacts ? "Richiesti" : "Non richiesti"}</dd></div>
      <div><dt>Note mediche</dt><dd>{event.requiresMedicalNotes ? "Richieste" : "Non richieste"}</dd></div>
      <div><dt>Consenso foto/video nell'autorizzazione</dt><dd>{event.requiresImageConsent ? "Incluso, facoltativo" : "Non incluso"}</dd></div>
      <div><dt>Campi del modulo</dt><dd>{config ? [...config.enabledStandardFields.map(key => getStandardFieldDefinition(key)?.label ?? key), ...config.customFields.map(field => field.label)].join(", ") || "Nessun campo aggiuntivo" : "Modulo non disponibile: torna alla bozza e ricaricalo."}</dd></div>
      <div><dt>Funzioni aggiuntive</dt><dd>{[event.recordsEnabled ? "Notte dei Record" : "", event.questionsEnabled ? "Domande dei partecipanti" : ""].filter(Boolean).join(", ") || "Nessuna"}</dd></div>
    </dl>
    {issues.length ? <div className="event-creation__issues"><strong>{COPY.missing}</strong><ul>{issues.map(issue => <li key={issue}>{issue}</li>)}</ul><p>Completa questi dati da «Dati essenziali».</p></div> : null}
    <p className="event-creation__effect">{COPY.publishEffect}</p>
  </div>;
}
