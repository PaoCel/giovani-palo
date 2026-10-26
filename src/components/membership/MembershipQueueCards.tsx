import { Link } from "react-router-dom";

import { AppIcon } from "@/components/AppIcon";
import { PALO } from "@/copy/palo";
import { fillCopy } from "@/copy/parole";
import { useMemberQueueCount } from "@/hooks/useStakeMembership";

import "@/styles/membership.css";

interface MembershipQueueCardsProps {
  stakeId: string;
  /** Unità del dirigente; null per l'admin. */
  unitId: string | null;
  peoplePath: string;
}

/**
 * In dashboard, solo quando c'è qualcosa da fare: richieste di accesso in
 * attesa e, per il dirigente, membri della sua unità da confermare.
 */
export function MembershipQueueCards({ stakeId, unitId, peoplePath }: MembershipQueueCardsProps) {
  const isUnit = unitId !== null;
  const enabled = Boolean(stakeId) && (!isUnit || Boolean(unitId));
  const pending = useMemberQueueCount(stakeId, "pending", unitId, enabled);
  // L'admin vede i "da confermare" nella pagina Persone: in dashboard sarebbero
  // ~100 letture a ogni apertura.
  const review = useMemberQueueCount(stakeId, "review", unitId, enabled && isUnit);

  if (!pending && !review) return null;
  return (
    <div className="mship-dash">
      {pending ? (
        <Link className="mship-dash-card" to={peoplePath}>
          <span className="mship-count mship-count--hot">{pending}</span>
          <span className="mship-dash-card__text">
            <strong>{PALO.richiesteTitolo}</strong>
            <span>{pending === 1 ? PALO.richiesteUna : fillCopy(PALO.richiestePiu, { n: String(pending) })}</span>
          </span>
          <AppIcon aria-hidden="true" name="arrow-right" />
        </Link>
      ) : null}
      {review ? (
        <Link className="mship-dash-card" to={`${peoplePath}?scheda=da-confermare`}>
          <span className="mship-count">{review}</span>
          <span className="mship-dash-card__text">
            <strong>{PALO.daConfermareTitolo}</strong>
            <span>{review === 1 ? PALO.daConfermareUno : fillCopy(PALO.daConfermarePiu, { n: String(review) })}</span>
          </span>
          <AppIcon aria-hidden="true" name="arrow-right" />
        </Link>
      ) : null}
    </div>
  );
}
