import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
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
import { AdultGuardCard } from "@/components/register/AdultGuardCard";
import { ChiIscriviStep } from "@/components/register/ChiIscriviStep";
import { ChiPartecipaStep } from "@/components/register/ChiPartecipaStep";
import { getChildUnitOptions } from "@/components/register/ChildForm";
import { ChildSheet } from "@/components/register/ChildSheet";
import { IscrizioneInviataStep } from "@/components/register/IscrizioneInviataStep";
import { RegisterFlowHeader } from "@/components/register/RegisterFlowHeader";
import {
  RegistrationEditor,
  type ParentAccountPrefill,
  type RegistrationEditorDraft,
} from "@/components/RegistrationEditor";
import { SectionCard } from "@/components/SectionCard";
import { StatusBadge } from "@/components/StatusBadge";
import { ACCEDI } from "@/copy/accedi";
import { CHI_ISCRIVI } from "@/copy/chiIscrivi";
import { CHI_PARTECIPA } from "@/copy/chiPartecipa";
import { INVIATA } from "@/copy/inviata";
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
import { parentAuthorizationService } from "@/services/firestore/parentAuthorizationService";
import { questionsService } from "@/services/firestore/questionsService";
import { registrationAttemptsService } from "@/services/firestore/registrationAttemptsService";
import { registrationsService } from "@/services/firestore/registrationsService";
import { unitsService } from "@/services/firestore/unitsService";
import type {
  AuthSession,
  ChildProfile,
  GenderRoleCategory,
  OrganizationProfile,
  Registration,
  RegistrationWriteInput,
  Unit,
} from "@/types";
import {
  applyChildIdentity,
  getActivityFirstDay,
  getAvatarTone,
  getChildChoiceState,
  getChildFormInitial,
  getInitialChildChoice,
  getInitials,
  getRegisterDraftKey,
  isLiveRegistration,
  validateChildForm,
  type ChildFormValues,
} from "@/utils/childChoice";
import {
  getAdultGuardAge,
  getAdultGuardKey,
  needsExistingAccountGuard,
  readAdultGuardConfirmations,
  writeAdultGuardConfirmation,
} from "@/utils/adultGuard";
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
  canChooseAccountType,
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
import { isConnectionError, isOffline, withWriteTimeout } from "@/utils/writeTimeout";
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
  // Unità del palo per il foglio del figlio (solo account da genitore).
  units: Unit[];
  // "Già iscritto": l'iscrizione di ogni figlio a questa attività, o null.
  childRegistrations: Record<string, Registration | null>;
  // Per quali parametri sono stati letti questi dati: al cambio di figlio,
  // il primo render dopo la navigazione ha ancora quelli del figlio di prima.
  loadedFor: string;
}

// Stato della cronologia lasciato dai passi: la freccia in alto torna indietro
// con la cronologia (non con una voce nuova) quando il passo prima è lì.
interface RegisterHistoryState {
  registerFrom?: string;
  fromActivity?: boolean;
  // «I tuoi dati» aperto dalla guardia in cima al modulo per un profilo già
  // completo (docs/FLUSSO_GENITORE.md, G): da dove ripartire nel passo.
  ownData?: "data" | "dirigente";
}

