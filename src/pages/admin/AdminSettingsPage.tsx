import { useMemo, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";

import { AdminEventEditorModal } from "@/components/AdminEventEditorModal";
import { AdminPushSettingsCard } from "@/components/AdminPushSettingsCard";
import { AppIcon } from "@/components/AppIcon";
import { AppModal } from "@/components/AppModal";
import { EmptyState } from "@/components/EmptyState";
import { StatusBadge } from "@/components/StatusBadge";
import { useAsyncData } from "@/hooks/useAsyncData";
import { useAuth } from "@/hooks/useAuth";
import { storageService } from "@/services/firebase/storageService";
import { organizationService } from "@/services/firestore/organizationService";
import { registrationAttemptsService } from "@/services/firestore/registrationAttemptsService";
import { unitsService } from "@/services/firestore/unitsService";
import { usersService } from "@/services/firestore/usersService";
import type {
  OrganizationProfile,
  RegistrationAttemptLog,
  StandardFieldKey,
  Unit,
  UserProfile,
} from "@/types";
import { formatDateTime } from "@/utils/formatters";
import {
  getVisibleStandardFieldDefinitions,
  normalizeStandardFieldKeys,
} from "@/utils/formFields";

interface SettingsActionCardProps {
  icon: "building" | "badge" | "key" | "list" | "chart";
  title: string;
  description: string;
  onClick: () => void;
}

function getAttemptStatusTone(status: RegistrationAttemptLog["status"]) {
  switch (status) {
    case "succeeded":
      return "success" as const;
    case "failed":
      return "danger" as const;
    default:
      return "warning" as const;
  }
}

function getAttemptStatusLabel(status: RegistrationAttemptLog["status"]) {
  switch (status) {
    case "succeeded":
      return "Completata";
    case "failed":
      return "Errore";
    default:
      return "In corso";
  }
}

function getAttemptStepLabel(step: RegistrationAttemptLog["lastStep"]) {
  switch (step) {
    case "registration_saved":
      return "Registrazione salvata";
    case "recovery_saved":
      return "Recovery salvato";
    case "completed":
      return "Conferma completata";
    case "pdf_generated":
      return "PDF generato";
    case "submit_failed":
      return "Errore submit";
    case "pdf_failed":
      return "Errore PDF";
    default:
      return "Submit avviato";
  }
}

function getModeLabel(mode: RegistrationAttemptLog["submittedByMode"]) {
  return mode === "anonymous" ? "Ospite" : "Con account";
}

function SettingsActionCard({
  icon,
  title,
  description,
  onClick,
}: SettingsActionCardProps) {
  return (
    <button className="settings-action-card" onClick={onClick} type="button">
      <span className="settings-action-card__icon">
        <AppIcon name={icon} />
      </span>
      <span className="settings-action-card__content">
        <strong>{title}</strong>
        <small>{description}</small>
      </span>
    </button>
  );
}

function toSaveInput(organization: OrganizationProfile) {
  return {
    stakeName: organization.stakeName,
    publicHomeTitle: organization.publicHomeTitle,
    publicHomeSubtitle: organization.publicHomeSubtitle,
    accountHelpText: organization.accountHelpText,
    codeRecoveryHelpText: organization.codeRecoveryHelpText,
    units: organization.units,
    youngMenPresident: organization.youngMenPresident,
    youngMenCounselors: organization.youngMenCounselors,
    youngWomenPresident: organization.youngWomenPresident,
    youngWomenCounselors: organization.youngWomenCounselors,
    supportContact: organization.supportContact,
    guestRegistrationHint: organization.guestRegistrationHint,
    minorConsentExampleImageUrl: organization.minorConsentExampleImageUrl,
    minorConsentExampleImagePath: organization.minorConsentExampleImagePath,
    registrationDefaults: organization.registrationDefaults,
  };
}

function OrganizationMetaModal({
  organization,
  busy,
  onClose,
  onSave,
}: {
  organization: OrganizationProfile;
  busy: boolean;
  onClose: () => void;
  onSave: (
    input: Omit<OrganizationProfile, "id" | "stakeId" | "stakeSlug" | "isActive" | "updatedAt">,
  ) => Promise<void>;
}) {
  const [values, setValues] = useState({
    stakeName: organization.stakeName,
    publicHomeTitle: organization.publicHomeTitle,
    publicHomeSubtitle: organization.publicHomeSubtitle,
    accountHelpText: organization.accountHelpText,
    codeRecoveryHelpText: organization.codeRecoveryHelpText,
    supportContact: organization.supportContact,
    guestRegistrationHint: organization.guestRegistrationHint,
    youngMenPresident: organization.youngMenPresident,
    youngMenCounselorsText: organization.youngMenCounselors.join(", "),
    youngWomenPresident: organization.youngWomenPresident,
    youngWomenCounselorsText: organization.youngWomenCounselors.join(", "),
  });

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await onSave({
      ...toSaveInput(organization),
      stakeName: values.stakeName,
      publicHomeTitle: values.publicHomeTitle,
      publicHomeSubtitle: values.publicHomeSubtitle,
      accountHelpText: values.accountHelpText,
      codeRecoveryHelpText: values.codeRecoveryHelpText,
      supportContact: values.supportContact,
      guestRegistrationHint: values.guestRegistrationHint,
      youngMenPresident: values.youngMenPresident,
      youngMenCounselors: values.youngMenCounselorsText
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean),
      youngWomenPresident: values.youngWomenPresident,
      youngWomenCounselors: values.youngWomenCounselorsText
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean),
    });
    onClose();
  }

  return (
    <AppModal
      title="Profilo del palo"
      subtitle="Responsabili, testi pubblici e supporto"
      onClose={onClose}
      size="wide"
    >
      <form className="form-stack form-stack--compact" onSubmit={handleSubmit}>
        <div className="card-grid card-grid--two">
          <label className="field">
            <span>Nome del palo</span>
            <input
              className="input"
              value={values.stakeName}
              onChange={(eventInput) =>
                setValues((current) => ({ ...current, stakeName: eventInput.target.value }))
              }
            />
          </label>

          <label className="field">
            <span>Contatto di supporto</span>
            <input
              className="input"
              value={values.supportContact}
              onChange={(eventInput) =>
                setValues((current) => ({ ...current, supportContact: eventInput.target.value }))
              }
            />
          </label>
        </div>

        <label className="field">
          <span>Titolo homepage pubblica</span>
          <input
            className="input"
            value={values.publicHomeTitle}
            onChange={(eventInput) =>
              setValues((current) => ({ ...current, publicHomeTitle: eventInput.target.value }))
            }
          />
        </label>

        <div className="card-grid card-grid--two">
          <label className="field">
            <span>Responsabile GU</span>
            <input
              className="input"
              value={values.youngMenPresident}
              onChange={(eventInput) =>
                setValues((current) => ({ ...current, youngMenPresident: eventInput.target.value }))
              }
            />
          </label>

          <label className="field">
            <span>Responsabile GD</span>
            <input
              className="input"
              value={values.youngWomenPresident}
              onChange={(eventInput) =>
                setValues((current) => ({
                  ...current,
                  youngWomenPresident: eventInput.target.value,
                }))
              }
            />
          </label>
        </div>

        <div className="card-grid card-grid--two">
          <label className="field">
            <span>Consiglieri GU</span>
            <input
              className="input"
              value={values.youngMenCounselorsText}
              onChange={(eventInput) =>
                setValues((current) => ({
                  ...current,
                  youngMenCounselorsText: eventInput.target.value,
                }))
              }
            />
          </label>

          <label className="field">
            <span>Consigliere GD</span>
            <input
              className="input"
              value={values.youngWomenCounselorsText}
              onChange={(eventInput) =>
                setValues((current) => ({
                  ...current,
                  youngWomenCounselorsText: eventInput.target.value,
                }))
              }
            />
          </label>
        </div>

        <label className="field">
          <span>Sottotitolo homepage</span>
          <textarea
            className="input input--textarea"
            rows={3}
            value={values.publicHomeSubtitle}
            onChange={(eventInput) =>
              setValues((current) => ({ ...current, publicHomeSubtitle: eventInput.target.value }))
            }
          />
        </label>

        <label className="field">
          <span>Testo aiuto account</span>
          <textarea
            className="input input--textarea"
            rows={3}
            value={values.accountHelpText}
            onChange={(eventInput) =>
              setValues((current) => ({ ...current, accountHelpText: eventInput.target.value }))
            }
          />
        </label>

        <label className="field">
          <span>Testo recupero ospite</span>
          <textarea
            className="input input--textarea"
            rows={3}
            value={values.codeRecoveryHelpText}
            onChange={(eventInput) =>
              setValues((current) => ({
                ...current,
                codeRecoveryHelpText: eventInput.target.value,
              }))
            }
          />
        </label>

        <label className="field">
          <span>Messaggio iscrizione ospite</span>
          <textarea
            className="input input--textarea"
            rows={3}
            value={values.guestRegistrationHint}
            onChange={(eventInput) =>
              setValues((current) => ({
                ...current,
                guestRegistrationHint: eventInput.target.value,
              }))
            }
          />
        </label>

        <button className="button button--primary" disabled={busy} type="submit">
          {busy ? "Salvataggio..." : "Salva"}
        </button>
      </form>
    </AppModal>
  );
}

