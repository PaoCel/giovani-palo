import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  Link,
  useBlocker,
  useLocation,
  useNavigate,
  useNavigationType,
  useParams,
  useSearchParams,
} from "react-router-dom";

import { AppIcon } from "@/components/AppIcon";
import { AuthCredentialsForm } from "@/components/auth/AuthCredentialsForm";
import { ConfirmSheet } from "@/components/ConfirmSheet";
import { ProfileForm } from "@/components/auth/ProfileForm";
import { EmptyState } from "@/components/EmptyState";
import { QuestionsSection } from "@/components/QuestionsSection";
import { AccountNeededCard } from "@/components/register/AccountNeededCard";
import { ChiPartecipaStep } from "@/components/register/ChiPartecipaStep";
import { RegisterFlowHeader } from "@/components/register/RegisterFlowHeader";
import { RegistrationEditor } from "@/components/RegistrationEditor";
import { SectionCard } from "@/components/SectionCard";
import { StatusBadge } from "@/components/StatusBadge";
import { ACCEDI } from "@/copy/accedi";
import { CHI_PARTECIPA } from "@/copy/chiPartecipa";
import { ISCRIZIONE } from "@/copy/iscrizione";
import { fillCopy } from "@/copy/parole";
import { PERCORSO } from "@/copy/percorso";
import { PROFILO } from "@/copy/profilo";
import { useAuth } from "@/hooks/useAuth";
import { useAsyncData } from "@/hooks/useAsyncData";
import { toUserFacingAuthError } from "@/services/firebase/debug";
import { childrenService } from "@/services/firestore/childrenService";
import { eventFormsService } from "@/services/firestore/eventFormsService";
import { eventsService } from "@/services/firestore/eventsService";
import { organizationService } from "@/services/firestore/organizationService";
import { questionsService } from "@/services/firestore/questionsService";
import { registrationAttemptsService } from "@/services/firestore/registrationAttemptsService";
import { registrationsService } from "@/services/firestore/registrationsService";
import type {
  AuthSession,
  ChildProfile,
  GenderRoleCategory,
  OrganizationProfile,
  Registration,
  RegistrationWriteInput,
} from "@/types";
import { formatDateOnly, formatDateRange } from "@/utils/formatters";
import { getVisibleStandardFieldDefinitions } from "@/utils/formFields";
import {
  getAudienceRestrictionMessage,
  getRegistrationAvailability,
  isEventAudienceEligible,
} from "@/utils/events";
import { getRegistrationStatusLabel, getRegistrationStatusTone } from "@/utils/registrations";
import { getRegistrationLookupFromSession } from "@/utils/session";
import { writePendingAccountProfile } from "@/utils/pendingAccountProfile";
import {
  canBecomeParent,
  getAgeOn,
  isEmailDerivedName,
  isMinorOn,
  isPlaceholderName,
  needsProfileCompletion,
} from "@/utils/profileCompletion";
import {
  buildRegisterSearch,
  clearStoredRegisterFor,
  getRegisterBackTarget,
  getRegisterProgressIndex,
  getRegisterRole,
  getRequestedRegisterChoice,
  parseRegisterFor,
  parseRegisterPasso,
  readStoredRegisterFor,
  resolveRegisterFlow,
  writeStoredRegisterFor,
  type RegisterFor,
  type RegisterPasso,
} from "@/utils/registerFlow";
import { resolvePublicStakeId } from "@/utils/stakeSelection";
import {
  getActivityPath,
  getActivityRegistrationPath,
  getLoginPath,
} from "@/utils/activityLinks";

import "@/styles/registerFlow.css";

interface RegisterPageData {
  stakeId: string;
  organization: OrganizationProfile | null;
  event: Awaited<ReturnType<typeof eventsService.getPublicEventById>>;
  formConfig: Awaited<ReturnType<typeof eventFormsService.getFormConfig>> | null;
  registration: Awaited<ReturnType<typeof registrationsService.getRegistrationById>>;
  // Iscrizione precedente dello stesso partecipante da cui recuperare i
  // contatti del genitore: lo step genitore parte compilato, da confermare.
  parentDetailsSource: Registration | null;
  children: ChildProfile[];
}

// Stato della cronologia lasciato dai passi: la freccia in alto torna indietro
// con la cronologia (non con una voce nuova) quando il passo prima è lì.
interface RegisterHistoryState {
  registerFrom?: string;
  fromActivity?: boolean;
}

const initialData: RegisterPageData = {
  stakeId: "",
  organization: null,
  event: null,
  formConfig: null,
  registration: null,
  parentDetailsSource: null,
  children: [],
};

const CATEGORY_WORDS: Record<GenderRoleCategory, string> = {
  giovane_uomo: CHI_PARTECIPA.categoriaGiovaneUomo,
  giovane_donna: CHI_PARTECIPA.categoriaGiovaneDonna,
  dirigente: CHI_PARTECIPA.categoriaDirigente,
  accompagnatore: CHI_PARTECIPA.categoriaAccompagnatore,
};

const CATEGORY_LABELS: Record<GenderRoleCategory, string> = {
  giovane_uomo: PROFILO.giovaneUomo,
  giovane_donna: PROFILO.giovaneDonna,
  dirigente: PROFILO.dirigente,
  accompagnatore: PROFILO.accompagnatore,
};

