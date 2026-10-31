/** Project-owned agenda illustration, shared by the program and its editor. */
export function ProgramAgendaMark() {
  return (
    <svg className="moments-mark" viewBox="0 0 120 120" aria-hidden="true">
      <ellipse
        cx="59"
        cy="107"
        rx="42"
        ry="7"
        fill="currentColor"
        opacity=".1"
      />
      <path
        d="M25 17q0-6 7-6h65q7 0 7 7v80q0 8-8 8H32q-7 0-7-7z"
        fill="#235d90"
      />
      <path d="M32 12h60v83H32z" fill="#fffaf2" />
      <path d="M32 95h62v8H32q-8-4 0-8" fill="#e7d6bd" />
      <path d="M75 12h10v32l-5-5-5 5z" fill="#b58a50" />
      <path
        d="M22 28h16M22 45h16M22 62h16M22 79h16"
        stroke="#b58a50"
        strokeWidth="5"
        strokeLinecap="round"
      />
      <path
        d="M47 54h29M47 66h34M47 78h21"
        stroke="#235d90"
        strokeWidth="4"
        strokeLinecap="round"
        opacity=".55"
      />
    </svg>
  );
}
