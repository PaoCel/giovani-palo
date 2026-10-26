import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { StakePeoplePanel } from "/src/components/membership/StakePeoplePanel";
import { stakeMembersService } from "/src/services/firestore/stakeMembersService";
import type { StakeMember, StakeMemberPrevious } from "/src/utils/stakeMembership";
import "/src/styles/base.css";

// Fixture isolata: nessuna lettura o scrittura Firebase. Il componente, i suoi
// hook e i criteri per mostrare le azioni sono quelli reali del progetto.
const scenario = new URLSearchParams(location.search).get("scenario") || "scope";
const viewerUid = "qa-dirigente";
const calls: { kind: string; stakeId: string; uid: string }[] = [];
const attempts = new Map<string, number>();
let panelMounts = 0;
let releaseFirstStake: (() => void) | undefined;
let firstStakeReleased = false;

const previous = (by = viewerUid): StakeMemberPrevious => ({ action: "decline", by, status: "pending", claimedUnitId: "qa-unit" });
const member = (stakeId: string, uid = "qa-stesso-uid"): StakeMember => ({
  stakeId,
  uid,
  version: 7,
  status: "declined",
  staffRole: null,
  claimedUnitId: "qa-unit",
  claimedUnitName: "Unità QA",
  displayName: uid === "qa-successo" ? "Lettura riuscita" : `Persona ${stakeId}`,
  birthYear: 2009,
  registrationHints: [],
  reviewNeeded: false,
  requestedAtMs: Date.now() - 60_000,
  decidedAtMs: Date.now() - 30_000,
  decidedBy: viewerUid,
  declineCount: 1,
  sourceKinds: [],
  previous: scenario === "legacy" ? previous() : null,
});

stakeMembersService.subscribeQueue = (stakeId, kind, _unitId, onNext) => {
  const rows = kind !== "declined" ? [] : scenario === "retry"
    ? [member(stakeId, "qa-successo"), member(stakeId, "qa-primo-errore")]
    : [member(stakeId)];
  onNext(rows);
  return () => undefined;
};
stakeMembersService.getStaffNoteKind = async (stakeId, uid) => {
  calls.push({ kind: "note", stakeId, uid });
  return null;
};
stakeMembersService.getStaffPrevious = async (stakeId, uid) => {
  calls.push({ kind: "previous", stakeId, uid });
  const key = `${stakeId}:${uid}`;
  const attempt = (attempts.get(key) || 0) + 1;
  attempts.set(key, attempt);
  if (scenario === "retry" && uid === "qa-primo-errore" && attempt === 1) {
    throw new Error("Errore temporaneo sintetico");
  }
  if (scenario === "late" && stakeId === "qa-palo-a" && !firstStakeReleased) {
    await new Promise<void>((resolve) => {
      releaseFirstStake = () => {
        firstStakeReleased = true;
        resolve();
      };
    });
  }
  if (scenario === "absent" || scenario === "legacy") return null;
  return previous(stakeId === "qa-palo-a" ? viewerUid : "qa-altro-dirigente");
};
stakeMembersService.run = async () => {
  throw new Error("La QA dei dettagli non deve eseguire azioni");
};

Object.assign(window, {
  __qaDetails: { calls, getMounts: () => panelMounts, releaseFirstStake: () => releaseFirstStake?.() },
});

function PanelWithMountCounter({ stakeId }: { stakeId: string }) {
  useEffect(() => {
    panelMounts += 1;
  }, []);
  return <StakePeoplePanel stakeId={stakeId} unitId="qa-unit" isAdmin={false} viewerUid={viewerUid} />;
}

function Fixture() {
  const [stakeId, setStakeId] = useState("qa-palo-a");
  return (
    <main style={{ maxWidth: 650, margin: "24px auto", padding: 16 }}>
      <div>
        <button id="qa-stake-a" onClick={() => setStakeId("qa-palo-a")}>Palo A</button>
        <button id="qa-stake-b" onClick={() => setStakeId("qa-palo-b")}>Palo B</button>
        <output id="qa-current-stake">{stakeId}</output>
      </div>
      <PanelWithMountCounter stakeId={stakeId} />
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<BrowserRouter><Fixture /></BrowserRouter>);
