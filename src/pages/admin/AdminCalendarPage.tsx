import { useState } from "react";
import { useNavigate } from "react-router-dom";

import { PlannerCalendar } from "@/components/PlannerCalendar";
import { QuickActivitySheet } from "@/components/activityWizard/QuickActivitySheet";
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

// First day of the month, or today in the current month (AAAA-MM-GG).
function getMonthQuickDate(year: number, monthIndex: number, now = new Date()) {
  const current = now.getFullYear() === year && now.getMonth() === monthIndex;
  const day = current ? now.getDate() : 1;
  return `${year}-${String(monthIndex + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function AdminCalendarPage() {
  const { session } = useAuth();
  const navigate = useNavigate();
  const stakeId = session?.profile.stakeId ?? DEFAULT_STAKE_ID;
  const [refreshKey, setRefreshKey] = useState(0);
  // null = closed; "" = no day prefilled; AAAA-MM-GG from «Aggiungi in <mese>».
  const [quickDate, setQuickDate] = useState<string | null>(null);
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
        adminMarks
        onAddInMonth={data.organization ? (year, monthIndex) => setQuickDate(getMonthQuickDate(year, monthIndex)) : undefined}
        organizationName={data.organization?.stakeName ?? "Attività GU e GD"}
        toolbarAction={
          <Button disabled={!data.organization} icon="plus" onClick={() => setQuickDate("")}>
            {COPY.nuovaAttivita}
          </Button>
        }
      />}

      {quickDate !== null && data.organization && session ? (
        <QuickActivitySheet
          initialDate={quickDate}
          organization={data.organization}
          sessionUid={session.firebaseUser.uid}
          stakeId={stakeId}
          onClose={(changed) => {
            setQuickDate(null);
            if (changed) setRefreshKey((current) => current + 1);
          }}
        />
      ) : null}

    </div>
  );
}
