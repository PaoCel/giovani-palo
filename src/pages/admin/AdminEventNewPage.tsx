import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";

import { EventEditorForm } from "@/components/EventEditorForm";
import { PageHero } from "@/components/PageHero";
import { SectionCard } from "@/components/SectionCard";
import { useAuth } from "@/hooks/useAuth";
import { storageService } from "@/services/firebase/storageService";
import { eventsService } from "@/services/firestore/eventsService";
import type { EventWriteInput } from "@/types";

export function AdminEventNewPage() {
  const navigate = useNavigate();
  const { session } = useAuth();
  const stakeId = session?.profile.stakeId ?? "roma-est";
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleCreateEvent(input: EventWriteInput) {
    if (!session) {
      setError("Sessione admin non disponibile.");
      return;
    }

    setBusy(true);
    setError(null);

    try {
      const createdEvent = await eventsService.createEvent(stakeId, input, session.firebaseUser.uid);

      if (!createdEvent) {
        throw new Error("Attività creata ma non riletta correttamente.");
      }

      navigate(`/admin/events/${createdEvent.id}`, { replace: true });
    } catch (caughtError) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : "Impossibile creare l'evento.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function handleUploadImage(file: File) {
    if (!session) {
      throw new Error("Serve una sessione admin attiva per caricare immagini.");
    }

    return storageService.uploadEventImage({
        file,
        uploadedBy: session.firebaseUser.uid,
        stakeId,
      });
  }

  return (
    <div className="page">
      <PageHero
        eyebrow="Nuovo evento"
        title="Crea una nuova attività pronta per essere pubblicata."
        description="Inserisci informazioni essenziali, programma, locandina e finestra iscrizioni."
        actions={
          <Link className="button button--ghost" to="/admin/events">
            Torna alla lista eventi
          </Link>
        }
      />

      {error ? (
        <div className="notice notice--warning">
          <div>
            <h3>Creazione non riuscita</h3>
            <p>{error}</p>
          </div>
        </div>
      ) : null}

      <SectionCard
        title="Dati base evento"
        description="Compila i dettagli che serviranno sia agli organizzatori sia ai partecipanti."
      >
        <EventEditorForm
          busy={busy}
          onUploadImage={handleUploadImage}
          submitLabel="Crea evento"
          onSubmit={handleCreateEvent}
        />
      </SectionCard>
    </div>
  );
}
