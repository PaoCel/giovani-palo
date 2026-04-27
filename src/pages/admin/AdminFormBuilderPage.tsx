import { useState } from "react";
import { Link, useParams } from "react-router-dom";

import { EmptyState } from "@/components/EmptyState";
import { EventFormConfigEditor } from "@/components/EventFormConfigEditor";
import { PageHero } from "@/components/PageHero";
import { SectionCard } from "@/components/SectionCard";
import { useAsyncData } from "@/hooks/useAsyncData";
import { useAuth } from "@/hooks/useAuth";
import { eventFormsService } from "@/services/firestore/eventFormsService";
import { eventsService } from "@/services/firestore/eventsService";
import type { EventAudience, EventFormConfig } from "@/types";

interface FormBuilderData {
  eventTitle: string;
  allowRoomFields: boolean;
  eventAudience: EventAudience;
  formConfig: EventFormConfig | null;
}

const initialData: FormBuilderData = {
  eventTitle: "",
  allowRoomFields: true,
  eventAudience: "congiunta",
  formConfig: null,
};

export function AdminFormBuilderPage() {
  const { eventId } = useParams();
  const { session } = useAuth();
  const stakeId = session?.profile.stakeId ?? "roma-est";
  const [refreshKey, setRefreshKey] = useState(0);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const { data, loading, error } = useAsyncData(
    async () => {
      if (!eventId) {
        return initialData;
      }

      const [event, formConfig] = await Promise.all([
        eventsService.getEventById(stakeId, eventId),
        eventFormsService.getFormConfig(stakeId, eventId),
      ]);

      return {
        eventTitle: event?.title ?? "",
        allowRoomFields: event?.overnight ?? false,
        eventAudience: event?.audience ?? "congiunta",
        formConfig,
      };
    },
    [eventId, refreshKey, stakeId],
    initialData,
  );

  async function handleSave(config: EventFormConfig) {
    if (!eventId) {
      return;
    }

    setBusy(true);
    setActionError(null);
    setFeedback(null);

    try {
      await eventFormsService.saveFormConfig(stakeId, eventId, config);
      setFeedback("Configurazione modulo salvata correttamente.");
      setRefreshKey((current) => current + 1);
    } catch (caughtError) {
      setActionError(
        caughtError instanceof Error
          ? caughtError.message
          : "Impossibile salvare la configurazione del form.",
      );
    } finally {
      setBusy(false);
    }
  }

  if (!eventId) {
    return (
      <div className="page">
        <EmptyState
          title="Evento non specificato"
          description="Manca l'identificativo del form da configurare."
          action={
            <Link className="button button--primary" to="/admin/events">
              Torna agli eventi
            </Link>
          }
        />
      </div>
    );
  }

  return (
    <div className="page">
      <PageHero
        eyebrow="Configurazione modulo"
        title={data.eventTitle || "Configurazione form evento"}
        description="Scegli quali dati raccogliere durante l'iscrizione e quali campi personalizzati mostrare."
        actions={
          <Link className="button button--ghost" to={`/admin/events/${eventId}`}>
            Torna al dettaglio evento
          </Link>
        }
      />

      {error ? (
        <div className="notice notice--warning">
          <div>
            <h3>Impossibile caricare la configurazione</h3>
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

      {feedback ? (
        <div className="notice notice--info">
          <div>
            <h3>Configurazione aggiornata</h3>
            <p>{feedback}</p>
          </div>
        </div>
      ) : null}

      <SectionCard
        title="Configurazione modulo"
        description="Definisci campi essenziali, preferenze e domande aggiuntive per questa attività."
      >
        {loading || !data.formConfig ? (
          <p className="subtle-text">Caricamento configurazione form...</p>
        ) : (
          <EventFormConfigEditor
            allowRoomFields={data.allowRoomFields}
            busy={busy}
            eventAudience={data.eventAudience}
            initialConfig={data.formConfig}
            onSave={handleSave}
          />
        )}
      </SectionCard>
    </div>
  );
}
