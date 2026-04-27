import {
  EmailAuthProvider,
  createUserWithEmailAndPassword,
  linkWithCredential,
  linkWithPopup,
  onAuthStateChanged,
  sendPasswordResetEmail,
  signInAnonymously,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  updatePassword,
  type User,
} from "firebase/auth";

import { auth, googleProvider } from "@/services/firebase/app";
import { logAuthFailure } from "@/services/firebase/debug";
import { usersService } from "@/services/firestore/usersService";
import type { AuthSession, GenderRoleCategory } from "@/types";

async function resetAnonymousSessionIfNeeded() {
  if (auth.currentUser?.isAnonymous) {
    await signOut(auth);
  }
}

function getProviderLabel(user: User) {
  if (user.isAnonymous) {
    return "Registrazione senza account";
  }

  const providerIds = user.providerData.map((provider) => provider.providerId);

  if (providerIds.includes("google.com")) {
    return "Google";
  }

  if (providerIds.includes("password")) {
    return "Email e password";
  }

  return "Firebase Auth";
}

export const authService = {
  async createSessionFromFirebaseUser(user: User): Promise<AuthSession> {
    const profile = await usersService.ensureProfileForUser(user);

    return {
      firebaseUser: user,
      profile,
      isAuthenticated: !user.isAnonymous,
      isAdmin: profile.role === "admin" || profile.role === "super_admin",
      isUnitLeader: profile.role === "unit_leader",
      isAnonymous: user.isAnonymous,
      providerLabel: getProviderLabel(user),
    };
  },

  async signInWithEmail(email: string, password: string) {
    try {
      await resetAnonymousSessionIfNeeded();
      return await signInWithEmailAndPassword(auth, email, password);
    } catch (error) {
      logAuthFailure("signInWithEmailAndPassword", auth, error, {
        attemptedEmail: email,
      });
      throw error;
    }
  },

  async signUpWithEmail(email: string, password: string) {
    try {
      if (auth.currentUser?.isAnonymous) {
        const credential = EmailAuthProvider.credential(email, password);
        return await linkWithCredential(auth.currentUser, credential);
      }

      return await createUserWithEmailAndPassword(auth, email, password);
    } catch (error) {
      logAuthFailure("createUserWithEmailAndPassword", auth, error, {
        attemptedEmail: email,
      });
      throw error;
    }
  },

  async sendPasswordReset(email: string) {
    try {
      await sendPasswordResetEmail(auth, email);
    } catch (error) {
      logAuthFailure("sendPasswordResetEmail", auth, error, {
        attemptedEmail: email,
      });
      throw error;
    }
  },

  async signInWithGoogle() {
    try {
      if (auth.currentUser?.isAnonymous) {
        return await linkWithPopup(auth.currentUser, googleProvider);
      }

      await resetAnonymousSessionIfNeeded();
      return await signInWithPopup(auth, googleProvider);
    } catch (error) {
      logAuthFailure("signInWithPopup", auth, error, {
        providerId: googleProvider.providerId,
      });
      throw error;
    }
  },

  async signInAnonymously() {
    try {
      return await signInAnonymously(auth);
    } catch (error) {
      logAuthFailure("signInAnonymously", auth, error);
      throw error;
    }
  },

  async completeProfile(
    session: AuthSession,
    input: {
      firstName: string;
      lastName: string;
      birthDate: string;
      genderRoleCategory: GenderRoleCategory;
      unitName: string;
      stakeId: string;
    },
  ) {
    if (session.firebaseUser.isAnonymous) {
      throw new Error("La sessione senza account non può completare un profilo utente.");
    }

    const profile = await usersService.updateProfile(session.firebaseUser.uid, input);

    if (!profile) {
      throw new Error("Impossibile rileggere il profilo aggiornato.");
    }

    return {
      ...session,
      profile,
      isAuthenticated: true,
      isAdmin: profile.role === "admin" || profile.role === "super_admin",
      isUnitLeader: profile.role === "unit_leader",
    };
  },

  observeAuthState(callback: Parameters<typeof onAuthStateChanged>[1]) {
    return onAuthStateChanged(auth, callback);
  },

  async changePassword(nextPassword: string) {
    if (!auth.currentUser) {
      throw new Error("Sessione non disponibile.");
    }

    await updatePassword(auth.currentUser, nextPassword);
    await usersService.completeMustChangePassword(auth.currentUser.uid);
  },

  async signOut() {
    await signOut(auth);
  },
};
