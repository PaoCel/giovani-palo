import { useEffect, useMemo, useState } from "react";

import { AppIcon } from "@/components/AppIcon";
import type { Event } from "@/types";
import { buildCampPackingSections } from "@/utils/campPacking";

interface CampPackingChecklistProps {
  event: Event;
  userId: string;
}

function getStorageKey(eventId: string, userId: string) {
  return `camp-packing:${userId}:${eventId}`;
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
  const storageKey = getStorageKey(event.id, userId);
  const [checked, setChecked] = useState<Record<string, boolean>>({});

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(storageKey);
      setChecked(raw ? JSON.parse(raw) : {});
    } catch {
      setChecked({});
    }
  }, [storageKey]);

  useEffect(() => {
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(checked));
    } catch {
      // localStorage puo' essere non disponibile in modalita' privacy.
    }
  }, [checked, storageKey]);

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
          <p>
            Spunta quello che hai già preparato. La lista resta salvata su questo dispositivo.
          </p>
        </div>
        <div className="packing-progress" aria-label={`${progress}% completato`}>
          <strong>{completedCount}/{totalCount}</strong>
          <span>{progress}%</span>
        </div>
      </div>

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
