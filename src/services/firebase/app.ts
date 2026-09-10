import { getApp, getApps, initializeApp } from "firebase/app";
import { connectAuthEmulator, getAuth, GoogleAuthProvider } from "firebase/auth";
import {
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  connectFirestoreEmulator,
} from "firebase/firestore";
import { connectFunctionsEmulator, getFunctions } from "firebase/functions";
import { connectStorageEmulator, getStorage } from "firebase/storage";

import { logFirebaseBootstrap } from "@/services/firebase/debug";
import { firebaseConfig, useLocalEmulators } from "@/services/firebase/config";

export const firebaseApp = getApps().length
  ? getApp()
  : initializeApp(firebaseConfig);

export const auth = getAuth(firebaseApp);
// Cache locale persistente (IndexedDB): le visite successive mostrano subito
// i dati già visti mentre la rete li aggiorna in background. Senza, ogni
// apertura ripagava per intero handshake del canale + tutte le query.
export const db = initializeFirestore(firebaseApp, {
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
});
export const storage = getStorage(firebaseApp);
// Cloud Functions su europe-west1 (stessa region del progetto giovani-palo).
export const functions = getFunctions(firebaseApp, "europe-west1");
if (useLocalEmulators) {
  connectAuthEmulator(auth, "http://127.0.0.1:9199", { disableWarnings: true });
  connectFirestoreEmulator(db, "127.0.0.1", 8180);
  connectFunctionsEmulator(functions, "127.0.0.1", 5101);
  // No Storage emulator is needed for room QA; point it at a closed local port
  // so an unrelated upload can never reach the real bucket in this mode.
  connectStorageEmulator(storage, "127.0.0.1", 9299);
}
export const googleProvider = new GoogleAuthProvider();

googleProvider.setCustomParameters({
  prompt: "select_account",
});

logFirebaseBootstrap({
  app: firebaseApp,
  auth,
  googleProvider,
});
