import { eventsService } from "@/services/firestore/eventsService";
import { galleriesService } from "@/services/firestore/galleriesService";
import type { Event, Gallery } from "@/types";
import { isPastEvent } from "@/utils/events";

export interface CampHighlight {
  event: Event;
  gallery: Gallery;
}

/** Un evento e' un "campeggio" quando ha activityType camp. */
export function isCampEvent(event: Pick<Event, "activityType">) {
  return event.activityType === "camp";
}

// Quante gallerie al massimo controlliamo partendo dal campeggio piu' recente.
// Post-campo normalmente ce n'e' una sola; il limite evita raffiche di read.
const MAX_CAMPS_TO_PROBE = 4;

/**
 * Risolve l'ultimo campeggio concluso che ha gia' una galleria con almeno un
 * media. E' la sorgente per la card home condivisa da tutti i ruoli e per la
 * pagina campeggio. Ritorna null se non c'e' nessun campeggio con foto.
 */
export async function resolveLatestCampWithGallery(
  stakeId: string,
): Promise<CampHighlight | null> {
  if (!stakeId) return null;

  const events = await eventsService.listPublicEvents(stakeId);
  const camps = events
    .filter((event) => isCampEvent(event) && isPastEvent(event))
    // Piu' recente per data di fine, prima.
    .sort((left, right) => right.endDate.localeCompare(left.endDate))
    .slice(0, MAX_CAMPS_TO_PROBE);

  for (const event of camps) {
    const gallery = await galleriesService
      .getGalleryByActivity(stakeId, event.id)
      .catch(() => null);
    if (gallery && gallery.mediaCount > 0) {
      return { event, gallery };
    }
  }

  return null;
}
