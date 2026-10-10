import type { RecordNightCategory, RecordNightMeasure } from "@/types";

// Icone della Notte dei Record: tratti a 24px, stessi disegni del mockup
// approvato (.claude/mockups/notte-dei-record/06-tabellone.html), più quelle
// per le categorie e le misure che il mockup non mostrava.
const PATHS = {
  back: <path d="M15.75 19.5 8.25 12l7.5-7.5" />,
  arrow: <path d="M4.5 12h15m-5.25-5.25L19.5 12l-5.25 5.25" />,
  clock: (
    <>
      <circle cx="12" cy="12" r="8.25" />
      <path d="M12 7.5V12l3 1.75" />
    </>
  ),
  timer: (
    <>
      <circle cx="12" cy="13.5" r="7.25" />
      <path d="M12 13.5V9.75M9.75 3h4.5M12 3v3M18.25 7.25l1.25-1.25" />
    </>
  ),
  check: <path d="m5.25 12.75 4.5 4.5 9-9" />,
  lock: (
    <>
      <path d="M7.5 10.5V8.25a4.5 4.5 0 1 1 9 0v2.25" />
      <path d="M6.75 10.5h10.5a.75.75 0 0 1 .75.75V18a.75.75 0 0 1-.75.75H6.75A.75.75 0 0 1 6 18v-6.75a.75.75 0 0 1 .75-.75Z" />
    </>
  ),
  pencil: (
    <>
      <path d="M4.5 19.5 8.25 18l9-9a1.59 1.59 0 0 0 0-2.25l-1-1a1.59 1.59 0 0 0-2.25 0l-9 9L4.5 19.5Z" />
      <path d="M13.5 6.75 17.25 10.5" />
    </>
  ),
  x: <path d="M6.75 6.75l10.5 10.5M17.25 6.75 6.75 17.25" />,
  out: (
    <>
      <path d="M15.75 8.25V6a1.5 1.5 0 0 0-1.5-1.5H6A1.5 1.5 0 0 0 4.5 6v12A1.5 1.5 0 0 0 6 19.5h8.25a1.5 1.5 0 0 0 1.5-1.5v-2.25" />
      <path d="M10.5 12h9" />
      <path d="m16.5 8.25 3.75 3.75-3.75 3.75" />
    </>
  ),
  "eye-off": (
    <>
      <path d="M3 3l18 18" />
      <path d="M10.6 5.35A9.9 9.9 0 0 1 12 5.25c6 0 9.75 6.75 9.75 6.75a17 17 0 0 1-2.9 3.7M6.6 6.6C3.9 8.4 2.25 12 2.25 12S6 18.75 12 18.75c1.7 0 3.2-.5 4.5-1.25" />
      <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
    </>
  ),
  bag: (
    <>
      <path d="M5.25 8.25h13.5l-1 11.25H6.25l-1-11.25Z" />
      <path d="M9 8.25V6.75a3 3 0 0 1 6 0v1.5" />
    </>
  ),
  plus: <path d="M12 5.25v13.5M5.25 12h13.5" />,
  list: (
    <>
      <path d="M9 4.5h6a.75.75 0 0 1 .75.75v1.5a.75.75 0 0 1-.75.75H9a.75.75 0 0 1-.75-.75v-1.5A.75.75 0 0 1 9 4.5Z" />
      <path d="M15.75 5.25h1.5a1.5 1.5 0 0 1 1.5 1.5V18.75a1.5 1.5 0 0 1-1.5 1.5H6.75a1.5 1.5 0 0 1-1.5-1.5V6.75a1.5 1.5 0 0 1 1.5-1.5h1.5" />
      <path d="m8.25 13.5 2.25 2.25 4.5-4.5" />
    </>
  ),
  undo: (
    <>
      <path d="M9 14.25 4.5 9.75 9 5.25" />
      <path d="M4.5 9.75h10.125a4.875 4.875 0 0 1 0 9.75H12" />
    </>
  ),
  user: (
    <>
      <path d="M15.75 6.75a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0Z" />
      <path d="M4.5 19.5a7.5 7.5 0 0 1 15 0" />
    </>
  ),
  ticket: (
    <>
      <path d="M3.75 7.5a1.5 1.5 0 0 1 1.5-1.5h13.5a1.5 1.5 0 0 1 1.5 1.5v2.25a2.25 2.25 0 0 0 0 4.5v2.25a1.5 1.5 0 0 1-1.5 1.5H5.25a1.5 1.5 0 0 1-1.5-1.5v-2.25a2.25 2.25 0 0 0 0-4.5Z" />
      <path d="M14.25 6v12" strokeDasharray="1.5 2" />
    </>
  ),
  alert: (
    <>
      <circle cx="12" cy="12" r="8.25" />
      <path d="M12 8.25v4.5M12 15.75h.008" />
    </>
  ),
  // Richiesta senza account collegata a un'iscrizione.
  link: (
    <>
      <path d="M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1 1" />
      <path d="M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66l1-1" />
    </>
  ),
  // Misure
  repeat: (
    <>
      <path d="M4.5 12a6 6 0 0 1 10.24-4.24L17.25 10.5" />
      <path d="M17.25 6v4.5h-4.5" />
      <path d="M19.5 12a6 6 0 0 1-10.24 4.24L6.75 13.5" />
      <path d="M6.75 18v-4.5h4.5" />
    </>
  ),
  hourglass: (
    <>
      <path d="M6.75 3.75h10.5M6.75 20.25h10.5" />
      <path d="M7.5 3.75c0 4.5 4.5 5.25 4.5 8.25s-4.5 3.75-4.5 8.25M16.5 3.75c0 4.5-4.5 5.25-4.5 8.25s4.5 3.75 4.5 8.25" />
    </>
  ),
  ruler: (
    <>
      <path d="M3.75 15.75 15.75 3.75l4.5 4.5-12 12Z" />
      <path d="m7.5 12 1.5 1.5M10.5 9l1.5 1.5M13.5 6 15 7.5" />
    </>
  ),
  dots: <path d="M6 12h.01M12 12h.01M18 12h.01" />,
  // Categorie
  dumbbell: <path d="M6.75 7.5v9M17.25 7.5v9M3.75 9.75v4.5M20.25 9.75v4.5M6.75 12h10.5" />,
  bolt: <path d="M13.5 3 5.25 13.5H12L10.5 21l8.25-10.5H12L13.5 3Z" />,
  target: (
    <>
      <circle cx="12" cy="12" r="8.25" />
      <circle cx="12" cy="12" r="4.5" />
      <circle cx="12" cy="12" r="0.9" />
    </>
  ),
  balance: (
    <>
      <path d="M12 4.5v15M8.25 19.5h7.5M5.25 7.5h13.5" />
      <path d="M5.25 7.5 2.75 13.5c.6 1.1 1.5 1.6 2.5 1.6s1.9-.5 2.5-1.6L5.25 7.5ZM18.75 7.5l-2.5 6c.6 1.1 1.5 1.6 2.5 1.6s1.9-.5 2.5-1.6l-2.5-6Z" />
    </>
  ),
  mind: (
    <>
      <path d="M9.25 18h5.5M10.25 21h3.5" />
      <path d="M12 3a6 6 0 0 0-3.6 10.8c.65.5 1.1 1.25 1.1 2.1V16h5v-.1c0-.85.45-1.6 1.1-2.1A6 6 0 0 0 12 3Z" />
    </>
  ),
  sparkle: (
    <>
      <path d="M10.5 3.75 12 9l5.25 1.5L12 12l-1.5 5.25L9 12 3.75 10.5 9 9l1.5-5.25Z" />
      <path d="M18 14.25v4.5M15.75 16.5h4.5" />
    </>
  ),
} as const;

export type RecordNightIconName = keyof typeof PATHS;

interface RecordNightIconProps {
  name: RecordNightIconName;
  className?: string;
}

export function RecordNightIcon({ name, className }: RecordNightIconProps) {
  return (
    <svg
      aria-hidden="true"
      className={className ? `rn-ico ${className}` : "rn-ico"}
      focusable="false"
      viewBox="0 0 24 24"
    >
      {PATHS[name]}
    </svg>
  );
}

export const CATEGORY_ICONS: Record<RecordNightCategory, RecordNightIconName> = {
  resistenza: "dumbbell",
  velocita: "bolt",
  precisione: "target",
  equilibrio: "balance",
  mente: "mind",
  fantasia: "sparkle",
};

export const MEASURE_ICONS: Record<RecordNightMeasure, RecordNightIconName> = {
  count_in_time: "timer",
  count_streak: "repeat",
  longest_time: "hourglass",
  fastest_time: "timer",
  distance: "ruler",
  other: "dots",
};
