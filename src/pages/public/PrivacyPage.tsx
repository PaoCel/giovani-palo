// =============================================================================
// PrivacyPage replacement — drop-in for src/pages/public/PrivacyPage.tsx
// =============================================================================
//
// WHY: the current PrivacyPage is generic boilerplate. This version adds the
//      GDPR elements the audit flagged: legal basis, sub-processor list,
//      retention statement, enumerated user rights, last-reviewed date,
//      and the new privacy@gugditalia.it contact.
//
// HOW TO USE:
//   1. Verify register.it mailboxes are live: privacy@gugditalia.it +
//      supporto@gugditalia.it. (Done 2026-04-25.)
//   2. Replace the contents of src/pages/public/PrivacyPage.tsx with this file.
//   3. Build & deploy: npm run build && firebase deploy --only hosting
//   4. Visit https://gugditalia.it/privacy and verify it renders.
//
// The PhotoConsentPage already references organization.supportContact, which
// is now populated via AdminSettingsPage with supporto@gugditalia.it — no
// edit needed there.
// =============================================================================

import { Link } from "react-router-dom";

import { PageHero } from "@/components/PageHero";
import { SectionCard } from "@/components/SectionCard";
import { useAsyncData } from "@/hooks/useAsyncData";
import { organizationService } from "@/services/firestore/organizationService";
import { resolvePublicStakeId } from "@/utils/stakeSelection";

const PRIVACY_EMAIL = "privacy@gugditalia.it";
const LAST_REVIEWED = "25 aprile 2026";

