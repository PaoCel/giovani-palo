import { useMemo, useState } from "react";

import { AppIcon } from "@/components/AppIcon";
import { EmptyState } from "@/components/EmptyState";
import { PhotoConsentPills } from "@/components/PhotoConsentPills";
import { StatusBadge } from "@/components/StatusBadge";
import {
  getCategoryShortLabel,
  getUnitLabel,
  isRegistrationCategoryFilter,
  registrationCategoryFilterOptions,
  type RegistrationCategoryFilter,
} from "@/components/admin/registrations/registrationLabels";
import { ISCRITTI } from "@/copy/iscritti";
import { useAsyncData } from "@/hooks/useAsyncData";
import { consentTasksService } from "@/services/firestore/consentTasksService";
import type { ConsentTask, Event, Registration } from "@/types";
import { isManualRegistration, isMissingParentEmail } from "@/utils/adminRegistration";
import { formatDateTime } from "@/utils/formatters";
import { needsPhotoConsentQuestion } from "@/utils/parentAuthorization";
import { getRegistrationDisplayName } from "@/utils/roomPreferences";

// Filtri dell'elenco: stanno nella pagina, così passare a Consensi o Stanze e
// tornare non li perde (la tab si smonta).
export interface RegistrationFilters {
  categories: RegistrationCategoryFilter[];
  unit: string;
  onlyPhotoToAsk: boolean;
  search: string;
}

export const DEFAULT_REGISTRATION_FILTERS: RegistrationFilters = {
  categories: ["giovane_uomo", "giovane_donna", "dirigente", "accompagnatore"],
  unit: "all",
  onlyPhotoToAsk: false,
  search: "",
};

interface RegistrationsTabProps {
  stakeId: string;
  eventId: string;
  activityType: Event["activityType"];
  // Tutte le iscrizioni dell'attività, ordinate per cognome e nome.
  sortedRegistrations: Registration[];
  currentCount: number;
  filters: RegistrationFilters;
  onFiltersChange: (update: (current: RegistrationFilters) => RegistrationFilters) => void;
  // Compiti sui consensi e azioni dell'admin: solo per gli admin del palo.
  canReadConsentTasks: boolean;
  sessionUid: string | null;
  loading: boolean;
  downloadingExcel: boolean;
  // Un'azione della pagina in corso: i tasti della tab aspettano.
  pageBusy: boolean;
  onOpenRegistration: (registrationId: string) => void;
  onDownloadYouthExcel: () => void;
  onOpenExcelExport: () => void;
  // Assente per chi non può aggiungere a mano (solo admin del palo).
  onAddManual?: () => void;
}

