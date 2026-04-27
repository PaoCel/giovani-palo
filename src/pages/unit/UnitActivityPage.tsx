import { useMemo } from "react";
import { useParams } from "react-router-dom";

import { AppIcon } from "@/components/AppIcon";
import { StatusBadge } from "@/components/StatusBadge";
import { useAsyncData } from "@/hooks/useAsyncData";
import { useAuth } from "@/hooks/useAuth";
import { unitLeaderService } from "@/services/firestore/unitLeaderService";
import { unitTransportNotesService } from "@/services/firestore/unitTransportNotesService";
import type { Registration, UserProfile } from "@/types";
import { isMinorBirthDate } from "@/utils/age";
import { getGenderRoleCategoryLabel } from "@/utils/profile";
import {
  getRegistrationStatusLabel,
  getRegistrationStatusTone,
} from "@/utils/registrations";

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("it-IT", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function TransportBadge({
  registration,
  isResolved,
  onToggle,
}: {
  registration: Registration;
  isResolved: boolean;
  onToggle: () => void;
}) {
  const mode =
    typeof registration.answers.transportMode === "string"
      ? registration.answers.transportMode
      : "";

  const needsHelp = !mode || mode === "Da definire" || mode === "Passaggio";

  if (!needsHelp) {
    return (
      <span className="unit-badge unit-badge--ok" title={mode}>
        {mode}
      </span>
    );
  }

  if (isResolved) {
    return (
      <div className="unit-transport-cell">
        <span className="unit-badge unit-badge--ok" title="Trasporto organizzato dall'unità">
          Risolto
        </span>
        <button
          className="unit-transport-btn unit-transport-btn--undo"
          onClick={onToggle}
          title="Annulla risoluzione"
          type="button"
        >
          <AppIcon name="x" />
        </button>
      </div>
    );
  }

  return (
    <div className="unit-transport-cell">
      <span className="unit-badge unit-badge--warn" title={mode || "Trasporto da definire"}>
        {mode || "Da definire"}
      </span>
      <button
        className="unit-transport-btn unit-transport-btn--resolve"
        onClick={onToggle}
        title="Segna come risolto"
        type="button"
      >
        <AppIcon name="check" />
      </button>
    </div>
  );
}

function ConsentCell({ registration }: { registration: Registration }) {
  const hasPhoto = registration.answers.photoInternalConsent === true;
  const isMinor = isMinorBirthDate(registration.birthDate);
  const hasParent =
    !isMinor ||
    Boolean(registration.parentConsentDocumentUrl || registration.answers.parentConfirmed);

  return (
    <div className="unit-consent-cell">
      <span
        className={hasPhoto ? "unit-consent-ok" : "unit-consent-missing"}
        title={hasPhoto ? "Consenso foto OK" : "Consenso foto mancante"}
      >
        <AppIcon name={hasPhoto ? "check" : "x"} />
        Foto
      </span>
      {isMinor && (
        <span
          className={hasParent ? "unit-consent-ok" : "unit-consent-missing"}
          title={hasParent ? "Modulo genitore OK" : "Modulo genitore mancante"}
        >
          {registration.parentConsentDocumentUrl ? (
            <a
              href={registration.parentConsentDocumentUrl}
              onClick={(e) => e.stopPropagation()}
              rel="noreferrer"
              target="_blank"
            >
              <AppIcon name="download" />
            </a>
          ) : (
            <AppIcon name={hasParent ? "check" : "x"} />
          )}
          Genitore
        </span>
      )}
    </div>
  );
}

function RegistrationRow({
  registration,
  isTransportResolved,
  onToggleTransport,
}: {
  registration: Registration;
  isTransportResolved: boolean;
  onToggleTransport: () => void;
}) {
  const categoryLabel = getGenderRoleCategoryLabel(registration.genderRoleCategory);
  const statusTone = getRegistrationStatusTone(registration.registrationStatus);
  const statusLabel = getRegistrationStatusLabel(registration.registrationStatus);

  return (
    <tr className="unit-table__row">
      <td className="unit-table__cell unit-table__cell--name">
        <strong>{registration.fullName}</strong>
        <small className="subtle-text">{categoryLabel}</small>
      </td>
      <td className="unit-table__cell">
        <StatusBadge tone={statusTone} label={statusLabel} />
      </td>
      <td className="unit-table__cell">
        <TransportBadge
          registration={registration}
          isResolved={isTransportResolved}
          onToggle={onToggleTransport}
        />
      </td>
      <td className="unit-table__cell">
        <ConsentCell registration={registration} />
      </td>
    </tr>
  );
}

function NotRegisteredRow({ youth }: { youth: UserProfile }) {
  return (
    <tr className="unit-table__row unit-table__row--unregistered">
      <td className="unit-table__cell unit-table__cell--name" colSpan={4}>
        <strong>{youth.fullName}</strong>
        <small className="subtle-text">
          {getGenderRoleCategoryLabel(youth.genderRoleCategory)} · Non iscritto/a
        </small>
      </td>
    </tr>
  );
}

const initialData = {
  event: null as Awaited<ReturnType<typeof unitLeaderService.getUnitActivityDetail>>["event"],
  registrations: [] as Registration[],
  unitYouth: [] as UserProfile[],
  stats: { total: 0, needsTransport: 0, missingPhotoConsent: 0, missingParentConsent: 0 },
};

export function UnitActivityPage() {
  const { eventId = "" } = useParams<{ eventId: string }>();
  const { session } = useAuth();
  const stakeId = session?.profile.stakeId ?? "roma-est";
  const unitId = session?.profile.unitId ?? "";
  const unitName = session?.profile.unitName ?? "";

  const { data, loading, error } = useAsyncData(
    () => unitLeaderService.getUnitActivityDetail(stakeId, eventId, unitId, unitName),
    [stakeId, eventId, unitId, unitName],
    initialData,
  );

  const { data: resolvedIds, setData: setResolvedIds } = useAsyncData(
    () => unitTransportNotesService.listResolved(stakeId, eventId),
    [stakeId, eventId],
    [] as string[],
  );

  const resolvedSet = useMemo(() => new Set(resolvedIds), [resolvedIds]);

  async function handleToggleTransport(registrationId: string) {
    const isResolved = resolvedSet.has(registrationId);

    if (isResolved) {
      setResolvedIds(resolvedIds.filter((id) => id !== registrationId));
      await unitTransportNotesService.clearResolved(stakeId, eventId, registrationId);
    } else {
      setResolvedIds([...resolvedIds, registrationId]);
      await unitTransportNotesService.markResolved(
        stakeId,
        eventId,
        registrationId,
        session?.firebaseUser.uid ?? "",
      );
    }
  }

  const effectiveNeedsTransport = useMemo(
    () =>
      data.registrations.filter((r) => {
        const t = typeof r.answers.transportMode === "string" ? r.answers.transportMode : "";
        return (!t || t === "Da definire" || t === "Passaggio") && !resolvedSet.has(r.id);
      }).length,
    [data.registrations, resolvedSet],
  );

  const registeredUserIds = new Set(
    data.registrations.flatMap((r) => (r.userId ? [r.userId] : [])),
  );
  const notRegistered = data.unitYouth.filter((y) => !registeredUserIds.has(y.id));

  return (
    <div className="page page--unit-activity">
      <div className="admin-section__head">
        <div>
          {data.event ? (
            <>
              <h2>{data.event.title}</h2>
              <p className="subtle-text">
                {formatDate(data.event.startDate)} · {data.event.location}
              </p>
            </>
          ) : loading ? (
            <p className="subtle-text">Caricamento...</p>
          ) : null}
        </div>
      </div>

      {error ? (
        <div className="notice notice--warning">
          <div>
            <h3>Impossibile caricare i dati</h3>
            <p>{error}</p>
          </div>
        </div>
      ) : null}

      {!loading && (
        <section className="admin-metrics">
          <article className="admin-metric">
            <strong>{data.stats.total}</strong>
            <span>Iscritti unità</span>
          </article>
          <article className="admin-metric admin-metric--warn">
            <strong>{effectiveNeedsTransport}</strong>
            <span>Passaggio / da definire</span>
          </article>
          <article className="admin-metric admin-metric--warn">
            <strong>{data.stats.missingPhotoConsent}</strong>
            <span>Consenso foto mancante</span>
          </article>
          <article className="admin-metric admin-metric--danger">
            <strong>{data.stats.missingParentConsent}</strong>
            <span>Modulo genitore mancante</span>
          </article>
        </section>
      )}

      <section className="admin-section">
        <div className="admin-section__head">
          <div>
            <h2>Iscritti dalla tua unità</h2>
            <p className="subtle-text">{data.registrations.length} iscrizioni attive</p>
          </div>
        </div>

        {loading ? (
          <p className="subtle-text">Caricamento...</p>
        ) : data.registrations.length === 0 ? (
          <p className="subtle-text">Nessun iscritto dalla tua unità per questa attività.</p>
        ) : (
          <div className="unit-table-wrapper">
            <table className="unit-table">
              <thead>
                <tr>
                  <th>Nome</th>
                  <th>Stato</th>
                  <th>Trasporto</th>
                  <th>Consensi</th>
                </tr>
              </thead>
              <tbody>
                {data.registrations.map((r) => (
                  <RegistrationRow
                    key={r.id}
                    registration={r}
                    isTransportResolved={resolvedSet.has(r.id)}
                    onToggleTransport={() => void handleToggleTransport(r.id)}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {!loading && notRegistered.length > 0 && (
        <section className="admin-section">
          <div className="admin-section__head">
            <div>
              <h2>Non ancora iscritti</h2>
              <p className="subtle-text">
                Giovani con account nella tua unità che non risultano iscritti a questa attività
              </p>
            </div>
          </div>

          <div className="unit-table-wrapper">
            <table className="unit-table unit-table--unregistered">
              <tbody>
                {notRegistered.map((y) => (
                  <NotRegisteredRow key={y.id} youth={y} />
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
