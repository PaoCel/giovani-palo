import type { AuthSession, RegistrationLookup } from "@/types";

export function getRegistrationLookupFromSession(
  session: AuthSession | null,
  childId?: string | null,
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

  // Genitore che agisce per conto di un figlio collegato: l'iscrizione vive
  // sul documento child_{parentUid}_{childId}, non su quello del genitore.
  if (session.isParent && childId) {
    return {
      userId: null,
      anonymousAuthUid: null,
      anonymousUid: null,
      parentUid: session.firebaseUser.uid,
      childId,
    };
  }

  return {
    userId: session.firebaseUser.uid,
    anonymousAuthUid: null,
    anonymousUid: null,
  };
}
