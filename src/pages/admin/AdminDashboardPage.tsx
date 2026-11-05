import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

import { AdminActivityCard } from "@/components/AdminActivityCard";
import { AdminEventEditorModal } from "@/components/AdminEventEditorModal";
import { AdminListSkeleton } from "@/components/AdminListSkeleton";
import { ActivityMediaHighlight } from "@/components/gallery/ActivityMediaHighlight";
import { HomeFeed } from "@/components/feed/HomeFeed";
import { MembershipQueueCards } from "@/components/membership/MembershipQueueCards";
import { Button, ButtonLink, EmptyState, Icon, Notice, PageHeader } from "@/components/ui";
import { ADMIN_ELENCHI as COPY } from "@/copy/adminElenchi";
import { useAsyncData } from "@/hooks/useAsyncData";
import { useAuth } from "@/hooks/useAuth";
import { adminEventsService } from "@/services/firestore/adminEventsService";
import { organizationService } from "@/services/firestore/organizationService";
import { registrationsService } from "@/services/firestore/registrationsService";
import type { OrganizationProfile } from "@/types";
import { getEffectiveEventStatus } from "@/utils/events";
import { DEFAULT_STAKE_ID } from "@/config/app";
import giovaniUrl from "@/assets/flusso-genitore/giovani.webp";
import "@/styles/adminPages.css";

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
  const stakeId = session?.profile.stakeId ?? DEFAULT_STAKE_ID;
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
    { label: COPY.attivitaCreate, value: data.events.length, icon: "list" as const },
    { label: COPY.iscrizioniAperte, value: openEvents.length, icon: "ticket" as const },
    { label: COPY.partecipantiTotali, value: data.totalParticipants, icon: "users" as const },
  ];

  let openList;
  if (loading) {
    openList = <AdminListSkeleton label={COPY.apertiCaricamento} />;
  } else if (error) {
    // Il Notice sopra dice cosa è successo: niente «Nessuna attività» né zeri.
    openList = null;
  } else if (openEvents.length === 0) {
    openList = (
      <EmptyState
        action={
          data.events.length === 0 ? (
            <Button disabled={!data.organization} icon="plus" onClick={() => setCreateModalOpen(true)}>
              {COPY.nuovaAttivita}
            </Button>
          ) : (
            <ButtonLink to="/admin/events" variant="secondary">
              {COPY.vediTutteLeAttivita}
            </ButtonLink>
          )
        }
        description={COPY.apertiVuotoCorpo}
        headingAs="h3"
        illustration={giovaniUrl}
        title={COPY.apertiVuotoTitolo}
      />
    );
  } else {
    openList = (
      <div className="admin-card-grid">
        {openEvents.map((event) => (
          <AdminActivityCard
            key={event.id}
            event={event}
            registrationsCount={data.registrationsCountByEvent[event.id]}
            to={`/admin/events/${event.id}`}
          />
        ))}
      </div>
    );
  }

  return (
    <div className="page page--admin-dashboard">
      <PageHeader
        actions={
          <Button disabled={!data.organization} icon="plus" onClick={() => setCreateModalOpen(true)}>
            {COPY.nuovaAttivita}
          </Button>
        }
        description={COPY.homeDescrizione}
        title={data.organization?.stakeName || COPY.homeTitoloDiRiserva}
      />

      <MembershipQueueCards peoplePath="/admin/persone" stakeId={stakeId} unitId={null} />

      {error ? (
        <Notice title={COPY.homeErrore} tone="warning">
          <p>{error}</p>
        </Notice>
      ) : null}

      <section aria-label={COPY.totali}>
        <ul className="admin-stats">
          {stats.map((item) => (
            <li key={item.label} className="admin-stat">
              <span className="admin-stat__icon" aria-hidden="true">
                <Icon name={item.icon} />
              </span>
              <span className="admin-stat__label">{item.label}</span>
              <strong className="admin-stat__value">{loading || error ? "…" : item.value}</strong>
            </li>
          ))}
        </ul>
      </section>

      <section className="admin-block">
        <div className="admin-block__head">
          <h2>{COPY.apertiTitolo}</h2>
        </div>
        {openList}
      </section>

      <ActivityMediaHighlight />

      <section className="admin-block">
        <div className="admin-block__head">
          <h2>{COPY.feedTitolo}</h2>
          <p>{COPY.feedDescrizione}</p>
        </div>
        <HomeFeed />
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
    </div>
  );
}
