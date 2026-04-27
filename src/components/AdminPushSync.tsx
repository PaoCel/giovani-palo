import { useEffect } from "react";

import { useAuth } from "@/hooks/useAuth";
import { adminPushService } from "@/services/push/adminPushService";

function getSessionDisplayName(
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

  return email || "Admin";
}

export function AdminPushSync() {
  const { session, loading } = useAuth();

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    if (loading) {
      return;
    }

    if (
      session?.isAdmin &&
      session.profile.stakeId &&
      !session.isAnonymous
    ) {
      void adminPushService.syncCurrentDevice({
        stakeId: session.profile.stakeId,
        userId: session.firebaseUser.uid,
        userName: getSessionDisplayName(
          session.profile.fullName,
          session.firebaseUser.email,
          session.firebaseUser.displayName,
        ),
        role: session.profile.role,
      }).catch(() => undefined);
      return;
    }

    void adminPushService.disableCurrentDevice().catch(() => undefined);
  }, [
    loading,
    session?.firebaseUser.displayName,
    session?.firebaseUser.email,
    session?.firebaseUser.uid,
    session?.isAdmin,
    session?.isAnonymous,
    session?.profile.fullName,
    session?.profile.role,
    session?.profile.stakeId,
  ]);

  return null;
}
