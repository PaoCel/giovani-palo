import { useMemo, useState, type ReactNode } from "react";

import { AppModal } from "@/components/AppModal";
import { Button, EmptyState, Icon, Pill } from "@/components/ui";
import { ADMIN_ELENCHI as COPY } from "@/copy/adminElenchi";
import { ANNUNCIATA } from "@/copy/annunciata";
import { fillCopy } from "@/copy/parole";
import type { Event } from "@/types";
import { getMonthAriaLabel } from "@/utils/adminLists";
import { getEffectiveEventStatus, getEventStatusLabel } from "@/utils/events";
import { capitalize, formatEventWhen } from "@/utils/formatters";
import "@/styles/plannerCalendar.css";

interface PlannerCalendarProps {
  events: Event[];
  loading?: boolean;
  organizationName?: string | null;
  onEventSelect: (event: Event) => void;
  toolbarAction?: ReactNode;
  /** Admin calendar: announced activities filled, drafts dashed. */
  adminMarks?: boolean;
  /** Admin calendar: «Aggiungi in <mese>» in the month window. */
  onAddInMonth?: (year: number, monthIndex: number) => void;
}

// Sign of the admin status pill on the calendar (docs/ATTIVITA_MODULARI.md,
// «Resa con dati mancanti»): announced filled, drafts dashed.
function getAdminMark(event: Event) {
  const status = getEffectiveEventStatus(event);
  return status === "planned" || status === "draft" ? status : null;
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

// Quante attività mostra il riquadro del mese prima di «+N altre»: tre stanno
// anche a 320 px; il resto è nella finestra del mese.
const MONTH_PREVIEW = 3;

export function PlannerCalendar({
  events,
  loading = false,
  organizationName,
  onEventSelect,
  toolbarAction,
  adminMarks = false,
  onAddInMonth,
}: PlannerCalendarProps) {
  const today = new Date();
  const currentYear = today.getFullYear();
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
      <section className="cal">
        <div className="cal-toolbar">
          <button
            aria-label={COPY.annoPrecedente}
            className="cal-toolbar__nav"
            onClick={() => setYear((current) => current - 1)}
            type="button"
          >
            <Icon name="arrow-left" />
          </button>

          <div className="cal-toolbar__meta">
            <h1 className="cal-toolbar__year">
              <span className="sr-only">{COPY.calendarioTitolo} </span>
              {year}
            </h1>
            {organizationName ? <p className="cal-toolbar__org">{organizationName}</p> : null}
          </div>

          <button
            aria-label={COPY.annoSuccessivo}
            className="cal-toolbar__nav"
            onClick={() => setYear((current) => current + 1)}
            type="button"
          >
            <Icon name="arrow-right" />
          </button>

          {toolbarAction ? <div className="cal-toolbar__action">{toolbarAction}</div> : null}
        </div>

        {loading ? (
          <div aria-busy="true" className="cal-board cal-board--loading">
            <span className="sr-only" role="status">
              {COPY.calendarioCaricamento}
            </span>
            {Array.from({ length: 6 }, (_, index) => (
              <span aria-hidden="true" className="cal-month cal-month--skeleton" key={index} />
            ))}
          </div>
        ) : (
          <div className="cal-board">
            {plannerMonths.map((month) => {
              const isCurrent = year === currentYear && month.index === today.getMonth();
              const count = month.events.length;
              return (
                <button
                  key={`${year}-${month.index}`}
                  aria-label={getMonthAriaLabel(month.monthLabel, count)}
                  className={[
                    "cal-month",
                    isCurrent ? "cal-month--current" : "",
                    count === 0 ? "cal-month--empty" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  onClick={() => setSelectedMonthIndex(month.index)}
                  type="button"
                >
                  <span className="cal-month__head" aria-hidden="true">
                    <strong className="cal-month__name">{month.monthLabel}</strong>
                    {count > 0 ? <Pill tone="sand">{count}</Pill> : null}
                  </span>

                  <span className="cal-month__events" aria-hidden="true">
                    {count > 0 ? (
                      <>
                        {month.events.slice(0, MONTH_PREVIEW).map((event) => {
                          const mark = adminMarks ? getAdminMark(event) : null;
                          return (
                            <span key={`${month.monthLabel}-${event.id}`} className={mark ? `cal-month__event cal-month__event--${mark}` : "cal-month__event"}>
                              <span className="cal-day">{getPlannerEventLabel(event)}</span>
                              <span className="cal-month__title">
                                {event.title}
                                {mark ? <span className="cal-mark"> · {getEventStatusLabel(mark)}</span> : null}
                              </span>
                            </span>
                          );
                        })}
                        {count > MONTH_PREVIEW ? (
                          <span className="cal-month__more">
                            {fillCopy(COPY.altreAttivita, { n: String(count - MONTH_PREVIEW) })}
                          </span>
                        ) : null}
                      </>
                    ) : (
                      <span className="cal-month__empty">{COPY.meseLibero}</span>
                    )}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </section>

      {selectedMonth ? (
        <AppModal
          footer={onAddInMonth ? (
            <Button
              icon="plus"
              onClick={() => {
                const monthIndex = selectedMonth.index;
                setSelectedMonthIndex(null);
                onAddInMonth(year, monthIndex);
              }}
            >
              {fillCopy(ANNUNCIATA.aggiungiInMese, { mese: selectedMonth.monthLabel.toLocaleLowerCase("it-IT") })}
            </Button>
          ) : undefined}
          onClose={() => setSelectedMonthIndex(null)}
          size="wide"
          subtitle={COPY.attivitaDelMese}
          title={`${selectedMonth.monthLabel} ${year}`}
        >
          {selectedMonth.events.length === 0 ? (
            <EmptyState
              action={null}
              description={COPY.meseVuotoCorpo}
              headingAs="h3"
              title={COPY.meseVuotoTitolo}
            />
          ) : (
            <ul className="cal-list">
              {selectedMonth.events.map((event) => {
                const mark = adminMarks ? getAdminMark(event) : null;
                return (
                <li key={event.id}>
                  <button
                    className="cal-list__row"
                    onClick={() => {
                      setSelectedMonthIndex(null);
                      onEventSelect(event);
                    }}
                    type="button"
                  >
                    <span className={mark ? `cal-day cal-day--lg cal-day--${mark}` : "cal-day cal-day--lg"}>{getPlannerEventLabel(event)}</span>
                    <span className="cal-list__content">
                      <strong>{event.title}</strong>
                      {mark ? <span className="cal-list__mark">{getEventStatusLabel(mark)}</span> : null}
                      {!adminMarks && event.status === "planned" ? <span className="cal-list__mark">{ANNUNCIATA.iscrizioniABreve}</span> : null}
                      <span>{formatEventWhen(event)}</span>
                      <span>{event.location || COPY.luogoDaDefinire}</span>
                    </span>
                    <Icon name="arrow-right" className="cal-list__arrow" />
                  </button>
                </li>
                );
              })}
            </ul>
          )}
        </AppModal>
      ) : null}
    </>
  );
}