function UnitsModal({
  stakeId,
  onClose,
}: {
  stakeId: string;
  onClose: () => void;
}) {
  const [refreshKey, setRefreshKey] = useState(0);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const { data: units, loading, setData } = useAsyncData(
    () => unitsService.listUnits(stakeId, { includeInactive: true }),
    [refreshKey, stakeId],
    [] as Unit[],
  );

  async function handleAdd() {
    if (!draft.trim()) {
      return;
    }

    setBusyId("new");
    const savedUnit = await unitsService.createOrUpdateUnit(stakeId, { name: draft });
    setDraft("");
    setData((current) =>
      [...current.filter((item) => item.id !== savedUnit.id), savedUnit].sort((left, right) =>
        left.name.localeCompare(right.name, "it-IT"),
      ),
    );
    setBusyId(null);
  }

  async function handleSave(unit: Unit) {
    setBusyId(unit.id);
    const updatedUnit = await unitsService.updateUnit(stakeId, unit.id, {
      name: unit.name,
      type: unit.type,
      isActive: unit.isActive,
    });
    setData((current) =>
      current.map((item) => (item.id === unit.id && updatedUnit ? updatedUnit : item)),
    );
    setBusyId(null);
  }

  async function handleDeactivate(unitId: string) {
    setBusyId(unitId);
    await unitsService.deactivateUnit(stakeId, unitId);
    setRefreshKey((current) => current + 1);
    setBusyId(null);
  }

  return (
    <AppModal title="Unità" subtitle="Aggiungi, modifica o rimuovi" onClose={onClose}>
      <div className="form-stack form-stack--compact">
        <div className="inline-actions inline-actions--compact">
          <input
            className="input"
            placeholder="Nuova unità"
            value={draft}
            onChange={(eventInput) => setDraft(eventInput.target.value)}
          />
          <button className="button button--primary" disabled={busyId === "new"} onClick={() => void handleAdd()} type="button">
            Aggiungi
          </button>
        </div>

        {loading ? (
          <p className="subtle-text">Sto caricando le unità...</p>
        ) : (
          <div className="stack">
            {units.map((unit) => (
              <article key={unit.id} className="surface-panel surface-panel--subtle unit-editor-row">
                <input
                  className="input"
                  value={unit.name}
                  onChange={(eventInput) =>
                    setData((current) =>
                      current.map((item) =>
                        item.id === unit.id ? { ...item, name: eventInput.target.value } : item,
                      ),
                    )
                  }
                />
                <select
                  className="input"
                  value={unit.type}
                  onChange={(eventInput) =>
                    setData((current) =>
                      current.map((item) =>
                        item.id === unit.id
                          ? { ...item, type: eventInput.target.value as Unit["type"] }
                          : item,
                      ),
                    )
                  }
                >
                  <option value="rione">Rione</option>
                  <option value="ramo">Ramo</option>
                </select>
                <button className="button button--ghost" disabled={busyId === unit.id} onClick={() => void handleSave(unit)} type="button">
                  Salva
                </button>
                <button
                  className="button button--ghost button--danger"
                  disabled={busyId === unit.id}
                  onClick={() => void handleDeactivate(unit.id)}
                  type="button"
                >
                  Rimuovi
                </button>
              </article>
            ))}
          </div>
        )}
      </div>
    </AppModal>
  );
}

