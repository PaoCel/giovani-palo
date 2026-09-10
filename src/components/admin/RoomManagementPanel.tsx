import { useEffect, useState } from "react";
import { useBeforeUnload, useBlocker } from "react-router-dom";
import { AppModal } from "@/components/AppModal";
import { RoomPlanner } from "@/components/admin/RoomPlanner";
import { roomLayoutService } from "@/services/firestore/roomLayoutService";
import { roomManagementService } from "@/services/firestore/roomManagementService";
import { registrationsService } from "@/services/firestore/registrationsService";
import type { Registration } from "@/types";
import type { RoomLayout } from "@/utils/roomLayout";
import type { RoomPlan } from "../../../functions/lib/roomPlannerCore.mjs";

export function RoomManagementPanel({ stakeId, activityId, registrations, referenceDate }: {
  stakeId: string; activityId: string; registrations: Registration[]; referenceDate: string;
}) {
  const [plan, setPlan] = useState<RoomPlan | null>(null);
  const [layouts, setLayouts] = useState<{ layouts: RoomLayout[]; unreadable: string[] } | null>(null);
  const [currentRegistrations, setCurrentRegistrations] = useState(registrations);
  const [error, setError] = useState("");
  const [dirty, setDirty] = useState(false);
  const [reload, setReload] = useState(0);
  const [confirmReload, setConfirmReload] = useState(false);
  const blocker = useBlocker(dirty);
  useBeforeUnload((event) => { if (dirty) event.preventDefault(); });
  useEffect(() => { setCurrentRegistrations(registrations); }, [registrations]);

  useEffect(() => {
    let current = true;
    setPlan(null); setError(""); setDirty(false);
    Promise.all([
      roomManagementService.load(stakeId, activityId),
      registrationsService.listRegistrationsByEvent(stakeId, activityId, true),
      // The floor plan is optional: a failed read is reported inside the Pianta view, not here.
      roomLayoutService.list(stakeId).catch(() => null),
    ]).then(([value, people, savedLayouts]) => {
      if (current) { setPlan(value); setCurrentRegistrations(people); setLayouts(savedLayouts); }
    }).catch(() => {
      if (current) setError("Impossibile caricare la bozza delle stanze. Controlla la connessione e riprova.");
    });
    return () => { current = false; };
  }, [stakeId, activityId, reload]);

  if (error) return <div className="surface-panel"><p role="alert">{error}</p><button className="button button--secondary" onClick={() => setReload((value) => value + 1)}>Riprova</button></div>;
  if (!plan) return <div className="surface-panel" role="status">Caricamento stanze...</div>;
  return <>
    <RoomPlanner key={`${stakeId}/${activityId}/${reload}`} initialPlan={plan} registrations={currentRegistrations} referenceDate={referenceDate}
      onDirtyChange={setDirty} onReload={() => setConfirmReload(true)}
      onSave={(draft) => roomManagementService.save(stakeId, activityId, draft, draft.revision)}
      layouts={layouts?.layouts ?? []} unreadableLayouts={layouts?.unreadable ?? []} layoutsFailed={!layouts}
      onSaveLayout={(layout) => roomLayoutService.save(stakeId, layout)} />
    {blocker.state === "blocked" ? <AppModal title="Modifiche non salvate" subtitle="Uscendo perderai le modifiche alla bozza delle stanze." size="compact" onClose={() => blocker.reset()} footer={<><button className="button button--secondary" onClick={() => blocker.reset()}>Resta nella bozza</button><button className="button button--primary" onClick={() => blocker.proceed()}>Esci senza salvare</button></>}><p>Salva la bozza per ritrovarla al prossimo accesso.</p></AppModal> : null}
    {confirmReload ? <AppModal title="Ricarica la bozza condivisa" size="compact" onClose={() => setConfirmReload(false)} footer={<><button className="button button--secondary" onClick={() => setConfirmReload(false)}>Mantieni le mie modifiche</button><button className="button button--primary" onClick={() => { setConfirmReload(false); setReload((value) => value + 1); }}>Ricarica</button></>}><p>La versione salvata sostituirà le modifiche locali. Puoi prima esportarle con “Esporta bozza”.</p></AppModal> : null}
  </>;
}
