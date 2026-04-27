import type { Room } from "@/types";

export const roomsService = {
  async listRoomsByEvent(eventId: string): Promise<Room[]> {
    void eventId;
    return [];
  },
};
