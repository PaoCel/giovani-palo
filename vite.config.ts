import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig, loadEnv, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

import { resolveFirebaseSettings } from "./src/services/firebase/environment";
import { PRODUCTION_SETTINGS } from "./src/services/firebase/productionSettings";

const rootDir = fileURLToPath(new URL(".", import.meta.url));

// Solo build di staging/demo: non indicizzabile e riconoscibile come demo
// (titolo, nome della PWA). Produzione non cambia.
function stagingExtras(): Plugin {
  let outDir = "";
  return {
    name: "staging-extras",
    apply: "build",
    configResolved(config) {
      outDir = path.resolve(config.root, config.build.outDir);
    },
    transformIndexHtml(html) {
      return html
        .replace("</head>", '    <meta name="robots" content="noindex, nofollow" />\n  </head>')
        .replace("<title>Attività GU GD</title>", "<title>[DEMO] Attività GU GD</title>")
        .replace('name="apple-mobile-web-app-title" content="Attività GU GD"', 'name="apple-mobile-web-app-title" content="GU GD Demo"');
    },
    closeBundle() {
      fs.writeFileSync(path.join(outDir, "robots.txt"), "User-agent: *\nDisallow: /\n");
      const manifestPath = path.join(outDir, "manifest.webmanifest");
      const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
      manifest.name = `${manifest.name} (Demo)`;
      manifest.short_name = "GU GD Demo";
      fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    },
  };
}

export default defineConfig(({ mode }) => {
  // Blocco anti-prod a build time: una build non di produzione senza config
  // completa, o con valori di produzione, non produce nessun bundle.
  const settings = resolveFirebaseSettings(
    { ...loadEnv(mode, rootDir, "VITE_"), MODE: mode },
    PRODUCTION_SETTINGS,
  );

  return {
    plugins: [react(), ...(settings.appEnvironment === "staging" ? [stagingExtras()] : [])],
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
