import path from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

import { resolveFirebaseSettings } from "./src/services/firebase/environment";
import { PRODUCTION_SETTINGS } from "./src/services/firebase/productionSettings";

const rootDir = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig(({ mode }) => {
  // Blocco anti-prod a build time: una build non di produzione senza config
  // completa, o con valori di produzione, non produce nessun bundle.
  resolveFirebaseSettings({ ...loadEnv(mode, rootDir, "VITE_"), MODE: mode }, PRODUCTION_SETTINGS);

  return {
    plugins: [react()],
    resolve: {
      alias: {
        "@": path.resolve(rootDir, "src"),
      },
    },
    build: {
      rollupOptions: {
        output: {
          // Vendor stabili in chunk separati: cambiano solo quando si
          // aggiornano le dipendenze, quindi restano in cache tra le release.
          manualChunks: {
            "vendor-react": ["react", "react-dom", "react-router-dom"],
            "vendor-firebase": [
              "firebase/app",
              "firebase/auth",
              "firebase/firestore",
              "firebase/storage",
              "firebase/functions",
            ],
          },
        },
      },
    },
  };
});
