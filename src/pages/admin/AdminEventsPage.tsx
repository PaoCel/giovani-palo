import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

import { AdminActivityCard } from "@/components/AdminActivityCard";
import { AdminEventEditorModal } from "@/components/AdminEventEditorModal";
import { AdminListSkeleton } from "@/components/AdminListSkeleton";
import { Button, EmptyState, Icon, Notice, PageHeader, Pill } from "@/components/ui";
import { ADMIN_ELENCHI as COPY } from "@/copy/adminElenchi";
import { useAsyncData } from "@/hooks/useAsyncData";
import { useAuth } from "@/hooks/useAuth";
import { adminEventsService } from "@/services/firestore/adminEventsService";
import { organizationService } from "@/services/firestore/organizationService";
import type { OrganizationProfile } from "@/types";
import { splitAdminEvents } from "@/utils/adminLists";
import { DEFAULT_STAKE_ID } from "@/config/app";
import giovaniUrl from "@/assets/flusso-genitore/giovani.webp";
import "@/styles/adminPages.css";

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

  const { upcoming, past } = useMemo(() => splitAdminEvents(data.events), [data.events]);

  const openCreate = () => setCreateModalOpen(true);

  let content;
  if (loading) {
    content = <AdminListSkeleton label={COPY.attivitaCaricamento} />;
  } else if (!error && data.events.length === 0) {
    content = (
      <EmptyState
        action={
          <Button disabled={!data.organization} icon="plus" onClick={openCreate}>
            {COPY.nuovaAttivita}
          </Button>
        }
        description={COPY.attivitaVuotoCorpo}
        illustration={giovaniUrl}
        title={COPY.attivitaVuotoTitolo}
      />
    );
  } else {
    content = (
      <>
        {upcoming.length > 0 ? (
          <section className="admin-block">
            <div className="admin-block__head admin-block__head--row">
              <h2>{COPY.prossime}</h2>
              <Pill tone="sand">{upcoming.length}</Pill>
            </div>
            <div className="admin-card-grid">
              {upcoming.map((event) => (
                <AdminActivityCard key={event.id} event={event} to={`/admin/events/${event.id}`} />
              ))}
            </div>
          </section>
        ) : null}
        {past.length > 0 ? (
          <section className="admin-block">
            <div className="admin-block__head admin-block__head--row">
              <h2>{COPY.concluse}</h2>
              <Pill>{past.length}</Pill>
            </div>
            <div className="admin-card-grid">
              {past.map((event) => (
                <AdminActivityCard key={event.id} event={event} past to={`/admin/events/${event.id}`} />
              ))}
            </div>
          </section>
        ) : null}
      </>
    );
  }

  return (
    <div className="page page--admin-events">
      <PageHeader
        actions={
          <Button disabled={!data.organization} icon="plus" onClick={openCreate}>
            {COPY.nuovaAttivita}
          </Button>
        }
        description={COPY.attivitaDescrizione}
        title={COPY.attivitaTitolo}
      />

      {error ? (
        <Notice title={COPY.attivitaErrore} tone="warning">
          <p>{error}</p>
        </Notice>
      ) : null}

      {content}

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

      {/* Su telefono la lista è lunga: il «+» resta a portata di pollice sopra
          la barra in basso. Da 1024 px c'è il tasto nella testata. */}
      {data.organization ? (
        <button aria-label={COPY.creaAttivita} className="admin-fab" onClick={openCreate} type="button">
          <Icon name="plus" />
        </button>
      ) : null}
    </div>
  );
}
