import { eventsService } from "@/services/firestore/eventsService";
import { registrationsService } from "@/services/firestore/registrationsService";
import type { AuthSession, Event, Registration } from "@/types";
import { isEventAudienceEligible } from "@/utils/events";
import { getRegistrationLookupFromSession } from "@/utils/session";

export interface UserActivityItem {
  event: Event;
  registration: Registration | null;
}

export const userActivitiesService = {
  async listForSession(
    session: AuthSession | null,
    options?: { onlyRegistered?: boolean },
  ): Promise<UserActivityItem[]> {
    if (!session || session.isAnonymous || !session.profile.stakeId) {
      return [];
    }

    const events = await eventsService.listAllEvents(session.profile.stakeId);
    const lookup = getRegistrationLookupFromSession(session);
    const activityItems = await Promise.all(
      events.map(async (event) => ({
        event,
        registration: await registrationsService.getRegistrationByActor(
          session.profile.stakeId,
          event.id,
          lookup,
        ),
      })),
    );

    const filtered = options?.onlyRegistered
      ? activityItems.filter((item) => Boolean(item.registration))
      : activityItems.filter(
          (item) =>
            Boolean(item.registration) ||
            isEventAudienceEligible(item.event, session.profile.genderRoleCategory),
        );

    return filtered.sort((left, right) =>
      left.event.startDate.localeCompare(right.event.startDate),
    );
  },

  async getForSessionEvent(session: AuthSession | null, eventId: string) {
    if (!session || session.isAnonymous || !session.profile.stakeId) {
      return null;
    }

    const registration = await registrationsService.getRegistrationByActor(
      session.profile.stakeId,
      eventId,
      getRegistrationLookupFromSession(session),
    );

    if (!registration) {
      return null;
    }

    const event = await eventsService.getEventById(session.profile.stakeId, eventId);

    if (!event || event.stakeId !== session.profile.stakeId) {
      return null;
    }

    return {
      event,
      registration,
    };
  },

  async listStakeActivityFeed(session: AuthSession | null): Promise<UserActivityItem[]> {
    if (!session || session.isAnonymous || !session.profile.stakeId) {
      return [];
    }

    const events = await eventsService.listPublicEvents(session.profile.stakeId);
    const lookup = getRegistrationLookupFromSession(session);
    const items = await Promise.all(
      events.map(async (event) => ({
        event,
        registration: await registrationsService.getRegistrationByActor(
          session.profile.stakeId,
          event.id,
          lookup,
        ),
      })),
    );

    return items
      .filter(
        (item) =>
          Boolean(item.registration) ||
          isEventAudienceEligible(item.event, session.profile.genderRoleCategory),
      )
      .sort((left, right) => left.event.startDate.localeCompare(right.event.startDate));
  },
};
