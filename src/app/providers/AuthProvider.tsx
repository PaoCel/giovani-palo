import {
  createContext,
  useEffect,
  useState,
  type PropsWithChildren,
} from "react";

import { authService } from "@/services/auth/authService";
import { usersService } from "@/services/firestore/usersService";
import { adminPushService } from "@/services/push/adminPushService";
import type { AuthContextValue, AuthSession, GenderRoleCategory } from "@/types";

export const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: PropsWithChildren) {
  const [session, setSession] = useState<AuthSession | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let unsubscribeProfile: (() => void) | null = null;

    const unsubscribeAuth = authService.observeAuthState(async (firebaseUser) => {
      unsubscribeProfile?.();
      unsubscribeProfile = null;

      if (!firebaseUser) {
        setSession(null);
        setLoading(false);
        return;
      }

      setSession(await authService.createSessionFromFirebaseUser(firebaseUser));
      setLoading(false);

      if (firebaseUser.isAnonymous) {
        return;
      }

      // Ascolta il doc utente: cambi di ruolo applicati senza richiedere re-login.
      unsubscribeProfile = usersService.observeProfile(firebaseUser.uid, (profile) => {
        if (!profile) {
          return;
        }

        setSession((current) => {
          if (!current || current.firebaseUser.uid !== firebaseUser.uid) {
            return current;
          }

          return {
            ...current,
            profile,
            isAdmin: profile.role === "admin" || profile.role === "super_admin",
            isUnitLeader: profile.role === "unit_leader",
            isParent: profile.role === "parent",
          };
        });
      });
    });

    return () => {
      unsubscribeAuth();
      unsubscribeProfile?.();
    };
  }, []);

  async function signInWithEmail(email: string, password: string) {
    const credential = await authService.signInWithEmail(email, password);
    const nextSession = await authService.createSessionFromFirebaseUser(credential.user);
    setSession(nextSession);
    return nextSession;
  }

  async function applyAccountType(nextSession: AuthSession, accountType?: "participant" | "parent") {
    if (!accountType || nextSession.profile.role === accountType) {
      return nextSession;
    }

    if (nextSession.profile.role !== "participant" && nextSession.profile.role !== "parent") {
      return nextSession;
    }

    const profile = await usersService.setOwnAccountType(
      nextSession.firebaseUser.uid,
      accountType,
    );
    const effectiveProfile = profile ?? nextSession.profile;
    const updatedSession = {
      ...nextSession,
      profile: effectiveProfile,
      isParent: effectiveProfile.role === "parent",
      isAdmin: effectiveProfile.role === "admin" || effectiveProfile.role === "super_admin",
      isUnitLeader: effectiveProfile.role === "unit_leader",
    };
    setSession(updatedSession);
    return updatedSession;
  }

  async function signInWithGoogle(accountType?: "participant" | "parent") {
    const credential = await authService.signInWithGoogle();
    const nextSession = await authService.createSessionFromFirebaseUser(credential.user);
    setSession(nextSession);
    return applyAccountType(nextSession, accountType);
  }

  async function signUpWithEmail(
    email: string,
    password: string,
    accountType?: "participant" | "parent",
  ) {
    const credential = await authService.signUpWithEmail(email, password);
    const nextSession = await authService.createSessionFromFirebaseUser(credential.user);
    setSession(nextSession);
    return applyAccountType(nextSession, accountType);
  }

  async function handlePasswordReset(email: string) {
    await authService.sendPasswordReset(email);
  }

  async function signInAnonymously() {
    const credential = await authService.signInAnonymously();
    const nextSession = await authService.createSessionFromFirebaseUser(credential.user);
    setSession(nextSession);
    return nextSession;
  }

  async function completeProfile(input: {
    firstName: string;
    lastName: string;
    birthDate: string;
    genderRoleCategory: GenderRoleCategory;
    unitName: string;
    stakeId: string;
  }) {
    if (!session) {
      throw new Error("Sessione non disponibile.");
    }

    const nextSession = await authService.completeProfile(session, input);
    setSession(nextSession);
    return nextSession;
  }

  async function completeParentProfile(input: {
    firstName: string;
    lastName: string;
    unitName: string;
    city: string;
    stakeId: string;
  }) {
    if (!session) {
      throw new Error("Sessione non disponibile.");
    }

    const profile = await usersService.updateParentProfile(session.firebaseUser.uid, input);

    if (!profile) {
      throw new Error("Impossibile rileggere il profilo aggiornato.");
    }

    const nextSession = {
      ...session,
      profile,
      isParent: profile.role === "parent",
      isAdmin: profile.role === "admin" || profile.role === "super_admin",
      isUnitLeader: profile.role === "unit_leader",
    };
    setSession(nextSession);
    return nextSession;
  }

  async function handleChangePassword(nextPassword: string) {
    await authService.changePassword(nextPassword);

    if (session?.firebaseUser) {
      setSession(await authService.createSessionFromFirebaseUser(session.firebaseUser));
    }
  }

  async function handleSignOut() {
    if (session?.profile.stakeId) {
      await adminPushService
        .disableCurrentDevice(session.profile.stakeId)
        .catch(() => undefined);
    }

    await authService.signOut();
    setSession(null);
  }

  return (
    <AuthContext.Provider
      value={{
        session,
        loading,
        signInWithEmail,
        signUpWithEmail,
        sendPasswordReset: handlePasswordReset,
        signInWithGoogle,
        signInAnonymously,
        completeProfile,
        completeParentProfile,
        changePassword: handleChangePassword,
        signOut: handleSignOut,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}
