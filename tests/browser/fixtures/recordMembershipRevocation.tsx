import React from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { AuthContext } from "/src/app/providers/AuthProvider";
import { RecordNightPage } from "/src/pages/public/RecordNightPage";
import { stakeMembersService } from "/src/services/firestore/stakeMembersService";
import { stakesService } from "/src/services/firestore/stakesService";
import { eventsService } from "/src/services/firestore/eventsService";
import { recordNightService } from "/src/services/firestore/recordNightService";
import "/src/styles/base.css";

// Component, auth consumer and membership subscription hook are real. The
// controlled services reproduce revocation and delayed replies without Firebase.
const scenario = new URLSearchParams(location.search).get("scenario") || "sheet";
const family = scenario === "family";
const uid = "qa-record-owner";
const stakeId = "qa-record-stake";
let status = "active";
let withdrawn = false;
let notify: ((value: unknown, fromServer: boolean) => void) | undefined;
let releaseOld: (() => void) | undefined;
const calls: { kind: string; uid?: string }[] = [];
const record = { id: "qa-protected-record", title: "Record riservato sentinella", status: "open", featured: true,
  challengerCount: 1, category: "fantasia", measure: "count_streak", needs: "", notes: "", createdAt: new Date().toISOString() };
const entry = { id: "qa-owned-entry", ownerUid: uid, registrationId: family ? "child_qa" : `user_${uid}`,
  recordId: null, kind: "proposal", status: "pending", proposedText: "Tentativo personale sentinella", text: "Tentativo personale sentinella",
  proposedMeasure: "count_streak", proposedNeeds: "", createdAt: new Date().toISOString() };
const member = () => ({ uid, stakeId, status, staffRole: null, version: 1, claimedUnitId: "qa-unit", sourceKinds: [] });
stakeMembersService.subscribeOwn = (_stake, _uid, callback) => {
  notify = callback;
  callback(member() as never, true);
  return () => { notify = undefined; };
};
stakesService.getStakeById = async () => ({ id: stakeId, isActive: true, name: "Palo QA" }) as never;
const event = { id: "qa-event", stakeId, title: "Attività QA", isPublic: true, isVisible: true,
  recordsEnabled: true, recordsCloseAt: new Date(Date.now() + 86400000).toISOString(),
  startDate: new Date(Date.now() + 172800000).toISOString(), endDate: new Date(Date.now() + 259200000).toISOString(),
  activityType: "standard", status: "registrations_open", location: "Sede QA" };
eventsService.getEventById = async () => event as never;
eventsService.getPublicEventById = async () => event as never;
recordNightService.listRecords = async () => {
  calls.push({ kind: "listRecords" });
  if (scenario === "late" && !releaseOld) await new Promise<void>(resolve => { releaseOld = resolve; });
  return [record] as never;
};
recordNightService.listOwnEntries = async (_stake, _event, owner) => {
  calls.push({ kind: "ownEntries", uid: owner });
  if (scenario === "failed-own-read" && status !== "active") throw Object.assign(new Error("Errore sintetico"), { code: "unavailable" });
  return [{ ...entry, status: withdrawn ? "withdrawn" : "pending" }] as never;
};
recordNightService.getContext = async () => ({
  people: [{ registrationId: entry.registrationId, displayName: family ? "Figlio QA" : "Persona QA", isSelf: !family }],
  isStaff: false, canManageStaff: false,
});
recordNightService.withdraw = async () => { calls.push({ kind: "withdraw" }); withdrawn = true; return {} as never; };
recordNightService.restore = async () => { calls.push({ kind: "restore" }); withdrawn = false; return {} as never; };
recordNightService.edit = async (_stake, _event, entryId, input) => {
  calls.push({ kind: "edit", uid: entryId });
  entry.proposedText = input.text;
  return {} as never;
};
recordNightService.propose = async () => { calls.push({ kind: "propose" }); return {} as never; };
recordNightService.challenge = async () => { calls.push({ kind: "challenge" }); return {} as never; };

Object.assign(window, { __qaRecord: {
  calls,
  revoke: () => { status = "removed"; notify?.(member(), true); },
  releaseOld: () => releaseOld?.(),
} });
const value = { session: { isAuthenticated: true, isAnonymous: false, isAdmin: false, isUnitLeader: false,
  isParent: family, firebaseUser: { uid }, profile: { role: family ? "parent" : "participant", stakeId, birthDate: "1982-01-01" } }, loading: false };
createRoot(document.getElementById("root")!).render(
  <AuthContext.Provider value={value as never}>
    <MemoryRouter initialEntries={[`/activities/qa-event/record?stake=${stakeId}`]}>
      <Routes><Route path="/activities/:eventId/record" element={<RecordNightPage />} /></Routes>
    </MemoryRouter>
  </AuthContext.Provider>,
);