const initialData: RegisterPageData = {
  stakeId: "",
  organization: null,
  event: null,
  formConfig: null,
  registration: null,
  parentDetailsSource: null,
  children: [],
  units: [],
  childRegistrations: {},
  loadedFor: "",
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

// Nome da mostrare per l'account: nome e cognome, altrimenti l'email.
function getAccountName(session: AuthSession) {
  const email = session.firebaseUser.email || session.profile.email || "";
  return isPlaceholderName(session.profile.fullName) ||
    isEmailDerivedName(session.profile.fullName, email)
    ? email
    : session.profile.fullName.trim();
}

// Nome e cognome veri (non il segnaposto né la parte dell'email).
function accountHasName(session: AuthSession) {
  const email = session.firebaseUser.email || session.profile.email || "";
  return (
    !isPlaceholderName(session.profile.fullName) &&
    !isEmailDerivedName(session.profile.fullName, email)
  );
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
  const loadKey = [eventId ?? "", requestedStakeId, sessionKey, childIdParam].join("|");

  const { data, loading, error, setData, reload } = useAsyncData(
    async () => {
      if (!eventId) {
        return { ...initialData, loadedFor: loadKey };
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
      const parentUid = isParentSession && session ? session.firebaseUser.uid : "";
      const [organization, event, formConfig, registration, children, units] = await Promise.all([
        organizationService.getProfile(stakeId),
        eventsService.getPublicEventById(stakeId, eventId),
        eventFormsService.getFormConfig(stakeId, eventId),
        hasLookup
          ? registrationsService.getRegistrationByActor(stakeId, eventId, lookup)
          : Promise.resolve(null),
        parentUid ? childrenService.listChildren(parentUid) : Promise.resolve([]),
        parentUid ? unitsService.listActiveUnits(stakeId) : Promise.resolve([]),
      ]);

      if (!event) {
        return {
          ...initialData,
          stakeId,
          organization,
          children,
          units,
          loadedFor: loadKey,
        };
      }

      // "Chi iscrivi?" mostra "Già iscritto" per ogni figlio: l'id è fisso
      // (`child_<genitore>_<figlio>`) e le rules lo lasciano leggere anche
      // quando manca. Una lettura fallita lascia la scheda selezionabile:
      // l'id fisso impedisce comunque un doppione (il salvataggio aggiorna).
      const childRegistrationList = parentUid
        ? await Promise.all(
            children.map((child) =>
              registrationsService
                .getRegistrationByActor(stakeId, eventId, {
                  userId: null,
                  anonymousAuthUid: null,
                  anonymousUid: null,
                  parentUid,
                  childId: child.id,
                })
                .catch((caughtError: unknown) => {
                  console.warn("Iscrizione del figlio non letta.", caughtError);
                  return null;
                }),
            ),
          )
        : [];
      const childRegistrations: Record<string, Registration | null> = {};
      children.forEach((child, index) => {
        childRegistrations[child.id] = childRegistrationList[index] ?? null;
      });

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
        units,
        childRegistrations,
        loadedFor: loadKey,
      };
    },
    [eventId, requestedStakeId, sessionKey, childIdParam],
    initialData,
  );
  // Dati di un altro figlio (o di prima del cambio di account): si aspetta.
  // Un errore lascia i dati di prima: si mostra l'errore, non il caricamento.
  const loadingData = loading || (!error && data.loadedFor !== loadKey);
  const loadFailed = Boolean(error) && data.loadedFor !== loadKey;

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
  // Primo giorno dell'attività: età e avvisi (figli, guardia adulto) valgono
  // per quel giorno.
  const activityFirstDay = getActivityFirstDay(event?.startDate, new Date());
  // Guardia adulto (docs/FLUSSO_GENITORE.md, G): "Confermo, partecipo io come
  // giovane" vale per account, attività e data di nascita.
  const [guardConfirmations, setGuardConfirmations] = useState(() =>
    readAdultGuardConfirmations(),
  );
  const guardUid = session && !session.isAnonymous ? session.firebaseUser.uid : "";
  const isGuardConfirmed = (birthDate: string) =>
    Boolean(
      guardUid &&
        event &&
        guardConfirmations.has(getAdultGuardKey({ uid: guardUid, eventId: event.id, birthDate })),
    );
  const confirmAdultGuard = (birthDate: string) => {
    if (!guardUid || !event) {
      return;
    }

    const key = getAdultGuardKey({ uid: guardUid, eventId: event.id, birthDate });
    writeAdultGuardConfirmation(key);
    setGuardConfirmations((current) => new Set(current).add(key));
  };
  // Un'iscrizione annullata non ferma la guardia: si sta iscrivendo di nuovo.
  const hasLiveOwnRegistration = isLiveRegistration(data.registration) && !selectedChild;
  const existingAccountGuard = Boolean(
    session &&
      event &&
      isUserAccount &&
      needsExistingAccountGuard({
        role: session.profile.role,
        profileComplete,
        category: session.profile.genderRoleCategory,
        birthDate: session.profile.birthDate,
        firstDay: activityFirstDay,
        hasOwnRegistration: hasLiveOwnRegistration,
        confirmed: isGuardConfirmed(session.profile.birthDate || ""),
      }),
  );
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
    submitted: isLiveRegistration(data.registration),
    adultGuard: existingAccountGuard,
    parentHasChildren: isParentSession ? data.children.length > 0 : undefined,
    editOwnData: Boolean(historyState?.ownData),
  });
  const keepChild =
    flow.per === "figlio" &&
    (flow.screen === "figlio" || flow.screen === "modulo" || flow.screen === "inviata");
  const canonicalSearch = buildRegisterSearch(searchParams, {
    per: flow.per,
    passo: flow.passo,
    child: keepChild ? undefined : null,
  });
  const ready =
    !authLoading && !loadingData && !loadFailed && Boolean(event) && !resettingGuest;

  // Bozze del modulo in memoria per account, attività e persona
  // (docs/FLUSSO_GENITORE.md, F): da Marco a Giulia e di nuovo a Marco si
  // ritrovano le risposte di Marco; i dati sanitari non passano a un altro
  // figlio. Uscire dall'iscrizione o dall'account le cancella.
  const draftsRef = useRef(new Map<string, RegistrationEditorDraft>());
  const draftUid = session && !session.isAnonymous ? session.firebaseUser.uid : "";
  const currentDraftKey =
    draftUid && event
      ? getRegisterDraftKey({
          uid: draftUid,
          stakeId: data.stakeId,
          eventId: event.id,
          childId: selectedChild?.id ?? null,
        })
      : null;
  const handleDraftChange = useCallback((draft: RegistrationEditorDraft, key: string | undefined) => {
    if (key) {
      draftsRef.current.set(key, draft);
    }
  }, []);

  // Risposte non inviate (il modulo aperto o le bozze di altri figli): uscire
  // dall'iscrizione (link, indietro del browser fuori dalla pagina, "Esci",
  // "Cambia account") passa dal foglio "Esci dall'iscrizione?". Dentro il
  // percorso ("Cambia", freccia, un altro figlio) le bozze restano: niente foglio.
  // Prima degli effetti che navigano: useBlocker aggiorna la sua funzione in
  // un suo effetto, e quegli effetti devono trovarla già aggiornata.
  const [formDirty, setFormDirty] = useState(false);
  const submittingRef = useRef(false);
  const [pendingExit, setPendingExit] = useState<null | (() => void)>(null);
  const hasUnsentAnswers = () =>
    (formDirty && flow.screen === "modulo") || draftsRef.current.size > 0;
  const blocker = useBlocker(({ currentLocation, nextLocation }) => {
    if (submittingRef.current || !hasUnsentAnswers()) {
      return false;
    }

    return nextLocation.pathname !== currentLocation.pathname;
  });

  useEffect(() => {
    if (flow.screen !== "modulo") {
      setFormDirty(false);
    }

    // Indietro del browser con il foglio aperto: il foglio non torna da solo.
    if (flow.screen !== "figlio") {
      setChildSheet(null);
    }
  }, [flow.screen]);

  // "Chi iscrivi?": la scelta fatta, il foglio del figlio, il modulo aperto
  // quando non ci sono figli salvati.
  const [childChoice, setChildChoice] = useState<string | null>(null);
  const [childSheet, setChildSheet] = useState<null | {
    child: ChildProfile | null;
    draft: { childId: string; createdAt: string } | null;
  }>(null);
  const [inlineChild, setInlineChild] = useState<ChildFormValues | null>(null);
  const [inlineError, setInlineError] = useState<string | null>(null);
  const [inlineBusy, setInlineBusy] = useState(false);
  const inlineDraftRef = useRef<{ childId: string; createdAt: string } | null>(null);
  const childSavingRef = useRef(false);
  // Doppio tocco su "Invia": una scrittura sola.
  const savingRef = useRef(false);
  // "Iscrizione inviata" segue l'iscrizione dal vivo.
  const [liveRegistration, setLiveRegistration] = useState<Registration | null>(null);
  const [authorizing, setAuthorizing] = useState(false);
  const [authorizeError, setAuthorizeError] = useState<string | null>(null);
  const authorizingRef = useRef(false);
  // Unità del foglio: quelle attive del palo, più quella salvata sul figlio
  // in modifica se nel frattempo non è più in elenco.
  const unitOptions = getChildUnitOptions(
    data.units,
    childSheet?.child
      ? { unitId: childSheet.child.unitId, unitName: childSheet.child.unitName }
      : null,
  );

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
    // Cambio di account o uscita: bozze e scelte dell'account di prima spariscono.
    draftsRef.current.clear();
    setFormDirty(false);
    setChildChoice(null);
    setChildSheet(null);
    setInlineChild(null);
    setInlineError(null);
    inlineDraftRef.current = null;
    setLiveRegistration(null);

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

  // Conferme della guardia adulto: AuthProvider le cancella a ogni uscita o
  // cambio di account; la pagina le rilegge a ogni account, anche al primo
  // accesso con la pagina già aperta.
  useEffect(() => {
    setGuardConfirmations(readAdultGuardConfirmations());
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

  // "Iscrizione inviata": l'iscrizione dal vivo (esito della mail, firma).
  const watchedRegistration =
    flow.screen === "inviata" && data.registration && data.stakeId && event
      ? `${data.stakeId}|${event.id}|${data.registration.id}`
      : "";
  useEffect(() => {
    if (!watchedRegistration) {
      setLiveRegistration(null);
      return;
    }

    const [stakeId, eventIdToWatch, registrationId] = watchedRegistration.split("|");
    return registrationsService.watchRegistration(
      stakeId,
      eventIdToWatch,
      registrationId,
      (next) => setLiveRegistration(next),
    );
  }, [watchedRegistration]);

  // Azioni che non sono una navigazione (uscita dall'account): stesso foglio.
  function confirmExitThen(action: () => void) {
    if (hasUnsentAnswers()) {
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

  // Dalla guardia in cima al modulo: «I tuoi dati» del profilo già salvato,
  // con il cursore sulla data o con Dirigente già scelto.
  function openOwnData(start: "data" | "dirigente") {
    setActionError(null);
    navigate(
      { search: buildRegisterSearch(searchParams, { per: "io", passo: "dati", child: null }) },
      {
        state: {
          registerFrom: searchParams.toString(),
          ownData: start,
        } satisfies RegisterHistoryState,
      },
    );
  }

  // «I tuoi dati» aperto dalla guardia: la voce prima è quella del modulo
  // (la guardia), e si torna lì, salvando o con la freccia, senza lasciare
  // due voci del modulo una dopo l'altra.
  const openedFromGuard =
    Boolean(historyState?.ownData) &&
    parseRegisterPasso(new URLSearchParams(historyState?.registerFrom ?? "").get("passo")) ===
      "modulo";

  // «I tuoi dati» salvato da chi partecipa: si va al modulo, e indietro non
  // riporta al passo appena chiuso.
  function handleOwnDataSaved() {
    if (openedFromGuard) {
      navigate(-1);
      return;
    }

    navigate(
      { search: buildRegisterSearch(searchParams, { per: "io", passo: "modulo", child: null }) },
      {
        replace: true,
        state: {
          registerFrom: historyState?.registerFrom,
          fromActivity: historyState?.fromActivity,
        } satisfies RegisterHistoryState,
      },
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

    if (flow.screen === "dati" && openedFromGuard) {
      navigate(-1);
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
    if (savingRef.current) {
      return;
    }

    if (!data.event || !data.stakeId || !session) {
      setActionError("Serve una sessione valida per salvare la registrazione.");
      return;
    }

    const lookup = getRegistrationLookupFromSession(session, childIdParam || null);

    if (!lookup.userId && !lookup.anonymousUid && !lookup.parentUid) {
      setActionError("Impossibile determinare il proprietario della registrazione.");
      return;
    }

    const currentEvent = data.event;
    const stakeId = data.stakeId;
    const networkMessage = ISCRIZIONE.invioRete;

    // Senza rete non si prova nemmeno: la scrittura resterebbe in coda e
    // partirebbe da sola più tardi, dopo che abbiamo detto che non è partita.
    if (isOffline()) {
      setActionError(networkMessage);
      return;
    }

    // Prima iscrizione (o una annullata risalvata): dopo l'invio si va su
    // "Iscrizione inviata". Una modifica torna dove tornava.
    const isNewSubmission = !isLiveRegistration(data.registration);
    const draftKey = currentDraftKey;
    savingRef.current = true;
    setBusy("save");
    setActionError(null);

    let attemptLogId: string | null = null;

    try {
      // Senza risposta dal server il pulsante torna attivo e le risposte
      // restano: un esito che arriva dopo non sposta più la pagina (la
      // scrittura in coda parte da sola e "Chi iscrivi?" la mostra).
      const savedRegistration = await withWriteTimeout(
        (async () => {
          attemptLogId = await registrationAttemptsService.startAttempt({
            stakeId,
            eventId: currentEvent.id,
            eventTitle: currentEvent.title,
            lookup,
            input,
          });

          setLatestAttemptLogId(attemptLogId);

          const saved = await registrationsService.upsertRegistration(
            stakeId,
            currentEvent.id,
            lookup,
            input,
          );

          if (!saved) {
            throw new Error("La registrazione non è stata riletta correttamente.");
          }

          return saved;
        })(),
      );

      // Registro dei tentativi e domande del caminetto: scritture di contorno,
      // in coda senza aspettarle. L'iscrizione è salvata: se la rete cade
      // adesso, la pagina va avanti lo stesso e loro partono al ritorno.
      void registrationAttemptsService.markStep(stakeId, attemptLogId, {
        lastStep: "registration_saved",
        registrationId: savedRegistration.id,
        registrationStatus: savedRegistration.registrationStatus,
      });

      // Iscrizione inviata: la scelta "per chi" non serve più, la bozza nemmeno.
      clearStoredRegisterFor();
      if (draftKey) {
        draftsRef.current.delete(draftKey);
      }

      // Domande caminetto raccolte inline nel form: ora che la registrazione
      // esiste possiamo creare i doc /questions. Errori non bloccano (le
      // domande sono facoltative): logghiamo soltanto.
      if (input.pendingQuestions && input.pendingQuestions.length > 0) {
        const authorName =
          session.isAnonymous
            ? savedRegistration.fullName
            : session.profile.fullName || savedRegistration.fullName;
        const questions = input.pendingQuestions;
        void (async () => {
          for (const draft of questions) {
            try {
              await questionsService.create(
                stakeId,
                currentEvent.id,
                savedRegistration.id,
                lookup,
                authorName,
                { text: draft.text, isAnonymous: draft.isAnonymous },
              );
            } catch (questionError) {
              console.error("Creazione domanda caminetto fallita", questionError);
            }
          }
        })();
      }

      let nextRegistration = savedRegistration;

      if (session.isAnonymous && lookup.anonymousUid) {
        const recoveryCode =
          savedRegistration.recoveryCode ?? savedRegistration.accessCode ?? "";

        if (!recoveryCode) {
          throw new Error("Codice di recupero non disponibile.");
        }

        const recovered = await registrationsService.saveAnonymousRecovery(
          stakeId,
          currentEvent.id,
          savedRegistration.id,
          {
            anonymousUid: lookup.anonymousUid,
            anonymousTokenId:
              savedRegistration.anonymousTokenId ?? createAnonymousTokenId(),
            recoveryCode,
            pdfDataSummary: {
              eventTitle: currentEvent.title,
              fullName: savedRegistration.fullName,
              email: savedRegistration.email,
              submittedAt: savedRegistration.updatedAt,
            },
            recoveryPdfGenerated: savedRegistration.recoveryPdfGenerated,
          },
        );

        nextRegistration = recovered ?? savedRegistration;
        void registrationAttemptsService.markStep(stakeId, attemptLogId, {
          lastStep: "recovery_saved",
          registrationId: nextRegistration.id,
          registrationStatus: nextRegistration.registrationStatus,
        });
        setAnonymousCompletion(nextRegistration);
        setFormDirty(false);
        setData((current) => ({ ...current, registration: nextRegistration }));
        window.scrollTo({ top: 0, behavior: "smooth" });
        void registrationAttemptsService.markSucceeded(
          stakeId,
          attemptLogId,
          nextRegistration,
          "completed",
        );
        return;
      }

      void registrationAttemptsService.markSucceeded(
        stakeId,
        attemptLogId,
        nextRegistration,
        "completed",
      );
      submittingRef.current = true;
      setFormDirty(false);

      if (isNewSubmission) {
        // I dati prima della navigazione: "Iscrizione inviata" vale solo con
        // l'iscrizione salvata, altrimenti la pagina tornerebbe al modulo.
        setData((current) => ({
          ...current,
          registration: nextRegistration,
          childRegistrations: lookup.childId
            ? { ...current.childRegistrations, [lookup.childId]: nextRegistration }
            : current.childRegistrations,
        }));
        setLiveRegistration(nextRegistration);
        goTo(flow.per ?? (lookup.parentUid ? "figlio" : "io"), "inviata", {
          replace: true,
          child: lookup.childId ?? null,
        });
        submittingRef.current = false;
      } else if (lookup.parentUid) {
        navigate("/family", { replace: true });
      } else {
        navigate(`/me/activities/${currentEvent.id}`, { replace: true });
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
        stakeId,
        eventId: currentEvent.id,
        lookup,
      });

      if (isConnectionError(caughtError)) {
        // Il tentativo resta "started": il registro non si scrive senza rete.
        setActionError(networkMessage);
        return;
      }

      await registrationAttemptsService.markFailed(
        stakeId,
        attemptLogId,
        "submit_failed",
        caughtError,
      );
      const code =
        caughtError && typeof caughtError === "object" && "code" in caughtError
          ? String((caughtError as { code?: unknown }).code ?? "")
          : "";
      // Gli errori di Firebase arrivano in inglese: per l'utente una frase
      // italiana con il codice; i nostri (pubblico, unità) restano come sono.
      setActionError(
        code
          ? `${ISCRIZIONE.invioErrore} (codice: ${code})`
          : caughtError instanceof Error
            ? caughtError.message
            : ISCRIZIONE.invioErrore,
      );
    } finally {
      savingRef.current = false;
      setBusy(null);
    }
  }

  // Scrive il figlio nell'account (foglio "Aggiungi", modifica, modulo aperto
  // senza figli) e aggiorna la lista senza rileggere tutto.
  async function saveChild(
    values: ChildFormValues,
    existing: ChildProfile | null,
    draft: { childId: string; createdAt: string } | null,
  ): Promise<ChildProfile> {
    if (!session || session.isAnonymous || !data.stakeId) {
      throw new Error(CHI_ISCRIVI.erroreSalvataggio);
    }

    if (isOffline()) {
      throw new Error(CHI_ISCRIVI.erroreRete);
    }

    const parentUid = session.firebaseUser.uid;
    const unit = unitOptions.find((option) => option.id === values.unitId) ?? null;
    const input = {
      firstName: values.firstName,
      lastName: values.lastName,
      birthDate: values.birthDate,
      genderRoleCategory: values.genderRoleCategory,
      unitId: unit?.id ?? "",
      unitName: unit?.name ?? "",
      stakeId: existing?.stakeId || data.stakeId,
    };

    const firstName = input.firstName.trim();
    const lastName = input.lastName.trim();
    const edited: ChildProfile | null = existing
      ? {
          ...existing,
          ...input,
          firstName,
          lastName,
          fullName: `${firstName} ${lastName}`.trim(),
          unitName: input.unitName.trim(),
          updatedAt: new Date().toISOString(),
        }
      : null;
    const showChild = (child: ChildProfile) =>
      setData((current) => ({
        ...current,
        children: [...current.children.filter((item) => item.id !== child.id), child].sort(
          (left, right) => left.fullName.localeCompare(right.fullName, "it-IT"),
        ),
      }));

    try {
      let saved: ChildProfile;

      if (existing && edited) {
        await withWriteTimeout(childrenService.updateChild(parentUid, existing.id, input));
        saved = edited;
      } else {
        saved = await withWriteTimeout(
          childrenService.createChild(parentUid, input, draft ?? undefined),
        );
      }

      showChild(saved);
      return saved;
    } catch (caughtError) {
      console.error("[child save] failed", caughtError);

      // Senza rete la modifica resta in coda e arriverà: la lista e la bozza
      // del suo modulo seguono già i dati nuovi (la data decide l'autorizzazione).
      if (edited && isConnectionError(caughtError)) {
        showChild(edited);
        refreshDraftIdentity(edited);
      }

      // Senza rete la creazione resta in coda e la cache la conosce già: il
      // figlio compare nella lista, così chiudere e riaprire "Aggiungi" non
      // ne crea un secondo.
      if (!existing && isConnectionError(caughtError)) {
        void childrenService
          .listChildren(parentUid)
          .then((children) => setData((current) => ({ ...current, children })))
          .catch(() => undefined);
      }

      throw new Error(
        isConnectionError(caughtError) ? CHI_ISCRIVI.erroreRete : CHI_ISCRIVI.erroreSalvataggio,
      );
    }
  }

  async function handleSheetSave(values: ChildFormValues) {
    if (!childSheet || childSavingRef.current) {
      return;
    }

    childSavingRef.current = true;

    try {
      const saved = await saveChild(values, childSheet.child, childSheet.draft);

      if (childSheet.child) {
        refreshDraftIdentity(saved);
      }

      // "Salva" seleziona il figlio (se l'attività lo accetta).
      setChildChoice(saved.id);
      setChildSheet(null);
    } finally {
      childSavingRef.current = false;
    }
  }

  // Dati del figlio corretti con la matita: la bozza del suo modulo riparte
  // dal primo passo con nome, data, gruppo e unità nuovi. Quei campi sono
  // nascosti a chi ha già il profilo completo, e una data vecchia deciderebbe
  // se serve l'autorizzazione del genitore.
  function refreshDraftIdentity(child: ChildProfile) {
    if (!draftUid || !event) {
      return;
    }

    const key = getRegisterDraftKey({
      uid: draftUid,
      stakeId: data.stakeId,
      eventId: event.id,
      childId: child.id,
    });
    const draft = draftsRef.current.get(key);

    if (!draft) {
      return;
    }

    draftsRef.current.set(key, { stepIndex: 0, values: applyChildIdentity(draft.values, child) });
  }

  // Senza figli: "Salva e continua" porta al modulo di quel figlio.
  async function handleInlineSave(values: ChildFormValues) {
    if (childSavingRef.current) {
      return;
    }

    if (!session) {
      return;
    }

    if (!inlineDraftRef.current) {
      inlineDraftRef.current = childrenService.newChildDraft(session.firebaseUser.uid);
    }

    childSavingRef.current = true;
    setInlineBusy(true);
    setInlineError(null);
    setActionError(null);

    try {
      const saved = await saveChild(values, null, inlineDraftRef.current);
      inlineDraftRef.current = null;
      setInlineChild(null);
      setChildChoice(saved.id);

      if (event && getChildChoiceState(saved, event, null).kind === "selectable") {
        goTo("figlio", "modulo", { child: saved.id });
      }
    } catch (caughtError) {
      const message =
        caughtError instanceof Error ? caughtError.message : CHI_ISCRIVI.erroreSalvataggio;
      setInlineError(message);
      // Senza rete il figlio in coda compare nella lista e il modulo aperto
      // sparisce: il messaggio resta in cima alla pagina.
      if (message === CHI_ISCRIVI.erroreRete) {
        setActionError(message);
      }
    } finally {
      childSavingRef.current = false;
      setInlineBusy(false);
    }
  }

  // "Autorizza ora" (G5): link di 60 minuti che invalida quello della mail,
  // poi la pagina di firma di oggi.
  function handleAuthorizeNow(registration: Registration) {
    if (authorizingRef.current) {
      return;
    }

    // Le bozze di un altro figlio si perderebbero: prima il foglio, poi il link.
    confirmExitThen(() => void issueOwnTokenAndOpen(registration));
  }

  async function issueOwnTokenAndOpen(registration: Registration) {
    if (authorizingRef.current) {
      return;
    }

    authorizingRef.current = true;
    setAuthorizing(true);
    setAuthorizeError(null);

    try {
      const { token } = await parentAuthorizationService.issueOwnToken({
        stakeId: registration.stakeId,
        activityId: registration.eventId,
        registrationId: registration.id,
      });
      navigate(`/parent-confirm/${token}`);
      authorizingRef.current = false;
      setAuthorizing(false);
    } catch (caughtError) {
      authorizingRef.current = false;
      const code = String((caughtError as { code?: unknown } | null)?.code ?? "");
      // I messaggi delle nostre callable sono già in italiano; quelli di rete no.
      setAuthorizeError(
        /^functions\/(failed-precondition|not-found|permission-denied|invalid-argument)$/u.test(code) &&
          caughtError instanceof Error &&
          caughtError.message
          ? caughtError.message
          : INVIATA.erroreAutorizza,
      );
      setAuthorizing(false);
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

  if (authLoading || loadingData) {
    return (
      <div className="page page--register-loading">
        <RegistrationLoadingState title={data.event?.title} />
      </div>
    );
  }

  if (loadFailed) {
    return (
      <div className="page">
        <EmptyState
          title={ISCRIZIONE.caricamentoTitolo}
          description={ISCRIZIONE.caricamentoTesto}
          action={
            <button className="button button--primary" onClick={reload} type="button">
              {ISCRIZIONE.riprova}
            </button>
          }
        />
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
  const selectedChildName = selectedChild
    ? selectedChild.fullName || `${selectedChild.firstName} ${selectedChild.lastName}`.trim()
    : "";
  const firstDay = activityFirstDay;
  // Passo "Genitore e sicurezza" del figlio: nome, email e telefono dell'account.
  const parentAccount: ParentAccountPrefill | null =
    session && isParentSession && selectedChild
      ? {
          firstName: accountHasName(session) ? session.profile.firstName : "",
          lastName: accountHasName(session) ? session.profile.lastName : "",
          email: session.profile.email || session.firebaseUser.email || "",
          phone: session.profile.phone || "",
        }
      : null;
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
      flow.screen === "guardia" ||
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
      // Modulo di un figlio: "Stai iscrivendo Marco Rossi · Cambia" (→ E).
      subject={
        flow.screen === "modulo" && flow.per === "figlio" && selectedChild
          ? {
              name: selectedChildName,
              initials: getInitials(selectedChildName),
              tone: getAvatarTone(selectedChildName),
              onChange: handleBack,
            }
          : null
      }
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

  // "Esci dall'iscrizione?" vale in ogni passo: le bozze di un figlio restano
  // anche mentre si guarda "Chi iscrivi?" o "Chi partecipa?".
  const exitSheet =
    blocker.state === "blocked" || pendingExit ? (
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
          draftsRef.current.clear();

          if (blocker.state === "blocked") {
            blocker.proceed();
          } else {
            action?.();
          }
        }}
        title={ISCRIZIONE.esciTitolo}
      />
    ) : null;


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
        {exitSheet}
      </div>
    );
  }

  if (flow.screen === "chi") {
    const category = session?.profile.genderRoleCategory || "";
    const isAdultCategory = category === "dirigente" || category === "accompagnatore";
    const partecipoIoDetail =
      isUserAccount && profileComplete && session
        ? isParentSession
          ? data.children.length > 0
            ? CHI_PARTECIPA.partecipoIoGenitore
            : CHI_PARTECIPA.partecipoIoGenitoreSenzaFigli
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
        {exitSheet}
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
        {exitSheet}
      </div>
    );
  }

  if (flow.screen === "dati" && session && organization) {
    // Dirigenti, admin e chi ha una data di nascita da minore completano i
    // loro dati, anche se hanno scelto il figlio: la scheda dopo dice cosa serve.
    const forParent =
      flow.per === "figlio" &&
      canBecomeParent(session.profile.role, session.profile.birthDate, new Date());
    const ownDataStart = profileComplete ? historyState?.ownData : undefined;

    return (
      <div className="page page--flow">
        {header}
        {errorNotices}
        <ProfileForm
          // Chi partecipa lui: guardia adulto al «Continua» della data (G).
          // Non per dirigenti e admin (completano i loro dati) né per chi ha
          // già un'iscrizione attiva (la modifica).
          adultGuard={
            flow.per === "io" &&
            canChooseAccountType(session.profile.role) &&
            !hasLiveOwnRegistration
              ? {
                  firstDay: activityFirstDay,
                  existingAccount: profileComplete,
                  isConfirmed: isGuardConfirmed,
                  onConfirm: confirmAdultGuard,
                  // Account nuovo: dati da genitore, niente salvato. Profilo
                  // già salvato: "Chi iscrivi?" (o la scheda che dice quale
                  // account serve), l'account resta com'è.
                  onChooseChild: () => {
                    writeStoredRegisterFor(event.id, "figlio");
                    goTo("figlio", profileComplete ? null : "dati");
                  },
                }
              : undefined
          }
          draftKey={`${session.firebaseUser.uid}|${event.id}`}
          onSaved={flow.per === "io" ? handleOwnDataSaved : undefined}
          start={ownDataStart}
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
          key={`${session.firebaseUser.uid}:${ownDataStart ?? ""}`}
          lead={forParent ? PROFILO.leadGenitore : PROFILO.leadIo}
          organization={organization}
          submitLabel={PROFILO.continua}
          title={forParent ? PROFILO.titoloDati : PROFILO.titoloIo}
          variant={forParent ? "genitore" : "io"}
        />
        {exitSheet}
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
              onClick: () => confirmExitThen(() => void handleSwitchAccount("figlio")),
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
              onClick: () => confirmExitThen(() => void handleSwitchAccount("figlio")),
            }}
            secondary={{
              label: CHI_PARTECIPA.partecipoIoInvece,
              onClick: () => goTo("io", null),
            }}
            title={CHI_PARTECIPA.serveGenitoreTitolo}
          />
        )}
        {exitSheet}
      </div>
    );
  }

  // Partecipante già entrato con almeno 19 anni il primo giorno: la guardia
  // in cima al modulo (docs/FLUSSO_GENITORE.md, G). Niente è salvato qui.
  if (flow.screen === "guardia" && session) {
    const birthDate = session.profile.birthDate || "";

    return (
      <div className="page page--flow">
        {header}
        {errorNotices}
        <section className="flow-step">
          <AdultGuardCard
            age={getAdultGuardAge(birthDate, activityFirstDay) ?? 0}
            existingAccount
            firstDay={activityFirstDay}
            headingLevel="h1"
            onChooseAdult={() => openOwnData("dirigente")}
            onChooseChild={() => handleChoose("figlio")}
            onConfirm={() => confirmAdultGuard(birthDate)}
            onWrongDate={() => openOwnData("data")}
          />
        </section>
        {exitSheet}
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
            onClick: () => confirmExitThen(() => void handleSwitchAccount("io")),
          }}
          secondary={{
            label: CHI_PARTECIPA.iscrivoFiglioInvece,
            onClick: () => goTo("figlio", null),
          }}
          title={CHI_PARTECIPA.soloFigliTitolo}
        />
        {exitSheet}
      </div>
    );
  }

  if (flow.screen === "figlio") {
    const parentUnitId = session?.profile.unitId ?? "";
    const entries = data.children.map((child) => ({
      child,
      state: getChildChoiceState(child, event, data.childRegistrations[child.id]),
    }));
    const choice = getInitialChildChoice(
      entries.map((entry) => ({ childId: entry.child.id, state: entry.state })),
      childChoice ?? childIdParam,
    );
    const unitIds = unitOptions.map((unit) => unit.id);
    const inlineValues = inlineChild ?? getChildFormInitial(null, parentUnitId, unitIds);

    return (
      <div className="page page--flow">
        {header}
        {errorNotices}
        {formConfig && !registrationsOpen ? (
          <div className="notice notice--warning">
            <div>
              <h3>
                {registrationWindow === "not-open-yet"
                  ? CHI_PARTECIPA.nonAncoraTitolo
                  : CHI_PARTECIPA.chiuseTitolo}
              </h3>
              <p>
                {registrationWindow === "not-open-yet"
                  ? fillCopy(CHI_PARTECIPA.nonAncoraTesto, {
                      data: formatDateOnly(event.registrationOpen),
                    })
                  : CHI_PARTECIPA.chiuseTesto}
              </p>
            </div>
          </div>
        ) : null}
        <ChiIscriviStep
          busy={inlineBusy}
          closed={!registrationsOpen}
          entries={entries}
          eventTitle={event.title}
          firstDay={firstDay}
          inlineForm={
            data.children.length === 0 && registrationsOpen
              ? {
                  values: inlineValues,
                  onChange: (next) => {
                    setInlineChild(next);
                    setInlineError(null);
                  },
                  onSubmit: () => {
                    const problem = validateChildForm(inlineValues, {
                      today: new Date(),
                      unitIds,
                    });

                    if (problem) {
                      setInlineError(problem);
                      return;
                    }

                    void handleInlineSave(inlineValues);
                  },
                  unitOptions,
                  parentUnitId,
                  error: inlineError,
                  busy: inlineBusy,
                }
              : null
          }
          onAdd={() =>
            setChildSheet({
              child: null,
              draft: session ? childrenService.newChildDraft(session.firebaseUser.uid) : null,
            })
          }
          onContinue={() => {
            if (choice) {
              setChildChoice(choice);
              goTo("figlio", "modulo", { child: choice });
            }
          }}
          onEdit={(child) => setChildSheet({ child, draft: null })}
          onOpen={(childId) => goTo("figlio", "modulo", { child: childId })}
          onSelect={(childId) => setChildChoice(childId)}
          selectedId={choice}
        />
        {childSheet ? (
          <ChildSheet
            child={childSheet.child}
            firstDay={firstDay}
            onCancel={() => setChildSheet(null)}
            onSave={handleSheetSave}
            parentUnitId={parentUnitId}
            unitOptions={unitOptions}
          />
        ) : null}
        {exitSheet}
      </div>
    );
  }

  if (flow.screen === "inviata") {
    const registration = liveRegistration ?? data.registration;

    if (!registration) {
      return null;
    }

    const forChild = flow.per === "figlio" && Boolean(selectedChild);
    const personName = forChild ? selectedChildName : registration.fullName || accountName;
    const personFirstName = forChild
      ? selectedChild?.firstName ?? ""
      : registration.firstName || session?.profile.firstName || "";

    return (
      <div className="page page--flow">
        <IscrizioneInviataStep
          authorizeError={authorizeError}
          authorizing={authorizing}
          childGroup={forChild ? selectedChild?.genderRoleCategory ?? "" : ""}
          eventTitle={event.title}
          mode={forChild ? "figlio" : "io"}
          onAnother={() => {
            setChildChoice(null);
            setAuthorizeError(null);
            goTo("figlio", "figlio");
          }}
          onAuthorize={() => handleAuthorizeNow(registration)}
          onClose={() => navigate(getActivityPath(event.id, requestedStakeId || undefined))}
          onEdit={() => goTo("io", "modulo")}
          onFamily={() => navigate("/family")}
          onScheda={() => navigate(`/me/activities/${event.id}`)}
          personFirstName={personFirstName}
          personName={personName}
          registration={registration}
        />
        {exitSheet}
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

      {formConfig && !canSubmit && !audienceMismatch && !anonymousCompletion ? (
        <div className="notice notice--warning">
          <div>
            <h3>{CHI_PARTECIPA.chiuseTitolo}</h3>
            <p>{CHI_PARTECIPA.chiuseTesto}</p>
          </div>
        </div>
      ) : null}

      {formConfig && canSubmit && !anonymousCompletion ? (
        <section className="flow-form">
          <RegistrationEditor
            layout="flow"
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
            key={currentDraftKey ?? "modulo"}
            draftKey={currentDraftKey ?? undefined}
            initialDraft={currentDraftKey ? draftsRef.current.get(currentDraftKey) : null}
            onDraftChange={handleDraftChange}
            parentAccount={parentAccount}
            childFirstName={selectedChild?.firstName}
          />
        </section>
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
      {exitSheet}
    </div>
  );
}
