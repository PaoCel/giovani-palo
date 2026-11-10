import { useEffect } from "react";
import { Link, Outlet, useLocation } from "react-router-dom";

import { PublicStakeProvider, usePublicStake } from "@/components/publicSite/PublicStakeProvider";
import { ACCEDI } from "@/copy/accedi";
import { CATALOGO } from "@/copy/catalogo";
import { HOME } from "@/copy/home";
import { useAuth } from "@/hooks/useAuth";
import { getActivitiesPath, getLoginPath } from "@/utils/activityLinks";
import { getAccountHomePath } from "@/utils/family";
import "@/styles/publicSite.css";

function accountPath(session: NonNullable<ReturnType<typeof useAuth>["session"]>) {
  if (session.profile.mustChangePassword) {
    return "/password-reset";
  }

  return getAccountHomePath(session.profile.role);
}

function PublicSiteFrame() {
  const { session } = useAuth();
  const location = useLocation();
  const { stakes, stakeId, selectStake } = usePublicStake();
  const signedIn = Boolean(session?.isAuthenticated && !session.isAnonymous);
  const isLogin = location.pathname === "/login";
  const isActivities = location.pathname === "/activities";
  const showDock = !isLogin && !signedIn;
  const activitiesPath = getActivitiesPath(stakeId || undefined);
  const loginPath = getLoginPath(`${location.pathname}${location.search}`);
  const accountHref = signedIn && session ? accountPath(session) : "/login";
  const title = isLogin
    ? "Accedi · Attività GU GD"
    : isActivities
      ? "Attività · Attività GU GD"
      : "Attività GU GD · Attività dei giovani";

  useEffect(() => {
    const meta = document.querySelector('meta[name="theme-color"]');
    const previousColor = meta?.getAttribute("content");
    meta?.setAttribute("content", "#005581");

    return () => {
      if (previousColor) {
        meta?.setAttribute("content", previousColor);
      }
    };
  }, []);

  useEffect(() => {
    const previousTitle = document.title;
    document.title = title;

    return () => {
      document.title = previousTitle;
    };
  }, [title]);

  return (
    <div className={showDock ? "pub26 has-dock" : isLogin ? "pub26 page-accedi" : "pub26"}>
      <header className="top">
        <div className="wrap">
          <Link className="wordmark" to="/">
            <span>{HOME.wordmark}</span> <b>{HOME.wordmarkMark}</b>
          </Link>
          <div className="palo-pick">
            <label htmlFor="palo-top">{HOME.palo}</label>
            <select
              aria-label={HOME.paloTuo}
              className="select"
              id="palo-top"
              value={stakeId}
              onChange={(event) => selectStake(event.target.value)}
            >
              <option value="">{HOME.tuttaItalia}</option>
              {stakeId && !stakes.some((stake) => stake.id === stakeId) ? (
                <option value={stakeId}>{CATALOGO.caricamento}</option>
              ) : null}
              {stakes.map((stake) => (
                <option key={stake.id} value={stake.id}>
                  {stake.name}
                </option>
              ))}
            </select>
          </div>
          <nav aria-label={HOME.principale} className="top-links">
            <Link aria-current={isActivities ? "page" : undefined} to={activitiesPath}>
              {CATALOGO.titolo}
            </Link>
            <Link className="btn btn-primary btn-small" to={accountHref}>
              {signedIn ? HOME.tuaPagina : HOME.accedi}
            </Link>
          </nav>
        </div>
      </header>

      <div className="pub26__body">
        <Outlet />
      </div>

      <footer className="foot">
        <div className="wrap">
          <p className="disc">
            <b>{HOME.disclaimerForte}</b> {HOME.disclaimerResto}
          </p>
          <nav aria-label={HOME.linkUtili}>
            <Link to={activitiesPath}>{CATALOGO.titolo}</Link>
            <Link to="/login">{ACCEDI.schede}</Link>
            <Link to="/privacy">{HOME.privacy}</Link>
            <Link to="/privacy/photos">{HOME.privacyFoto}</Link>
          </nav>
          <p>{HOME.logoCredit}</p>
        </div>
      </footer>

      {showDock ? (
        <div className="dock">
          {isActivities ? (
            <Link className="btn btn-primary" to={loginPath}>
              {ACCEDI.accediInFretta}
            </Link>
          ) : (
            <>
              <Link className="btn btn-ghost" to={activitiesPath}>
                {CATALOGO.titolo}
              </Link>
              <Link className="btn btn-primary" to="/login">
                {HOME.accedi}
              </Link>
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}

export function PublicSiteLayout() {
  return (
    <PublicStakeProvider>
      <PublicSiteFrame />
    </PublicStakeProvider>
  );
}
