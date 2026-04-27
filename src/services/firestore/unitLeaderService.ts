import { eventsService } from "@/services/firestore/eventsService";
import { registrationsService } from "@/services/firestore/registrationsService";
import { usersService } from "@/services/firestore/usersService";
import type { Registration, UserProfile } from "@/types";
import { isMinorBirthDate } from "@/utils/age";

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

function normalizeUnit(name: string) {
  return name.trim().toLowerCase();
}

function matchesUnit(r: { unitId: string; unitNameSnapshot: string }, unitId: string, unitName: string) {
  if (unitId && r.unitId === unitId) return true;
  if (unitName && normalizeUnit(r.unitNameSnapshot) === normalizeUnit(unitName)) return true;
  return false;
}

function computeStats(registrations: Registration[]): UnitActivityStats {
  let needsTransport = 0;
  let missingPhotoConsent = 0;
  let missingParentConsent = 0;

  for (const r of registrations) {
    const transport = typeof r.answers.transportMode === "string" ? r.answers.transportMode : "";
    if (!transport || transport === "Da definire" || transport === "Passaggio") {
      needsTransport++;
    }
    if (r.answers.photoInternalConsent !== true) {
      missingPhotoConsent++;
    }
    const isMinor = isMinorBirthDate(r.birthDate);
    if (isMinor && !r.parentConsentDocumentUrl && !r.answers.parentConfirmed) {
      missingParentConsent++;
    }
  }

  return { total: registrations.length, needsTransport, missingPhotoConsent, missingParentConsent };
}

export const unitLeaderService = {
  async listUnitRegistrationsForEvent(
    stakeId: string,
    activityId: string,
    unitId: string,
    unitName: string,
  ): Promise<Registration[]> {
    const all = await registrationsService.listRegistrationsByEvent(stakeId, activityId);
    return all.filter(
      (r) => matchesUnit(r, unitId, unitName) && r.registrationStatus !== "cancelled",
    );
  },

  async getUnitActivitySummaries(
    stakeId: string,
    unitId: string,
    unitName: string,
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
          unitName,
        );
        return {
          eventId: event.id,
          eventTitle: event.title,
          eventStartDate: event.startDate,
          eventStatus: event.status,
          registrations,
          stats: computeStats(registrations),
        };
      }),
    );

    return summaries;
  },

  async getUnitActivityDetail(
    stakeId: string,
    activityId: string,
    unitId: string,
    unitName: string,
  ): Promise<{
    event: Awaited<ReturnType<typeof eventsService.getEventById>>;
    registrations: Registration[];
    unitYouth: UserProfile[];
    stats: UnitActivityStats;
  }> {
    const [event, registrations, unitYouth] = await Promise.all([
      eventsService.getEventById(stakeId, activityId),
      unitLeaderService.listUnitRegistrationsForEvent(stakeId, activityId, unitId, unitName),
      usersService.listUnitYouth(stakeId, unitId, unitName),
    ]);

    return { event, registrations, unitYouth, stats: computeStats(registrations) };
  },
};
