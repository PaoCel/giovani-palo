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

  async function signInWithGoogle() {
    const credential = await authService.signInWithGoogle();
    const nextSession = await authService.createSessionFromFirebaseUser(credential.user);
    setSession(nextSession);
    return nextSession;
  }

  async function signUpWithEmail(email: string, password: string) {
    const credential = await authService.signUpWithEmail(email, password);
    const nextSession = await authService.createSessionFromFirebaseUser(credential.user);
    setSession(nextSession);
    return nextSession;
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
        changePassword: handleChangePassword,
        signOut: handleSignOut,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}
