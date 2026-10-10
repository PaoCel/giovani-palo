import { useEffect, useState } from "react";
import { Navigate, Outlet, useLocation } from "react-router-dom";

import { AppLoader } from "@/components/AppLoader";
import { EmptyState } from "@/components/EmptyState";
import { useAuth } from "@/hooks/useAuth";
import { campManagementService } from "@/services/firestore/campManagementService";

function isCampManagementAdminPath(pathname: string) {
  return /^\/admin\/events\/[^/]+\/(committees|comitati)$/.test(pathname.split("?")[0]);
}

function campEventIdFromPath(pathname: string) {
  return /^\/admin\/events\/([^/]+)\/(committees|comitati)$/.exec(pathname.split("?")[0])?.[1] ?? "";
}

/**
 * Comitati e pattuglie per chi non è admin né dirigente di unità: ci entra solo
 * chi un admin ha messo nell'elenco staff del campeggio. La categoria del profilo
 * è autodichiarata e non conta: lo decide il server.
 */
function CampStaffGate({ session, pathname }: {
  session: NonNullable<ReturnType<typeof useAuth>["session"]>;
  pathname: string;
}) {
  const stakeId = session.profile.stakeId;
  const eventId = campEventIdFromPath(pathname);
  const [state, setState] = useState<"loading" | "allowed" | "denied" | "error">("loading");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setState("loading");
    campManagementService
      .getStaffContext(stakeId, eventId)
      .then((context) => {
        if (!cancelled) setState(context.isStaff ? "allowed" : "denied");
      })
      .catch(() => {
        // Rete o server: non è un "no", non mando lo staff vero a /me.
        if (!cancelled) setState("error");
      });
    return () => {
      cancelled = true;
    };
  }, [stakeId, eventId, attempt]);

  if (state === "loading") return <AppLoader label="Verifica accesso..." />;
  if (state === "error") {
    return (
      <EmptyState
        action={
          <button
            className="button button--ghost button--small"
            onClick={() => setAttempt((current) => current + 1)}
            type="button"
          >
            Riprova
          </button>
        }
        description="Controlla la connessione e riprova."
        title="Non riesco a verificare l'accesso"
      />
    );
  }
  return state === "allowed" ? <Outlet /> : <Navigate replace to="/me" />;
}

export function ProtectedRoute() {
  const { loading, session } = useAuth();
  const location = useLocation();

  if (loading) {
    return <AppLoader label="Verifica sessione..." />;
  }

  if (!session?.isAuthenticated) {
    const redirect = encodeURIComponent(`${location.pathname}${location.search}`);
    return <Navigate replace to={`/login?redirect=${redirect}`} />;
  }

  if (session.isAnonymous) {
    return <Navigate replace to="/activities" />;
  }

  if (session.profile.mustChangePassword) {
    return <Navigate replace to="/password-reset" />;
  }

  if (session.isUnitLeader && !isCampManagementAdminPath(location.pathname)) {
    return <Navigate replace to="/unit" />;
  }

  if (session.isParent) {
    return <Navigate replace to="/family" />;
  }

  return <Outlet />;
}

export function AdminRoute() {
  const { loading, session } = useAuth();
  const location = useLocation();

  if (loading) {
    return <AppLoader label="Verifica accesso admin..." />;
  }

  if (!session?.isAuthenticated) {
    const redirect = encodeURIComponent(`${location.pathname}${location.search}`);
    return <Navigate replace to={`/login?redirect=${redirect}`} />;
  }

  if (session.isAnonymous) {
    return <Navigate replace to="/activities" />;
  }

  if (session.profile.mustChangePassword) {
    return <Navigate replace to="/password-reset" />;
  }

  if (session.isUnitLeader && !isCampManagementAdminPath(location.pathname)) {
    return <Navigate replace to="/unit" />;
  }

  if (session.isParent) {
    return <Navigate replace to="/family" />;
  }

  if (!session.isAdmin && !session.isUnitLeader) {
    return isCampManagementAdminPath(location.pathname) ? (
      <CampStaffGate pathname={location.pathname} session={session} />
    ) : (
      <Navigate replace to="/me" />
    );
  }

  return <Outlet />;
}

export function UnitLeaderRoute() {
  const { loading, session } = useAuth();
  const location = useLocation();

  if (loading) {
    return <AppLoader label="Verifica accesso..." />;
  }

  if (!session?.isAuthenticated) {
    const redirect = encodeURIComponent(`${location.pathname}${location.search}`);
    return <Navigate replace to={`/login?redirect=${redirect}`} />;
  }

  if (session.isAnonymous) {
    return <Navigate replace to="/activities" />;
  }

  if (session.profile.mustChangePassword) {
    return <Navigate replace to="/password-reset" />;
  }

  if (!session.isUnitLeader) {
    return (
      <Navigate
        replace
        to={session.isAdmin ? "/admin" : session.isParent ? "/family" : "/me"}
      />
    );
  }

  return <Outlet />;
}

/**
 * Guardia dell'area campeggio condivisa (/campeggio): la vedono TUTTI i ruoli
 * autenticati non anonimi (giovani, genitori, dirigenti, admin) senza redirect
 * per ruolo. Serve ad allineare galleria + sondaggio del campeggio tra i ruoli.
 */
export function CampRoute() {
  const { loading, session } = useAuth();
  const location = useLocation();

  if (loading) {
    return <AppLoader label="Apertura campeggio..." />;
  }

  if (!session?.isAuthenticated) {
    const redirect = encodeURIComponent(`${location.pathname}${location.search}`);
    return <Navigate replace to={`/login?redirect=${redirect}`} />;
  }

  if (session.isAnonymous) {
    return <Navigate replace to="/activities" />;
  }

  if (session.profile.mustChangePassword) {
    return <Navigate replace to="/password-reset" />;
  }

  return <Outlet />;
}

export function ParentRoute() {
  const { loading, session } = useAuth();
  const location = useLocation();

  if (loading) {
    return <AppLoader label="Verifica accesso..." />;
  }

  if (!session?.isAuthenticated) {
    const redirect = encodeURIComponent(`${location.pathname}${location.search}`);
    return <Navigate replace to={`/login?redirect=${redirect}`} />;
  }

  if (session.isAnonymous) {
    return <Navigate replace to="/activities" />;
  }

  if (session.profile.mustChangePassword) {
    return <Navigate replace to="/password-reset" />;
  }

  if (!session.isParent) {
    return (
      <Navigate
        replace
        to={session.isAdmin ? "/admin" : session.isUnitLeader ? "/unit" : "/me"}
      />
    );
  }

  return <Outlet />;
}
