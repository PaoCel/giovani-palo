import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";

import { AppIcon } from "@/components/AppIcon";
import { EmptyState } from "@/components/EmptyState";
import { ConsentSection } from "@/components/ConsentSection";
import { ParentConsentUploadCard } from "@/components/ParentConsentUploadCard";
import { PageHero } from "@/components/PageHero";
import { QuestionsSection } from "@/components/QuestionsSection";
import { RegistrationEditor } from "@/components/RegistrationEditor";
import { SectionCard } from "@/components/SectionCard";
import { StatusBadge } from "@/components/StatusBadge";
import { useAuth } from "@/hooks/useAuth";
import { useAsyncData } from "@/hooks/useAsyncData";
import { toUserFacingAuthError } from "@/services/firebase/debug";
import { eventFormsService } from "@/services/firestore/eventFormsService";
import { eventsService } from "@/services/firestore/eventsService";
import { organizationService } from "@/services/firestore/organizationService";
import { registrationAttemptsService } from "@/services/firestore/registrationAttemptsService";
import { registrationsService } from "@/services/firestore/registrationsService";
import type { OrganizationProfile, Registration, RegistrationWriteInput } from "@/types";
import { formatDateTime } from "@/utils/formatters";
import { getVisibleStandardFieldDefinitions } from "@/utils/formFields";
import { isMinorBirthDate } from "@/utils/age";
import {
  getAudienceRestrictionMessage,
  getEventAudienceLabel,
  getRegistrationAvailability,
  isEventAudienceEligible,
} from "@/utils/events";
import { getRegistrationStatusLabel, getRegistrationStatusTone } from "@/utils/registrations";
import { getRegistrationLookupFromSession } from "@/utils/session";
import { writePendingAccountProfile } from "@/utils/pendingAccountProfile";
import { resolvePublicStakeId } from "@/utils/stakeSelection";

interface RegisterPageData {
  stakeId: string;
  organization: OrganizationProfile | null;
  event: Awaited<ReturnType<typeof eventsService.getPublicEventById>>;
  formConfig: Awaited<ReturnType<typeof eventFormsService.getFormConfig>> | null;
  registration: Awaited<ReturnType<typeof registrationsService.getRegistrationById>>;
}

const initialData: RegisterPageData = {
  stakeId: "",
  organization: null,
  event: null,
  formConfig: null,
  registration: null,
};

