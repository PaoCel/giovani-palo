import { Link, useParams, useSearchParams } from "react-router-dom";

import "@/styles/activityGallery.css";

import { AppIcon } from "@/components/AppIcon";
import { ActivityGallery } from "@/components/gallery/ActivityGallery";
import { DEFAULT_STAKE_ID } from "@/config/app";
import { useAsyncData } from "@/hooks/useAsyncData";
import { useAuth } from "@/hooks/useAuth";
import { eventsService } from "@/services/firestore/eventsService";
import type { Event } from "@/types";

function useActivityHref(eventId: string) {
  const { session } = useAuth();
  if (session?.isAdmin) return `/admin/events/${eventId}`;
  if (session?.isUnitLeader) return `/unit/activities/${eventId}`;
  if (session?.isParent) return `/activities/${eventId}`;
  return `/me/activities/${eventId}`;
}

/** Galleria foto e video di un'attività, per tutti i ruoli con un account nel palo. */
export function ActivityMediaPage() {
  const { eventId = "" } = useParams<{ eventId: string }>();
  const [searchParams] = useSearchParams();
  const { session } = useAuth();
  const stakeId = session?.profile.stakeId || DEFAULT_STAKE_ID;
  const backHref = useActivityHref(eventId);

  const { data: event } = useAsyncData<Event | null>(
    () => (eventId ? eventsService.getEventById(stakeId, eventId) : Promise.resolve(null)),
    [stakeId, eventId],
    null,
  );

  return (
    <div className="page ag-page">
      <header className="ag-page__head">
        <Link className="ag-page__back" to={backHref} aria-label="Torna all'attività">
          <AppIcon name="arrow-left" />
        </Link>
        <div>
          <h1>Foto e video</h1>
          <p>{event?.title ?? " "}</p>
        </div>
      </header>
      <ActivityGallery
        stakeId={stakeId}
        event={event ?? (eventId ? { id: eventId, startDate: "", endDate: "" } : null)}
        initialView={searchParams.get("vista") === "nascosti" ? "hidden" : undefined}
      />
    </div>
  );
}
