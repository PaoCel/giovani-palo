import { useState } from "react";
import { Link, useParams } from "react-router-dom";

import { EmptyState } from "@/components/EmptyState";
import { ConsentSection } from "@/components/ConsentSection";
import { ParentConsentUploadCard } from "@/components/ParentConsentUploadCard";
// keep import order stable for Vite
import { PageHero } from "@/components/PageHero";
import { QuestionsSection } from "@/components/QuestionsSection";
import { SectionCard } from "@/components/SectionCard";
import { StatusBadge } from "@/components/StatusBadge";
import { useAuth } from "@/hooks/useAuth";
import { useAsyncData } from "@/hooks/useAsyncData";
import { eventFormsService } from "@/services/firestore/eventFormsService";
import { organizationService } from "@/services/firestore/organizationService";
import { registrationsService } from "@/services/firestore/registrationsService";
import { userActivitiesService } from "@/services/firestore/userActivitiesService";
import { isMinorBirthDate } from "@/utils/age";
import { formatDateRange, formatDateTime } from "@/utils/formatters";
import { getEventAudienceLabel } from "@/utils/events";
import {
  getRegistrationAnswerEntries,
  getRegistrationStatusLabel,
  getRegistrationStatusTone,
} from "@/utils/registrations";
import { getRegistrationLookupFromSession } from "@/utils/session";

