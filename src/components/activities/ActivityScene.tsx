import { useId } from "react";

// Paesaggio disegnato al posto della foto quando l'attività non ne ha una
// (card del catalogo e dettaglio pubblico). Stessi colori della scheda giovane.
export function ActivityScene({ className }: { className: string }) {
  const skyId = `${useId()}-sky`;

  return (
    <svg aria-hidden="true" className={className} preserveAspectRatio="xMidYMax slice" viewBox="0 0 400 225">
      <defs>
        <linearGradient id={skyId} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="#9fb8cf" />
          <stop offset="0.62" stopColor="#e9d3ae" />
          <stop offset="1" stopColor="#f3dfbd" />
        </linearGradient>
      </defs>
      <rect fill={`url(#${skyId})`} height="225" width="400" />
      <circle cx="300" cy="78" fill="#f6c77d" opacity="0.9" r="30" />
      <path d="M0 165 C70 137 130 147 200 159 C270 171 330 147 400 155 V225 H0Z" fill="#7f9bb4" />
      <path d="M0 189 C90 171 160 185 240 193 C310 200 360 187 400 183 V225 H0Z" fill="#1b3f67" />
    </svg>
  );
}
