import React from "react";
import ReactDOM from "react-dom/client";

import App from "@/app/App";
import "@/styles/base.css";

function updateDisplayModeFlag() {
  const standalone =
    window.matchMedia("(display-mode: standalone)").matches ||
    (window.navigator as Navigator & { standalone?: boolean }).standalone === true;

  document.documentElement.dataset.displayMode = standalone ? "standalone" : "browser";
}

updateDisplayModeFlag();
const displayModeQuery = window.matchMedia("(display-mode: standalone)");
displayModeQuery.addEventListener("change", updateDisplayModeFlag);

if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => undefined);
  });
}

// Riarma l'auto-reload di RouteErrorPanel solo dopo che l'app è rimasta
// stabile un po': riarmarlo subito al boot ricreerebbe il loop di reload
// che il flag deve prevenire.
window.setTimeout(() => {
  try {
    sessionStorage.removeItem("gugd-chunk-reload");
  } catch {
    // sessionStorage non disponibile (modalità privata restrittiva): pazienza.
  }
}, 20000);

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
