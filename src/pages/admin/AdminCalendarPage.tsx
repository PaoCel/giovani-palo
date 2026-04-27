import { useState } from "react";
import { useNavigate } from "react-router-dom";

import { AdminEventEditorModal } from "@/components/AdminEventEditorModal";
import { AppIcon } from "@/components/AppIcon";
import { PlannerCalendar } from "@/components/PlannerCalendar";
import { useAsyncData } from "@/hooks/useAsyncData";
import { useAuth } from "@/hooks/useAuth";
import { adminEventsService } from "@/services/firestore/adminEventsService";
import { organizationService } from "@/services/firestore/organizationService";
import type { OrganizationProfile } from "@/types";

interface CalendarData {
  organization: OrganizationProfile | null;
  events: Awaited<ReturnType<typeof adminEventsService.listAdminEvents>>;
}

const initialData: CalendarData = {
  organization: null,
  events: [],
};

export function AdminCalendarPage() {
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

  return (
    <div className="page page--planner">
      {error ? (
        <div className="notice notice--warning">
          <div>
            <h3>Calendario non disponibile</h3>
            <p>{error}</p>
          </div>
        </div>
      ) : null}

      <PlannerCalendar
        events={data.events}
        loading={loading}
        onEventSelect={(event) => navigate(`/admin/events/${event.id}`)}
        organizationName={data.organization?.stakeName ?? "Attività GU e GD"}
        toolbarAction={
          <button
            aria-label="Crea nuova attività"
            className="icon-button icon-button--primary planner-toolbar__create"
            onClick={() => setCreateModalOpen(true)}
            type="button"
          >
            <AppIcon name="plus" />
          </button>
        }
      />

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

    </div>
  );
}
