import type { ReactNode } from "react";
import { Link, useLocation, useParams } from "react-router-dom";

import { AppIcon } from "@/components/AppIcon";
import { RecordNightAdminTab } from "@/components/admin/recordNight/RecordNightAdminTab";
import { DEFAULT_STAKE_ID } from "@/config/app";
import { useAsyncData } from "@/hooks/useAsyncData";
import { useAuth } from "@/hooks/useAuth";
import { eventsService } from "@/services/firestore/eventsService";
import { recordNightService } from "@/services/firestore/recordNightService";
import type { Event } from "@/types";
import { getActivityPath, getRecordNightPath } from "@/utils/activityLinks";
import { isPermissionDenied } from "@/utils/recordNight";

interface ManageData {
  // false finché non c'è stata una lettura vera: evita di mostrare "non trovata"
  // per un attimo mentre parte l'autenticazione.
  loaded: boolean;
  event: Event | null;
  isStaff: boolean;
  // Solo gli admin del palo scelgono chi altro gestisce le proposte.
  canManageStaff: boolean;
}

const initialData: ManageData = { loaded: false, event: null, isStaff: false, canManageStaff: false };

// Gestione della Notte dei Record per chi organizza la serata, dal telefono:
// admin del palo, dirigenti di unità e gli adulti scelti a mano da un admin.
// Chi può entrare lo decide il server (`getContext`): la
// pagina non lo deduce dal ruolo. Pelle chiara dell'app, la stessa della
// scheda "Record" del pannello admin.
export function RecordNightManagePage() {
  const { eventId = "" } = useParams();
  const location = useLocation();
  const { session, loading: authLoading } = useAuth();
  const uid =
    session?.isAuthenticated && !session.isAnonymous ? session.firebaseUser.uid : null;
  const stakeId = session?.profile.stakeId ?? DEFAULT_STAKE_ID;
  const loginPath = `/login?redirect=${encodeURIComponent(`${location.pathname}${location.search}`)}`;

  const { data, loading, error, reload } = useAsyncData<ManageData>(
    async () => {
      if (authLoading) return initialData;
      if (!uid || !eventId) {
        return { loaded: true, event: null, isStaff: false, canManageStaff: false };
      }

      // Lettura autenticata: un'attività non pubblica la vede solo chi ha i
      // permessi, per gli altri è come se non esistesse.
      const event = await eventsService.getEventById(stakeId, eventId).catch((caught) => {
        if (isPermissionDenied(caught)) return null;
        throw caught;
      });
      if (!event || event.recordsEnabled !== true) {
        return { loaded: true, event, isStaff: false, canManageStaff: false };
      }

      try {
        const context = await recordNightService.getContext(stakeId, eventId);
        return {
          loaded: true,
          event,
          isStaff: context.isStaff === true,
          canManageStaff: context.canManageStaff === true,
        };
      } catch (caught) {
        if (isPermissionDenied(caught)) {
          return { loaded: true, event, isStaff: false, canManageStaff: false };
        }
        throw caught;
      }
    },
    [eventId, stakeId, uid, authLoading],
    initialData,
  );

  const { event, isStaff, canManageStaff } = data;

  function renderState(title: string, text: string, action: ReactNode) {
    return (
      <div className="page page--rna-wide rna-manage">
        <section className="rna-state">
          <h1>{title}</h1>
          <p>{text}</p>
          <div className="rna-state__action">{action}</div>
        </section>
      </div>
    );
  }

  if (authLoading || (uid && (!data.loaded || (loading && !event)) && !error)) {
    return (
      <div className="page page--rna-wide rna-manage">
        <p className="rna-loading" role="status">
          Sto caricando la pagina...
        </p>
      </div>
    );
  }

  if (!uid) {
    return renderState(
      "Accedi per gestire i record",
      "Dopo l'accesso torni a questa pagina.",
      <Link className="button button--primary" to={loginPath}>
        <AppIcon name="user" />
        <span>Accedi</span>
      </Link>,
    );
  }

  if (error) {
    return renderState(
      "Caricamento non riuscito",
      "Non riesco a caricare la pagina. Controlla la connessione e riprova.",
      <button className="button button--primary" onClick={reload} type="button">
        Riprova
      </button>,
    );
  }

  if (!event) {
    return renderState(
      "Attività non trovata",
      "L'attività richiesta non esiste oppure non puoi vederla.",
      <Link className="button button--primary" to="/activities">
        Torna alle attività
      </Link>,
    );
  }

  if (event.recordsEnabled !== true) {
    return renderState(
      "Non è in programma",
      "Per questa attività la Notte dei Record non è attiva.",
      <Link className="button button--primary" to={getActivityPath(event.id, stakeId)}>
        Vai all'attività
      </Link>,
    );
  }

  const recordsPath = getRecordNightPath(event.id, stakeId);

  if (!isStaff) {
    return renderState(
      "Questa pagina è per chi organizza la serata.",
      "Qui si controllano le proposte dei ragazzi. L'elenco dei record lo trovi nella pagina dei record.",
      <Link className="button button--primary" to={recordsPath}>
        Vai ai record
      </Link>,
    );
  }

  return (
    <div className="page page--rna-wide rna-manage">
      <header className="rna-manage__head">
        <Link className="rna-back" to={recordsPath}>
          <AppIcon name="arrow-left" />
          <span>Torna ai record</span>
        </Link>
        <p className="rna-manage__eyebrow">{event.title}</p>
        <h1>Gestisci la Notte dei Record</h1>
      </header>

      <RecordNightAdminTab
        canManageStaff={canManageStaff}
        event={event}
        hideTitle
        stakeId={stakeId}
      />
    </div>
  );
}

export default RecordNightManagePage;
