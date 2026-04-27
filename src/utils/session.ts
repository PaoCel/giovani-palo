import type { AuthSession, RegistrationLookup } from "@/types";

export function getRegistrationLookupFromSession(
  session: AuthSession | null,
): RegistrationLookup {
  if (!session) {
    return { userId: null, anonymousAuthUid: null, anonymousUid: null };
  }

  if (session.isAnonymous) {
    return {
      userId: null,
      anonymousAuthUid: session.firebaseUser.uid,
      anonymousUid: session.firebaseUser.uid,
    };
  }

  return {
    userId: session.firebaseUser.uid,
    anonymousAuthUid: null,
    anonymousUid: null,
  };
}
