import { eventsService } from "@/services/firestore/eventsService";
import { campManagementService } from "@/services/firestore/campManagementService";
import { registrationsService } from "@/services/firestore/registrationsService";
import { usersService } from "@/services/firestore/usersService";
import type { CampManagementPlan, Event, Registration, UserProfile } from "@/types";
import { isMinorBirthDate } from "@/utils/age";
import { isParentAuthorizationAuthorized } from "@/utils/parentAuthorization";

export interface UnitActivityStats {
  total: number;
  needsTransport: number;
  missingPhotoConsent: number;
  missingParentConsent: number;
}

export interface UnitActivitySummary {
  eventId: string;
  eventTitle: string;
  eventStartDate: string;
  eventStatus: string;
  registrations: Registration[];
  stats: UnitActivityStats;
}

function computeStats(registrations: Registration[], event?: Event | null): UnitActivityStats {
  let needsTransport = 0;
  let missingPhotoConsent = 0;
  let missingParentConsent = 0;
  const requiresParentAuthorization = Boolean(event?.requiresParentAuthorization);

  for (const r of registrations) {
    const transport = typeof r.answers.transportMode === "string" ? r.answers.transportMode : "";
    if (!transport || transport === "Da definire" || transport === "Passaggio") {
      needsTransport++;
    }
    if (r.answers.photoInternalConsent !== true) {
      missingPhotoConsent++;
    }
    const isMinor = isMinorBirthDate(r.birthDate);
    if (requiresParentAuthorization && isMinor && !isParentAuthorizationAuthorized(r)) {
      missingParentConsent++;
    }
  }

  return { total: registrations.length, needsTransport, missingPhotoConsent, missingParentConsent };
}

export const unitLeaderService = {
  // Le rules autorizzano i dirigenti di unità solo su query filtrate per la
  // propria unitId: niente più lettura dell'intero evento con filtro client.
  async listUnitRegistrationsForEvent(
    stakeId: string,
    activityId: string,
    unitId: string,
  ): Promise<Registration[]> {
    const unitRegistrations = await registrationsService.listUnitRegistrationsByEvent(
      stakeId,
      activityId,
      unitId,
    );
    return unitRegistrations.filter((r) => r.registrationStatus !== "cancelled");
  },

  async getUnitActivitySummaries(
    stakeId: string,
    unitId: string,
  ): Promise<UnitActivitySummary[]> {
    const events = await eventsService.listAllEvents(stakeId);
    const relevant = events
      .filter((e) => e.status !== "cancelled" && e.status !== "draft")
      .sort((a, b) => new Date(b.startDate).getTime() - new Date(a.startDate).getTime())
      .slice(0, 6);

    const summaries = await Promise.all(
      relevant.map(async (event) => {
        const registrations = await unitLeaderService.listUnitRegistrationsForEvent(
          stakeId,
          event.id,
          unitId,
        );
        return {
          eventId: event.id,
          eventTitle: event.title,
          eventStartDate: event.startDate,
          eventStatus: event.status,
          registrations,
          stats: computeStats(registrations, event),
        };
      }),
    );

    return summaries;
  },

  async getUnitActivityDetail(
    stakeId: string,
    activityId: string,
    unitId: string,
  ): Promise<{
    event: Awaited<ReturnType<typeof eventsService.getEventById>>;
    registrations: Registration[];
    unitYouth: UserProfile[];
    campManagement: CampManagementPlan;
    stats: UnitActivityStats;
  }> {
    const [event, registrations, unitYouth, campManagement] = await Promise.all([
      eventsService.getEventById(stakeId, activityId),
      unitLeaderService.listUnitRegistrationsForEvent(stakeId, activityId, unitId),
      usersService.listUnitYouth(stakeId, unitId),
      campManagementService.getCampManagement(stakeId, activityId),
    ]);

    return { event, registrations, unitYouth, campManagement, stats: computeStats(registrations, event) };
  },
};
