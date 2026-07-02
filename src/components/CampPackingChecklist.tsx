import { useEffect, useMemo, useState } from "react";

import { packingChecklistService } from "@/services/firestore/packingChecklistService";
import type { Event } from "@/types";
import { buildCampPackingSections } from "@/utils/campPacking";

interface CampPackingChecklistProps {
  event: Event;
  userId: string;
}

export function CampPackingChecklist({
  event,
  userId,
}: CampPackingChecklistProps) {
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
        setChecked(
          Object.fromEntries(checkedItemIds.map((itemId) => [itemId, true])),
        );
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
  const progress =
    totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;

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
    <section className="camp-youth-screen camp-youth-screen--packing">
      <span className="camp-section-eyebrow">Preparazione campeggio</span>
      <h2 className="camp-section-title">Cosa portare nello zaino</h2>

      {syncError ? <p className="packing-sync-error">{syncError}</p> : null}

      <div className="packing-journey-card">
        <div className="packing-journey-card__top">
          <span>Il tuo cammino</span>
          <strong aria-label={`${completedCount} di ${totalCount} pronti`}>
            {completedCount}/{totalCount}
          </strong>
        </div>
        <div className="camp-trail-bar" aria-hidden="true">
          <span style={{ width: `${progress}%` }} />
        </div>
        <div className="packing-journey-card__foot">
          <span>{completedCount} cose prese</span>
          <span>{progress}% pronto</span>
        </div>
      </div>

      <div className="packing-quick-actions">
        <button
          className="camp-pill-btn camp-pill-btn--solid"
          onClick={checkAll}
          type="button"
        >
          <span aria-hidden="true">✓</span>
          Tutto pronto
        </button>
        <button className="camp-pill-btn" onClick={resetAll} type="button">
          <span aria-hidden="true">↺</span>
          Reset
        </button>
      </div>

      <div className="camp-waypoint-list">
        {sections.map((section) => (
          <article className="camp-waypoint-group" key={section.id}>
            <span className="camp-waypoint-dot" aria-hidden="true" />
            <div className="camp-cat-card">
              <div className="camp-cat-head">
                <h3>{section.title}</h3>
                <span>{section.items.length} oggetti</span>
              </div>
              <div className="packing-list">
                {section.items.map((item) => {
                  const isChecked = checked[item.id] === true;
                  return (
                    <label
                      className={
                        isChecked
                          ? "packing-item packing-item--checked"
                          : "packing-item"
                      }
                      key={item.id}
                    >
                      <input
                        checked={isChecked}
                        onChange={() => toggleItem(item.id)}
                        type="checkbox"
                      />
                      <span className="packing-item__box" aria-hidden="true" />
                      <span className="packing-item__text">{item.label}</span>
                    </label>
                  );
                })}
              </div>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
