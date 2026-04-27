import { Link } from "react-router-dom";

import { PageHero } from "@/components/PageHero";

export function NotFoundPage() {
  return (
    <div className="page">
      <PageHero
        eyebrow="404"
        title="Pagina non trovata"
        description="La route richiesta non esiste nella base attuale della piattaforma."
        actions={
          <>
            <Link className="button button--primary" to="/">
              Torna alla home
            </Link>
            <Link className="button button--ghost" to="/activities">
              Vai alle attività
            </Link>
          </>
        }
      />
    </div>
  );
}
