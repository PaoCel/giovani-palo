import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, Outlet, useLocation, useNavigate } from "react-router-dom";

import { AppIcon, type AppIconName } from "@/components/AppIcon";
import { InstallHint } from "@/components/InstallHint";
import { UnofficialDisclaimer } from "@/components/UnofficialDisclaimer";
import { fillCopy, PAROLE } from "@/copy/parole";
import { TESTATA } from "@/copy/testata";
import { useAuth } from "@/hooks/useAuth";
import { AccountMenu } from "@/layouts/shell/AccountMenu";
import { AdminAlerts } from "@/layouts/shell/AdminAlerts";
import { alertsService } from "@/services/firestore/alertsService";
import type { Alert } from "@/types";
import { getLoginPath } from "@/utils/activityLinks";
import { getAccountHomePath } from "@/utils/family";
import { needsProfileCompletion } from "@/utils/profileCompletion";
import { getRoleLabel } from "@/utils/roles";
import { isNavLinkActive } from "@/utils/shellNavigation";

export interface LayoutLink {
  to: string;
  label: string;
  end?: boolean;
  icon?: AppIconName;
  /** Numero da mostrare accanto alla voce (es. richieste di accesso in attesa). */
  badge?: number;
  /** Altri percorsi che accendono la voce (Altro su Gallerie e Feed). */
  alsoActive?: string[];
}

interface ShellLayoutProps {
  area: "public" | "user" | "admin" | "unit" | "family";
  links?: LayoutLink[];
  /** Voci della barra laterale a desktop (solo admin); senza, la barra non c'è. */
  railLinks?: LayoutLink[];
  actionLink?: LayoutLink;
  brandLabel?: string;
}

function getSessionLabel(
  fullName: string | null | undefined,
  email?: string | null,
  displayName?: string | null,
) {
  if (fullName && fullName !== "Partecipante" && fullName !== "Ospite anonimo") {
    return fullName;
  }

  if (displayName) {
    return displayName;
  }

  if (email) {
    return email.split("@")[0];
  }

  return "Sessione attiva";
}

const SHORT_BRAND_LABEL = "Attività GU GD";

