import { Link } from "react-router-dom";

import { FAMIGLIA } from "@/copy/famiglia";
import { fillCopy } from "@/copy/parole";
import { useAsyncData } from "@/hooks/useAsyncData";
import { useAuth } from "@/hooks/useAuth";
import { childrenService } from "@/services/firestore/childrenService";
import { registrationsService } from "@/services/firestore/registrationsService";
import type { ChildProfile, Registration } from "@/types";
import { canManageFamily } from "@/utils/family";

interface FamilyHomeData {
  children: ChildProfile[];
  registrations: Registration[];
}

function describeChild(child: ChildProfile, registrations: Registration[]) {
  const active = registrations.filter(
    (registration) =>
      registration.childId === child.id && registration.registrationStatus !== "cancelled",
  );
  const toAuthorize = active.some(
    (registration) => registration.registrationStatus === "pending_parent_authorization",
  );
  const count =
    active.length === 0
      ? FAMIGLIA.homeNessuna
      : active.length === 1
        ? FAMIGLIA.homeUna
        : fillCopy(FAMIGLIA.homePiu, { n: String(active.length) });

  return toAuthorize ? `${count} · ${FAMIGLIA.homeDaAutorizzare}` : count;
}

// "I tuoi figli" nella home di un account adulto che non è da genitore
// (partecipante, dirigente, admin: G2, docs/FLUSSO_GENITORE.md fase 6). Per
// l'account da genitore la home è già Famiglia. Senza figli non compare.
// L'intestazione segue la pagina che la ospita: la home /me ha l'etichetta
// sopra il titolo, /unit le sezioni con il titolo e la riga sotto.
export function FamilyHomeSection({ variant = "me" }: { variant?: "me" | "unit" }) {
  const { session } = useAuth();
  const uid =
    session && !session.isParent && canManageFamily(session) ? session.firebaseUser.uid : "";
  const { data, error } = useAsyncData<FamilyHomeData | null>(
    async () => {
      if (!uid) {
        return null;
      }

      const [children, registrations] = await Promise.all([
        childrenService.listChildren(uid),
        registrationsService.listFamilyRegistrations(uid),
      ]);
      return { children, registrations };
    },
    [uid],
    null,
  );

  if (!uid || (!error && (!data || data.children.length === 0))) {
    return null;
  }

  return (
    <section className={variant === "unit" ? "admin-section family-home" : "dash-section family-home"}>
      {variant === "unit" ? (
        <div className="admin-section__head">
          <div>
            <h2>{FAMIGLIA.homeTitolo}</h2>
            <p className="subtle-text">{FAMIGLIA.homeSottotitolo}</p>
          </div>
        </div>
      ) : (
        <div className="dash-section__head">
          <span className="dash-section__eyebrow">{FAMIGLIA.homeEyebrow}</span>
          <h2 className="dash-section__title">{FAMIGLIA.homeTitolo}</h2>
          <p className="dash-section__sub">{FAMIGLIA.homeSottotitolo}</p>
        </div>
      )}
      <div className="dash-list">
        {error || !data ? (
          <article className="dash-list-row">
            <div className="dash-list-row__text">
              <strong>{FAMIGLIA.homeEyebrow}</strong>
              <span className="subtle-text">{FAMIGLIA.homeErrore}</span>
            </div>
            <Link className="button button--soft" to="/family">
              {FAMIGLIA.homeApri}
            </Link>
          </article>
        ) : (
          data.children.map((child) => (
            <article className="dash-list-row" key={child.id}>
              <div className="dash-list-row__text">
                <strong>{child.fullName || child.firstName}</strong>
                <span className="subtle-text">{describeChild(child, data.registrations)}</span>
              </div>
              <Link
                aria-label={`${FAMIGLIA.homeApri}: ${child.fullName || child.firstName}`}
                className="button button--soft"
                to="/family"
              >
                {FAMIGLIA.homeApri}
              </Link>
            </article>
          ))
        )}
      </div>
    </section>
  );
}