function createAnonymousTokenId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `anon_${crypto.randomUUID()}`;
  }

  return `anon_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export function ActivityRegisterPage() {
  const { eventId } = useParams();
  const navigate = useNavigate();
  const { session, signInAnonymously } = useAuth();
  const sessionKey = session ? `${session.firebaseUser.uid}:${session.isAnonymous}` : "public";
  const [busy, setBusy] = useState<null | "anonymous" | "save" | "pdf">(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [anonymousCompletion, setAnonymousCompletion] = useState<Registration | null>(null);
  const [latestAttemptLogId, setLatestAttemptLogId] = useState<string | null>(null);

  const { data, loading, error, setData } = useAsyncData(
    async () => {
      if (!eventId) {
        return initialData;
      }

      const stakeId = await resolvePublicStakeId(session?.profile.stakeId);
      const organization = await organizationService.getProfile(stakeId);
      const event = await eventsService.getPublicEventById(stakeId, eventId);

      if (!event) {
        return {
          ...initialData,
          stakeId,
          organization,
        };
      }

      const formConfig = await eventFormsService.getFormConfig(stakeId, eventId);
      const lookup = getRegistrationLookupFromSession(session);
      const registration =
        lookup.userId || lookup.anonymousUid
          ? await registrationsService.getRegistrationByActor(stakeId, eventId, lookup)
          : null;

      return {
        stakeId,
        organization,
        event,
        formConfig,
        registration,
      };
    },
    [eventId, sessionKey],
    initialData,
  );

  async function handleAnonymousAccess() {
    setBusy("anonymous");
    setActionError(null);

    try {
      await signInAnonymously();
    } catch (caughtError) {
      setActionError(toUserFacingAuthError(caughtError));
    } finally {
      setBusy(null);
    }
  }

  async function handleSubmit(input: RegistrationWriteInput) {
    if (!data.event || !data.stakeId || !session) {
      setActionError("Serve una sessione valida per salvare la registrazione.");
      return;
    }

    const lookup = getRegistrationLookupFromSession(session);

    if (!lookup.userId && !lookup.anonymousUid) {
      setActionError("Impossibile determinare il proprietario della registrazione.");
      return;
    }

    setBusy("save");
    setActionError(null);

    const attemptLogId = await registrationAttemptsService.startAttempt({
      stakeId: data.stakeId,
      eventId: data.event.id,
      eventTitle: data.event.title,
      lookup,
      input,
    });

    setLatestAttemptLogId(attemptLogId);

    try {
      const savedRegistration = await registrationsService.upsertRegistration(
        data.stakeId,
        data.event.id,
        lookup,
        input,
      );

      if (!savedRegistration) {
        throw new Error("La registrazione non è stata riletta correttamente.");
      }

      await registrationAttemptsService.markStep(data.stakeId, attemptLogId, {
        lastStep: "registration_saved",
        registrationId: savedRegistration.id,
        registrationStatus: savedRegistration.registrationStatus,
      });

      let nextRegistration = savedRegistration;

      if (session.isAnonymous && lookup.anonymousUid) {
        const recoveryCode =
          savedRegistration.recoveryCode ?? savedRegistration.accessCode ?? "";

        if (!recoveryCode) {
          throw new Error("Codice di recupero non disponibile.");
        }

        const recovered = await registrationsService.saveAnonymousRecovery(
          data.stakeId,
          data.event.id,
          savedRegistration.id,
          {
            anonymousUid: lookup.anonymousUid,
            anonymousTokenId:
              savedRegistration.anonymousTokenId ?? createAnonymousTokenId(),
            recoveryCode,
            pdfDataSummary: {
              eventTitle: data.event.title,
              fullName: savedRegistration.fullName,
              email: savedRegistration.email,
              submittedAt: savedRegistration.updatedAt,
            },
            recoveryPdfGenerated: savedRegistration.recoveryPdfGenerated,
          },
        );

        nextRegistration = recovered ?? savedRegistration;
        await registrationAttemptsService.markStep(data.stakeId, attemptLogId, {
          lastStep: "recovery_saved",
          registrationId: nextRegistration.id,
          registrationStatus: nextRegistration.registrationStatus,
        });
        setAnonymousCompletion(nextRegistration);
        window.scrollTo({ top: 0, behavior: "smooth" });
      } else {
        await registrationAttemptsService.markSucceeded(
          data.stakeId,
          attemptLogId,
          nextRegistration,
          "completed",
        );
        navigate(`/me/activities/${data.event.id}`, { replace: true });
      }

      setData((current) => ({
        ...current,
        registration: nextRegistration,
      }));

      if (session.isAnonymous && lookup.anonymousUid) {
        await registrationAttemptsService.markSucceeded(
          data.stakeId,
          attemptLogId,
          nextRegistration,
          "completed",
        );
      }
    } catch (caughtError) {
      await registrationAttemptsService.markFailed(
        data.stakeId,
        attemptLogId,
        "submit_failed",
        caughtError,
      );
      setActionError(
        caughtError instanceof Error
          ? caughtError.message
          : "Impossibile salvare la registrazione.",
      );
    } finally {
      setBusy(null);
    }
  }

  async function handleDownloadPdf() {
    if (!data.event || !data.formConfig || !anonymousCompletion || !data.stakeId) {
      return;
    }

    setBusy("pdf");
    setActionError(null);

    try {
      const { downloadRegistrationPdf } = await import("@/utils/registrationPdf");

      downloadRegistrationPdf({
        event: data.event,
        registration: anonymousCompletion,
        formConfig: data.formConfig,
      });

      await registrationsService.markRecoveryPdfGenerated(
        data.stakeId,
        data.event.id,
        anonymousCompletion.id,
      );

      setAnonymousCompletion((current) =>
        current
          ? {
              ...current,
              recoveryPdfGenerated: true,
            }
          : current,
      );
      await registrationAttemptsService.markSucceeded(
        data.stakeId,
        latestAttemptLogId,
        anonymousCompletion,
        "pdf_generated",
      );
    } catch (caughtError) {
      await registrationAttemptsService.markFailed(
        data.stakeId,
        latestAttemptLogId,
        "pdf_failed",
        caughtError,
      );
      setActionError(
        caughtError instanceof Error
          ? caughtError.message
          : "Impossibile generare il PDF riepilogativo.",
      );
    } finally {
      setBusy(null);
    }
  }

  if (!loading && !data.event) {
    return (
      <div className="page">
        <EmptyState
          title="Attività non disponibile"
          description="L'attività non è pubblica oppure non esiste."
          action={
            <Link className="button button--primary" to="/activities">
              Torna alle attività
            </Link>
          }
        />
      </div>
    );
  }

  const event = data.event;
  const formConfig = data.formConfig;
  const organization = data.organization;
  const availability =
    event && formConfig ? getRegistrationAvailability(event, formConfig, session) : null;
  const canEditExisting = Boolean(data.registration);
  const audienceMismatch =
    event && session?.isAuthenticated && !session.isAnonymous && !canEditExisting
      ? !isEventAudienceEligible(event, session.profile.genderRoleCategory)
      : false;
  // Per attivita' rafforzate (overnight/trip/camp/multi_day) con account
  // obbligatorio: blocco i guest. Anche se formConfig.allowGuestRegistration
  // fosse legacy true, qui prevale.
  const eventForcesAccount = Boolean(event?.requiresAccount);
  const allowGuestForThisActivity =
    Boolean(formConfig?.allowGuestRegistration) && !eventForcesAccount;
  const isAuthenticatedAccount = Boolean(session?.isAuthenticated && !session.isAnonymous);
  const accountBlockedForGuest =
    eventForcesAccount && session?.isAnonymous === true;
  const canSubmit =
    Boolean(event && formConfig && session) &&
    !audienceMismatch &&
    !accountBlockedForGuest &&
    (canEditExisting || availability === "open" || availability === "guest-allowed");
  const showRegisteredMinorConsentUpload =
    Boolean(
      data.registration &&
        session?.isAuthenticated &&
        !session.isAnonymous &&
        formConfig?.enabledStandardFields.includes("parentConfirmed") &&
        isMinorBirthDate(data.registration.birthDate),
    );

  return (
    <div className="page">
      <PageHero
        className="hero--compact"
        eyebrow="Iscrizione"
        title={event?.title ?? "Caricamento iscrizione..."}
        actions={
          session?.isAuthenticated && !session.isAnonymous ? (
            <Link className="button button--soft" to="/me">
              <AppIcon name="home" />
              <span>Dashboard</span>
            </Link>
          ) : undefined
        }
      />

      {error ? (
        <div className="notice notice--warning">
          <div>
            <h3>Caricamento modulo non riuscito</h3>
            <p>{error}</p>
          </div>
        </div>
      ) : null}

      {event && audienceMismatch ? (
        <div className="notice notice--warning">
          <div>
            <h3>Iscrizione non disponibile</h3>
            <p>{getAudienceRestrictionMessage(event.audience)}</p>
          </div>
        </div>
      ) : null}

      {actionError ? (
        <div className="notice notice--warning">
          <div>
            <h3>Azione non completata</h3>
            <p>{actionError}</p>
          </div>
        </div>
      ) : null}

      {anonymousCompletion ? (
        <SectionCard
          title="Iscrizione completata"
          description="Se non fai il login, i tuoi dati verranno salvati solo per questa attività."
        >
          <div className="stack">
            <div className="notice notice--info">
              <div>
                <h3>Codice di recupero</h3>
                <p>
                  Conserva questo codice:{" "}
                  <strong>
                    {anonymousCompletion.recoveryCode || anonymousCompletion.accessCode}
                  </strong>
                  . Lo ritrovi anche nel PDF riepilogativo.
                </p>
              </div>
              <StatusBadge
                label={getRegistrationStatusLabel(anonymousCompletion.registrationStatus)}
                tone={getRegistrationStatusTone(anonymousCompletion.registrationStatus)}
              />
            </div>

            <div className="inline-actions">
              <Link
                className="button button--primary"
                onClick={() => {
                  writePendingAccountProfile({
                    firstName: anonymousCompletion.firstName,
                    lastName: anonymousCompletion.lastName,
                    birthDate: anonymousCompletion.birthDate,
                    genderRoleCategory: anonymousCompletion.genderRoleCategory,
                    unitName: anonymousCompletion.unitNameSnapshot,
                  });
                }}
                to={`/login?redirect=${encodeURIComponent(`/me/activities/${eventId}`)}`}
              >
                <AppIcon name="user" />
                <span>Crea account</span>
              </Link>
              <button
                className="button button--ghost"
                disabled={busy !== null}
                onClick={() => void handleDownloadPdf()}
                type="button"
              >
                <AppIcon name="download" />
                <span>{busy === "pdf" ? "Generazione PDF..." : "PDF riepilogo"}</span>
              </button>
            </div>

            <p className="subtle-text">
              {organization?.codeRecoveryHelpText ||
                "Se preferisci continuare senza account, conserva il PDF e il codice di recupero."}
            </p>

            {formConfig?.enabledStandardFields.includes("parentConfirmed") &&
            isMinorBirthDate(anonymousCompletion.birthDate) &&
            !anonymousCompletion.parentConsentDocumentUrl ? (
              <div className="notice notice--warning">
                <div>
                  <h3>Consenso genitore ancora da caricare</h3>
                  <p>
                    Per allegare la foto del foglio firmato ti conviene creare un account e poi
                    aprire di nuovo questa attivita dalla tua area personale.
                  </p>
                </div>
              </div>
            ) : null}
          </div>
        </SectionCard>
      ) : null}

      {data.registration && !anonymousCompletion ? (
        <div className="notice notice--info">
          <div>
            <h3>Iscrizione già presente</h3>
            <p>
              Stato corrente: {getRegistrationStatusLabel(data.registration.registrationStatus)}.
              Le modifiche verranno salvate sullo stesso documento.
            </p>
            {data.registration.registrationStatus === "pending_parent_authorization" ? (
              <p style={{ marginTop: "0.6rem" }}>
                <strong>Email autorizzazione inviata al genitore.</strong> Se non la trovate
                in arrivo entro qualche minuto, controllate la <strong>cartella spam</strong>
                {" "}o <strong>posta indesiderata</strong>. Per iCloud/Outlook puo' capitare
                che venga filtrata: contrassegnatela come "non spam" per vederla. Mittente:
                {" "}<code>noreply@gugditalia.it</code>.
              </p>
            ) : null}
          </div>
          <StatusBadge
            label={getRegistrationStatusLabel(data.registration.registrationStatus)}
            tone={getRegistrationStatusTone(data.registration.registrationStatus)}
          />
        </div>
      ) : null}

      {!session && allowGuestForThisActivity ? (
        <SectionCard
          title="Come vuoi procedere?"
          description={
            organization?.guestRegistrationHint ||
            "Puoi iscriverti senza account oppure entrare con email e password."
          }
        >
          <div className="inline-actions">
            <button
              className="button button--primary"
              disabled={busy !== null}
              onClick={() => void handleAnonymousAccess()}
              type="button"
            >
              <AppIcon name="ticket" />
              <span>{busy === "anonymous" ? "Apertura sessione..." : "Senza account"}</span>
            </button>
            <Link
              className="button button--ghost"
              to={`/login?redirect=${encodeURIComponent(`/activities/${eventId}/register`)}`}
            >
              <AppIcon name="user" />
              <span>Login / Account</span>
            </Link>
          </div>

          {organization?.supportContact ? (
            <p className="subtle-text">
              Per supporto rapido puoi contattare: {organization.supportContact}.
            </p>
          ) : null}
        </SectionCard>
      ) : null}

      {!session && formConfig && !allowGuestForThisActivity ? (
        <SectionCard
          title={eventForcesAccount ? "Serve un account per questa attivita'" : "Serve un account"}
          description={
            eventForcesAccount
              ? "Questa attivita' prevede pernottamento o trasferta: per motivi di sicurezza l'iscrizione e' disponibile solo con account autenticato."
              : "Per questa attivita' l'iscrizione e' disponibile solo dopo autenticazione."
          }
        >
          <Link
            className="button button--primary"
            to={`/login?redirect=${encodeURIComponent(`/activities/${eventId}/register`)}`}
          >
            <AppIcon name="user" />
            <span>Vai al login</span>
          </Link>
        </SectionCard>
      ) : null}

      {accountBlockedForGuest ? (
        <SectionCard
          title="Iscrizione disponibile solo con account"
          description="Stai usando una sessione anonima. Per le attivita' con pernottamento o trasferta serve creare un account o accedere."
        >
          <Link
            className="button button--primary"
            to={`/login?redirect=${encodeURIComponent(`/activities/${eventId}/register`)}`}
          >
            <AppIcon name="user" />
            <span>Vai al login</span>
          </Link>
        </SectionCard>
      ) : null}

      {event && formConfig && canSubmit && !anonymousCompletion ? (
        <SectionCard title={data.registration ? "Aggiorna iscrizione" : "Compila il modulo"}>
          <RegistrationEditor
            busy={busy === "save"}
            event={event}
            formConfig={formConfig}
            initialRegistration={data.registration}
            session={session}
            standardFieldDefinitions={getVisibleStandardFieldDefinitions(
              organization?.registrationDefaults.fieldOverrides,
            )}
            minorConsentExampleImageUrl={organization?.minorConsentExampleImageUrl}
            unitOptions={organization?.units ?? []}
            submitLabel={data.registration ? "Salva modifiche" : "Conferma iscrizione"}
            onSubmit={handleSubmit}
          />
        </SectionCard>
      ) : null}

      {showRegisteredMinorConsentUpload && data.registration && session ? (
        <ParentConsentUploadCard
          eventId={data.event?.id || ""}
          exampleImageUrl={organization?.minorConsentExampleImageUrl}
          onRegistrationUpdated={(updatedRegistration) =>
            setData((current) =>
              current
                ? {
                    ...current,
                    registration: updatedRegistration,
                  }
                : current,
            )
          }
          registration={data.registration}
          sessionUid={session.firebaseUser.uid}
          stakeId={data.stakeId}
        />
      ) : null}

      {event?.questionsEnabled && data.registration && session ? (
        <QuestionsSection
          eventId={event.id}
          registration={data.registration}
          session={session}
          stakeId={data.stakeId}
        />
      ) : null}

      {event &&
      (event.requiresParentalConsent || event.requiresPhotoRelease) &&
      data.registration &&
      session ? (
        <SectionCard
          title="Autorizzazioni e firma"
          description="Completa firma digitale, consensi e (se vuoi) carica un documento del genitore."
        >
          <ConsentSection
            event={event}
            isMinor={isMinorBirthDate(data.registration.birthDate)}
            onRegistrationUpdated={(updated) =>
              setData((current) =>
                current
                  ? {
                      ...current,
                      registration: updated,
                    }
                  : current,
              )
            }
            persistImmediately
            registration={data.registration}
            sessionUid={session.firebaseUser.uid}
            stakeId={data.stakeId}
          />
        </SectionCard>
      ) : null}
    </div>
  );
}
