import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";

import { EmptyState } from "@/components/EmptyState";
import { PageHero } from "@/components/PageHero";
import { RegistrationEditor } from "@/components/RegistrationEditor";
import { SectionCard } from "@/components/SectionCard";
import { useAuth } from "@/hooks/useAuth";
import { useAsyncData } from "@/hooks/useAsyncData";
import { eventFormsService } from "@/services/firestore/eventFormsService";
import { organizationService } from "@/services/firestore/organizationService";
import { registrationsService } from "@/services/firestore/registrationsService";
import { userActivitiesService } from "@/services/firestore/userActivitiesService";
import type { RegistrationWriteInput } from "@/types";
import { getRegistrationLookupFromSession } from "@/utils/session";

export function MyActivityEditPage() {
  const { eventId } = useParams();
  const navigate = useNavigate();
  const { session } = useAuth();
  const stakeId = session?.profile.stakeId ?? "";
  const sessionKey = session ? `${session.firebaseUser.uid}:${session.isAnonymous}` : "none";
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const { data: organization, error: organizationError } = useAsyncData(
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

  async function handleSubmit(input: RegistrationWriteInput) {
    if (!data?.event || !session || !stakeId) {
      setActionError("Sessione o attività non disponibili.");
      return;
    }

    setBusy(true);
    setActionError(null);

    try {
      const updatedRegistration = await registrationsService.upsertRegistration(
        stakeId,
        data.event.id,
        getRegistrationLookupFromSession(session),
        input,
      );

      if (!updatedRegistration) {
        throw new Error("Registrazione aggiornata ma non riletta correttamente.");
      }

      setData((current) =>
        current
          ? {
              ...current,
              registration: updatedRegistration,
            }
          : current,
      );

      navigate(`/me/activities/${data.event.id}`, { replace: true });
    } catch (caughtError) {
      setActionError(
        caughtError instanceof Error
          ? caughtError.message
          : "Impossibile aggiornare la registrazione.",
      );
    } finally {
      setBusy(false);
    }
  }

  if (!loading && !data) {
    return (
      <div className="page">
        <EmptyState
          title="Registrazione non trovata"
          description="Non c'è una registrazione esistente collegata al tuo account per questa attività."
          action={
            <Link className="button button--primary" to="/me/activities">
              Torna alle attività
            </Link>
          }
        />
      </div>
    );
  }

  const isCancelled = data?.registration.registrationStatus === "cancelled";

  return (
    <div className="page">
      <PageHero
        eyebrow="Modifica iscrizione"
        title={data?.event.title ?? "Caricamento modulo..."}
        description="Aggiorna i tuoi dati e mantieni allineata l'iscrizione già presente."
        actions={
          data ? (
            <Link className="button button--ghost" to={`/me/activities/${data.event.id}`}>
              Torna al dettaglio
            </Link>
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
            <h3>Salvataggio non riuscito</h3>
            <p>{actionError}</p>
          </div>
        </div>
      ) : null}

      {organizationError ? (
        <div className="notice notice--warning">
          <div>
            <h3>Configurazione non disponibile</h3>
            <p>{organizationError}</p>
          </div>
        </div>
      ) : null}

      {data && isCancelled ? (
        <SectionCard
          title="Iscrizione annullata"
          description="Questa iscrizione è già stata annullata e non è più modificabile."
        >
          <Link className="button button--primary" to={`/me/activities/${data.event.id}`}>
            Torna al dettaglio
          </Link>
        </SectionCard>
      ) : null}

      {data && !isCancelled ? (
        <SectionCard
          title="Aggiorna i tuoi dati"
          description="Le modifiche vengono salvate sullo stesso documento di registrazione."
        >
          <RegistrationEditor
            busy={busy}
            event={data.event}
            formConfig={data.formConfig}
            initialRegistration={data.registration}
            minorConsentExampleImageUrl={organization?.minorConsentExampleImageUrl}
            session={session}
            unitOptions={organization?.units ?? []}
            submitLabel="Salva modifiche"
            onSubmit={handleSubmit}
          />
        </SectionCard>
      ) : null}
    </div>
  );
}
