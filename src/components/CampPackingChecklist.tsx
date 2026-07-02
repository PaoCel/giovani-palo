import { useEffect, useMemo, useState } from "react";

import { AppIcon } from "@/components/AppIcon";
import { packingChecklistService } from "@/services/firestore/packingChecklistService";
import type { Event } from "@/types";
import { buildCampPackingSections } from "@/utils/campPacking";

interface CampPackingChecklistProps {
  event: Event;
  userId: string;
}

export function CampPackingChecklist({ event, userId }: CampPackingChecklistProps) {
  const sections = useMemo(
    () => buildCampPackingSections(event.whatToBring),
    [event.whatToBring],
  );
  const allItems = useMemo(
    () => sections.flatMap((section) => section.items.map((item) => item.id)),
    [sections],
  );
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [loaded, setLoaded] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    setLoaded(false);
    setSyncError(null);
    packingChecklistService
      .getCheckedItemIds(event.stakeId, event.id, userId)
      .then((checkedItemIds) => {
        if (!active) return;
        setChecked(Object.fromEntries(checkedItemIds.map((itemId) => [itemId, true])));
        setLoaded(true);
      })
      .catch((caughtError) => {
        if (!active) return;
        setChecked({});
        setLoaded(true);
        setSyncError(
          caughtError instanceof Error
            ? caughtError.message
            : "Impossibile caricare la checklist.",
        );
      });

    return () => {
      active = false;
    };
  }, [event.id, event.stakeId, userId]);

  useEffect(() => {
    if (!loaded) {
      return;
    }

    const checkedItemIds = allItems.filter((itemId) => checked[itemId]);
    const timeoutId = window.setTimeout(() => {
      packingChecklistService
        .saveCheckedItemIds(event.stakeId, event.id, userId, checkedItemIds)
        .then(() => setSyncError(null))
        .catch((caughtError) => {
          setSyncError(
            caughtError instanceof Error
              ? caughtError.message
              : "Impossibile salvare la checklist.",
          );
        });
    }, 250);

    return () => window.clearTimeout(timeoutId);
  }, [allItems, checked, event.id, event.stakeId, loaded, userId]);

  const completedCount = allItems.filter((itemId) => checked[itemId]).length;
  const totalCount = allItems.length;
  const progress = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;

  function toggleItem(itemId: string) {
    setChecked((current) => ({
      ...current,
      [itemId]: !current[itemId],
    }));
  }

  function checkAll() {
    setChecked(Object.fromEntries(allItems.map((itemId) => [itemId, true])));
  }

  function resetAll() {
    setChecked({});
  }

  return (
    <section className="card packing-card">
      <div className="packing-card__head">
        <div>
          <span className="packing-card__eyebrow">Preparazione campeggio</span>
          <h2>Cose da portare</h2>
        </div>
        <div className="packing-progress-set">
          <div className="packing-progress" aria-label={`${completedCount} di ${totalCount} pronti`}>
            <strong>{completedCount}/{totalCount}</strong>
            <span>prese</span>
          </div>
          <div className="packing-progress packing-progress--percent" aria-label={`${progress}% completato`}>
            <strong>{progress}%</strong>
            <span>completo</span>
          </div>
        </div>
      </div>

      {syncError ? <p className="packing-sync-error">{syncError}</p> : null}

      <div className="packing-progress-bar" aria-hidden="true">
        <span style={{ width: `${progress}%` }} />
      </div>

      <div className="packing-card__actions">
        <button className="button button--soft button--small" onClick={checkAll} type="button">
          <AppIcon name="check" />
          <span>Tutto pronto</span>
        </button>
        <button className="button button--ghost button--small" onClick={resetAll} type="button">
          <AppIcon name="refresh" />
          <span>Reset</span>
        </button>
      </div>

      <div className="packing-section-grid">
        {sections.map((section) => (
          <article className="packing-section" key={section.id}>
            <h3>{section.title}</h3>
            <div className="packing-list">
              {section.items.map((item) => {
                const isChecked = checked[item.id] === true;
                return (
                  <label
                    className={isChecked ? "packing-item packing-item--checked" : "packing-item"}
                    key={item.id}
                  >
                    <input
                      checked={isChecked}
                      onChange={() => toggleItem(item.id)}
                      type="checkbox"
                    />
                    <span className="packing-item__box" aria-hidden="true">
                      {isChecked ? <AppIcon name="check" /> : null}
                    </span>
                    <span>{item.label}</span>
                  </label>
                );
              })}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
