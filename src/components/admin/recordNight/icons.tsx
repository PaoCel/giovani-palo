// Icone della coda "Da collegare" che AppIcon non ha. Stesso tratto di AppIcon
// (24 px, 1.75, estremi tondi): decorative, il testo del tasto dice già tutto.

const PATHS = {
  link: (
    <>
      <path d="M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1 1" />
      <path d="M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66l1-1" />
    </>
  ),
  unlink: (
    <>
      <path d="M10.5 13.5a4 4 0 0 0 5.66 0l2.4-2.4a4 4 0 0 0-5.66-5.66l-.8.8" />
      <path d="M13.5 10.5a4 4 0 0 0-5.66 0l-2.4 2.4a4 4 0 0 0 5.66 5.66l.8-.8" />
      <path d="M3.5 3.5l2 2M20.5 20.5l-2-2M8 2.75v2M2.75 8h2M16 21.25v-2M21.25 16h-2" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="6.5" />
      <path d="m16 16 4 4" />
    </>
  ),
  select: (
    <>
      <path d="M5.25 4.5h13.5a.75.75 0 0 1 .75.75v13.5a.75.75 0 0 1-.75.75H5.25a.75.75 0 0 1-.75-.75V5.25a.75.75 0 0 1 .75-.75Z" />
      <path d="m8.5 12.25 2.5 2.5 4.5-5" />
    </>
  ),
} as const;

export type RnaIconName = keyof typeof PATHS;

export function RnaIcon({ name }: { name: RnaIconName }) {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      focusable="false"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={1.75}
      viewBox="0 0 24 24"
    >
      {PATHS[name]}
    </svg>
  );
}