// Tab Iscritti della scheda attività admin (estratta da AdminEventDetailPage,
// task gugd-admin-iscritti): compiti sui consensi, contatori, filtri ed
// elenco. La scheda dell'iscrizione e i fogli restano nella pagina, perché li
// aprono anche le tab Consensi e Stanze.
export function RegistrationsTab({
  stakeId,
  eventId,
  activityType,
  sortedRegistrations,
  currentCount,
  filters,
  onFiltersChange,
  canReadConsentTasks,
  sessionUid,
  loading,
  downloadingExcel,
  pageBusy,
  onOpenRegistration,
  onDownloadYouthExcel,
  onOpenExcelExport,
  onAddManual,
}: RegistrationsTabProps) {
  const activeRegistrationFilters = filters.categories;
  const selectedUnitFilter = filters.unit;
  const onlyPhotoToAsk = filters.onlyPhotoToAsk;
  const nameSearch = filters.search;
  const setSelectedUnitFilter = (unit: string) =>
    onFiltersChange((current) => ({ ...current, unit }));
  const setNameSearch = (search: string) =>
    onFiltersChange((current) => ({ ...current, search }));
  const toggleOnlyPhotoToAsk = () =>
    onFiltersChange((current) => ({ ...current, onlyPhotoToAsk: !current.onlyPhotoToAsk }));
  const [consentTasksRefreshKey, setConsentTasksRefreshKey] = useState(0);
  const [consentTasksError, setConsentTasksError] = useState<string | null>(null);
  const [busyTaskId, setBusyTaskId] = useState<string | null>(null);

  const { data: consentTasks, error: consentTasksLoadError } = useAsyncData<
    ConsentTask[]
  >(
    async () => {
      if (!canReadConsentTasks) {
        return [];
      }

      return consentTasksService.listTasks(stakeId, eventId);
    },
    [eventId, stakeId, canReadConsentTasks, consentTasksRefreshKey],
    [],
  );
  const consentTasksTodo = consentTasks.filter((task) => task.status === "todo");
  const consentTasksDone = consentTasks.filter((task) => task.status === "done");

  const waitlistCount = sortedRegistrations.filter(
    (registration) => registration.registrationStatus === "waitlist",
  ).length;
  const cancelledCount = sortedRegistrations.filter(
    (registration) => registration.registrationStatus === "cancelled",
  ).length;
  const registrationFilterCounts = useMemo(
    () =>
      registrationCategoryFilterOptions.reduce<
        Record<RegistrationCategoryFilter, number>
      >(
        (accumulator, option) => {
          accumulator[option.value] = sortedRegistrations.filter(
            (registration) =>
              registration.genderRoleCategory === option.value &&
              (selectedUnitFilter === "all" ||
                getUnitLabel(registration) === selectedUnitFilter),
          ).length;
          return accumulator;
        },
        {
          giovane_uomo: 0,
          giovane_donna: 0,
          dirigente: 0,
          accompagnatore: 0,
        },
      ),
    [selectedUnitFilter, sortedRegistrations],
  );
  const registrationUnitOptions = useMemo(() => {
    const seen = new Set<string>();

    return sortedRegistrations.reduce<string[]>((accumulator, registration) => {
      const unitLabel = getUnitLabel(registration).trim();
      const normalizedLabel = unitLabel.toLocaleLowerCase("it-IT");

      if (!unitLabel || seen.has(normalizedLabel)) {
        return accumulator;
      }

      seen.add(normalizedLabel);
      accumulator.push(unitLabel);
      return accumulator;
    }, []);
  }, [sortedRegistrations]);
  const filteredRegistrations = useMemo(() => {
    const needle = nameSearch.trim().toLocaleLowerCase("it-IT");
    return sortedRegistrations.filter((registration) => {
      if (!isRegistrationCategoryFilter(registration.genderRoleCategory))
        return false;
      if (!activeRegistrationFilters.includes(registration.genderRoleCategory))
        return false;
      if (onlyPhotoToAsk && !needsPhotoConsentQuestion(registration))
        return false;
      if (
        selectedUnitFilter !== "all" &&
        getUnitLabel(registration) !== selectedUnitFilter
      ) {
        return false;
      }
      if (needle) {
        const haystack = [
          registration.fullName,
          registration.firstName,
          registration.lastName,
          registration.email,
        ]
          .filter(Boolean)
          .join(" ")
          .toLocaleLowerCase("it-IT");
        if (!haystack.includes(needle)) return false;
      }
      return true;
    });
  }, [
    activeRegistrationFilters,
    nameSearch,
    onlyPhotoToAsk,
    selectedUnitFilter,
    sortedRegistrations,
  ]);
  const photoToAskCount = useMemo(
    () =>
      sortedRegistrations.filter(
        (registration) =>
          registration.registrationStatus !== "cancelled" &&
          needsPhotoConsentQuestion(registration) &&
          (selectedUnitFilter === "all" ||
            getUnitLabel(registration) === selectedUnitFilter),
      ).length,
    [selectedUnitFilter, sortedRegistrations],
  );

  function toggleRegistrationFilter(filter: RegistrationCategoryFilter) {
    onFiltersChange((current) => ({
      ...current,
      categories: current.categories.includes(filter)
        ? current.categories.filter((item) => item !== filter)
        : [...current.categories, filter],
    }));
  }

  async function handleSetConsentTaskDone(task: ConsentTask, done: boolean) {
    if (!sessionUid) return;

    setBusyTaskId(task.id);
    setConsentTasksError(null);

    try {
      await consentTasksService.setTaskDone(stakeId, eventId, task.id, done, sessionUid);
      setConsentTasksRefreshKey((current) => current + 1);
    } catch (caughtError) {
      console.error("Aggiornamento compito consenso non riuscito", caughtError);
      setConsentTasksError("Non sono riuscito ad aggiornare il compito. Riprova tra poco.");
    } finally {
      setBusyTaskId(null);
    }
  }

  return (
    <section className="admin-detail-stack">
      {canReadConsentTasks &&
      (consentTasks.length > 0 || consentTasksError || consentTasksLoadError) ? (
        <article className="consent-tasks">
          <div className="consent-tasks__head">
            <h3>Da controllare</h3>
            <small>
              {consentTasksTodo.length > 0
                ? `${consentTasksTodo.length} da fare`
                : "Niente da fare"}
            </small>
          </div>
          {consentTasksError || consentTasksLoadError ? (
            <p className="form-error" role="alert">
              {consentTasksError ??
                "Non sono riuscito a caricare i compiti sui consensi."}
            </p>
          ) : null}
          {consentTasksTodo.map((task) => (
            <div className="consent-task" key={task.id}>
              <div>
                <p>{task.title}</p>
                <small>{formatDateTime(task.createdAt)}</small>
              </div>
              <button
                className="button button--primary button--small"
                disabled={pageBusy || busyTaskId !== null}
                onClick={() => void handleSetConsentTaskDone(task, true)}
                type="button"
              >
                {busyTaskId === task.id ? "Salvo..." : "Fatto"}
              </button>
            </div>
          ))}
          {consentTasksDone.length > 0 ? (
            <details className="consent-tasks__done">
              <summary>Completati ({consentTasksDone.length})</summary>
              <div className="consent-tasks__done-list">
                {consentTasksDone.map((task) => (
                  <div className="consent-task consent-task--done" key={task.id}>
                    <div>
                      <p>{task.title}</p>
                      {task.doneAt ? (
                        <small>Fatto il {formatDateTime(task.doneAt)}</small>
                      ) : null}
                    </div>
                    <button
                      className="button button--ghost button--small"
                      disabled={pageBusy || busyTaskId !== null}
                      onClick={() => void handleSetConsentTaskDone(task, false)}
                      type="button"
                    >
                      {busyTaskId === task.id
                        ? "Salvo..."
                        : "Torna da fare"}
                    </button>
                  </div>
                ))}
              </div>
            </details>
          ) : null}
        </article>
      ) : null}

      <div className="admin-inline-metrics admin-inline-metrics--three">
        <article className="admin-inline-metric">
          <strong>{currentCount}</strong>
          <span>Attivi</span>
        </article>
        <article className="admin-inline-metric">
          <strong>{waitlistCount}</strong>
          <span>Attesa</span>
        </article>
        <article className="admin-inline-metric">
          <strong>{cancelledCount}</strong>
          <span>Annullati</span>
        </article>
      </div>

      {sortedRegistrations.length === 0 ? (
        <>
          <EmptyState
            title="Nessun iscritto"
            description="Le registrazioni compariranno qui come elenco rapido."
          />
          {onAddManual ? (
            <button
              className="button button--primary"
              disabled={pageBusy}
              onClick={onAddManual}
              type="button"
            >
              <AppIcon name="plus" />
              <span>{ISCRITTI.aggiungiAMano}</span>
            </button>
          ) : null}
        </>
      ) : (
        <article className="surface-panel surface-panel--subtle admin-roster">
          <div className="section-head admin-roster__head">
            <div>
              <h3>Elenco iscritti</h3>
              <p>
                Tocca una riga per aprire tutti i dettagli della
                registrazione.
              </p>
            </div>
            <div className="admin-section-actions">
              {onAddManual ? (
                <button
                  className="button button--primary button--small"
                  disabled={pageBusy}
                  onClick={onAddManual}
                  type="button"
                >
                  <AppIcon name="plus" />
                  <span>{ISCRITTI.aggiungiAMano}</span>
                </button>
              ) : null}
              <button
                className="button button--secondary button--small"
                disabled={downloadingExcel || loading}
                onClick={onDownloadYouthExcel}
                type="button"
              >
                <AppIcon name="download" />
                <span>
                  {downloadingExcel ? "Preparazione..." : "Elenco GU/GD"}
                </span>
              </button>
              <button
                className="button button--ghost button--small"
                disabled={downloadingExcel || loading}
                onClick={onOpenExcelExport}
                type="button"
              >
                <AppIcon name="download" />
                <span>
                  {downloadingExcel ? "Preparazione..." : "Scarica Excel"}
                </span>
              </button>
            </div>
          </div>

          <div
            className="admin-filter-bar"
            aria-label="Filtri iscritti"
            role="group"
          >
            {registrationCategoryFilterOptions.map((option) => {
              const active = activeRegistrationFilters.includes(
                option.value,
              );

              return (
                <button
                  key={option.value}
                  aria-pressed={active}
                  className={
                    active
                      ? "admin-filter-toggle admin-filter-toggle--active"
                      : "admin-filter-toggle"
                  }
                  onClick={() => toggleRegistrationFilter(option.value)}
                  type="button"
                >
                  <span
                    className="admin-filter-toggle__box"
                    aria-hidden="true"
                  >
                    {active ? <AppIcon name="check" /> : null}
                  </span>
                  <span className="admin-filter-toggle__label">
                    {option.label}
                  </span>
                  <small>{registrationFilterCounts[option.value]}</small>
                </button>
              );
            })}

            <button
              aria-pressed={onlyPhotoToAsk}
              className={
                onlyPhotoToAsk
                  ? "admin-filter-toggle admin-filter-toggle--active"
                  : "admin-filter-toggle"
              }
              onClick={toggleOnlyPhotoToAsk}
              type="button"
            >
              <span
                className="admin-filter-toggle__box"
                aria-hidden="true"
              >
                {onlyPhotoToAsk ? <AppIcon name="check" /> : null}
              </span>
              <span className="admin-filter-toggle__label">
                Foto: da chiedere
              </span>
              <small>{photoToAskCount}</small>
            </button>

            <label className="admin-filter-select">
              <span>Unità</span>
              <select
                className="input"
                value={selectedUnitFilter}
                onChange={(eventInput) =>
                  setSelectedUnitFilter(eventInput.target.value)
                }
              >
                <option value="all">Tutte le unità</option>
                {registrationUnitOptions.map((unitOption) => (
                  <option key={unitOption} value={unitOption}>
                    {unitOption}
                  </option>
                ))}
              </select>
            </label>

            <label className="admin-filter-select admin-filter-select--search">
              <span>Cerca</span>
              <input
                className="input"
                type="search"
                placeholder="Nome, cognome o email"
                value={nameSearch}
                onChange={(eventInput) =>
                  setNameSearch(eventInput.target.value)
                }
              />
            </label>
          </div>

          {filteredRegistrations.length === 0 ? (
            <EmptyState
              title="Nessun iscritto con questi filtri"
              description="Attiva almeno una categoria o cambia selezione."
            />
          ) : (
            <div className="admin-roster__list" role="list">
              {filteredRegistrations.map((registration) => {
                const days = registration.participatingDays ?? [];
                const supportsDays =
                  activityType === "overnight" ||
                  activityType === "camp" ||
                  activityType === "multi_day" ||
                  activityType === "trip";
                const showDays = supportsDays && days.length > 0;
                return (
                  <button
                    key={registration.id}
                    className="admin-roster-row"
                    onClick={() => onOpenRegistration(registration.id)}
                    type="button"
                  >
                    <strong>
                      {getRegistrationDisplayName(registration)}
                    </strong>
                    <span className="admin-roster-row__type">
                      {getCategoryShortLabel(registration)}
                    </span>
                    {showDays ? (
                      <small className="admin-roster-row__days">
                        Giorni:{" "}
                        {days
                          .map((day) =>
                            new Date(day).toLocaleDateString("it-IT", {
                              day: "2-digit",
                              month: "2-digit",
                            }),
                          )
                          .join(", ")}
                      </small>
                    ) : null}
                    <PhotoConsentPills
                      className="admin-roster-row__consent"
                      registration={registration}
                    />
                    {isManualRegistration(registration) ||
                    isMissingParentEmail(registration) ? (
                      <span className="photo-consent-pills admin-roster-row__consent">
                        {isManualRegistration(registration) ? (
                          <StatusBadge label={ISCRITTI.pillAMano} tone="neutral" />
                        ) : null}
                        {isMissingParentEmail(registration) ? (
                          <StatusBadge label={ISCRITTI.pillMancaEmail} tone="warning" />
                        ) : null}
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </div>
          )}
        </article>
      )}
    </section>
  );
}
