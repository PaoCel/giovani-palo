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
import { registrationsService } from "@/services/firestore/registrationsService";
import type { OrganizationProfile } from "@/types";
import { getEffectiveEventStatus } from "@/utils/events";

interface DashboardData {
  organization: OrganizationProfile | null;
  events: Awaited<ReturnType<typeof adminEventsService.listAdminEvents>>;
  registrationsCountByEvent: Record<string, number>;
  totalParticipants: number;
}

const initialData: DashboardData = {
  organization: null,
  events: [],
  registrationsCountByEvent: {},
  totalParticipants: 0,
};

export function AdminDashboardPage() {
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
      const registrationsPerEvent = await Promise.all(
        events.map(async (event) => ({
          eventId: event.id,
          registrations: await registrationsService.listRegistrationsByEvent(stakeId, event.id),
        })),
      );

      const registrationsCountByEvent = registrationsPerEvent.reduce<Record<string, number>>(
        (accumulator, item) => {
          accumulator[item.eventId] = item.registrations.filter(
            (registration) => registration.registrationStatus !== "cancelled",
          ).length;
          return accumulator;
        },
        {},
      );

      return {
        organization,
        events,
        registrationsCountByEvent,
        totalParticipants: Object.values(registrationsCountByEvent).reduce(
          (total, value) => total + value,
          0,
        ),
      };
    },
    [refreshKey, stakeId],
    initialData,
  );

  const openEvents = useMemo(
    () =>
      [...data.events]
        .filter((event) => getEffectiveEventStatus(event) === "registrations_open")
        .sort(
          (left, right) =>
            new Date(left.startDate).getTime() - new Date(right.startDate).getTime(),
        ),
    [data.events],
  );

  const stats = [
    { label: "Attività create", value: data.events.length },
    { label: "Attività attive", value: openEvents.length },
    { label: "Partecipanti totali", value: data.totalParticipants },
  ];

  return (
    <div className="page page--admin-dashboard">
      {error ? (
        <div className="notice notice--warning">
          <div>
            <h3>Dashboard non disponibile</h3>
            <p>{error}</p>
          </div>
        </div>
      ) : null}

      <section className="admin-metrics">
        {stats.map((item) => (
          <article key={item.label} className="admin-metric">
            <strong>{loading ? "..." : item.value}</strong>
            <span>{item.label}</span>
          </article>
        ))}
      </section>

      <section className="admin-section">
        <div className="admin-section__head">
          <div>
            <h2>Iscrizioni aperte adesso</h2>
          </div>
        </div>

        {loading ? (
          <p className="subtle-text">Sto preparando le attività aperte...</p>
        ) : openEvents.length === 0 ? (
          <EmptyState
            title="Nessuna attività aperta"
            description="Le attività con iscrizioni aperte compariranno qui in ordine temporale."
          />
        ) : (
          <div className="card-grid card-grid--three admin-activity-grid">
            {openEvents.map((event) => (
              <AdminActivityCard
                key={event.id}
                event={event}
                registrationsCount={data.registrationsCountByEvent[event.id]}
                to={`/admin/events/${event.id}`}
              />
            ))}
          </div>
        )}
      </section>

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