export function MyActivityDetailPage() {
  const { eventId } = useParams();
  const { session } = useAuth();
  const sessionKey = session ? `${session.firebaseUser.uid}:${session.isAnonymous}` : "none";
  const stakeId = session?.profile.stakeId ?? "";
  const [busy, setBusy] = useState<null | "cancel">(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const { data: organization } = useAsyncData(
    () => organizationService.getProfile(stakeId),
    [stakeId],
    null,
  );

  const { data, loading, error, setData } = useAsyncData(
    async () => {
      if (!eventId || !stakeId) {
        return null;
      }

      const bundle = await userActivitiesService.getForSessionEvent(session, eventId);

      if (!bundle) {
        return null;
      }

      const formConfig = await eventFormsService.getFormConfig(stakeId, eventId);

      return {
        ...bundle,
        formConfig,
      };
    },
    [eventId, sessionKey, stakeId],
    null,
  );

  async function handleCancelRegistration() {
    if (!session || !eventId || !stakeId) {
      return;
    }

    const confirmed = window.confirm("Vuoi annullare questa iscrizione?");

    if (!confirmed) {
      return;
    }

    setBusy("cancel");
    setFeedback(null);
    setActionError(null);

    try {
      const cancelledRegistration = await registrationsService.cancelRegistration(
        stakeId,
        eventId,
        getRegistrationLookupFromSession(session),
      );

      if (!cancelledRegistration) {
        throw new Error("Impossibile rileggere la registrazione dopo l'annullamento.");
      }

      setData((current) =>
        current
          ? {
              ...current,
              registration: cancelledRegistration,
            }
          : current,
      );
      setFeedback("Iscrizione annullata correttamente.");
    } catch (caughtError) {
      setActionError(
        caughtError instanceof Error
          ? caughtError.message
          : "Impossibile annullare l'iscrizione.",
      );
    } finally {
      setBusy(null);
    }
  }

  if (!loading && !data) {
    return (
      <div className="page">
        <EmptyState
          title="Registrazione non trovata"
          description="Non esiste una registrazione collegata al tuo account per questa attività."
          action={
            <Link className="button button--primary" to="/me/activities">
              Torna alle attività
            </Link>
          }
        />
      </div>
    );
  }

  const answerEntries =
    data ? getRegistrationAnswerEntries(data.formConfig, data.registration) : [];
  const isCancelled = data?.registration.registrationStatus === "cancelled";
  const showParentConsentCard =
    Boolean(
      data &&
        session?.isAuthenticated &&
        !session.isAnonymous &&
        data.formConfig.enabledStandardFields.includes("parentConfirmed") &&
        isMinorBirthDate(data.registration.birthDate),
    );

  return (
    <div className="page">
      <PageHero
        eyebrow="Dettaglio iscrizione"
        title={data?.event.title ?? "Caricamento iscrizione..."}
        description="Qui ritrovi i dati inviati, lo stato dell'iscrizione e le informazioni da conservare."
        actions={
          data ? (
            <>
              {!isCancelled ? (
                <Link className="button button--primary" to={`/me/activities/${data.event.id}/edit`}>
                  Modifica iscrizione
                </Link>
              ) : null}
              {!isCancelled ? (
                <button
                  className="button button--ghost"
                  disabled={busy !== null}
                  onClick={() => void handleCancelRegistration()}
                  type="button"
                >
                  {busy === "cancel" ? "Annullamento..." : "Annulla iscrizione"}
                </button>
              ) : null}
              <Link className="button button--ghost" to="/me/activities">
                Torna alle attività
              </Link>
            </>
          ) : null
        }
      />

      {error ? (
        <div className="notice notice--warning">
          <div>
            <h3>Caricamento non riuscito</h3>
            <p>{error}</p>
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

      {feedback ? (
        <div className="notice notice--info">
          <div>
            <h3>Aggiornamento completato</h3>
            <p>{feedback}</p>
          </div>
        </div>
      ) : null}

      {data ? (
        <>
          <SectionCard title="Riepilogo evento" description="Contesto dell'attività a cui sei iscritto.">
            <dl className="summary-list">
              <div>
                <dt>Date</dt>
                <dd>{formatDateRange(data.event.startDate, data.event.endDate)}</dd>
              </div>
              <div>
                <dt>Luogo</dt>
                <dd>{data.event.location}</dd>
              </div>
              <div>
                <dt>Destinatari</dt>
                <dd>{getEventAudienceLabel(data.event.audience)}</dd>
              </div>
              <div>
                <dt>Stato iscrizione</dt>
                <dd>
                  <StatusBadge
                    label={getRegistrationStatusLabel(data.registration.registrationStatus)}
                    tone={getRegistrationStatusTone(data.registration.registrationStatus)}
                  />
                </dd>
              </div>
              <div>
                <dt>Ultimo aggiornamento</dt>
                <dd>{formatDateTime(data.registration.updatedAt)}</dd>
              </div>
              {data.registration.recoveryCode || data.registration.accessCode ? (
                <div>
                  <dt>Codice iscrizione</dt>
                  <dd>{data.registration.recoveryCode || data.registration.accessCode}</dd>
                </div>
              ) : null}
            </dl>
          </SectionCard>

          <SectionCard
            title="Dati inviati"
            description="Valori principali e risposte raccolte dal modulo."
          >
            <dl className="summary-list">
              <div>
                <dt>Nome completo</dt>
                <dd>{data.registration.fullName}</dd>
              </div>
              <div>
                <dt>Email</dt>
                <dd>{data.registration.email}</dd>
              </div>
              <div>
                <dt>Telefono</dt>
                <dd>{data.registration.phone || "-"}</dd>
              </div>
            </dl>

            {answerEntries.length > 0 ? (
              <ul className="plain-list">
                {answerEntries.map((entry) => (
                  <li key={entry.key}>
                    <strong>{entry.label}</strong>
                    <span>{entry.value}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="subtle-text">Nessuna risposta aggiuntiva oltre ai dati base.</p>
            )}
          </SectionCard>

          {(data.event.requiresParentalConsent || data.event.requiresPhotoRelease) && session ? (
            <SectionCard
              title="Autorizzazioni e firma"
              description="Completa o aggiorna i consensi richiesti per questa attivita. Tutto e visibile solo agli admin."
            >
              <ConsentSection
                event={data.event}
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
                stakeId={stakeId}
              />
            </SectionCard>
          ) : null}

          {showParentConsentCard && session ? (
            <ParentConsentUploadCard
              eventId={data.event.id}
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
              stakeId={stakeId}
            />
          ) : null}

          {data.event.questionsEnabled ? (
            <QuestionsSection
              eventId={data.event.id}
              registration={data.registration}
              session={session}
              stakeId={stakeId}
            />
          ) : null}
        </>
      ) : null}
    </div>
  );
}