// Precompila il modulo con i dati del figlio selezionato: il RegistrationEditor
// legge i valori iniziali da una Registration, quindi ne costruiamo una vuota
// con i soli dati anagrafici del figlio.
function buildChildPrefill(child: ChildProfile): Registration {
  const timestamp = new Date().toISOString();

  return {
    id: "",
    eventId: "",
    activityId: "",
    stakeId: child.stakeId,
    userId: null,
    anonymousUid: null,
    anonymousTokenId: null,
    firstName: child.firstName,
    lastName: child.lastName,
    fullName: child.fullName,
    email: "",
    phone: "",
    birthDate: child.birthDate,
    genderRoleCategory: child.genderRoleCategory,
    youthGroup: "",
    unitId: child.unitId,
    unitNameSnapshot: child.unitName,
    answers: {},
    roomPreferenceMatches: {},
    accessCode: null,
    recoveryCode: null,
    recoveryPdfGenerated: false,
    parentConsentDocumentName: null,
    parentConsentDocumentUrl: null,
    parentConsentDocumentPath: null,
    parentConsentUploadedAt: null,
    consentSignatureUrl: null,
    consentSignaturePath: null,
    consentSignatureSetAt: null,
    parentIdDocumentName: null,
    parentIdDocumentUrl: null,
    parentIdDocumentPath: null,
    parentIdUploadedAt: null,
    parentAuthorization: null,
    linkedLaterToUserId: null,
    parentUid: null,
    childId: child.id,
    registrationStatus: "active",
    submittedByMode: "parent",
    assignedRoomId: null,
    assignedRoomName: null,
    assignedTempleShiftId: null,
    assignedServiceTeamIds: [],
    assignedPatrolId: null,
    assignedPatrolName: null,
    assignedPatrolRole: null,
    assignedCommittees: [],
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

function createAnonymousTokenId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `anon_${crypto.randomUUID()}`;
  }

  return `anon_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function getInitials(fullName: string) {
  const initials = fullName
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word.charAt(0))
    .slice(0, 2)
    .join("");
  return initials.toUpperCase() || "?";
}

// Nome da mostrare per l'account: nome e cognome, altrimenti l'email.
function getAccountName(session: AuthSession) {
  const email = session.firebaseUser.email || session.profile.email || "";
  return isPlaceholderName(session.profile.fullName) ||
    isEmailDerivedName(session.profile.fullName, email)
    ? email
    : session.profile.fullName.trim();
}

// "Partecipi tu: {nome}" con il nome in grassetto.
function withBoldName(template: string, name: string): ReactNode {
  const [before, after = ""] = template.split("{nome}");
  return (
    <>
      {before}
      <strong>{name}</strong>
      {after}
    </>
  );
}

function RegistrationLoadingState({ title }: { title?: string }) {
  return (
    <section className="registration-loading" role="status" aria-live="polite">
      <div className="registration-loading__stage" aria-hidden="true">
        <span className="registration-loading__pulse registration-loading__pulse--one" />
        <span className="registration-loading__pulse registration-loading__pulse--two" />
        <div className="registration-loading__ticket">
          <AppIcon name="ticket" />
        </div>
      </div>
      <div className="registration-loading__copy">
        <h2>{title ? `Prepariamo ${title}` : "Prepariamo il modulo"}</h2>
        <p>
          Stiamo aprendo la sessione e caricando i dati dell'attività. Resta
          su questa pagina ancora un momento.
        </p>
      </div>
      <div className="registration-loading__steps" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>
    </section>
  );
}

export function ActivityRegisterPage() {
  const { eventId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const { session, loading: authLoading, signInAnonymously, signOut } = useAuth();
  const historyState = (location.state ?? null) as RegisterHistoryState | null;
  // Cambia anche quando l'account diventa da genitore: i figli si rileggono.
  const sessionKey = session
    ? `${session.firebaseUser.uid}:${session.isAnonymous}:${session.isParent}`
    : "public";
  const requestedStakeId = searchParams.get("stake") ?? "";
  const isParentSession = Boolean(session?.isParent);
  const childIdParam = isParentSession ? (searchParams.get("child") ?? "") : "";
  const perParam = parseRegisterFor(searchParams.get("per"));
  const passoParam = parseRegisterPasso(searchParams.get("passo"));
  const [busy, setBusy] = useState<null | "anonymous" | "save" | "pdf" | "reset" | "account">(
    null,
  );
  const [actionError, setActionError] = useState<string | null>(null);
  const [anonymousCompletion, setAnonymousCompletion] = useState<Registration | null>(null);
  const [latestAttemptLogId, setLatestAttemptLogId] = useState<string | null>(null);
  const [resetSheetOpen, setResetSheetOpen] = useState(false);
  // Uscita chiesta da qui ("Cambia account"): la scelta "per chi" resta.
  const keepPerOnSignOutRef = useRef(false);
  const previousUidRef = useRef<string | null>(null);

  const { data, loading, error, setData } = useAsyncData(
    async () => {
      if (!eventId) {
        return initialData;
      }

      const stakeId = await resolvePublicStakeId(requestedStakeId || session?.profile.stakeId);
      const lookup = getRegistrationLookupFromSession(session, childIdParam || null);
      // I genitori operano solo su iscrizioni dei figli: senza figlio
      // selezionato non cerchiamo una (eventuale) vecchia iscrizione personale,
      // che renderebbe la pagina un vicolo cieco.
      const hasLookup =
        Boolean(lookup.userId || lookup.anonymousUid || lookup.parentUid) &&
        (!isParentSession || Boolean(childIdParam));

      // Step 2-5 sono indipendenti tra loro (basta lo stakeId): in parallelo
      // tagliamo ~60% del tempo percepito sulla pagina di iscrizione.
      const [organization, event, formConfig, registration, children] = await Promise.all([
        organizationService.getProfile(stakeId),
        eventsService.getPublicEventById(stakeId, eventId),
        eventFormsService.getFormConfig(stakeId, eventId),
        hasLookup
          ? registrationsService.getRegistrationByActor(stakeId, eventId, lookup)
          : Promise.resolve(null),
        isParentSession && session
          ? childrenService.listChildren(session.firebaseUser.uid)
          : Promise.resolve([]),
      ]);

      if (!event) {
        return {
          ...initialData,
          stakeId,
          organization,
          children,
        };
      }

      // Solo quando servono davvero (attività con autorizzazione genitore) e
      // solo se questa iscrizione non li ha già: sono get sulla propria
      // iscrizione, serviti dalla cache locale nella quasi totalità dei casi.
      const parentDetailsSource =
        event.requiresParentAuthorization && hasLookup && !registration
          ? await registrationsService
              .findLatestParentDetails(stakeId, lookup, eventId)
              .catch(() => null)
          : null;

      return {
        stakeId,
        organization,
        event,
        formConfig,
        registration,
        parentDetailsSource,
        children,
      };
    },
    [eventId, requestedStakeId, sessionKey, childIdParam],
    initialData,
  );

  const event = data.event;
  const formConfig = data.formConfig;
  const organization = data.organization;
  const isUserAccount = Boolean(session && !session.isAnonymous);
  const profileComplete = Boolean(
    session && !session.isAnonymous && !needsProfileCompletion(session.profile),
  );
  const isMinorAccount = Boolean(
    session &&
      isUserAccount &&
      profileComplete &&
      session.profile.role === "participant" &&
      isMinorOn(session.profile.birthDate, new Date()),
  );
  // Per attività rafforzate (overnight/trip/camp/multi_day) con account
  // obbligatorio: niente ospiti, anche se formConfig.allowGuestRegistration
  // fosse legacy true.
  const eventForcesAccount = Boolean(event?.requiresAccount);
  const allowGuestForThisActivity =
    Boolean(formConfig?.allowGuestRegistration) && !eventForcesAccount;
  const selectedChild = isParentSession
    ? (data.children.find((child) => child.id === childIdParam) ?? null)
    : null;
  // Chi ha già la sua iscrizione (account o ospite) riparte dal modulo, non
  // da "Chi partecipa?"; così chi arriva con un figlio già scelto ("Gestisci"
  // in Famiglia, link vecchi senza `per`).
  const hasOwnRegistration = Boolean(data.registration) && !selectedChild;
  const requested = getRequestedRegisterChoice({
    per: perParam,
    passo: passoParam,
    childSelected: Boolean(selectedChild),
    hasOwnRegistration,
  });
  // "Iscrivi un'altra persona" esce dalla sessione da ospite e ne apre
  // un'altra: nel mezzo si resta ospiti, sul modulo.
  const resettingGuest = busy === "reset";
  const flow = resolveRegisterFlow({
    per: requested.per,
    passo: requested.passo,
    account: resettingGuest || session?.isAnonymous ? "guest" : !session ? "none" : "user",
    profileComplete,
    role: getRegisterRole(session?.profile.role ?? ""),
    isMinor: isMinorAccount,
    guestAllowed: allowGuestForThisActivity,
    childSelected: Boolean(selectedChild),
  });
  const keepChild =
    flow.per === "figlio" && (flow.screen === "figlio" || flow.screen === "modulo");
  const canonicalSearch = buildRegisterSearch(searchParams, {
    per: flow.per,
    passo: flow.passo,
    child: keepChild ? undefined : null,
  });
  const ready = !authLoading && !loading && Boolean(event) && !resettingGuest;

  // Risposte del modulo non inviate: ogni uscita (freccia, "Cambia", link,
  // indietro del browser, "Esci") passa dal foglio "Esci dall'iscrizione?".
  // Prima degli effetti che navigano: useBlocker aggiorna la sua funzione in
  // un suo effetto, e quegli effetti devono trovarla già aggiornata.
  const [formDirty, setFormDirty] = useState(false);
  const submittingRef = useRef(false);
  const [pendingExit, setPendingExit] = useState<null | (() => void)>(null);
  const blocker = useBlocker(({ currentLocation, nextLocation }) => {
    if (!formDirty || submittingRef.current || flow.screen !== "modulo") {
      return false;
    }

    const next = new URLSearchParams(nextLocation.search);
    const current = new URLSearchParams(currentLocation.search);
    return (
      nextLocation.pathname !== currentLocation.pathname ||
      next.get("passo") !== "modulo" ||
      next.get("per") !== current.get("per") ||
      next.get("child") !== current.get("child")
    );
  });

  useEffect(() => {
    if (flow.screen !== "modulo") {
      setFormDirty(false);
    }
  }, [flow.screen]);

  // Un passo senza i suoi prerequisiti porta al primo passo valido: si
  // sostituisce la voce di cronologia, mai una nuova (docs/FLUSSO_GENITORE.md,
  // "Navigazione").
  useEffect(() => {
    if (!ready || canonicalSearch === searchParams.toString()) {
      return;
    }

    navigate({ search: canonicalSearch }, { replace: true, state: location.state });
  }, [canonicalSearch, location.state, navigate, ready, searchParams]);

  // Uscita dall'account (anche dall'intestazione del sito): la scelta "per
  // chi" si cancella, salvo "Cambia account" che la tiene per rientrare.
  const currentUid = session && !session.isAnonymous ? session.firebaseUser.uid : null;
  useEffect(() => {
    const previousUid = previousUidRef.current;
    previousUidRef.current = currentUid;

    if (!previousUid || previousUid === currentUid) {
      return;
    }

    setAnonymousCompletion(null);

    if (keepPerOnSignOutRef.current) {
      keepPerOnSignOutRef.current = false;
      return;
    }

    clearStoredRegisterFor();
    navigate(
      { search: buildRegisterSearch(searchParams, { per: null, passo: null, child: null }) },
      { replace: true },
    );
    // Solo al cambio di account.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUid]);

  // Passo nuovo: si riparte dall'alto (il titolo prende il focus nel passo);
  // indietro del browser ritrova la posizione di prima.
  const navigationType = useNavigationType();
  const screenKey = `${flow.screen}:${flow.per ?? ""}`;
  const previousScreenRef = useRef<string | null>(null);
  useEffect(() => {
    if (!ready) {
      return;
    }

    const previous = previousScreenRef.current;
    previousScreenRef.current = screenKey;

    if (previous && previous !== screenKey && navigationType !== "POP") {
      window.scrollTo({ top: 0 });
    }
  }, [navigationType, ready, screenKey]);

  // Azioni che non sono una navigazione (uscita dall'account): stesso foglio.
  function confirmExitThen(action: () => void) {
    if (formDirty && flow.screen === "modulo") {
      setPendingExit(() => action);
      return;
    }

    action();
  }

  function goTo(
    per: RegisterFor | null,
    passo: RegisterPasso | null,
    options: { replace?: boolean; child?: string | null } = {},
  ) {
    const search = buildRegisterSearch(searchParams, {
      per,
      passo,
      child: options.child === undefined ? null : options.child,
    });
    navigate(
      { search },
      options.replace
        ? { replace: true, state: location.state }
        : { state: { registerFrom: searchParams.toString() } satisfies RegisterHistoryState },
    );
  }

  function handleChoose(per: RegisterFor) {
    if (eventId) {
      writeStoredRegisterFor(eventId, per);
    }

    setActionError(null);
    goTo(per, null);
  }

  function handleBack() {
    if (!event) {
      return;
    }

    const target = getRegisterBackTarget(flow.screen, flow.per, isMinorAccount);

    if (target.kind === "activity") {
      if (historyState?.fromActivity) {
        navigate(-1);
      } else {
        navigate(getActivityPath(event.id, requestedStakeId || undefined));
      }
      return;
    }

    // Il passo prima è la voce precedente della cronologia: si torna con la
    // cronologia (così "avanti" del browser funziona ancora). "Chi
    // partecipa?" senza scelta nell'URL conta come lo stesso passo.
    if (historyState?.registerFrom !== undefined) {
      const from = new URLSearchParams(historyState.registerFrom);
      const fromPasso =
        parseRegisterPasso(from.get("passo")) ?? (parseRegisterFor(from.get("per")) ? null : "chi");

      if (fromPasso === target.passo) {
        navigate(-1);
        return;
      }
    }

    navigate(
      {
        search: buildRegisterSearch(searchParams, {
          per: target.per,
          passo: target.passo,
          child: target.passo === "figlio" ? undefined : null,
        }),
      },
      { replace: true, state: location.state },
    );
  }

  async function handleSignOut() {
    setBusy("account");
    setActionError(null);

    try {
      await signOut();
    } catch (caughtError) {
      setActionError(toUserFacingAuthError(caughtError));
    } finally {
      setBusy(null);
    }
  }

  // Esce e riparte da "Il tuo account" con la stessa scelta (o con `per`).
  async function handleSwitchAccount(per: RegisterFor) {
    setBusy("account");
    setActionError(null);
    keepPerOnSignOutRef.current = true;

    try {
      await signOut();
      writeStoredRegisterFor(eventId ?? "", per);
      navigate(
        { search: buildRegisterSearch(searchParams, { per, passo: "account", child: null }) },
        { replace: true },
      );
    } catch (caughtError) {
      keepPerOnSignOutRef.current = false;
      setActionError(toUserFacingAuthError(caughtError));
    } finally {
      setBusy(null);
    }
  }

  async function handleAnonymousAccess() {
    setBusy("anonymous");
    setActionError(null);

    try {
      if (!session?.isAnonymous) {
        await signInAnonymously();
      }
      goTo("io", "modulo");
    } catch (caughtError) {
      setActionError(toUserFacingAuthError(caughtError));
    } finally {
      setBusy(null);
    }
  }

  // Caso uso: genitore che iscrive più figli dallo stesso device senza
  // creare un account. La sessione anonima è legata al primo figlio quindi
  // riapre l'iscrizione esistente; con questo bottone scolleghiamo e
  // apriamo una nuova sessione anonima per ripartire da zero.
  // Conferma nel foglio (resetSheetOpen), mai con un dialogo del browser.
  async function handleResetAnonymousSession() {
    if (!session?.isAnonymous) {
      return;
    }

    setBusy("reset");
    setActionError(null);

    try {
      await signOut();
      await signInAnonymously();
      setAnonymousCompletion(null);
      setLatestAttemptLogId(null);
      setData((current) => ({ ...current, registration: null }));
      setResetSheetOpen(false);
    } catch (caughtError) {
      setResetSheetOpen(false);
      setActionError(toUserFacingAuthError(caughtError));
    } finally {
      setBusy(null);
    }
  }

  async function handleSubmit(input: RegistrationWriteInput) {
    if (!data.event || !data.stakeId || !session) {
      setActionError("Serve una sessione valida per salvare la registrazione.");
      return;
    }

    const lookup = getRegistrationLookupFromSession(session, childIdParam || null);

    if (!lookup.userId && !lookup.anonymousUid && !lookup.parentUid) {
      setActionError("Impossibile determinare il proprietario della registrazione.");
      return;
    }

    setBusy("save");
    setActionError(null);

    const attemptLogId = await registrationAttemptsService.startAttempt({
      stakeId: data.stakeId,
      eventId: data.event.id,
      eventTitle: data.event.title,
      lookup,
      input,
    });

    setLatestAttemptLogId(attemptLogId);

    try {
      const savedRegistration = await registrationsService.upsertRegistration(
        data.stakeId,
        data.event.id,
        lookup,
        input,
      );

      if (!savedRegistration) {
        throw new Error("La registrazione non è stata riletta correttamente.");
      }

      await registrationAttemptsService.markStep(data.stakeId, attemptLogId, {
        lastStep: "registration_saved",
        registrationId: savedRegistration.id,
        registrationStatus: savedRegistration.registrationStatus,
      });

      // Iscrizione inviata: la scelta "per chi" non serve più.
      clearStoredRegisterFor();

      // Domande caminetto raccolte inline nel form: ora che la registrazione
      // esiste possiamo creare i doc /questions. Errori non bloccano (le
      // domande sono facoltative): logghiamo soltanto.
      if (input.pendingQuestions && input.pendingQuestions.length > 0) {
        const authorName =
          session.isAnonymous
            ? savedRegistration.fullName
            : session.profile.fullName || savedRegistration.fullName;
        for (const draft of input.pendingQuestions) {
          try {
            await questionsService.create(
              data.stakeId,
              data.event.id,
              lookup,
              authorName,
              { text: draft.text, isAnonymous: draft.isAnonymous },
            );
          } catch (questionError) {
            console.error("Creazione domanda caminetto fallita", questionError);
          }
        }
      }

      let nextRegistration = savedRegistration;

      if (session.isAnonymous && lookup.anonymousUid) {
        const recoveryCode =
          savedRegistration.recoveryCode ?? savedRegistration.accessCode ?? "";

        if (!recoveryCode) {
          throw new Error("Codice di recupero non disponibile.");
        }

        const recovered = await registrationsService.saveAnonymousRecovery(
          data.stakeId,
          data.event.id,
          savedRegistration.id,
          {
            anonymousUid: lookup.anonymousUid,
            anonymousTokenId:
              savedRegistration.anonymousTokenId ?? createAnonymousTokenId(),
            recoveryCode,
            pdfDataSummary: {
              eventTitle: data.event.title,
              fullName: savedRegistration.fullName,
              email: savedRegistration.email,
              submittedAt: savedRegistration.updatedAt,
            },
            recoveryPdfGenerated: savedRegistration.recoveryPdfGenerated,
          },
        );

        nextRegistration = recovered ?? savedRegistration;
        await registrationAttemptsService.markStep(data.stakeId, attemptLogId, {
          lastStep: "recovery_saved",
          registrationId: nextRegistration.id,
          registrationStatus: nextRegistration.registrationStatus,
        });
        setAnonymousCompletion(nextRegistration);
        setFormDirty(false);
        window.scrollTo({ top: 0, behavior: "smooth" });
      } else {
        await registrationAttemptsService.markSucceeded(
          data.stakeId,
          attemptLogId,
          nextRegistration,
          "completed",
        );
        submittingRef.current = true;
        setFormDirty(false);
        if (lookup.parentUid) {
          navigate("/family", { replace: true });
        } else {
          navigate(`/me/activities/${data.event.id}`, { replace: true });
        }
      }

      setData((current) => ({
        ...current,
        registration: nextRegistration,
      }));

      if (session.isAnonymous && lookup.anonymousUid) {
        await registrationAttemptsService.markSucceeded(
          data.stakeId,
          attemptLogId,
          nextRegistration,
          "completed",
        );
      }
    } catch (caughtError) {
      // Log dettagliato per diagnostica: senza questo l'admin vede solo
      // il messaggio generico in UI e in registrationAttempts.
      console.error("[registration submit] failed", {
        code:
          caughtError && typeof caughtError === "object" && "code" in caughtError
            ? (caughtError as { code?: unknown }).code
            : null,
        message:
          caughtError instanceof Error ? caughtError.message : String(caughtError),
        stakeId: data.stakeId,
        eventId: data.event.id,
        lookup,
      });
      await registrationAttemptsService.markFailed(
        data.stakeId,
        attemptLogId,
        "submit_failed",
        caughtError,
      );
      const code =
        caughtError && typeof caughtError === "object" && "code" in caughtError
          ? String((caughtError as { code?: unknown }).code ?? "")
          : "";
      const baseMessage =
        caughtError instanceof Error
          ? caughtError.message
          : "Impossibile salvare la registrazione.";
      setActionError(code ? `${baseMessage} (codice: ${code})` : baseMessage);
    } finally {
      setBusy(null);
    }
  }

  async function handleDownloadPdf() {
    if (!data.event || !data.formConfig || !anonymousCompletion || !data.stakeId) {
      return;
    }

    setBusy("pdf");
    setActionError(null);

    try {
      const { downloadRegistrationPdf } = await import("@/utils/registrationPdf");

      downloadRegistrationPdf({
        event: data.event,
        registration: anonymousCompletion,
        formConfig: data.formConfig,
      });

      await registrationsService.markRecoveryPdfGenerated(
        data.stakeId,
        data.event.id,
        anonymousCompletion.id,
      );

      setAnonymousCompletion((current) =>
        current
          ? {
              ...current,
              recoveryPdfGenerated: true,
            }
          : current,
      );
      await registrationAttemptsService.markSucceeded(
        data.stakeId,
        latestAttemptLogId,
        anonymousCompletion,
        "pdf_generated",
      );
    } catch (caughtError) {
      await registrationAttemptsService.markFailed(
        data.stakeId,
        latestAttemptLogId,
        "pdf_failed",
        caughtError,
      );
      setActionError(
        caughtError instanceof Error
          ? caughtError.message
          : "Impossibile generare il PDF riepilogativo.",
      );
    } finally {
      setBusy(null);
    }
  }

  if (authLoading || loading) {
    return (
      <div className="page page--register-loading">
        <RegistrationLoadingState title={data.event?.title} />
      </div>
    );
  }

  if (!event) {
    return (
      <div className="page">
        <EmptyState
          title="Attività non disponibile"
          description="L'attività non è pubblica oppure non esiste."
          action={
            <Link className="button button--primary" to="/activities">
              Torna alle attività
            </Link>
          }
        />
      </div>
    );
  }

  const registrationPath = getActivityRegistrationPath(event.id, data.stakeId);
  const eventDates = formatDateRange(event.startDate, event.endDate);
  // Finestra delle iscrizioni, uguale per tutti (il pubblico si guarda dopo).
  const registrationWindow = formConfig
    ? getRegistrationAvailability(event, formConfig, null)
    : null;
  const registrationsOpen =
    registrationWindow === "guest-allowed" || registrationWindow === "login-required";
  const availability =
    formConfig ? getRegistrationAvailability(event, formConfig, session) : null;
  const canEditExisting = Boolean(data.registration);
  const audienceMismatch =
    session?.isAuthenticated &&
    !session.isAnonymous &&
    !canEditExisting &&
    (!isParentSession || selectedChild)
      ? !isEventAudienceEligible(
          event,
          selectedChild ? selectedChild.genderRoleCategory : session.profile.genderRoleCategory,
        )
      : false;
  const accountBlockedForGuest = eventForcesAccount && session?.isAnonymous === true;
  const canSubmit =
    Boolean(formConfig && session) &&
    !audienceMismatch &&
    !accountBlockedForGuest &&
    (!isParentSession || Boolean(selectedChild)) &&
    (canEditExisting || availability === "open" || availability === "guest-allowed");
  const accountName = session && isUserAccount ? getAccountName(session) : "";
  const progressIndex = getRegisterProgressIndex(flow.screen, flow.per);
  const progressLabels =
    flow.per === "figlio"
      ? ([PERCORSO.tappaAccount, PERCORSO.tappaFiglio, PERCORSO.tappaIscrizione] as const)
      : ([PERCORSO.tappaAccount, PERCORSO.tappaDati, PERCORSO.tappaIscrizione] as const);
  const busyAccount = busy === "account";
  const showsIdentity =
    isUserAccount &&
    !isMinorAccount &&
    (flow.screen === "chi" ||
      flow.screen === "figlio" ||
      flow.screen === "serve-genitore" ||
      flow.screen === "solo-figli");
  const identity =
    session && showsIdentity
      ? {
          text: withBoldName(`${PERCORSO.seiEntratoCome} {nome}`, accountName),
          actionLabel: PERCORSO.cambiaAccount,
          // Da "Chi partecipa?" senza scelta: si esce e si resta qui.
          onAction: () =>
            confirmExitThen(
              () => void (flow.per ? handleSwitchAccount(flow.per) : handleSignOut()),
            ),
          note: profileComplete ? null : PERCORSO.accountResta,
        }
      : session && isMinorAccount && flow.screen === "modulo"
        ? {
            text: withBoldName(PERCORSO.partecipiTu, accountName),
            prompt: fillCopy(PERCORSO.nonSeiTu, {
              nome: session.profile.firstName || accountName,
            }),
            actionLabel: PERCORSO.cambiaAccount,
            onAction: () => confirmExitThen(() => void handleSwitchAccount("io")),
          }
        : null;

  const header = (
    <RegisterFlowHeader
      busy={busyAccount}
      eventDates={eventDates}
      eventTitle={event.title}
      identity={identity}
      onBack={handleBack}
      onChangePer={() => goTo(flow.per, "chi")}
      // Sotto "Esci" in "I tuoi dati": l'account appena creato resta.
      note={flow.screen === "dati" ? PERCORSO.accountResta : null}
      onSignOut={
        isUserAccount ? () => confirmExitThen(() => void handleSignOut()) : undefined
      }
      per={flow.screen === "chi" || isMinorAccount ? null : flow.per}
      progress={progressIndex === null ? null : { index: progressIndex, labels: progressLabels }}
    />
  );

  const errorNotices = (
    <>
      {error ? (
        <div className="notice notice--warning">
          <div>
            <h3>Caricamento modulo non riuscito</h3>
            <p>{error}</p>
          </div>
        </div>
      ) : null}

      {actionError ? (
        <div className="notice notice--warning" role="alert">
          <div>
            <h3>Azione non completata</h3>
            <p>{actionError}</p>
          </div>
        </div>
      ) : null}
    </>
  );

  // Iscrizioni chiuse o non ancora aperte: niente percorso, salvo chi ha già
  // un'iscrizione da rivedere (o un account da genitore con i figli).
  if (formConfig && !registrationsOpen && !hasOwnRegistration && !isParentSession) {
    const notYet = registrationWindow === "not-open-yet";

    return (
      <div className="page page--flow">
        {header}
        <section className="flow-step">
          <EmptyState
            title={notYet ? CHI_PARTECIPA.nonAncoraTitolo : CHI_PARTECIPA.chiuseTitolo}
            description={
              notYet
                ? fillCopy(CHI_PARTECIPA.nonAncoraTesto, {
                    data: formatDateOnly(event.registrationOpen),
                  })
                : CHI_PARTECIPA.chiuseTesto
            }
            action={
              <div className="inline-actions">
                <Link
                  className="button button--primary"
                  to={getActivityPath(event.id, requestedStakeId || undefined)}
                >
                  {CHI_PARTECIPA.tornaAllAttivita}
                </Link>
                {!isUserAccount && !notYet ? (
                  <Link className="button button--ghost" to={getLoginPath(registrationPath)}>
                    {CHI_PARTECIPA.accedi}
                  </Link>
                ) : null}
              </div>
            }
          />
          {!isUserAccount && !notYet ? (
            <p className="subtle-text">{CHI_PARTECIPA.giaIscritto}</p>
          ) : null}
        </section>
      </div>
    );
  }

  if (flow.screen === "chi") {
    const category = session?.profile.genderRoleCategory || "";
    const isAdultCategory = category === "dirigente" || category === "accompagnatore";
    const partecipoIoDetail =
      isUserAccount && profileComplete && session
        ? isParentSession
          ? CHI_PARTECIPA.partecipoIoGenitore
          : category && session.profile.unitName
            ? fillCopy(CHI_PARTECIPA.partecipoIoCome, {
                categoria: CATEGORY_WORDS[category],
                unita: session.profile.unitName,
              })
            : CHI_PARTECIPA.partecipoIoAccount
        : CHI_PARTECIPA.partecipoIoDettaglio;
    const iscrivoFiglioDetail = !isUserAccount
      ? CHI_PARTECIPA.iscrivoFiglioDettaglio
      : !profileComplete &&
          session &&
          canBecomeParent(session.profile.role, session.profile.birthDate, new Date())
        ? CHI_PARTECIPA.iscrivoFiglioCompleta
        : isParentSession
          ? CHI_PARTECIPA.iscrivoFiglioGenitore
          : CHI_PARTECIPA.iscrivoFiglioServeGenitore;

    return (
      <div className="page page--flow">
        {header}
        {errorNotices}
        <ChiPartecipaStep
          iscrivoFiglioDetail={iscrivoFiglioDetail}
          onChoose={handleChoose}
          partecipoIoDetail={partecipoIoDetail}
          partecipoIoIllustration={
            isAdultCategory || (isUserAccount && getRegisterRole(session?.profile.role ?? "") === "staff")
              ? "dirigente"
              : "io"
          }
          selected={flow.per ?? readStoredRegisterFor(event.id)}
        />
      </div>
    );
  }

  if (flow.screen === "account" && flow.per) {
    const forParent = flow.per === "figlio";
    const offerGuest = !forParent && allowGuestForThisActivity;

    return (
      <div className="page page--flow">
        {header}
        {errorNotices}
        <AuthCredentialsForm
          accountType={forParent ? "parent" : "participant"}
          // Collegare la sessione da ospite vale per chi partecipa lui.
          anonymousNote={session?.isAnonymous && !forParent ? ACCEDI.ospiteIscrizione : null}
          extra={
            offerGuest ? (
              <div className="flow-guest">
                <button
                  className="button button--ghost button--large"
                  disabled={busy !== null}
                  onClick={() => void handleAnonymousAccess()}
                  type="button"
                >
                  {busy === "anonymous" ? ISCRIZIONE.apriSessione : ISCRIZIONE.continuaSenzaAccount}
                </button>
                <p className="auth-screen__note">
                  {organization?.guestRegistrationHint || ISCRIZIONE.completataSenzaAccount}
                </p>
              </div>
            ) : !forParent && eventForcesAccount ? (
              <p className="auth-screen__note">{ISCRIZIONE.serveAccountPernottamento}</p>
            ) : null
          }
          afterExtra={
            organization?.supportContact ? (
              <p className="auth-screen__note">
                {fillCopy(ISCRIZIONE.supporto, { contatto: organization.supportContact })}
              </p>
            ) : null
          }
          autoFocusTitle
          footNotes={forParent ? { signup: ISCRIZIONE.accountPiedeGenitore } : undefined}
          initialMode="signup"
          key={flow.per}
          leads={{
            login: forParent ? ISCRIZIONE.accountLeadGenitore : ISCRIZIONE.accountLeadIo,
            signup: forParent ? ISCRIZIONE.accountLeadGenitore : ISCRIZIONE.accountLeadIo,
          }}
          signupNote={organization?.accountHelpText || ACCEDI.notaDati}
          tabOrder={["signup", "login"]}
          titles={{
            login: forParent ? ISCRIZIONE.accountTitoloGenitore : ISCRIZIONE.accountTitoloIo,
            signup: forParent ? ISCRIZIONE.accountTitoloGenitore : ISCRIZIONE.accountTitoloIo,
          }}
        />
      </div>
    );
  }

  if (flow.screen === "dati" && session && organization) {
    // Dirigenti, admin e chi ha una data di nascita da minore completano i
    // loro dati, anche se hanno scelto il figlio: la scheda dopo dice cosa serve.
    const forParent =
      flow.per === "figlio" &&
      canBecomeParent(session.profile.role, session.profile.birthDate, new Date());

    return (
      <div className="page page--flow">
        {header}
        {errorNotices}
        <ProfileForm
          aside={
            forParent ? (
              <p className="flow-aside">
                <AppIcon name="user" />
                <span>
                  {PROFILO.menoDi18}{" "}
                  <button
                    className="flow-aside__link"
                    onClick={() => goTo("io", "dati")}
                    type="button"
                  >
                    {PROFILO.seiTuAPartecipare}
                  </button>
                </span>
              </p>
            ) : null
          }
          autoFocusTitle
          footNote={PROFILO.piede}
          key={session.firebaseUser.uid}
          lead={forParent ? PROFILO.leadGenitore : PROFILO.leadIo}
          organization={organization}
          submitLabel={PROFILO.continua}
          title={forParent ? PROFILO.titoloDati : PROFILO.titoloIo}
          variant={forParent ? "genitore" : "io"}
        />
      </div>
    );
  }

  if (flow.screen === "serve-genitore" && session) {
    const firstName = session.profile.firstName || accountName;
    const age = getAgeOn(session.profile.birthDate, new Date());
    const category = session.profile.genderRoleCategory;

    return (
      <div className="page page--flow">
        {header}
        {errorNotices}
        {isMinorAccount ? (
          <AccountNeededCard
            body={fillCopy(CHI_PARTECIPA.serveGenitoreRagazzo, { nome: firstName })}
            busy={busyAccount}
            identity={{
              label: PERCORSO.seiEntratoCome,
              name: accountName,
              initials: getInitials(accountName),
              detail:
                age !== null && category
                  ? fillCopy(CHI_PARTECIPA.etaEGruppo, {
                      eta: String(age),
                      gruppo: CATEGORY_LABELS[category],
                    })
                  : undefined,
            }}
            primary={{
              icon: "logout",
              label: CHI_PARTECIPA.esciEAccediComeGenitore,
              onClick: () => void handleSwitchAccount("figlio"),
            }}
            secondary={{
              label: fillCopy(CHI_PARTECIPA.iscriviConIlSuoAccount, { nome: firstName }),
              onClick: () => goTo("io", "modulo"),
            }}
            title={CHI_PARTECIPA.serveGenitoreTitolo}
          />
        ) : (
          <AccountNeededCard
            body={CHI_PARTECIPA.serveGenitoreAdulto}
            busy={busyAccount}
            primary={{
              icon: "logout",
              label: CHI_PARTECIPA.cambiaAccount,
              onClick: () => void handleSwitchAccount("figlio"),
            }}
            secondary={{
              label: CHI_PARTECIPA.partecipoIoInvece,
              onClick: () => goTo("io", null),
            }}
            title={CHI_PARTECIPA.serveGenitoreTitolo}
          />
        )}
      </div>
    );
  }

  if (flow.screen === "solo-figli") {
    return (
      <div className="page page--flow">
        {header}
        {errorNotices}
        <AccountNeededCard
          body={CHI_PARTECIPA.soloFigliTesto}
          busy={busyAccount}
          primary={{
            icon: "logout",
            label: CHI_PARTECIPA.cambiaAccount,
            onClick: () => void handleSwitchAccount("io"),
          }}
          secondary={{
            label: CHI_PARTECIPA.iscrivoFiglioInvece,
            onClick: () => goTo("figlio", null),
          }}
          title={CHI_PARTECIPA.soloFigliTitolo}
        />
      </div>
    );
  }

  if (flow.screen === "figlio") {
    return (
      <div className="page page--flow page--flow-wide">
        {header}
        {errorNotices}
        {formConfig && !anonymousCompletion ? (
          <SectionCard title="Chi vuoi iscrivere?" description={ISCRIZIONE.scegliFiglio}>
            {data.children.length === 0 ? (
              <EmptyState
                title={ISCRIZIONE.nessunFiglioTitolo}
                description={ISCRIZIONE.nessunFiglioTesto}
                action={
                  <Link className="button button--primary" to="/family">
                    {ISCRIZIONE.vaiAFamiglia}
                  </Link>
                }
              />
            ) : (
              <div className="inline-actions">
                {data.children.map((child) => (
                  <Link
                    key={child.id}
                    className="button button--primary"
                    state={{ registerFrom: searchParams.toString() } satisfies RegisterHistoryState}
                    to={{
                      search: buildRegisterSearch(searchParams, {
                        per: "figlio",
                        passo: "modulo",
                        child: child.id,
                      }),
                    }}
                  >
                    <AppIcon name="user" />
                    <span>{child.fullName || child.firstName}</span>
                  </Link>
                ))}
                <Link className="button button--ghost" to="/family">
                  <AppIcon name="plus" />
                  <span>{ISCRIZIONE.aggiungiFiglio}</span>
                </Link>
              </div>
            )}
          </SectionCard>
        ) : null}
      </div>
    );
  }

  // Modulo (F), con le iscrizioni da ospite e quelle già presenti.
  return (
    <div className="page page--flow page--flow-wide">
      {header}
      {errorNotices}

      {audienceMismatch ? (
        <div className="notice notice--warning">
          <div>
            <h3>Iscrizione non disponibile</h3>
            <p>{getAudienceRestrictionMessage(event.audience)}</p>
          </div>
        </div>
      ) : null}

      {anonymousCompletion ? (
        <SectionCard
          title="Iscrizione completata"
          description={ISCRIZIONE.completataSenzaAccount}
        >
          <div className="stack">
            <div className="notice notice--info">
              <div>
                <h3>Codice di recupero</h3>
                <p>
                  Conserva questo codice:{" "}
                  <strong>
                    {anonymousCompletion.recoveryCode || anonymousCompletion.accessCode}
                  </strong>
                  . Lo ritrovi anche nel PDF riepilogativo.
                </p>
              </div>
              <StatusBadge
                label={getRegistrationStatusLabel(anonymousCompletion.registrationStatus)}
                tone={getRegistrationStatusTone(anonymousCompletion.registrationStatus)}
              />
            </div>

            <div className="inline-actions">
              <Link
                className="button button--primary"
                onClick={() => {
                  writePendingAccountProfile({
                    firstName: anonymousCompletion.firstName,
                    lastName: anonymousCompletion.lastName,
                    birthDate: anonymousCompletion.birthDate,
                    genderRoleCategory: anonymousCompletion.genderRoleCategory,
                    unitName: anonymousCompletion.unitNameSnapshot,
                  });
                }}
                to={getLoginPath(`/me/activities/${eventId}`, "crea")}
              >
                <AppIcon name="user" />
                <span>{ISCRIZIONE.creaUnAccount}</span>
              </Link>
              <button
                className="button button--ghost"
                disabled={busy !== null}
                onClick={() => void handleDownloadPdf()}
                type="button"
              >
                <AppIcon name="download" />
                <span>{busy === "pdf" ? "Generazione PDF..." : "PDF riepilogo"}</span>
              </button>
              {session?.isAnonymous ? (
                <button
                  className="button button--soft"
                  disabled={busy !== null}
                  onClick={() => setResetSheetOpen(true)}
                  type="button"
                >
                  <AppIcon name="plus" />
                  <span>
                    {busy === "reset"
                      ? "Apertura sessione..."
                      : "Iscrivi un'altra persona"}
                  </span>
                </button>
              ) : null}
            </div>

            <p className="subtle-text">
              {organization?.codeRecoveryHelpText ||
                "Se preferisci continuare senza account, conserva il PDF e il codice di recupero."}
            </p>

            {session?.isAnonymous ? (
              <p className="subtle-text">
                {ISCRIZIONE.altraPersonaAiuto} <strong>{ISCRIZIONE.altraPersonaSalva}</strong>
              </p>
            ) : null}
          </div>
        </SectionCard>
      ) : null}

      {data.registration && !anonymousCompletion ? (
        <div className="notice notice--info">
          <div>
            <h3>Iscrizione già presente</h3>
            <p>
              Stato corrente: {getRegistrationStatusLabel(data.registration.registrationStatus)}.
              Le modifiche verranno salvate sullo stesso documento.
            </p>
            {data.registration.registrationStatus === "pending_parent_authorization" ? (
              <p style={{ marginTop: "0.6rem" }}>
                <strong>Email autorizzazione inviata al genitore.</strong> Se non la trovate
                in arrivo entro qualche minuto, controllate la <strong>cartella spam</strong>
                {" "}o <strong>posta indesiderata</strong>. Per iCloud/Outlook può capitare
                che venga filtrata: contrassegnatela come "non spam" per vederla. Mittente:
                {" "}<code>noreply@gugditalia.it</code>.
              </p>
            ) : null}
            {session?.isAnonymous ? (
              <p style={{ marginTop: "0.6rem" }}>
                {ISCRIZIONE.altraPersonaDomanda}{" "}
                <button
                  className="button button--soft button--small"
                  disabled={busy !== null}
                  onClick={() => setResetSheetOpen(true)}
                  type="button"
                >
                  <AppIcon name="plus" />
                  <span>
                    {busy === "reset"
                      ? "Apertura sessione..."
                      : "Iscrivi un'altra persona"}
                  </span>
                </button>{" "}
                {ISCRIZIONE.altraPersonaSalvaCodice}
              </p>
            ) : null}
          </div>
          <StatusBadge
            label={getRegistrationStatusLabel(data.registration.registrationStatus)}
            tone={getRegistrationStatusTone(data.registration.registrationStatus)}
          />
        </div>
      ) : null}

      {selectedChild && !anonymousCompletion ? (
        <div className="notice notice--info">
          <div>
            <h3>Stai iscrivendo {selectedChild.fullName || selectedChild.firstName}</h3>
            <p>
              {fillCopy(ISCRIZIONE.salvataSulProfilo, {
                nome: selectedChild.firstName || ISCRIZIONE.tuoFiglio,
              })}
            </p>
          </div>
        </div>
      ) : null}

      {formConfig && !canSubmit && !audienceMismatch && !anonymousCompletion ? (
        <div className="notice notice--warning">
          <div>
            <h3>{CHI_PARTECIPA.chiuseTitolo}</h3>
            <p>{CHI_PARTECIPA.chiuseTesto}</p>
          </div>
        </div>
      ) : null}

      {formConfig && canSubmit && !anonymousCompletion ? (
        <SectionCard title={data.registration ? "Aggiorna iscrizione" : "Compila il modulo"}>
          <RegistrationEditor
            busy={busy === "save"}
            event={event}
            formConfig={formConfig}
            initialRegistration={
              data.registration ?? (selectedChild ? buildChildPrefill(selectedChild) : null)
            }
            parentDetailsSource={data.parentDetailsSource}
            session={session}
            standardFieldDefinitions={getVisibleStandardFieldDefinitions(
              organization?.registrationDefaults.fieldOverrides,
            )}
            minorConsentExampleImageUrl={organization?.minorConsentExampleImageUrl}
            unitOptions={organization?.units ?? []}
            submitLabel={data.registration ? "Salva modifiche" : "Conferma iscrizione"}
            onDirtyChange={setFormDirty}
            onSubmit={handleSubmit}
          />
        </SectionCard>
      ) : null}

      {blocker.state === "blocked" || pendingExit ? (
        <ConfirmSheet
          body={ISCRIZIONE.esciTesto}
          cancelLabel={ISCRIZIONE.continuaACompilare}
          confirmLabel={ISCRIZIONE.esci}
          onCancel={() => {
            if (blocker.state === "blocked") {
              blocker.reset();
            }
            setPendingExit(null);
          }}
          onConfirm={() => {
            const action = pendingExit;
            setFormDirty(false);
            setPendingExit(null);

            if (blocker.state === "blocked") {
              blocker.proceed();
            } else {
              action?.();
            }
          }}
          title={ISCRIZIONE.esciTitolo}
        />
      ) : null}

      {resetSheetOpen ? (
        <ConfirmSheet
          body={ISCRIZIONE.altraPersonaConferma}
          busy={busy === "reset"}
          busyLabel={ISCRIZIONE.altraPersonaInCorso}
          cancelLabel={ISCRIZIONE.altraPersonaResta}
          confirmLabel={ISCRIZIONE.altraPersonaVai}
          onCancel={() => setResetSheetOpen(false)}
          onConfirm={() => void handleResetAnonymousSession()}
          title={ISCRIZIONE.altraPersonaTitolo}
        />
      ) : null}

      {event.questionsEnabled && data.registration && session ? (
        <QuestionsSection
          eventId={event.id}
          registration={data.registration}
          session={session}
          stakeId={data.stakeId}
        />
      ) : null}
    </div>
  );
}
