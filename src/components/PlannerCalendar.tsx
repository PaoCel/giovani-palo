import { useMemo, useState, type ReactNode } from "react";

import { AppIcon } from "@/components/AppIcon";
import { AppModal } from "@/components/AppModal";
import { EmptyState } from "@/components/EmptyState";
import type { Event } from "@/types";
import { capitalize, formatDateRange } from "@/utils/formatters";

interface PlannerCalendarProps {
  events: Event[];
  loading?: boolean;
  organizationName?: string | null;
  onEventSelect: (event: Event) => void;
  toolbarAction?: ReactNode;
}

function getMonthStart(year: number, monthIndex: number) {
  return new Date(year, monthIndex, 1);
}

function getMonthEnd(year: number, monthIndex: number) {
  return new Date(year, monthIndex + 1, 0, 23, 59, 59, 999);
}

function isEventInMonth(event: Event, year: number, monthIndex: number) {
  const monthStart = getMonthStart(year, monthIndex);
  const monthEnd = getMonthEnd(year, monthIndex);
  const start = new Date(event.startDate);
  const end = new Date(event.endDate);

  return start <= monthEnd && end >= monthStart;
}

function getPlannerEventLabel(event: Event) {
  const start = new Date(event.startDate);
  const end = new Date(event.endDate);
  const sameDay = start.toDateString() === end.toDateString();

  if (sameDay) {
    return String(start.getDate()).padStart(2, "0");
  }

  if (start.getMonth() === end.getMonth() && start.getFullYear() === end.getFullYear()) {
    return `${String(start.getDate()).padStart(2, "0")}-${String(end.getDate()).padStart(2, "0")}`;
  }

  return `${String(start.getDate()).padStart(2, "0")}/${String(start.getMonth() + 1).padStart(2, "0")}`;
}

export function PlannerCalendar({
  events,
  loading = false,
  organizationName,
  onEventSelect,
  toolbarAction,
}: PlannerCalendarProps) {
  const currentYear = new Date().getFullYear();
  const [year, setYear] = useState(currentYear);
  const [selectedMonthIndex, setSelectedMonthIndex] = useState<number | null>(null);

  const plannerMonths = useMemo(
    () =>
      Array.from({ length: 12 }, (_, index) => {
        const monthDate = getMonthStart(year, index);
        const monthEvents = events
          .filter((event) => isEventInMonth(event, year, index))
          .sort((left, right) => left.startDate.localeCompare(right.startDate));

        return {
          index,
          events: monthEvents,
          monthLabel: capitalize(
            monthDate.toLocaleDateString("it-IT", { month: "long" }),
          ),
        };
      }),
    [events, year],
  );

  const selectedMonth =
    selectedMonthIndex !== null ? plannerMonths[selectedMonthIndex] ?? null : null;

  return (
    <>
      <section className="planner-shell">
        <div className={toolbarAction ? "planner-toolbar planner-toolbar--with-action" : "planner-toolbar"}>
          <button
            aria-label="Anno precedente"
            className="icon-button icon-button--soft"
            onClick={() => setYear((current) => current - 1)}
            type="button"
          >
            <AppIcon name="arrow-left" />
          </button>

          <div className="planner-toolbar__meta">
            <strong>{year}</strong>
            {organizationName ? <span>{organizationName}</span> : null}
          </div>

          {toolbarAction ? <div className="planner-toolbar__action">{toolbarAction}</div> : null}

          <button
            aria-label="Anno successivo"
            className="icon-button icon-button--soft"
            onClick={() => setYear((current) => current + 1)}
            type="button"
          >
            <AppIcon name="arrow-right" />
          </button>
        </div>

        {loading ? <p className="subtle-text">Sto preparando il planner...</p> : null}

        <div className="planner-board">
          {plannerMonths.map((month) => (
            <button
              key={`${year}-${month.index}`}
              className="planner-card"
              onClick={() => setSelectedMonthIndex(month.index)}
              type="button"
            >
              <div className="planner-card__tear" aria-hidden="true">
                {Array.from({ length: 6 }, (_, index) => (
                  <span key={`${month.monthLabel}-tear-${index}`} />
                ))}
              </div>

              <div className="planner-card__head">
                <strong className="planner-card__month">{month.monthLabel}</strong>
                <small className="planner-card__count">{month.events.length}</small>
              </div>

              <div className="planner-card__events">
                {month.events.length > 0 ? (
                  <>
                    {month.events.slice(0, 2).map((event) => (
                      <p key={`${month.monthLabel}-${event.id}`} className="planner-card__event">
                        <strong>{getPlannerEventLabel(event)}</strong>
                        <span>{event.title}</span>
                      </p>
                    ))}
                    {month.events.length > 2 ? (
                      <p className="planner-card__more">+{month.events.length - 2} altre</p>
                    ) : null}
                  </>
                ) : (
                  <p className="planner-card__empty">Spazio libero</p>
                )}
              </div>
            </button>
          ))}
        </div>
      </section>

      {selectedMonth ? (
        <AppModal
          onClose={() => setSelectedMonthIndex(null)}
          size="wide"
          subtitle="Attività del mese"
          title={`${selectedMonth.monthLabel} ${year}`}
        >
          {selectedMonth.events.length === 0 ? (
            <EmptyState
              title="Nessuna attività prevista"
              description="Questo mese è ancora libero."
            />
          ) : (
            <div className="planner-month-modal">
              {selectedMonth.events.map((event) => (
                <button
                  key={event.id}
                  className="planner-month-event"
                  onClick={() => {
                    setSelectedMonthIndex(null);
                    onEventSelect(event);
                  }}
                  type="button"
                >
                  <div className="planner-month-event__day">{getPlannerEventLabel(event)}</div>

                  <div className="planner-month-event__content">
                    <strong>{event.title}</strong>
                    <p>{formatDateRange(event.startDate, event.endDate)}</p>
                    <p>{event.location || "Luogo da definire"}</p>
                  </div>

                  <AppIcon name="arrow-right" />
                </button>
              ))}
            </div>
          )}
        </AppModal>
      ) : null}
    </>
  );
}
