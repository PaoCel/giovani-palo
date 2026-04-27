import { Navigate, Outlet, useLocation } from "react-router-dom";

import { AppLoader } from "@/components/AppLoader";
import { useAuth } from "@/hooks/useAuth";

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

  if (session.isUnitLeader) {
    return <Navigate replace to="/unit" />;
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

  if (session.isUnitLeader) {
    return <Navigate replace to="/unit" />;
  }

  if (!session.isAdmin) {
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
    return <Navigate replace to={session.isAdmin ? "/admin" : "/me"} />;
  }

  return <Outlet />;
}
