import { assertHostMatchesEnvironment, resolveFirebaseSettings } from "@/services/firebase/environment";
import { PRODUCTION_SETTINGS } from "@/services/firebase/productionSettings";

// Emulator mode requires both a development build and an isolated demo project.
// Never allow a test flag to route a production build away from its backend.
export const useLocalEmulators = import.meta.env.DEV && import.meta.env.VITE_USE_EMULATORS === "true";
const emulatorProjectId = import.meta.env.VITE_EMULATOR_PROJECT_ID || "demo-room-planner";
if (useLocalEmulators && (!emulatorProjectId.startsWith("demo-") || !["localhost", "127.0.0.1", "[::1]"].includes(location.hostname))) {
  throw new Error("Gli emulatori richiedono localhost e un progetto demo-*.");
}

// Backend per ambiente. Produzione = valori storici; staging solo da VITE_*
// e mai con valori di produzione (vedi environment.ts, controllato anche in
// vite.config.ts a build time). Il confronto sta sul valore statico di
// VITE_APP_ENV cosi' un bundle di staging non include i valori di produzione.
const settings = resolveFirebaseSettings(
  import.meta.env,
  import.meta.env.VITE_APP_ENV === "staging" ? null : PRODUCTION_SETTINGS,
);

// Il bundle deve girare sull'host del proprio ambiente (vedi environment.ts).
assertHostMatchesEnvironment(settings.appEnvironment, location.hostname);

export const appEnvironment = settings.appEnvironment;
export const isProductionEnvironment = settings.appEnvironment === "production";

export const firebaseConfig = {
  ...settings.firebaseConfig,
  projectId: useLocalEmulators ? emulatorProjectId : settings.firebaseConfig.projectId,
};

export const webPushPublicKey = settings.webPushPublicKey;