export function ShellLayout({
  area,
  links = [],
  railLinks = [],
  actionLink,
  brandLabel = SHORT_BRAND_LABEL,
}: ShellLayoutProps) {
  const { session, signOut } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [adminAlerts, setAdminAlerts] = useState<Alert[]>([]);
  const [bottomNavHidden, setBottomNavHidden] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const lastScrollYRef = useRef(0);
  const scrollFrameRef = useRef<number | null>(null);
  const showRail = railLinks.length > 0;
  const showBottomNav = area !== "public" && links.length > 0;
  // L'iscrizione ha la sua freccia, che torna al passo prima; «Chi sei?» e
  // "I tuoi dati" dopo un account nuovo non ne hanno (FLUSSO_GENITORE.md, I).
  const showPublicBack =
    area === "public" &&
    location.pathname !== "/" &&
    !/^\/activities\/[^/]+\/register\/?$/u.test(location.pathname) &&
    !(
      location.pathname === "/login" &&
      session &&
      !session.isAnonymous &&
      needsProfileCompletion(session.profile)
    );
  // "Accedi" per chi non è entrato (anche da ospite), con ritorno alla pagina
  // corrente. Non su /login, dove azzererebbe il redirect già in corso.
  const showAuthLink = location.pathname !== "/login";
  // Da non entrati, sul telefono, il nome corto delle aree riservate: accanto
  // ad "Accedi" il nome lungo andava su quattro righe, e su /login resta
  // uguale alle altre pagine invece di cambiare.
  const compactBrand =
    area === "public" && !session?.isAuthenticated && brandLabel !== SHORT_BRAND_LABEL;
  // Cambio vista per gli admin: nel menu dell'account, non più in una riga
  // sotto la testata (fase 4 del restyling).
  const viewSwitch =
    session?.isAdmin && !session.isAnonymous
      ? area === "admin"
        ? { to: "/me", label: TESTATA.vistaGiovane }
        : area === "user"
          ? { to: "/admin", label: TESTATA.vistaAdmin }
          : null
      : null;
  const brandDestination =
    area === "admin"
      ? "/admin"
      : area === "unit"
        ? "/unit"
        : area === "family"
          ? session && !session.isParent
            ? getAccountHomePath(session.profile.role)
            : "/family"
          : area === "user"
            ? "/me"
            : session?.isAuthenticated && !session.isAnonymous
              ? session.isAdmin
                ? "/admin"
                : session.isUnitLeader
                  ? "/unit"
                  : session.isParent
                    ? "/family"
                    : "/me"
              : "/";
  const unreadAdminAlerts = useMemo(() => {
    const currentUserId = session?.firebaseUser.uid;

    if (!currentUserId) {
      return [];
    }

    return adminAlerts.filter((alert) => !(alert.readBy ?? []).includes(currentUserId));
  }, [adminAlerts, session?.firebaseUser.uid]);
  const adminUnreadCount = unreadAdminAlerts.length;
  const sessionLabel = session
    ? getSessionLabel(
        session.profile?.fullName,
        session.firebaseUser.email,
        session.firebaseUser.displayName,
      )
    : "Sessione pubblica";
  const roleLabel = session ? getRoleLabel(session.profile.role) : "";
  // Riga piccola sopra il nome del palo o dell'unità (admin e dirigente).
  const brandContext =
    (area === "admin" || area === "unit") && session
      ? fillCopy(TESTATA.contesto, { ruolo: roleLabel })
      : null;

  useEffect(() => {
    if (area !== "admin" || !session?.isAdmin || !session.profile.stakeId) {
      setAdminAlerts([]);
      return;
    }

    return alertsService.subscribeToActiveAlerts(session.profile.stakeId, 12, setAdminAlerts);
  }, [area, session?.isAdmin, session?.profile.stakeId]);

  useEffect(() => {
    if (!showBottomNav || typeof window === "undefined") {
      setBottomNavHidden(false);
      return;
    }

    const topRevealThreshold = 80;
    const directionThreshold = 8;

    lastScrollYRef.current = Math.max(window.scrollY, 0);
    setBottomNavHidden(false);

    function handleScroll() {
      if (scrollFrameRef.current !== null) {
        return;
      }

      scrollFrameRef.current = window.requestAnimationFrame(() => {
        scrollFrameRef.current = null;
        const currentScrollY = Math.max(window.scrollY, 0);
        const delta = currentScrollY - lastScrollYRef.current;

        if (currentScrollY <= topRevealThreshold) {
          setBottomNavHidden(false);
        } else if (delta > directionThreshold) {
          setBottomNavHidden(true);
        } else if (delta < -directionThreshold) {
          setBottomNavHidden(false);
        }

        lastScrollYRef.current = currentScrollY;
      });
    }

    window.addEventListener("scroll", handleScroll, { passive: true });

    return () => {
      window.removeEventListener("scroll", handleScroll);
      if (scrollFrameRef.current !== null) {
        window.cancelAnimationFrame(scrollFrameRef.current);
        scrollFrameRef.current = null;
      }
    };
  }, [location.pathname, location.search, showBottomNav]);

  // All'apertura della campanella le notifiche non lette diventano lette.
  // Ogni scrittura fa arrivare uno snapshot nuovo: gli id già inviati non si
  // riscrivono.
  const sentReadIdsRef = useRef(new Set<string>());
  const markAlertsRead = useCallback(() => {
    const currentUserId = session?.firebaseUser.uid;

    if (
      area !== "admin" ||
      !session?.isAdmin ||
      !session.profile.stakeId ||
      !currentUserId ||
      unreadAdminAlerts.length === 0
    ) {
      return;
    }

    const toSend = unreadAdminAlerts.filter((alert) => !sentReadIdsRef.current.has(alert.id));
    if (toSend.length === 0) {
      return;
    }
    toSend.forEach((alert) => sentReadIdsRef.current.add(alert.id));

    void Promise.all(
      toSend.map((alert) =>
        alertsService.markAlertRead(session.profile.stakeId, alert.id, currentUserId),
      ),
    )
      .then(() => {
        setAdminAlerts((current) =>
          current.map((alert) =>
            toSend.some((sentAlert) => sentAlert.id === alert.id)
              ? {
                  ...alert,
                  readBy: [...new Set([...(alert.readBy ?? []), currentUserId])],
                }
              : alert,
          ),
        );
      })
      // Scrittura fallita: alla prossima apertura si riprova.
      .catch(() => toSend.forEach((alert) => sentReadIdsRef.current.delete(alert.id)));
  }, [area, session?.firebaseUser.uid, session?.isAdmin, session?.profile.stakeId, unreadAdminAlerts]);

  // Svuota service worker + cache e ricarica: scialuppa quando la sessione
  // mostra dati stale (es. ruolo cambiato lato server mentre l'app era aperta).
  async function handleForceRefresh() {
    setRefreshing(true);

    try {
      if ("serviceWorker" in navigator) {
        const registrations = await navigator.serviceWorker.getRegistrations();
        await Promise.all(registrations.map((registration) => registration.unregister()));
      }

      if ("caches" in window) {
        const keys = await caches.keys();
        await Promise.all(keys.map((key) => caches.delete(key)));
      }
    } catch {
      // Pulizia best-effort: ricarico comunque anche se SW/cache non si svuotano.
    }

    window.location.reload();
  }

  const alerts =
    area === "admin" && session?.isAdmin ? (
      <AdminAlerts alerts={adminAlerts} onOpen={markAlertsRead} unreadCount={adminUnreadCount} />
    ) : null;
  const accountMenu = (variant: "avatar" | "card") =>
    session?.isAuthenticated ? (
      <AccountMenu
        name={sessionLabel}
        onRefresh={() => void handleForceRefresh()}
        onSignOut={() => void signOut()}
        refreshing={refreshing}
        roleLabel={roleLabel}
        variant={variant}
        viewSwitch={viewSwitch}
      />
    ) : null;
  const brandLogo = (
    <img
      alt=""
      aria-hidden="true"
      className="brand__mark"
      loading="eager"
      src="/brand-logo.png"
    />
  );
  const areaBrand = (
    <Link className="brand" to={brandDestination}>
      {brandLogo}
      <span className="brand__text">
        {brandContext ? <small>{brandContext}</small> : null}
        <strong>{brandLabel}</strong>
      </span>
    </Link>
  );

  return (
    <div className={showRail ? `shell shell--${area} shell--rail` : `shell shell--${area}`}>
      <header className="topbar">
        <div className="topbar__inner">
          {area === "public" ? (
            <div className="topbar__lead">
              {showPublicBack ? (
                <button
                  aria-label="Torna indietro"
                  className="topbar__back"
                  onClick={() => {
                    if (location.key !== "default") {
                      navigate(-1);
                      return;
                    }

                    navigate("/", { replace: true });
                  }}
                  type="button"
                >
                  <AppIcon name="arrow-left" />
                </button>
              ) : (
                <span aria-hidden="true" className="topbar__back topbar__back--hidden" />
              )}

              <Link className={compactBrand ? "brand brand--compact" : "brand"} to={brandDestination}>
                {brandLogo}
                <span>
                  <strong>
                    <span className="brand__label">{brandLabel}</span>
                    {compactBrand ? (
                      <span className="brand__label brand__label--short">{SHORT_BRAND_LABEL}</span>
                    ) : null}
                  </strong>
                </span>
              </Link>
            </div>
          ) : (
            areaBrand
          )}

          <div className="topbar__actions">
            {alerts}
            {actionLink ? (
              <Link
                className="button button--ghost button--small topbar__action-link"
                to={actionLink.to}
              >
                <AppIcon name="arrow-right" />
                {actionLink.label}
              </Link>
            ) : null}
            {session?.isAuthenticated ? (
              accountMenu("avatar")
            ) : showAuthLink ? (
              <Link
                className="button button--soft button--small topbar__auth-link"
                to={getLoginPath(`${location.pathname}${location.search}`)}
              >
                <AppIcon name="user" />
                {PAROLE.accedi}
              </Link>
            ) : null}
          </div>
        </div>
      </header>

      {showRail ? (
        <aside className="shell-rail">
          <div className="shell-rail__head">
            {areaBrand}
            {alerts}
          </div>
          <nav className="shell-rail__nav" aria-label={TESTATA.navigazione}>
            {railLinks.map((link) => {
              const active = isNavLinkActive(link, location.pathname);
              return (
                <Link
                  aria-current={active ? "page" : undefined}
                  className={active ? "shell-rail__item shell-rail__item--active" : "shell-rail__item"}
                  key={link.to}
                  to={link.to}
                >
                  {link.icon ? <AppIcon name={link.icon} /> : null}
                  <span className="shell-rail__label">{link.label}</span>
                  {link.badge ? <span className="nav-badge">{link.badge}</span> : null}
                </Link>
              );
            })}
          </nav>
          <div className="shell-rail__foot">{accountMenu("card")}</div>
        </aside>
      ) : null}

      {showBottomNav ? (
        <nav
          className={bottomNavHidden ? "bottom-nav bottom-nav--hidden" : "bottom-nav"}
          aria-label={TESTATA.navigazione}
        >
          {links.map((link) => {
            const active = isNavLinkActive(link, location.pathname);
            return (
              <Link
                aria-current={active ? "page" : undefined}
                className={active ? "bottom-nav__item bottom-nav__item--active" : "bottom-nav__item"}
                key={link.to}
                to={link.to}
              >
                {link.icon ? <AppIcon name={link.icon} /> : null}
                <span className="bottom-nav__label">{link.label}</span>
                {link.badge ? (
                  <span className="nav-badge nav-badge--corner">{link.badge}</span>
                ) : null}
              </Link>
            );
          })}
          {actionLink ? (
            <Link className="bottom-nav__item bottom-nav__item--action" to={actionLink.to}>
              {actionLink.label}
            </Link>
          ) : null}
        </nav>
      ) : null}

      <main className="shell__main">
        <Outlet />
      </main>

      {/* Avvisi di servizio dopo il contenuto: prima rubavano la prima
          schermata al messaggio principale della pagina. */}
      <InstallHint />

      {area === "public" ? <UnofficialDisclaimer compact className="shell-disclaimer" /> : null}
    </div>
  );
}
