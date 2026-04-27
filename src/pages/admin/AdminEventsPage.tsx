import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

import { AdminActivityCard } from "@/components/AdminActivityCard";
import { AdminEventEditorModal } from "@/components/AdminEventEditorModal";
import { AppIcon } from "@/components/AppIcon";
import { EmptyState } from "@/components/EmptyState";
import { useAsyncData } from "@/hooks/useAsyncData";
import { useAuth } from "@/hooks/useAuth";
import { adminEventsService } from "@/services/firestore/adminEventsService";
import { organizationService } from "@/services/firestore/organizationService";
import type { OrganizationProfile } from "@/types";

interface EventsData {
  organization: OrganizationProfile | null;
  events: Awaited<ReturnType<typeof adminEventsService.listAdminEvents>>;
}

const initialData: EventsData = {
  organization: null,
  events: [],
};

export function AdminEventsPage() {
  const { session } = useAuth();
  const navigate = useNavigate();
  const stakeId = session?.profile.stakeId ?? "roma-est";
  const [refreshKey, setRefreshKey] = useState(0);
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const { data, loading, error } = useAsyncData(
    async () => {
      const [events, organization] = await Promise.all([
        adminEventsService.listAdminEvents(stakeId),
        organizationService.getProfile(stakeId),
      ]);

      return {
        organization,
        events,
      };
    },
    [refreshKey, stakeId],
    initialData,
  );

  const events = useMemo(
    () =>
      [...data.events].sort(
        (left, right) =>
          new Date(left.startDate).getTime() - new Date(right.startDate).getTime(),
      ),
    [data.events],
  );

  return (
    <div className="page">
      {error ? (
        <div className="notice notice--warning">
          <div>
            <h3>Attività non disponibili</h3>
            <p>{error}</p>
          </div>
        </div>
      ) : null}

      {loading ? (
        <p className="subtle-text">Sto preparando le attività...</p>
      ) : events.length === 0 ? (
        <EmptyState
          title="Nessuna attività ancora creata"
          description="Le nuove attività compariranno qui in una griglia compatta."
        />
      ) : (
        <div className="card-grid card-grid--three admin-activity-grid">
          {events.map((event) => (
            <AdminActivityCard key={event.id} event={event} to={`/admin/events/${event.id}`} />
          ))}
        </div>
      )}

      {createModalOpen && data.organization && session ? (
        <AdminEventEditorModal
          organization={data.organization}
          sessionUid={session.firebaseUser.uid}
          stakeId={stakeId}
          onClose={() => setCreateModalOpen(false)}
          onCompleted={(eventId) => {
            setRefreshKey((current) => current + 1);
            navigate(`/admin/events/${eventId}`);
          }}
        />
      ) : null}

      <button
        aria-label="Crea nuova attività"
        className="admin-fab"
        onClick={() => setCreateModalOpen(true)}
        type="button"
      >
        <AppIcon name="plus" />
      </button>
    </div>
  );
}
