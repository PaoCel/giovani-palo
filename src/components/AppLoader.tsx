export function AppLoader({ label = "Caricamento in corso..." }: { label?: string }) {
  return (
    <div className="app-loader" role="status" aria-live="polite">
      <div className="app-loader__mark">
        <span className="app-loader__ring" aria-hidden="true" />
        <img
          className="app-loader__logo"
          src="/brand-logo.png"
          alt=""
          width={64}
          height={64}
        />
      </div>
      <p className="app-loader__label">{label}</p>
      <span className="app-loader__bar" aria-hidden="true">
        <span className="app-loader__bar-fill" />
      </span>
    </div>
  );
}
