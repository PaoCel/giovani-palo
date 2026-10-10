import { Link, Navigate, useSearchParams } from "react-router-dom";

import "@/styles/recordNight.css";

import { RecordNightLoading, RecordNightState } from "@/components/recordNight/RecordNightStates";
import { useRecordNightSkin } from "@/components/recordNight/hooks";
import { useAsyncData } from "@/hooks/useAsyncData";
import { useAuth } from "@/hooks/useAuth";
import { eventsService } from "@/services/firestore/eventsService";
import type { Event } from "@/types";
import { getRecordNightPath } from "@/utils/activityLinks";
import { resolvePublicStakeId } from "@/utils/stakeSelection";

function timeOf(value: string | null | undefined) {
  if (!value) return Number.NaN;
  return new Date(value).getTime();
}

// La Notte dei Record da aprire: attività pubblica del palo con il modulo
// attivo e non ancora finita (fine nel futuro; senza fine vale l'inizio). Se
// sono più d'una, quella che comincia prima.
export function pickRecordNightEvent(events: ReadonlyArray<Event>, now = Date.now()) {
  return (
    events
      .filter((event) => event.recordsEnabled === true)
      .filter((event) => {
        const end = timeOf(event.endDate);
        const reference = Number.isFinite(end) ? end : timeOf(event.startDate);
        return Number.isFinite(reference) && reference > now;
      })
      .sort((left, right) => timeOf(left.startDate) - timeOf(right.startDate))[0] ?? null
  );
}

// Indirizzo corto `/record` da condividere su WhatsApp: porta alla Notte dei
// Record in programma. Legge le attività pubbliche del palo con la stessa query
// di /activities, quindi funziona anche senza login.
export function RecordNightShortcutPage() {
  useRecordNightSkin();
  const [searchParams] = useSearchParams();
  const { session, loading: authLoading } = useAuth();
  const requestedStakeId = searchParams.get("stake") ?? "";
  const profileStakeId = session?.profile.stakeId ?? "";

  const { data, loading, error, reload } = useAsyncData(
    async () => {
      if (authLoading) return null;
      const stakeId = await resolvePublicStakeId(requestedStakeId || profileStakeId || undefined);
      const events = await eventsService.listPublicEvents(stakeId);
      return { stakeId, event: pickRecordNightEvent(events) };
    },
    [requestedStakeId, profileStakeId, authLoading],
    null,
  );

  if (data?.event) {
    return <Navigate replace to={getRecordNightPath(data.event.id, data.stakeId)} />;
  }

  if (authLoading || loading || (!data && !error)) {
    return (
      <div className="rn">
        <RecordNightLoading label="Cerco la Notte dei Record..." />
      </div>
    );
  }

  return (
    <div className="rn">
      {error ? (
        <RecordNightState
          action={
            <button className="rn-btn rn-btn--led" onClick={reload} type="button">
              Riprova
            </button>
          }
          text="Non riesco a caricare la pagina. Controlla la connessione e riprova."
          title="Caricamento non riuscito"
        />
      ) : (
        <RecordNightState
          action={
            <Link className="rn-btn rn-btn--led" to="/activities">
              Vai alle attività
            </Link>
          }
          text="Nessuna Notte dei Record in programma."
          title="Niente record, per ora"
        />
      )}
    </div>
  );
}