function StandardFieldsModal({
  organization,
  stakeId,
  sessionUid,
  busy,
  onClose,
  onSave,
}: {
  organization: OrganizationProfile;
  stakeId: string;
  sessionUid: string;
  busy: boolean;
  onClose: () => void;
  onSave: (
    input: Omit<OrganizationProfile, "id" | "stakeId" | "stakeSlug" | "isActive" | "updatedAt">,
  ) => Promise<void>;
}) {
  const baseFields = useMemo(
    () => getVisibleStandardFieldDefinitions(organization.registrationDefaults.fieldOverrides),
    [organization.registrationDefaults.fieldOverrides],
  );
  const [enabledFields, setEnabledFields] = useState<StandardFieldKey[]>(
    normalizeStandardFieldKeys(organization.registrationDefaults.enabledStandardFields),
  );
  const [allowGuestRegistration, setAllowGuestRegistration] = useState(
    organization.registrationDefaults.allowGuestRegistration,
  );
  const [requireLoginForEdit, setRequireLoginForEdit] = useState(
    organization.registrationDefaults.requireLoginForEdit,
  );
  const [fields, setFields] = useState(baseFields);
  const [minorConsentExampleImageUrl, setMinorConsentExampleImageUrl] = useState(
    organization.minorConsentExampleImageUrl || "",
  );
  const [minorConsentExampleImagePath, setMinorConsentExampleImagePath] = useState(
    organization.minorConsentExampleImagePath || "",
  );
  const [uploadingExample, setUploadingExample] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  async function handleExampleUpload(file?: File | null) {
    if (!file) {
      return;
    }

    setUploadingExample(true);
    setUploadError(null);

    try {
      const uploadedFile = await storageService.uploadMinorConsentExampleImage({
        file,
        uploadedBy: sessionUid,
        stakeId,
        previousPath: minorConsentExampleImagePath || undefined,
      });
      setMinorConsentExampleImageUrl(uploadedFile.url);
      setMinorConsentExampleImagePath(uploadedFile.path);
    } catch (caughtError) {
      setUploadError(
        caughtError instanceof Error
          ? caughtError.message
          : "Impossibile caricare l'esempio.",
      );
    } finally {
      setUploadingExample(false);
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    await onSave({
      ...toSaveInput(organization),
      minorConsentExampleImageUrl,
      minorConsentExampleImagePath,
      registrationDefaults: {
        allowGuestRegistration,
        requireLoginForEdit,
        enabledStandardFields: enabledFields,
        fieldOverrides: fields.reduce<NonNullable<OrganizationProfile["registrationDefaults"]["fieldOverrides"]>>(
          (accumulator, field) => {
            accumulator[field.key] = {
              label: field.label,
              helpText: field.helpText,
              options: field.options,
            };
            return accumulator;
          },
          {},
        ),
      },
    });
    onClose();
  }

  return (
    <AppModal
      title="Moduli"
      subtitle="Campi standard e preset di default"
      onClose={onClose}
      size="wide"
    >
      <form className="form-stack form-stack--compact" onSubmit={handleSubmit}>
        <div className="checkbox-grid">
          <label className="toggle-field">
            <input
              type="checkbox"
              checked={allowGuestRegistration}
              onChange={(eventInput) => setAllowGuestRegistration(eventInput.target.checked)}
            />
            <span>Consenti iscrizione ospite di default</span>
          </label>

          <label className="toggle-field">
            <input
              type="checkbox"
              checked={requireLoginForEdit}
              onChange={(eventInput) => setRequireLoginForEdit(eventInput.target.checked)}
            />
            <span>Richiedi login per modificare l'iscrizione</span>
          </label>
        </div>

        <div className="surface-panel surface-panel--subtle form-subsection">
          <h3>Esempio consenso genitori</h3>
          <p>
            Carica un fac-simile fotografato o scannerizzato: verra mostrato ai partecipanti
            minorenni per far capire subito che tipo di foglio preparare.
          </p>

          <div className="upload-panel">
            {minorConsentExampleImageUrl ? (
              <div
                className="upload-preview"
                style={{ backgroundImage: `url(${minorConsentExampleImageUrl})` }}
              />
            ) : (
              <div className="upload-placeholder">
                Nessun esempio caricato. Aggiungilo qui per guidare meglio le famiglie.
              </div>
            )}

            <div className="upload-actions">
              <label className="button button--soft button--small upload-button">
                <input
                  accept="image/*"
                  hidden
                  onChange={(eventInput) =>
                    void handleExampleUpload(eventInput.target.files?.[0] ?? null)
                  }
                  type="file"
                />
                {uploadingExample ? "Caricamento..." : "Carica esempio"}
              </label>
              {uploadError ? <small className="field-error">{uploadError}</small> : null}
            </div>
          </div>
        </div>

        <div className="stack">
          {fields.map((field) => {
            const isEnabled = enabledFields.includes(field.key);

            return (
              <article key={field.key} className="surface-panel surface-panel--subtle form-field-editor">
                <label className="toggle-field">
                  <input
                    type="checkbox"
                    checked={isEnabled}
                    onChange={() =>
                      setEnabledFields((current) =>
                        current.includes(field.key)
                          ? current.filter((item) => item !== field.key)
                          : normalizeStandardFieldKeys([...current, field.key]),
                      )
                    }
                  />
                  <span>{field.label}</span>
                </label>

                <label className="field">
                  <span>Label</span>
                  <input
                    className="input"
                    value={field.label}
                    onChange={(eventInput) =>
                      setFields((current) =>
                        current.map((item) =>
                          item.key === field.key ? { ...item, label: eventInput.target.value } : item,
                        ),
                      )
                    }
                  />
                </label>

                <label className="field">
                  <span>Testo aiuto</span>
                  <textarea
                    className="input input--textarea"
                    rows={2}
                    value={field.helpText}
                    onChange={(eventInput) =>
                      setFields((current) =>
                        current.map((item) =>
                          item.key === field.key
                            ? { ...item, helpText: eventInput.target.value }
                            : item,
                        ),
                      )
                    }
                  />
                </label>

                {field.inputType === "select" ? (
                  <label className="field">
                    <span>Opzioni</span>
                    <input
                      className="input"
                      placeholder="Valore 1, Valore 2, Valore 3"
                      value={(field.options ?? []).join(", ")}
                      onChange={(eventInput) =>
                        setFields((current) =>
                          current.map((item) =>
                            item.key === field.key
                              ? {
                                  ...item,
                                  options: eventInput.target.value
                                    .split(",")
                                    .map((option) => option.trim())
                                    .filter(Boolean),
                                }
                              : item,
                          ),
                        )
                      }
                    />
                  </label>
                ) : null}
              </article>
            );
          })}
        </div>

        <button className="button button--primary" disabled={busy} type="submit">
          {busy ? "Salvataggio..." : "Salva"}
        </button>
      </form>
    </AppModal>
  );
}

function AssignAdminModal({
  stakeId,
  onClose,
}: {
  stakeId: string;
  onClose: () => void;
}) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const { data: users, loading, setData } = useAsyncData(
    () => usersService.listStakeUsers(stakeId),
    [stakeId],
    [] as UserProfile[],
  );

  async function handleAssignAdmin(userId: string) {
    setBusyId(userId);
    const updatedProfile = await usersService.assignAdminRole(stakeId, userId);
    setData((current) =>
      current.map((item) => (item.id === userId && updatedProfile ? updatedProfile : item)),
    );
    setBusyId(null);
  }

  return (
    <AppModal title="Assegna admin" subtitle="Solo utenti del tuo palo" onClose={onClose}>
      {loading ? (
        <p className="subtle-text">Sto caricando gli utenti...</p>
      ) : (
        <div className="stack">
          {users.map((user) => (
            <article key={user.id} className="surface-panel surface-panel--subtle assign-admin-row">
              <div>
                <strong>{user.fullName || user.email || "Utente senza nome"}</strong>
                <p>{user.email || "Email non disponibile"}</p>
              </div>
              {user.role === "admin" || user.role === "super_admin" ? (
                <span className="surface-chip">
                  {user.role === "super_admin" ? "Super admin" : "Admin"}
                </span>
              ) : (
                <button
                  className="button button--primary"
                  disabled={busyId === user.id}
                  onClick={() => void handleAssignAdmin(user.id)}
                  type="button"
                >
                  {busyId === user.id ? "Assegnazione..." : "Assegna admin"}
                </button>
              )}
            </article>
          ))}
        </div>
      )}
    </AppModal>
  );
}

