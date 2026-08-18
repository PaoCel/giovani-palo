import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type DependencyList,
} from "react";

import { onCacheRevalidated } from "@/services/firestore/cacheFirst";

export function useAsyncData<T>(
  loader: () => Promise<T>,
  dependencies: DependencyList,
  initialValue: T,
) {
  const [data, setData] = useState<T>(initialValue);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const [revalidationToken, setRevalidationToken] = useState(0);
  // Le riletture innescate dalla revalidazione cache-first sono silenziose:
  // niente skeleton, i dati correnti restano a schermo finché non arrivano
  // quelli nuovi.
  const silentRunRef = useRef(false);

  useEffect(() => {
    let active = true;
    const silent = silentRunRef.current;
    silentRunRef.current = false;

    async function run() {
      if (!silent) {
        setLoading(true);
      }
      setError(null);

      try {
        const result = await loader();

        if (active) {
          setData(result);
        }
      } catch (caughtError) {
        if (active) {
          setError(
            caughtError instanceof Error
              ? caughtError.message
              : "Errore inatteso durante il caricamento.",
          );
        }
      } finally {
        if (active && !silent) {
          setLoading(false);
        }
      }
    }

    void run();

    return () => {
      active = false;
    };
  }, [...dependencies, reloadToken, revalidationToken]);

  // La lettura cache-first dipinge dati potenzialmente vecchi di una visita:
  // quando il refresh in background scopre dati diversi sul server, il loader
  // viene rieseguito e la schermata si allinea da sola.
  useEffect(
    () =>
      onCacheRevalidated(() => {
        silentRunRef.current = true;
        setRevalidationToken((token) => token + 1);
      }),
    [],
  );

  // Riesegue il loader mantenendo i dati correnti finché non arrivano i nuovi.
  const reload = useCallback(() => setReloadToken((token) => token + 1), []);

  return { data, loading, error, setData, reload };
}
