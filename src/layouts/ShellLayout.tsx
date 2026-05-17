import { useEffect, useMemo, useRef, useState } from "react";
import { NavLink, Link, Outlet, useLocation, useNavigate } from "react-router-dom";

import { AppIcon, type AppIconName } from "@/components/AppIcon";
import { InstallHint } from "@/components/InstallHint";
import { UnofficialDisclaimer } from "@/components/UnofficialDisclaimer";
import { useAuth } from "@/hooks/useAuth";
import { alertsService } from "@/services/firestore/alertsService";
import type { Alert } from "@/types";
import { getRoleLabel } from "@/utils/roles";

export interface LayoutLink {
  to: string;
  label: string;
  end?: boolean;
  icon?: AppIconName;
}

interface ShellLayoutProps {
  area: "public" | "user" | "admin" | "unit";
  eyebrow?: string;
  title?: string;
  links?: LayoutLink[];
  actionLink?: LayoutLink;
  brandLabel?: string;
  showDefaultAuthAction?: boolean;
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

export function ShellLayout({
  area,
  eyebrow,
  title,
  links = [],
  actionLink,
  brandLabel = "Attività GU GD",
  showDefaultAuthAction = true,
}: ShellLayoutProps) {
  const { session, signOut } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [adminAlerts, setAdminAlerts] = useState<Alert[]>([]);
  const [alertDropdownOpen, setAlertDropdownOpen] = useState(false);
  const alertDropdownRef = useRef<HTMLDivElement | null>(null);
  const showTopNav = area === "admin" && links.length > 0;
  const showBottomNav = area !== "public" && links.length > 0;
  const showPublicBack = area === "public" && location.pathname !== "/";
  const showMeta =
    area !== "user" && Boolean(eyebrow || title || (area !== "public" && session));
  const brandDestination =
    area === "admin"
      ? "/admin"
      : area === "unit"
        ? "/unit"
        : area === "user"
          ? "/me"
          : session?.isAuthenticated && !session.isAnonymous
            ? session.isAdmin
              ? "/admin"
              : session.isUnitLeader
                ? "/unit"
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

  useEffect(() => {
    if (area !== "admin" || !session?.isAdmin || !session.profile.stakeId) {
      setAdminAlerts([]);
      return;
    }

    return alertsService.subscribeToActiveAlerts(session.profile.stakeId, 12, setAdminAlerts);
  }, [area, session?.isAdmin, session?.profile.stakeId]);

  useEffect(() => {
    setAlertDropdownOpen(false);
  }, [location.pathname, location.search, location.hash]);

  useEffect(() => {
    if (!alertDropdownOpen || typeof document === "undefined") {
      return;
    }

    function handlePointerDown(event: MouseEvent) {
      if (!alertDropdownRef.current?.contains(event.target as Node)) {
        setAlertDropdownOpen(false);
      }
    }

    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [alertDropdownOpen]);

  useEffect(() => {
    const currentUserId = session?.firebaseUser.uid;

    if (
      !alertDropdownOpen ||
      area !== "admin" ||
      !session?.isAdmin ||
      !session.profile.stakeId ||
      !currentUserId ||
      unreadAdminAlerts.length === 0
    ) {
      return;
    }

    void Promise.all(
      unreadAdminAlerts.map((alert) =>
        alertsService.markAlertRead(session.profile.stakeId, alert.id, currentUserId),
      ),
    )
      .then(() => {
        setAdminAlerts((current) =>
          current.map((alert) =>
            unreadAdminAlerts.some((unreadAlert) => unreadAlert.id === alert.id)
              ? {
                  ...alert,
                  readBy: [...new Set([...(alert.readBy ?? []), currentUserId])],
                }
              : alert,
          ),
        );
      })
      .catch(() => undefined);
  }, [
    alertDropdownOpen,
    area,
    session?.firebaseUser.uid,
    session?.isAdmin,
    session?.profile.stakeId,
    unreadAdminAlerts,
  ]);

  return (
    <div className={`shell shell--${area}`}>
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

              <Link className="brand" to={brandDestination}>
                <img
                  alt=""
                  aria-hidden="true"
                  className="brand__mark"
                  loading="eager"
                  src="/brand-logo.png"
                />
                <span>
                  <strong>{brandLabel}</strong>
                  {eyebrow ? <small>{eyebrow}</small> : null}
                </span>
              </Link>
            </div>
          ) : (
            <Link className="brand" to={brandDestination}>
              <img
                alt=""
                aria-hidden="true"
                className="brand__mark"
                loading="eager"
                src="/brand-logo.png"
              />
              <span>
                <strong>{brandLabel}</strong>
                {eyebrow ? <small>{eyebrow}</small> : null}
              </span>
            </Link>
          )}

          {showTopNav ? (
            <nav className="topbar__nav" aria-label={`Navigazione ${area}`}>
              {links.map((link) => (
                <NavLink
                  key={link.to}
                  to={link.to}
                  end={link.end}
                  className={({ isActive }) =>
                    isActive ? "nav-pill nav-pill--active" : "nav-pill"
                  }
                >
                  {link.label}
                </NavLink>
              ))}
            </nav>
          ) : (
            <div />
          )}

          <div className="topbar__actions">
            {area === "admin" && session?.isAdmin ? (
              <div className="topbar__alert-shell" ref={alertDropdownRef}>
                <button
                  aria-expanded={alertDropdownOpen}
                  aria-haspopup="dialog"
                  aria-label={
                    adminUnreadCount > 0
                      ? `Apri notifiche admin (${adminUnreadCount})`
                      : "Apri notifiche admin"
                  }
                  className="topbar__alert-link"
                  onClick={() => setAlertDropdownOpen((current) => !current)}
                  title="Notifiche admin"
                  type="button"
                >
                  <AppIcon name="bell" />
                  {adminUnreadCount > 0 ? (
                    <span className="topbar__alert-count">
                      {adminUnreadCount > 9 ? "9+" : adminUnreadCount}
                    </span>
                  ) : null}
                </button>

                {alertDropdownOpen ? (
                  <div className="topbar__alert-dropdown" role="dialog" aria-label="Notifiche admin">
                    <div className="topbar__alert-dropdown-head">
                      <strong>Notifiche</strong>
                      <small>
                        {adminUnreadCount > 0
                          ? `${adminUnreadCount} nuove`
                          : "Tutte lette"}
                      </small>
                    </div>

                    {adminAlerts.length === 0 ? (
                      <p className="topbar__alert-empty">Nessuna notifica recente.</p>
                    ) : (
                      <div className="topbar__alert-list">
                        {adminAlerts.slice(0, 8).map((alert) => (
                          <Link
                            key={alert.id}
                            className="topbar__alert-item"
                            onClick={() => setAlertDropdownOpen(false)}
                            to={alert.eventId ? `/admin/events/${alert.eventId}` : "/admin"}
                          >
                            <strong>{alert.participantName || alert.title}</strong>
                            <span>{alert.eventTitle || alert.message}</span>
                            <small>
                              {alert.submittedByMode === "anonymous" ? "Ospite" : "Con account"}
                            </small>
                          </Link>
                        ))}
                      </div>
                    )}
                  </div>
                ) : null}
              </div>
            ) : null}
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
              area === "user" || area === "admin" || area === "unit" ? (
                <button
                  aria-label="Esci"
                  className="icon-button icon-button--soft topbar__logout"
                  onClick={() => void signOut()}
                  title="Esci"
                  type="button"
                >
                  <AppIcon name="logout" />
                </button>
              ) : area !== "public" ? (
                <button
                  className="button button--soft button--small"
                  onClick={() => void signOut()}
                  type="button"
                >
                  <AppIcon name="arrow-left" />
                  Esci
                </button>
              ) : null
            ) : showDefaultAuthAction ? (
              <Link className="button button--soft button--small" to="/login">
                <AppIcon name="user" />
                Accedi
              </Link>
            ) : null}
          </div>
        </div>

        {showMeta ? (
          <div className="topbar__meta">
            <div>
              {eyebrow ? <span className="topbar__eyebrow">{eyebrow}</span> : null}
              {title ? <p>{title}</p> : null}
            </div>
            <div className="chip-row">
              <div className="surface-chip">
                {session
                  ? getSessionLabel(
                      session.profile?.fullName,
                      session.firebaseUser.email,
                      session.firebaseUser.displayName,
                    )
                  : "Sessione pubblica"}
              </div>
              {session ? (
                <div className="surface-chip">
                  {session.isAnonymous ? "Ospite" : getRoleLabel(session.profile.role)}
                </div>
              ) : null}
            </div>
          </div>
        ) : null}
      </header>

      {showBottomNav ? (
        <nav className="bottom-nav" aria-label={`Navigazione ${area}`}>
          {links.map((link) => (
            <NavLink
              key={link.to}
              to={link.to}
              end={link.end}
              aria-label={link.label}
              title={link.label}
              className={({ isActive }) =>
                isActive ? "bottom-nav__item bottom-nav__item--active" : "bottom-nav__item"
              }
            >
              {link.icon ? <AppIcon name={link.icon} /> : null}
              {link.icon ? <span className="sr-only">{link.label}</span> : link.label}
            </NavLink>
          ))}
          {actionLink ? (
            <Link className="bottom-nav__item bottom-nav__item--action" to={actionLink.to}>
              {actionLink.label}
            </Link>
          ) : null}
        </nav>
      ) : null}

      <InstallHint />

      {area === "public" ? <UnofficialDisclaimer compact className="shell-disclaimer" /> : null}

      <main className="shell__main">
        <Outlet />
      </main>
    </div>
  );
}
