import "@/styles/adminPages.css";

// Caricamento degli elenchi admin: righe grigie, mai «vuoto» mentre i dati
// arrivano. Il testo è per i lettori di schermo.
export function AdminListSkeleton({ label, rows = 3 }: { label: string; rows?: number }) {
  return (
    <div aria-busy="true" className="admin-skeleton">
      <span className="sr-only" role="status">
        {label}
      </span>
      {Array.from({ length: rows }, (_, index) => (
        <span aria-hidden="true" className="admin-skeleton__row" key={index} />
      ))}
    </div>
  );
}
