import { getApp, getApps, initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getFunctions } from "firebase/functions";
import { getStorage } from "firebase/storage";

import { logFirebaseBootstrap } from "@/services/firebase/debug";
import { firebaseConfig } from "@/services/firebase/config";

export const firebaseApp = getApps().length
  ? getApp()
  : initializeApp(firebaseConfig);

export const auth = getAuth(firebaseApp);
export const db = getFirestore(firebaseApp);
export const storage = getStorage(firebaseApp);
// Cloud Functions su europe-west1 (stessa region del progetto giovani-palo).
export const functions = getFunctions(firebaseApp, "europe-west1");
export const googleProvider = new GoogleAuthProvider();

googleProvider.setCustomParameters({
  prompt: "select_account",
});

logFirebaseBootstrap({
  app: firebaseApp,
  auth,
  googleProvider,
});
