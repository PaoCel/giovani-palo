export function AppLoader({ label = "Caricamento in corso..." }: { label?: string }) {
  return (
    <div className="loader-panel">
      <div className="loader-spinner" />
      <p>{label}</p>
    </div>
  );
}