export function PrivacyPage() {
  const { data: organization } = useAsyncData(
    async () => {
      const stakeId = await resolvePublicStakeId();
      return organizationService.getProfile(stakeId);
    },
    [],
    null,
  );

  const supportContact = organization?.supportContact || "supporto@gugditalia.it";

  return (
    <div className="page">
      <PageHero
        className="hero--compact"
        eyebrow="Privacy"
        title="Informativa privacy e cookie"
        description="Come GUGD Italia tratta i dati personali raccolti per gestire attivita, iscrizioni e supporto organizzativo, in conformita al GDPR e al Codice Privacy italiano."
        actions={
          <Link className="button button--soft" to="/privacy/photos">
            Informativa fotografie
          </Link>
        }
      />

      <SectionCard
        title="Titolare del trattamento"
        description="Chi gestisce i tuoi dati e come contattarlo."
      >
        <div className="surface-panel surface-panel--subtle">
          <p>
            Titolare del trattamento e l&apos;organizzazione non-profit GUGD Italia.
            Per esercitare i tuoi diritti o per qualsiasi richiesta privacy puoi scrivere a
            {" "}<strong>{PRIVACY_EMAIL}</strong>. Per supporto operativo (problemi di iscrizione,
            informazioni sull&apos;attivita) usa {supportContact}.
          </p>
        </div>
      </SectionCard>

      <SectionCard
        title="Categorie di dati trattati"
        description="Raccogliamo solo le informazioni necessarie per gestire correttamente attivita e iscrizioni (principio di minimizzazione)."
      >
        <div className="stack">
          <div className="surface-panel surface-panel--subtle">
            <h3>Dati richiesti per ogni iscrizione</h3>
            <ul>
              <li>Nome e cognome.</li>
              <li>Email e telefono per conferme e comunicazioni operative.</li>
              <li>Data di nascita per gestire la fascia d&apos;eta e i consensi richiesti per i minori.</li>
              <li>Unita / rione di appartenenza, per la visibilita del responsabile locale.</li>
              <li>Eventuali risposte a campi del modulo specifici dell&apos;attivita
                (es. allergie, preferenze di stanza, note logistiche) — opzionali e configurabili per attivita.</li>
            </ul>
          </div>

          <div className="surface-panel surface-panel--subtle">
            <h3>Dati specifici per i minori</h3>
            <p>
              Per i partecipanti minorenni puo essere richiesto il caricamento del consenso del genitore
              o del tutore legale come immagine del foglio firmato. Questo documento viene conservato
              in area protetta accessibile solo agli admin di palo e al titolare dell&apos;iscrizione,
              e gestito secondo le indicazioni dell&apos;Art. 8 GDPR (in Italia, eta minima 14 anni
              per il consenso digitale; GUGD applica la regola operativa piu rigorosa di richiedere
              il consenso del genitore per tutti gli iscritti sotto i 18 anni).
            </p>
          </div>
        </div>
      </SectionCard>

      <SectionCard
        title="Base giuridica e finalita"
        description="Perche tratta i tuoi dati e con quale base legale ai sensi del GDPR."
      >
        <div className="surface-panel surface-panel--subtle">
          <ul>
            <li>
              <strong>Consenso (Art. 6, par. 1, lett. a GDPR):</strong> consensi per uso interno e
              uso pubblico delle fotografie; consenso del genitore o tutore per i minori.
            </li>
            <li>
              <strong>Legittimo interesse (Art. 6, par. 1, lett. f GDPR):</strong> coordinamento
              organizzativo e logistico delle attivita del palo, gestione di iscrizioni, contatti
              operativi, sicurezza dei partecipanti.
            </li>
          </ul>
        </div>
      </SectionCard>

      <SectionCard
        title="Periodo di conservazione"
        description="Per quanto tempo conserviamo le diverse categorie di dati."
      >
        <div className="surface-panel surface-panel--subtle">
          <ul>
            <li><strong>Profilo utente:</strong> finche l&apos;account e attivo. Profili inattivi
              da oltre 24 mesi vengono eliminati salvo rinnovo del consenso.</li>
            <li><strong>Iscrizioni a una attivita e moduli compilati:</strong> 24 mesi dopo la data
              di fine dell&apos;attivita.</li>
            <li><strong>Documenti di consenso del genitore (immagini):</strong> 24 mesi dopo la
              data di fine dell&apos;attivita.</li>
            <li><strong>Tentativi di iscrizione (log tecnico):</strong> 90 giorni.</li>
            <li><strong>Token di recupero per iscrizioni guest:</strong> 90 giorni dalla fine
              dell&apos;attivita.</li>
            <li><strong>Notifiche admin:</strong> 365 giorni.</li>
            <li><strong>Audit log delle azioni amministrative:</strong> 24 mesi.</li>
          </ul>
        </div>
      </SectionCard>

      <SectionCard
        title="I tuoi diritti"
        description="Diritti riconosciuti dagli articoli 15-22 del GDPR e come esercitarli."
      >
        <div className="surface-panel surface-panel--subtle">
          <ul>
            <li><strong>Accesso (Art. 15):</strong> puoi vedere quali dati abbiamo su di te.
              Direttamente in app per profilo e iscrizioni; per un export completo scrivi a
              {" "}{PRIVACY_EMAIL}.</li>
            <li><strong>Rettifica (Art. 16):</strong> direttamente in app.</li>
            <li><strong>Cancellazione (Art. 17):</strong> richiesta a {PRIVACY_EMAIL}.
              Ti rispondiamo entro 30 giorni.</li>
            <li><strong>Limitazione del trattamento (Art. 18):</strong> richiesta a
              {" "}{PRIVACY_EMAIL}.</li>
            <li><strong>Portabilita (Art. 20):</strong> export dei tuoi dati in formato JSON
              su richiesta a {PRIVACY_EMAIL}, entro 30 giorni.</li>
            <li><strong>Opposizione (Art. 21):</strong> richiesta a {PRIVACY_EMAIL}.</li>
            <li><strong>Reclamo:</strong> puoi rivolgerti al Garante per la protezione dei dati
              personali — <a href="https://www.garanteprivacy.it" target="_blank" rel="noopener noreferrer">
              garanteprivacy.it</a>.</li>
          </ul>
          <p>
            Per i minori, i diritti sono esercitati dal genitore o dal tutore legale.
          </p>
        </div>
      </SectionCard>

      <SectionCard
        title="Sub-fornitori"
        description="Servizi terzi che ricevono dati per nostro conto, sotto Standard Contractual Clauses (SCC)."
      >
        <div className="surface-panel surface-panel--subtle">
          <p>
            GUGD Italia usa Google come unico sub-fornitore, attraverso i seguenti servizi Firebase:
          </p>
          <ul>
            <li>Firebase Authentication — gestione delle credenziali di accesso.</li>
            <li>Cloud Firestore — archiviazione dei dati strutturati, regione UE
              <code> eur3 </code> (Belgio + Paesi Bassi).</li>
            <li>Firebase Storage — immagini di consenso e materiali pubblici, regione UE.</li>
            <li>Firebase Hosting — assets statici, edge globale (no PII).</li>
            <li>Firebase Cloud Messaging — notifiche push agli admin (no PII nel payload).</li>
          </ul>
          <p>
            Nessun altro sub-fornitore e attivo. Nessun servizio di analytics, advertising,
            tracciamento o profilazione e integrato. Eventuali nuovi sub-fornitori verranno aggiunti
            qui prima dell&apos;attivazione.
          </p>
        </div>
      </SectionCard>

      <SectionCard
        title="Cookie e tecnologie simili"
        description="In questa versione dell'app abbiamo scelto il minimo indispensabile."
      >
        <div className="stack">
          <div className="surface-panel surface-panel--subtle">
            <h3>Cosa usiamo adesso</h3>
            <p>
              L&apos;app usa solo strumenti tecnici necessari al funzionamento: sessione,
              autenticazione, preferenze operative, installazione della PWA. Non sono attivi
              banner cookie per profilazione o marketing perche non sono presenti servizi di
              tracciamento pubblicitario o analytics di profilazione.
            </p>
          </div>

          <div className="surface-panel surface-panel--subtle">
            <h3>Quando servira un banner</h3>
            <p>
              Se in futuro verranno aggiunti analytics non anonimizzati, pixel pubblicitari,
              remarketing o altri strumenti di tracciamento non tecnici, sara mostrato un banner
              di consenso dedicato prima dell&apos;attivazione.
            </p>
          </div>
        </div>
      </SectionCard>

      <SectionCard
        title="Sicurezza e residenza dei dati"
        description="Dove vengono custoditi i dati e con quali misure tecniche."
      >
        <div className="surface-panel surface-panel--subtle">
          <p>
            Tutti i dati personali sono trattati e conservati nell&apos;Unione Europea
            (regione Firestore <code>eur3</code>: Belgio + Paesi Bassi).
            L&apos;accesso e regolato da regole di sicurezza per ruolo (admin di palo,
            responsabile di unita, partecipante), validate lato server da Firebase Security Rules.
            La connessione e cifrata in HTTPS. I documenti sensibili (es. consensi dei minori)
            sono in area di storage protetta, accessibile solo all&apos;admin di palo e al
            titolare dell&apos;iscrizione.
          </p>
          <p>
            In caso di violazione confermata che riguardi dati personali, GUGD Italia notifica
            agli interessati e al Garante entro 72 ore, in conformita all&apos;Art. 33 GDPR.
          </p>
        </div>
      </SectionCard>

      <SectionCard
        title="Contatti"
        description="Come scriverci per richieste privacy o supporto operativo."
      >
        <div className="surface-panel surface-panel--subtle">
          <ul>
            <li>Richieste privacy / GDPR: <strong>{PRIVACY_EMAIL}</strong></li>
            <li>Supporto operativo: <strong>{supportContact}</strong></li>
          </ul>
          <p style={{ marginTop: "1rem", fontSize: "0.85em", opacity: 0.75 }}>
            Ultimo aggiornamento: {LAST_REVIEWED}.
          </p>
        </div>
      </SectionCard>
    </div>
  );
}
