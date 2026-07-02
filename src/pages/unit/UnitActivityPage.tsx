import { useMemo, useState } from "react";
import { useParams } from "react-router-dom";

import { AppIcon } from "@/components/AppIcon";
import { AppModal } from "@/components/AppModal";
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

function formatUnitDateRange(startDate: string, endDate: string) {
  if (startDate === endDate) {
    return formatDate(startDate);
  }

  return `${formatDate(startDate)} - ${formatDate(endDate)}`;
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

function CampAssignmentCell({ registration }: { registration: Registration }) {
  const committee = registration.assignedCommittees[0];

  if (!registration.assignedPatrolName && !committee) {
    return <span className="subtle-text">-</span>;
  }

  return (
    <div className="unit-consent-cell">
      {registration.assignedPatrolName ? (
        <span className="unit-badge unit-badge--ok" title="Pattuglia">
          {registration.assignedPatrolName}
        </span>
      ) : null}
      {committee ? (
        <span className="unit-badge" title="Comitato">
          {committee.title}
        </span>
      ) : null}
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
      <td className="unit-table__cell">
        <CampAssignmentCell registration={registration} />
      </td>
    </tr>
  );
}

function NotRegisteredRow({ youth }: { youth: UserProfile }) {
  return (
    <tr className="unit-table__row unit-table__row--unregistered">
      <td className="unit-table__cell unit-table__cell--name" colSpan={5}>
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

type CampGroup =
  | { kind: "patrol"; id: string; title: string; registrations: Registration[] }
  | { kind: "committee"; id: string; title: string; registrations: Registration[] };

export function UnitActivityPage() {
  const { eventId = "" } = useParams<{ eventId: string }>();
  const { session } = useAuth();
  const stakeId = session?.profile.stakeId ?? "roma-est";
  const unitId = session?.profile.unitId ?? "";
  const [selectedCampGroupKey, setSelectedCampGroupKey] = useState<string | null>(null);

  const { data, loading, error } = useAsyncData(
    () => unitLeaderService.getUnitActivityDetail(stakeId, eventId, unitId),
    [stakeId, eventId, unitId],
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
  const campGroups = useMemo<CampGroup[]>(() => {
    const patrols = new Map<string, CampGroup>();
    const committees = new Map<string, CampGroup>();

    for (const registration of data.registrations) {
      if (registration.assignedPatrolId && registration.assignedPatrolName) {
        const key = registration.assignedPatrolId;
        const existing =
          patrols.get(key) ??
          ({
            kind: "patrol",
            id: key,
            title: registration.assignedPatrolName,
            registrations: [],
          } satisfies CampGroup);
        existing.registrations.push(registration);
        patrols.set(key, existing);
      }

      for (const committee of registration.assignedCommittees) {
        const key = committee.id;
        const existing =
          committees.get(key) ??
          ({
            kind: "committee",
            id: key,
            title: committee.title,
            registrations: [],
          } satisfies CampGroup);
        existing.registrations.push(registration);
        committees.set(key, existing);
      }
    }

    return [...committees.values(), ...patrols.values()];
  }, [data.registrations]);
  const selectedCampGroup =
    selectedCampGroupKey !== null
      ? campGroups.find((group) => `${group.kind}:${group.id}` === selectedCampGroupKey) ?? null
      : null;

  return (
    <div className="page page--activity-ios page--unit-activity">
      {data.event ? (
        <section className="activity-ios-hero activity-ios-hero--compact">
          <div
            className="activity-ios-hero__image"
            style={
              data.event.heroImageUrl ? { backgroundImage: `url(${data.event.heroImageUrl})` } : undefined
            }
          >
            {!data.event.heroImageUrl ? <AppIcon name="ticket" /> : null}
          </div>
          <div className="activity-ios-hero__content">
            <div className="activity-ios-chip-row">
              <span className="activity-ios-chip activity-ios-chip--green">La tua unità</span>
              {data.event.overnight ? (
                <span className="activity-ios-chip activity-ios-chip--violet">Pernottamento</span>
              ) : null}
            </div>
            <h1>{data.event.title}</h1>
            <p className="activity-ios-meta">
              <AppIcon name="calendar" />
              <span>{formatUnitDateRange(data.event.startDate, data.event.endDate)}</span>
            </p>
            {data.event.location ? (
              <p className="activity-ios-meta">
                <AppIcon name="map-pin" />
                <span>{data.event.location}</span>
              </p>
            ) : null}
          </div>
        </section>
      ) : loading ? (
        <p className="subtle-text">Caricamento...</p>
      ) : null}

      {error ? (
        <div className="notice notice--warning">
          <div>
            <h3>Impossibile caricare i dati</h3>
            <p>{error}</p>
          </div>
        </div>
      ) : null}

      {!loading && (
        <section className="activity-ios-metrics activity-ios-metrics--four">
          <article className="activity-ios-metric">
            <span><AppIcon name="users" /></span>
            <strong>{data.stats.total}</strong>
            <small>Iscritti unità</small>
          </article>
          <article className="activity-ios-metric activity-ios-metric--warn">
            <span><AppIcon name="map-pin" /></span>
            <strong>{effectiveNeedsTransport}</strong>
            <small>Trasporto</small>
          </article>
          <article className="activity-ios-metric activity-ios-metric--warn">
            <span><AppIcon name="eye" /></span>
            <strong>{data.stats.missingPhotoConsent}</strong>
            <small>Foto mancanti</small>
          </article>
          <article className="activity-ios-metric activity-ios-metric--danger">
            <span><AppIcon name="lock" /></span>
            <strong>{data.stats.missingParentConsent}</strong>
            <small>Genitori</small>
          </article>
        </section>
      )}

      {!loading && campGroups.length > 0 ? (
        <section className="activity-ios-panel admin-section">
          <div className="admin-section__head">
            <div>
              <h2>Organizzazione campeggio</h2>
              <p className="subtle-text">Comitati e pattuglie dove compaiono ragazzi della tua unità</p>
            </div>
          </div>
          <div className="camp-ios-grid">
            {campGroups.map((group) => (
              <button
                className={
                  group.kind === "committee"
                    ? "camp-ios-card camp-ios-card--committee"
                    : "camp-ios-card camp-ios-card--patrol"
                }
                key={`${group.kind}:${group.id}`}
                onClick={() => setSelectedCampGroupKey(`${group.kind}:${group.id}`)}
                type="button"
              >
                <span className="camp-ios-card__icon" aria-hidden="true">
                  {group.kind === "committee" ? "◌" : "🧭"}
                </span>
                <span className="camp-ios-card__body">
                  <strong>{group.title}</strong>
                  <small>
                    {group.kind === "committee" ? "Comitato" : "Pattuglia"} ·{" "}
                    {group.registrations.length} persone
                  </small>
                  <span className="camp-ios-card__preview">
                    {group.registrations
                      .slice(0, 3)
                      .map((registration) => registration.fullName)
                      .join(", ")}
                  </span>
                </span>
                <AppIcon name="arrow-right" />
              </button>
            ))}
          </div>
        </section>
      ) : null}

      <section className="activity-ios-panel admin-section">
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
                  <th>Campeggio</th>
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
        <section className="activity-ios-panel admin-section">
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

      {selectedCampGroup ? (
        <AppModal
          title={selectedCampGroup.title}
          subtitle={selectedCampGroup.kind === "committee" ? "Comitato" : "Pattuglia"}
          size="compact"
          onClose={() => setSelectedCampGroupKey(null)}
        >
          <div className="camp-person-list">
            {selectedCampGroup.registrations.map((registration) => (
              <article className="camp-person-row" key={registration.id}>
                <span>
                  <strong>{registration.fullName}</strong>
                  <small>{getGenderRoleCategoryLabel(registration.genderRoleCategory)}</small>
                </span>
                {selectedCampGroup.kind === "patrol" && registration.assignedPatrolRole ? (
                  <StatusBadge
                    label={
                      registration.assignedPatrolRole === "leader"
                        ? "Capo"
                        : registration.assignedPatrolRole === "supervisor"
                          ? "Supervisore"
                          : "Membro"
                    }
                    tone="info"
                  />
                ) : null}
                {selectedCampGroup.kind === "committee" ? (
                  <StatusBadge
                    label={
                      registration.assignedCommittees.find(
                        (committee) => committee.id === selectedCampGroup.id,
                      )?.role === "leader"
                        ? "Responsabile"
                        : "Membro"
                    }
                    tone="info"
                  />
                ) : null}
              </article>
            ))}
          </div>
        </AppModal>
      ) : null}
    </div>
  );
}
