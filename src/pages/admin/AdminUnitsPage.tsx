import { useState } from "react";

import { EmptyState } from "@/components/EmptyState";
import { PageHero } from "@/components/PageHero";
import { SectionCard } from "@/components/SectionCard";
import { useAuth } from "@/hooks/useAuth";
import { useAsyncData } from "@/hooks/useAsyncData";
import { unitsService } from "@/services/firestore/unitsService";

export function AdminUnitsPage() {
  const { session } = useAuth();
  const stakeId = session?.profile.stakeId ?? "roma-est";
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const { data: units, loading } = useAsyncData(
    () => unitsService.listUnits(stakeId, { includeInactive: true }),
    [stakeId, refreshKey],
    [],
  );

  async function handleAddUnit() {
    if (!draft.trim()) {
      return;
    }

    setBusy(true);
    setError(null);

    try {
      await unitsService.createOrUpdateUnit(stakeId, { name: draft });
      setDraft("");
      setRefreshKey((current) => current + 1);
    } catch (caughtError) {
      setError(
        caughtError instanceof Error ? caughtError.message : "Impossibile salvare l'unità.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function handleToggleUnit(unitId: string, isActive: boolean) {
    setBusy(true);
    setError(null);

    try {
      if (isActive) {
        await unitsService.deactivateUnit(stakeId, unitId);
      } else {
        const unit = units.find((item) => item.id === unitId);

        if (unit) {
          await unitsService.createOrUpdateUnit(stakeId, {
            id: unit.id,
            name: unit.name,
            type: unit.type,
          });
        }
      }

      setRefreshKey((current) => current + 1);
    } catch (caughtError) {
      setError(
        caughtError instanceof Error ? caughtError.message : "Impossibile aggiornare l'unità.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page">
      <PageHero
        eyebrow="Unità"
        title="Gestione rioni e rami."
        description="Questa lista alimenta registrazioni, profili e report del palo."
      />

      <SectionCard title="Nuova unità" description="Aggiungi una voce riusabile in tutta l'app.">
        {error ? <div className="form-error">{error}</div> : null}
        <div className="inline-actions">
          <input
            className="input"
            value={draft}
            onChange={(eventInput) => setDraft(eventInput.target.value)}
            placeholder="Nome unità"
          />
          <button className="button button--primary" disabled={busy} onClick={() => void handleAddUnit()} type="button">
            Aggiungi
          </button>
        </div>
      </SectionCard>

      <SectionCard title="Unità configurate" description="Attiva o disattiva senza perdere la cronologia.">
        {loading ? (
          <p className="subtle-text">Sto caricando le unità...</p>
        ) : units.length === 0 ? (
          <EmptyState
            title="Nessuna unità configurata"
            description="Aggiungi almeno una unità per rendere completi profili e iscrizioni."
          />
        ) : (
          <div className="stack">
            {units.map((unit) => (
              <article key={unit.id} className="surface-panel surface-panel--subtle">
                <div className="section-head">
                  <div>
                    <h3>{unit.name}</h3>
                    <p>{unit.type === "ramo" ? "Ramo" : "Rione"}</p>
                  </div>
                  <span className="surface-chip">{unit.isActive ? "Attiva" : "Disattivata"}</span>
                </div>
                <button
                  className="button button--ghost button--small"
                  disabled={busy}
                  onClick={() => void handleToggleUnit(unit.id, unit.isActive)}
                  type="button"
                >
                  {unit.isActive ? "Disattiva" : "Riattiva"}
                </button>
              </article>
            ))}
          </div>
        )}
      </SectionCard>
    </div>
  );
}
