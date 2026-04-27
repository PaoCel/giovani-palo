import { eventFormsService } from "@/services/firestore/eventFormsService";
import { eventsService } from "@/services/firestore/eventsService";
import { registrationsService } from "@/services/firestore/registrationsService";
import type { AdminEventWorkspace, Registration } from "@/types";

export const adminEventsService = {
  async listAdminEvents(stakeId: string) {
    return eventsService.listAllEvents(stakeId);
  },

  async getAdminEventWorkspace(
    stakeId: string,
    eventId: string,
  ): Promise<AdminEventWorkspace | null> {
    const event = await eventsService.getEventById(stakeId, eventId);

    if (!event) {
      return null;
    }

    const [formConfig, registrations] = await Promise.all([
      eventFormsService.getFormConfig(stakeId, eventId),
      registrationsService.listRegistrationsByEvent(stakeId, eventId),
    ]);

    return {
      event,
      formConfig,
      registrations,
    };
  },

  async listStakeRegistrations(stakeId: string): Promise<
    Array<{
      eventId: string;
      eventTitle: string;
      registration: Registration;
    }>
  > {
    const events = await eventsService.listAllEvents(stakeId);
    const registrationsPerEvent = await Promise.all(
      events.map(async (event) => ({
        event,
        registrations: await registrationsService.listRegistrationsByEvent(stakeId, event.id),
      })),
    );

    return registrationsPerEvent.flatMap(({ event, registrations }) =>
      registrations.map((registration) => ({
        eventId: event.id,
        eventTitle: event.title,
        registration,
      })),
    );
  },
};
