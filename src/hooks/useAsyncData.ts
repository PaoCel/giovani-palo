import { useCallback, useEffect, useState, type DependencyList } from "react";

export function useAsyncData<T>(
  loader: () => Promise<T>,
  dependencies: DependencyList,
  initialValue: T,
) {
  const [data, setData] = useState<T>(initialValue);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let active = true;

    async function run() {
      setLoading(true);
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
        if (active) {
          setLoading(false);
        }
      }
    }

    void run();

    return () => {
      active = false;
    };
  }, [...dependencies, reloadToken]);

  // Riesegue il loader mantenendo i dati correnti finché non arrivano i nuovi.
  const reload = useCallback(() => setReloadToken((token) => token + 1), []);

  return { data, loading, error, setData, reload };
}
