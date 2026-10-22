import { useState } from "react";
import { useNavigate } from "react-router-dom";

import inviataUrl from "@/assets/flusso-genitore/inviata.webp";
import { AppModal } from "@/components/AppModal";
import { ConfirmSheet } from "@/components/ConfirmSheet";
import { PALO } from "@/copy/palo";
import { fillCopy } from "@/copy/parole";
import { useAuth } from "@/hooks/useAuth";
import { useAsyncData } from "@/hooks/useAsyncData";
import { useEnsureMembershipRequest, useStakeMembership } from "@/hooks/useStakeMembership";
import { organizationService } from "@/services/firestore/organizationService";
import { stakeMembersService } from "@/services/firestore/stakeMembersService";
import { needsProfileCompletion } from "@/utils/profileCompletion";
import { fromDateLabel, membershipBannerOf, membershipErrorMessage } from "@/utils/stakeMembership";

import "@/styles/membership.css";

type Sheet = "who" | "withdraw" | "account" | null;

/**
 * Banner dell'appartenenza al palo scelto, in cima a /me e alla home famiglia
 * (docs/APPARTENENZA_AL_PALO.md, «Client della fase 3»). Niente per lo staff,
 * i membri attivi e i profili incompleti.
 */
export function MembershipBanner() {
  const { session, signOut } = useAuth();
  const navigate = useNavigate();
  const stakeId = session?.profile.stakeId ?? "";
  const { access, member } = useStakeMembership(stakeId);
  useEnsureMembershipRequest();
  const [sheet, setSheet] = useState<Sheet>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const profileComplete = session ? !needsProfileCompletion(session.profile) : false;
  const banner = membershipBannerOf({ access, profileComplete, member, nowMs: Date.now() });
  const showsSupport = banner !== null && banner.kind !== "pending" && banner.kind !== "withdrawn";
  const { data: organization } = useAsyncData(
    () => (showsSupport && stakeId ? organizationService.getProfile(stakeId) : Promise.resolve(null)),
    [showsSupport, stakeId],
    null,
  );

  if (!banner) return null;

  async function run(action: "request" | "withdraw") {
    setBusy(true);
    setError(null);
    try {
      await stakeMembersService.run({ action, stakeId });
      setSheet(null);
    } catch (caught) {
      setError(membershipErrorMessage(caught, { self: true }));
    } finally {
      setBusy(false);
    }
  }

  async function switchAccount() {
    setBusy(true);
    try {
      await signOut();
      navigate("/login", { replace: true });
    } finally {
      setBusy(false);
    }
  }

  const support = organization?.supportContact ? (
    <p className="mship-banner__support">{fillCopy(PALO.supporto, { contatto: organization.supportContact })}</p>
  ) : null;
  const inlineError = error && sheet === null ? (
    <p className="form-error mship-banner__error" role="alert">
      {error}
    </p>
  ) : null;

  let content;
  if (banner.kind === "pending") {
    content = (
      <section className="mship-banner" aria-live="polite">
        <div className="mship-banner__in">
          <img alt="" className="mship-banner__art" src={inviataUrl} />
          <div>
            <h2 className="mship-banner__title">{PALO.attesaTitolo}</h2>
            <p className="mship-banner__body">
              {banner.toAdmins
                ? PALO.attesaCorpoAdmin
                : banner.unitName
                  ? fillCopy(PALO.attesaCorpoUnita, { unita: banner.unitName })
                  : PALO.attesaCorpo}
            </p>
          </div>
        </div>
        {inlineError}
        <div className="mship-banner__actions">
          <button className="mship-btn mship-btn--soft" onClick={() => setSheet("who")} type="button">
            {PALO.chiVerifica}
          </button>
          {member?.status === "pending" ? (
            <button className="mship-btn mship-btn--ghost" onClick={() => setSheet("withdraw")} type="button">
              {PALO.ritiraRichiesta}
            </button>
          ) : null}
        </div>
      </section>
    );
  } else if (banner.kind === "declined") {
    content = (
      <section className="mship-banner mship-banner--out">
        <div className="mship-banner__in">
          <div>
            <h2 className="mship-banner__title">{PALO.rifiutoTitolo}</h2>
            <p className="mship-banner__body">
              {PALO.rifiutoCorpo}
              {!banner.canRetry && banner.retryAtMs !== null
                ? ` ${fillCopy(PALO.potraiChiedereDiNuovo, { dal: fromDateLabel(banner.retryAtMs) })}`
                : ""}
            </p>
            {support}
          </div>
        </div>
        {inlineError}
        <div className="mship-banner__actions">
          {banner.canRetry ? (
            <button className="mship-btn mship-btn--primary" disabled={busy} onClick={() => void run("request")} type="button">
              {busy ? PALO.invio : PALO.chiediDiNuovo}
            </button>
          ) : null}
          <button className="mship-link" onClick={() => setSheet("account")} type="button">
            {PALO.nonRicordiAccount}
          </button>
        </div>
      </section>
    );
  } else if (banner.kind === "withdrawn") {
    content = (
      <section className="mship-banner mship-banner--out">
        <div className="mship-banner__in">
          <div>
            <h2 className="mship-banner__title">{PALO.fuoriTitolo}</h2>
            <p className="mship-banner__body">{PALO.fuoriCorpo}</p>
          </div>
        </div>
        {inlineError}
        <div className="mship-banner__actions">
          <button className="mship-btn mship-btn--primary" disabled={busy} onClick={() => void run("request")} type="button">
            {busy ? PALO.invio : PALO.chiediDiEntrare}
          </button>
        </div>
      </section>
    );
  } else {
    content = (
      <section className="mship-banner mship-banner--out">
        <div className="mship-banner__in">
          <div>
            <h2 className="mship-banner__title">{PALO.rimossoTitolo}</h2>
            <p className="mship-banner__body">{PALO.rimossoCorpo}</p>
            {support}
          </div>
        </div>
      </section>
    );
  }

  return (
    <>
      {content}
      {sheet === "who" ? (
        <AppModal
          footer={
            <button className="button button--primary" onClick={() => setSheet(null)} type="button">
              {PALO.chiudi}
            </button>
          }
          onClose={() => setSheet(null)}
          size="compact"
          title={PALO.chiVerifica}
        >
          <p className="mship-sheet__body">
            {banner.kind === "pending" && banner.toAdmins ? PALO.chiVerificaCorpoAdmin : PALO.chiVerificaCorpo}
          </p>
        </AppModal>
      ) : null}
      {sheet === "account" ? (
        <AppModal
          footer={
            <div className="family-cancel-actions">
              <button className="button button--primary" disabled={busy} onClick={() => setSheet(null)} type="button">
                {PALO.chiudi}
              </button>
              <button className="button button--ghost" disabled={busy} onClick={() => void switchAccount()} type="button">
                {PALO.cambiaAccount}
              </button>
            </div>
          }
          onClose={busy ? () => undefined : () => setSheet(null)}
          size="compact"
          title={PALO.nonRicordiAccount}
        >
          <p className="mship-sheet__body">{PALO.nonRicordiCorpo}</p>
        </AppModal>
      ) : null}
      {sheet === "withdraw" ? (
        <ConfirmSheet
          body={PALO.ritiraCorpo}
          busy={busy}
          busyLabel={PALO.ritiro}
          cancelLabel={PALO.tieniRichiesta}
          confirmLabel={PALO.confermaRitira}
          error={error}
          onCancel={() => {
            setSheet(null);
            setError(null);
          }}
          onConfirm={() => void run("withdraw")}
          title={PALO.ritiraTitolo}
          tone="danger"
        />
      ) : null}
    </>
  );
}
