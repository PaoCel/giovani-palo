import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type PropsWithChildren,
} from "react";

import { authService } from "@/services/auth/authService";
import { usersService } from "@/services/firestore/usersService";
import { adminPushService } from "@/services/push/adminPushService";
import { galleryCommentsService } from "@/services/firestore/galleryCommentsService";
import { useStakeMembership } from "@/hooks/useStakeMembership";
import type { AuthContextValue, AuthSession, GenderRoleCategory } from "@/types";
import { clearAdultGuardConfirmations } from "@/utils/adultGuard";
import { shouldApplyAccountType } from "@/utils/profileCompletion";
import { clearProfileDrafts } from "@/utils/profileDrafts";

export const AuthContext = createContext<AuthContextValue | null>(null);

// The shared membership listener stays alive while the user navigates. A
// request started in a now-closed viewer must also lose its UI context on revocation.
function CommentMembershipEffects() {
  const session = useContext(AuthContext)?.session;
  const uid = session?.firebaseUser.uid ?? "";
  const stakeId = session?.profile.stakeId ?? "";
  const { access } = useStakeMembership(stakeId);
  useEffect(() => {
    if (uid && stakeId && access !== "member" && access !== "loading") {
      galleryCommentsService.clearContext(uid, stakeId);
    }
  }, [uid, stakeId, access]);
  return null;
}

export function AuthProvider({ children }: PropsWithChildren) {
  const [session, setSession] = useState<AuthSession | null>(null);
  const [loading, setLoading] = useState(true);
  const previousCommentsContext = useRef<{ uid: string; stakeId: string } | null>(null);
  const commentsUid = session?.firebaseUser.uid ?? "";
  const commentsStakeId = session?.profile.stakeId ?? "";
  useEffect(() => {
    const previous = previousCommentsContext.current;
    if (previous && (previous.uid !== commentsUid || previous.stakeId !== commentsStakeId)) {
      galleryCommentsService.clearContext(previous.uid, previous.stakeId);
    }
    previousCommentsContext.current = commentsUid ? { uid: commentsUid, stakeId: commentsStakeId } : null;
  }, [commentsUid, commentsStakeId]);

  useEffect(() => {
    let unsubscribeProfile: (() => void) | null = null;
    // Account di prima (undefined al primo giro): uscendo o cambiando account
    // le memorie dell'iscrizione dell'altro (bozza di «I tuoi dati», conferme
    // della guardia adulto) spariscono, qualunque pagina sia aperta.
    let previousUid: string | null | undefined;

    const unsubscribeAuth = authService.observeAuthState(async (firebaseUser) => {
      unsubscribeProfile?.();
      unsubscribeProfile = null;

      // Anche l'ospite conta col suo uid: collegando un account l'uid resta lo
      // stesso e Firebase non chiama di nuovo questo ascoltatore, quindi
      // l'uscita dopo il collegamento deve trovare l'uid di prima.
      const uid = firebaseUser?.uid ?? null;

      if (previousUid !== undefined && previousUid !== uid) {
        clearProfileDrafts();
        clearAdultGuardConfirmations();
      }

      previousUid = uid;

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

  // Il tipo scelto ("per chi" dell'iscrizione) vale solo per un account appena
  // creato e col profilo ancora da completare: entrare con Google in un
  // account esistente non lo trasforma mai (l'account di un ragazzo non
  // diventa da genitore); per quelli il tipo si decide salvando "I tuoi dati".
  // Dirigenti e admin restano quello che sono.
  async function applyAccountType(
    nextSession: AuthSession,
    accountType: "participant" | "parent" | undefined,
    isNewAccount: boolean,
  ) {
    if (
      !accountType ||
      !shouldApplyAccountType({ accountType, isNewAccount, profile: nextSession.profile })
    ) {
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
    return applyAccountType(nextSession, accountType, authService.isNewAccount(credential));
  }

  async function signUpWithEmail(
    email: string,
    password: string,
    accountType?: "participant" | "parent",
  ) {
    const credential = await authService.signUpWithEmail(email, password);
    const nextSession = await authService.createSessionFromFirebaseUser(credential.user);
    setSession(nextSession);
    // "Crea un account" crea sempre un account nuovo (o collega l'ospite).
    return applyAccountType(nextSession, accountType, true);
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
    role?: "participant";
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
      <CommentMembershipEffects />
      {children}
    </AuthContext.Provider>
  );
}