export function AdminSettingsPage() {
  const { session } = useAuth();
  const navigate = useNavigate();
  const stakeId = session?.profile.stakeId ?? "roma-est";
  const [refreshKey, setRefreshKey] = useState(0);
  const [busy, setBusy] = useState(false);
  const [modal, setModal] = useState<null | "profile" | "units" | "forms" | "admins" | "logs">(null);
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [attemptSearch, setAttemptSearch] = useState("");
  const { data: organization, loading, error } = useAsyncData(
    () => organizationService.getProfile(stakeId),
    [refreshKey, stakeId],
    null,
  );
  const { data: recentAttempts, loading: attemptsLoading } = useAsyncData(
    () => registrationAttemptsService.listRecentAttempts(stakeId, 40),
    [stakeId],
    [] as RegistrationAttemptLog[],
  );
  const filteredAttempts = useMemo(() => {
    const normalizedSearch = attemptSearch.trim().toLowerCase();

    if (!normalizedSearch) {
      return recentAttempts;
    }

    return recentAttempts.filter((attempt) =>
      [
        attempt.fullName,
        attempt.email,
        attempt.eventTitle,
        attempt.errorMessage || "",
        getAttemptStatusLabel(attempt.status),
        getAttemptStepLabel(attempt.lastStep),
      ]
        .join(" ")
        .toLowerCase()
        .includes(normalizedSearch),
    );
  }, [attemptSearch, recentAttempts]);

  async function handleSaveOrganization(
    input: Omit<OrganizationProfile, "id" | "stakeId" | "stakeSlug" | "isActive" | "updatedAt">,
  ) {
    setBusy(true);

    try {
      await organizationService.saveProfile(stakeId, input);
      setRefreshKey((current) => current + 1);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page">
      {error ? (
        <div className="notice notice--warning">
          <div>
            <h3>Altro non disponibile</h3>
            <p>{error}</p>
          </div>
        </div>
      ) : null}

      {loading || !organization ? (
        <p className="subtle-text">Sto preparando l'area operativa...</p>
      ) : (
        <>
          <section className="admin-section">
            <div className="admin-section__head">
              <div>
                <h2>Operatività</h2>
              </div>
            </div>

            <div className="stack">
              <button className="button button--primary" onClick={() => setCreateModalOpen(true)} type="button">
                Crea nuova attività
              </button>

              <div className="card-grid card-grid--two">
                <SettingsActionCard
                  description="Griglia completa delle attività"
                  icon="list"
                  onClick={() => navigate("/admin/events")}
                  title="Tutte le attività"
                />
                <SettingsActionCard
                  description="Statistiche del palo e iscritti globali"
                  icon="chart"
                  onClick={() => navigate("/admin/stats")}
                  title="Statistiche"
                />
                <SettingsActionCard
                  description="Tentativi recenti di iscrizione e supporto"
                  icon="list"
                  onClick={() => setModal("logs")}
                  title="Log"
                />
              </div>
            </div>
          </section>

          <AdminPushSettingsCard />

          <section className="admin-section">
            <div className="admin-section__head">
              <div>
                <h2>Organizzazione</h2>
              </div>
            </div>

            <div className="card-grid card-grid--two">
              <SettingsActionCard
                description="Lista unità del palo"
                icon="building"
                onClick={() => setModal("units")}
                title="Unità"
              />
              <SettingsActionCard
                description="Preset e campi standard dei moduli"
                icon="badge"
                onClick={() => setModal("forms")}
                title="Moduli"
              />
              <SettingsActionCard
                description="Responsabili, testi pubblici e supporto"
                icon="key"
                onClick={() => setModal("profile")}
                title="Profilo del palo"
              />
              <SettingsActionCard
                description="Promuovi admin nel tuo palo"
                icon="badge"
                onClick={() => setModal("admins")}
                title="Assegna admin"
              />
            </div>
          </section>

          {modal === "profile" ? (
            <OrganizationMetaModal
              busy={busy}
              organization={organization}
              onClose={() => setModal(null)}
              onSave={handleSaveOrganization}
            />
          ) : null}

          {modal === "units" ? (
            <UnitsModal onClose={() => setModal(null)} stakeId={stakeId} />
          ) : null}

          {modal === "forms" && session ? (
            <StandardFieldsModal
              busy={busy}
              organization={organization}
              onClose={() => setModal(null)}
              onSave={handleSaveOrganization}
              sessionUid={session.firebaseUser.uid}
              stakeId={stakeId}
            />
          ) : null}

          {modal === "admins" ? (
            <AssignAdminModal onClose={() => setModal(null)} stakeId={stakeId} />
          ) : null}

          {modal === "logs" ? (
            <AppModal
              title="Log invii"
              subtitle="Tentativi recenti di iscrizione con ricerca rapida"
              onClose={() => setModal(null)}
              size="wide"
            >
              <div className="stack">
                <div className="support-monitor__filters">
                  <label className="field">
                    <span>Cerca</span>
                    <input
                      className="input"
                      placeholder="Nome, email o attività"
                      value={attemptSearch}
                      onChange={(eventInput) => setAttemptSearch(eventInput.target.value)}
                    />
                  </label>
                </div>

                {attemptsLoading ? (
                  <p className="subtle-text">Sto caricando i log recenti...</p>
                ) : filteredAttempts.length === 0 ? (
                  <EmptyState
                    title="Nessun log con questi filtri"
                    description="Prova a cambiare ricerca oppure attendi nuovi invii."
                  />
                ) : (
                  <div className="stack support-monitor__modal-list">
                    {filteredAttempts.map((attempt) => (
                      <article
                        key={attempt.id}
                        className="surface-panel surface-panel--subtle admin-registration-row support-monitor__row"
                      >
                        <div>
                          <strong>{attempt.fullName || "Iscrizione senza nome"}</strong>
                          <p>{attempt.eventTitle}</p>
                          <p>
                            {getModeLabel(attempt.submittedByMode)}
                            {" • "}
                            {getAttemptStepLabel(attempt.lastStep)}
                            {" • "}
                            {formatDateTime(attempt.updatedAt)}
                          </p>
                          {attempt.email ? <p>{attempt.email}</p> : null}
                          {attempt.errorMessage ? (
                            <p className="support-monitor__error">{attempt.errorMessage}</p>
                          ) : null}
                        </div>

                        <div className="admin-registration-row__meta support-monitor__meta">
                          <StatusBadge
                            label={getAttemptStatusLabel(attempt.status)}
                            tone={getAttemptStatusTone(attempt.status)}
                          />
                          <small>
                            {attempt.displayMode === "standalone" ? "PWA" : "Browser"}
                            {" • "}
                            {attempt.online ? "online" : "offline"}
                          </small>
                          <button
                            className="button button--ghost button--small"
                            onClick={() => {
                              setModal(null);
                              navigate(`/admin/events/${attempt.eventId}`);
                            }}
                            type="button"
                          >
                            Apri attività
                          </button>
                        </div>
                      </article>
                    ))}
                  </div>
                )}
              </div>
            </AppModal>
          ) : null}

          {createModalOpen && session ? (
            <AdminEventEditorModal
              organization={organization}
              sessionUid={session.firebaseUser.uid}
              stakeId={stakeId}
              onClose={() => setCreateModalOpen(false)}
              onCompleted={(eventId) => navigate(`/admin/events/${eventId}`)}
            />
          ) : null}
        </>
      )}
    </div>
  );
}
