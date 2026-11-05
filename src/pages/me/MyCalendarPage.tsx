import { useMemo } from "react";
import { useNavigate } from "react-router-dom";

import { PlannerCalendar } from "@/components/PlannerCalendar";
import { Notice } from "@/components/ui";
import { ADMIN_ELENCHI as COPY } from "@/copy/adminElenchi";
import { useAuth } from "@/hooks/useAuth";
import { useAsyncData } from "@/hooks/useAsyncData";
import { userActivitiesService } from "@/services/firestore/userActivitiesService";

export function MyCalendarPage() {
  const { session } = useAuth();
  const navigate = useNavigate();
  const sessionKey = session ? `${session.firebaseUser.uid}:${session.isAnonymous}` : "none";
  const { data: feed, loading, error } = useAsyncData(
    () => userActivitiesService.listStakeActivityFeed(session),
    [sessionKey],
    [],
  );
  const events = useMemo(
    () =>
      feed
        .map((item) => item.event)
        .sort((left, right) => left.startDate.localeCompare(right.startDate)),
    [feed],
  );
  const organizationName = session?.profile.stakeName ?? "Attività GU e GD";

  return (
    <div className="page page--calendar">
      {error ? (
        <Notice title={COPY.calendarioErrore} tone="warning">
          <p>{error}</p>
        </Notice>
      ) : null}

      {/* In errore i mesi direbbero «Spazio libero»: resta solo l'avviso. */}
      {error ? null : <PlannerCalendar
        events={events}
        loading={loading}
        onEventSelect={(event) => navigate(`/activities/${event.id}`)}
        organizationName={organizationName}
      />}
    </div>
  );
}
