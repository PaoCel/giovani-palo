import { Link } from "react-router-dom";

import { useAuth } from "@/hooks/useAuth";
import { useAsyncData } from "@/hooks/useAsyncData";
import { resolveLatestCampWithGallery, type CampHighlight } from "@/utils/campHighlight";
import { formatEventWindow } from "@/utils/formatters";

const DEFAULT_STAKE_ID = "roma-est";

/**
 * Card home condivisa da tutti i ruoli: annuncia l'ultimo campeggio concluso
 * con foto disponibili e porta alla galleria + sondaggio del campeggio.
 * Non mostra nulla finche' non c'e' un campeggio con almeno un media.
 */
export function CampHighlightCard() {
  const { session } = useAuth();
  const stakeId = session?.profile.stakeId || DEFAULT_STAKE_ID;
  const sessionKey = session ? `${session.firebaseUser.uid}:${stakeId}` : "none";

  const { data: highlight } = useAsyncData<CampHighlight | null>(
    () => resolveLatestCampWithGallery(stakeId),
    [sessionKey],
    null,
  );

  if (!highlight) return null;

  const { event, gallery } = highlight;
  const cover = gallery.coverImageUrl || event.coverImageUrl || event.heroImageUrl || "";
  const mediaLabel =
    gallery.mediaCount === 1 ? "1 contenuto" : `${gallery.mediaCount} contenuti`;

  return (
    <section className="user-dashboard-section user-dashboard-section--priority">
      <div className="user-section-heading">
        <h2>Campeggio</h2>
        <p className="subtle-text">Le foto e i video del campeggio sono disponibili.</p>
      </div>

      <article className="camp-highlight-card">
        <Link
          to={`/campeggio/${event.id}`}
          className="camp-highlight-card__media"
          aria-label={`Apri la galleria di ${event.title}`}
        >
          {cover ? (
            <div
              className="camp-highlight-card__poster"
              style={{ backgroundImage: `url(${cover})` }}
            />
          ) : (
            <div className="camp-highlight-card__poster camp-highlight-card__poster--fallback">
              📸
            </div>
          )}
        </Link>

        <div className="camp-highlight-card__body">
          <span className="surface-chip">Foto & video · {mediaLabel}</span>
          <h3>{event.title}</h3>
          <p className="subtle-text">{formatEventWindow(event)}</p>
          <div className="chip-row">
            <Link className="button button--primary button--small" to={`/campeggio/${event.id}`}>
              Guarda le foto
            </Link>
            <Link
              className="button button--soft button--small"
              to={`/campeggio/${event.id}?tab=sondaggio`}
            >
              Sondaggio
            </Link>
          </div>
        </div>
      </article>
    </section>
  );
}
