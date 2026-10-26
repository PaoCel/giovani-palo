# Home social: verbale del primo blocco

26 ottobre 2026. Base `3a59dad`, branch `codex/gugd-home-social-progetto`.
Consegna: spec e prototipo statico sintetico; nessuna modifica al client reale.

**Verdict: PASS WITH CONCERNS per la consegna di progetto.**
Spec indipendente e QA del prototipo passano. Contratto S2 e autorizzazioni
non collaudati in questo blocco: nessuna approvazione di integrazione o rilascio.

## Findings e modifiche recepite

Review della spec da `gpt-6-astra`, separato dall'autore. Prima lettura:
PASS WITH CONCERNS, cinque rilievi recepiti; seconda lettura: **PASS per la
sola spec**, nessun residuo bloccante nel perimetro documentale.

| Rilievo | Correzione |
| --- | --- |
| Offline poteva cambiare la dock | Bloccare nuove mutazioni dal feed; upload già avviati conservano ripartenza automatica |
| Upload non scopribile senza post album | Posizione esplicita di ActivityMediaHighlight; scenario `live` senza post galleria |
| Autorizza ora confondeva giovane e genitore | Identità e destinazioni separate; nessuna facoltà nuova dalla home |
| Back/Esc e bozza non avevano precedenza chiara | Stessa protezione della chiusura; bozza per foto e gestione dell'invio già partito |
| Segnalazione non distingueva autore e staff | Nascondimento dalla consultazione ordinaria, ritorno alla card aggiornata e accesso residuo D4 |

Spec rivista: SHA-256
`61702315c215bb0f4cf621e6db7f0bfa39f98b8203a638ec3db1d0dc88fe9bb1`.

Tentato prima Gemini CLI 0.65.0 sul mini. Accesso rifiutato:
`IneligibleTierError`, `UNSUPPORTED_CLIENT`. Nessun parere Gemini ottenuto,
nessun tentativo con Claude. Il secondo parere è quello di `gpt-6-astra`.

## Verifiche eseguite

Script Playwright scritto da un agente distinto dall'autore del prototipo,
eseguito dall'autore sul Mac mini nella copia QA dedicata, porta 5487.
Chromium locale Playwright, sorgenti e dati sintetici; nessun account reale.

| Verifica | Esito |
| --- | --- |
| QA prototipo | **68 PASS, 0 FAIL**, runner exit 0 |
| Mobile | 320, 390, 430 × 844; screenshot viewport e pagina intera |
| Desktop | 1440 × 1000; screenshot viewport e pagina intera |
| Stati | loading, empty, error, pending, offline, closed, none, awaiting, live |
| Dimensioni | Nessun overflow orizzontale; bersagli ≥ 44 × 44; secondario ≥ 13 px, escluse sopracciglia decorative e barra demo |
| Interazioni locali | Filtri; like reversibile, post e foto separati; chiusura e focus; annulla segnalazione; Back; bozza conservata/scartata; retry errore |
| Rete del prototipo | Solo GET di asset statici locali e font Google; nessuna richiesta Firebase/backend o scrittura HTTP |
| Runtime | Nessun errore JavaScript o asset locale mancante |
| Build applicazione base | `npm ci` e `npm run build` sul mini, exit 0; tsc e Vite verdi |
| Controllo repository | `git diff --check`; nessun path assoluto nei file aggiunti/modificati |

La build conserva l'avviso di chunk oltre 500 kB. Il prototipo vive in
`docs/` e non entra nel bundle dell'app.

Primo giro QA: **66 PASS, 2 FAIL**. Output rilevante:

```text
page.waitForURL: Timeout 30000ms exceeded
waiting for navigation to ".../docs/prototypes/home-social/" until "load"
strict mode violation: locator('#detail [data-close]') resolved to 2 elements
```

Il reviewer del test ha corretto l'attesa del retry su URL semanticamente
senza query e DOMContentLoaded (l'URL effettivo termina con `/?`) e reso
univoco il controllo di chiusura. Restano verificati due post visibili,
assenza della card errore e tutti i filtri attivi dopo Riprova. Il secondo
giro finale è verde; nessuna eccezione nascosta o assert disabilitato.

Ispezione visiva diretta dei PNG: ridotta la card prossima e tolto il
sottotitolo mobile per rendere visibile la fotografia già nel primo schermo;
immagine intera con rapporto 3:2; contrasto e gerarchia basati sui token reali.
Titolo/stato e illustrazione non coprono la CTA. La barra inferiore conserva
le quattro destinazioni attuali e spazio di rispetto in fondo alla pagina.

## Artefatti e riproduzione

Versionati:

- `docs/HOME_SOCIAL.md`: esperienza, P1–P3, ownership, fonti dati, stati e ritorni.
- `docs/HOME_SOCIAL_REVIEW.md`: questo verbale.
- `docs/prototypes/home-social/index.html`, `home.css`, `home.js`: prototipo.
- `docs/prototypes/home-social/assets/pomeriggio.webp`: foto sintetica, circa 100 KB.
- `docs/prototypes/home-social/README.md`: prompt e istruzioni.
- `tasks/gugd-home-social.md`: stato e prossimo passo.

PNG e prove persistenti, ignorati da git:

- `.claude/mockups/home-social/home-{320,390,430,1440}.png`
- `.claude/mockups/home-social/home-{320,390,430,1440}-full.png`
- `.claude/mockups/home-social/home-<stato>-390.png` e `-full.png`
- `.claude/mockups/home-social/home-{viewer,report,draft}-390.png`
- `.claude/mockups/home-social/qa.mjs`, `qa-report.json`, `qa-final.log`
- `.claude/mockups/home-social/assets/pomeriggio-originale.png`

Aprire il prototipo con un server statico dalla radice del repo, sul mini
con `mini --bg --no-lock 'python3 -m http.server 5487 --bind 127.0.0.1'`.
Lo script QA locale punta a quella porta e al Chromium Playwright del mini.
Per rigenerare i PNG: copiare lo script ignorato con `mini put`, quindi
eseguirlo sul mini e riportare gli artefatti con `mini get`.

## Required changes, risks e passi successivi

Nessuna correzione documentale bloccante residua. P1–P3 sono da ratificare,
non nuove decisioni approvate. Il task completo mantiene i propri criteri di
accettazione, incluso il futuro ingresso Famiglia.

Prima del client: integrare S2, scrivere la query esatta e provarla con
ruoli, stati e due pali. Verificare revoca mentre una foto è aperta, cambio
account, moderazione, upload e doppio invio con i servizi reali. Comparare
implementazione e mockup alla stessa scala; collaudare Safari con tastiera.
Queste verifiche non sono sostituite dal prototipo e non sono state eseguite.

Nessuna lettura o scrittura di produzione, deploy, migrazione o modifica
del branch S2. Nessun merge o push di main in questa consegna.
