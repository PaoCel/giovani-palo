import { useEffect, useLayoutEffect, useState } from "react";

// Pelle "Tabellone" su tutta la finestra mentre la pagina dei record è aperta:
// la classe su <html> scurisce sfondo, barra in alto e avvisi della shell
// (regole in src/styles/recordNight.css, tutte sotto `html.rn-skin`). Si toglie
// all'uscita, così il resto dell'app resta com'è.
export function useRecordNightSkin() {
  useLayoutEffect(() => {
    const root = document.documentElement;
    const themeMeta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    const previousTheme = themeMeta?.getAttribute("content") ?? null;

    root.classList.add("rn-skin");
    themeMeta?.setAttribute("content", "#0b0d12");

    return () => {
      root.classList.remove("rn-skin");
      if (themeMeta && previousTheme !== null) {
        themeMeta.setAttribute("content", previousTheme);
      }
    };
  }, []);
}

// Ora corrente che avanza allo scoccare di ogni minuto: basta per il conto alla
// rovescia (giorni/ore/minuti) e per chiudere la pagina all'ora di chiusura.
export function useMinuteClock() {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    let interval: ReturnType<typeof setInterval> | null = null;
    const untilNextMinute = 60_000 - (Date.now() % 60_000) + 50;
    const timeout = setTimeout(() => {
      setNow(new Date());
      interval = setInterval(() => setNow(new Date()), 60_000);
    }, untilNextMinute);

    // Tornando sulla scheda dopo ore il timer del browser può essere rimasto
    // indietro: si riallinea subito.
    function handleVisibility() {
      if (document.visibilityState === "visible") setNow(new Date());
    }
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      clearTimeout(timeout);
      if (interval) clearInterval(interval);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, []);

  return now;
}
