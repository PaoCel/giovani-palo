import type { User } from "firebase/auth";

import type { GenderRoleCategory, UserProfile } from "@/types/models";

export interface AuthSession {
  firebaseUser: User;
  profile: UserProfile;
  isAuthenticated: boolean;
  isAdmin: boolean;
  isUnitLeader: boolean;
  isAnonymous: boolean;
  providerLabel: string;
}

export interface AuthContextValue {
  session: AuthSession | null;
  loading: boolean;
  signInWithEmail: (email: string, password: string) => Promise<AuthSession>;
  signUpWithEmail: (email: string, password: string) => Promise<AuthSession>;
  sendPasswordReset: (email: string) => Promise<void>;
  signInWithGoogle: () => Promise<AuthSession>;
  signInAnonymously: () => Promise<AuthSession>;
  completeProfile: (input: {
    firstName: string;
    lastName: string;
    birthDate: string;
    genderRoleCategory: GenderRoleCategory;
    unitName: string;
    stakeId: string;
  }) => Promise<AuthSession>;
  changePassword: (nextPassword: string) => Promise<void>;
  signOut: () => Promise<void>;
}
