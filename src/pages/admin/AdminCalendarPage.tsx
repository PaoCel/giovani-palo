import { useState } from "react";
import { useNavigate } from "react-router-dom";

import { AdminEventEditorModal } from "@/components/AdminEventEditorModal";
import { PlannerCalendar } from "@/components/PlannerCalendar";
import { Button, Notice } from "@/components/ui";
import { ADMIN_ELENCHI as COPY } from "@/copy/adminElenchi";
import { useAsyncData } from "@/hooks/useAsyncData";
import { useAuth } from "@/hooks/useAuth";
import { adminEventsService } from "@/services/firestore/adminEventsService";
import { organizationService } from "@/services/firestore/organizationService";
import type { OrganizationProfile } from "@/types";
import { DEFAULT_STAKE_ID } from "@/config/app";

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
  const stakeId = session?.profile.stakeId ?? DEFAULT_STAKE_ID;
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
    <div className="page page--calendar">
      {error ? (
        <Notice title={COPY.calendarioErrore} tone="warning">
          <p>{error}</p>
        </Notice>
      ) : null}

      {/* In errore i mesi direbbero «Spazio libero»: resta solo l'avviso. */}
      {error ? null : <PlannerCalendar
        events={data.events}
        loading={loading}
        onEventSelect={(event) => navigate(`/admin/events/${event.id}`)}
        organizationName={data.organization?.stakeName ?? "Attività GU e GD"}
        toolbarAction={
          <Button disabled={!data.organization} icon="plus" onClick={() => setCreateModalOpen(true)}>
            {COPY.nuovaAttivita}
          </Button>
        }
      />}

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
