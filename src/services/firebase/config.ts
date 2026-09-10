// Emulator mode requires both a development build and an isolated demo project.
// Never allow a test flag to route a production build away from its backend.
export const useLocalEmulators = import.meta.env.DEV && import.meta.env.VITE_USE_EMULATORS === "true";
const emulatorProjectId = import.meta.env.VITE_EMULATOR_PROJECT_ID || "demo-room-planner";
if (useLocalEmulators && (!emulatorProjectId.startsWith("demo-") || !["localhost", "127.0.0.1", "[::1]"].includes(location.hostname))) {
  throw new Error("Gli emulatori richiedono localhost e un progetto demo-*.");
}

export const firebaseConfig = {
  apiKey: "AIzaSyA_EzJVDlEAwlBWE98nWTfRFjZGe7MCkak",
  authDomain: "giovani-palo.firebaseapp.com",
  projectId: useLocalEmulators ? emulatorProjectId : "giovani-palo",
  storageBucket: "giovani-palo.firebasestorage.app",
  messagingSenderId: "877273843364",
  appId: "1:877273843364:web:4720460301bcd8d6fe8831",
  measurementId: "G-YP2VXKTS13",
};

export const webPushPublicKey = "BNXpBiGfPKrQKpHDW7d7-qYscOYyBZhhG3zFosp6_V9-Azmg5OLCWTb_Sib6v5wYaJkGOiGHBQ5MiNDjYbKH-p8";
