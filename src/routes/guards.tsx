import { Navigate, Outlet, useLocation } from "react-router-dom";

import { AppLoader } from "@/components/AppLoader";
import { useAuth } from "@/hooks/useAuth";

function isCampManagementAdminPath(pathname: string) {
  return /^\/admin\/events\/[^/]+\/(committees|comitati)$/.test(pathname.split("?")[0]);
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

  if (!session.isAdmin && !(session.isUnitLeader && isCampManagementAdminPath(location.pathname))) {
    return <Navigate replace to="/me" />;
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
