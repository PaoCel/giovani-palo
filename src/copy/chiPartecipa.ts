// "Chi partecipa?", primo passo dell'iscrizione (docs/FLUSSO_GENITORE.md, B),
// e le schede che dicono quale account serve. Convenzioni in ./parole.ts.

import { PAROLE } from "./parole.ts";

export const CHI_PARTECIPA = {
  titolo: "Chi partecipa?",
  lead: "Scegli per chi è l'iscrizione: ti mostriamo solo i passi che servono.",
  partecipoIo: "Partecipo io",
  partecipoIoDettaglio: "Sono un ragazzo o una ragazza, un dirigente o un accompagnatore.",
  // Entrato con un profilo completo: come partecipa.
  partecipoIoCome: "Come {categoria}, {unita}.",
  partecipoIoAccount: "Ti iscrivi con il tuo account.",
  // Account da genitore con figli: per sé serve un altro account (fino alla fase 6).
  partecipoIoGenitore: "Per te serve un account personale.",
  // Account da genitore senza figli: completa i suoi dati e diventa da partecipante.
  partecipoIoGenitoreSenzaFigli: "Completi i tuoi dati e ti iscrivi.",
  categoriaGiovaneUomo: "giovane uomo",
  categoriaGiovaneDonna: "giovane donna",
  categoriaDirigente: "dirigente",
  categoriaAccompagnatore: "accompagnatore",
  iscrivoFiglio: "Iscrivo mio figlio o mia figlia",
  iscrivoFiglioDettaglio: "Con il tuo account da genitore iscrivi i tuoi figli.",
  iscrivoFiglioGenitore: "Scegli chi iscrivere tra i tuoi figli.",
  // Account appena creato, profilo ancora da completare.
  iscrivoFiglioCompleta: "Completi i tuoi dati da genitore e iscrivi i tuoi figli.",
  iscrivoFiglioServeGenitore: "Serve un account da genitore.",
  piuFigli: "Hai più figli? Li iscrivi uno dopo l'altro, con lo stesso account.",

  // Figlio scelto da un account che non è da genitore.
  serveGenitoreTitolo: "Serve l'account di un genitore",
  serveGenitoreRagazzo:
    "Per iscrivere un figlio o una figlia accedi con l'account del genitore, o creane uno: ci vuole un minuto. L'account di {nome} resta com'è.",
  serveGenitoreAdulto:
    "Per ora i figli si iscrivono da un account da genitore. Esci e accedi con quello, oppure creane uno: ci vuole un minuto. Il tuo account resta com'è.",
  etaEGruppo: "{eta} anni · {gruppo}",
  esciEAccediComeGenitore: "Esci e accedi come genitore",
  iscriviConIlSuoAccount: "Iscrivi {nome} con il suo account",
  partecipoIoInvece: "Partecipo io",

  // "Partecipo io" da un account da genitore con figli (fino alla fase 6).
  soloFigliTitolo: "Questo account iscrive i tuoi figli",
  soloFigliTesto:
    "Il tuo è un account da genitore. Per partecipare tu, esci e accedi con il tuo account personale, oppure creane uno.",
  iscrivoFiglioInvece: "Iscrivo mio figlio o mia figlia",
  cambiaAccount: PAROLE.cambiaAccount,

  // Attività che oggi non accetta iscrizioni.
  chiuseTitolo: "Iscrizioni chiuse",
  chiuseTesto: "Le iscrizioni a questa attività non sono aperte.",
  nonAncoraTitolo: "Iscrizioni non ancora aperte",
  nonAncoraTesto: "Le iscrizioni apriranno il {data}.",
  giaIscritto: "Ti sei già iscritto? Accedi per vedere la tua iscrizione.",
  accedi: PAROLE.accedi,
  tornaAllAttivita: "Torna all'attività",
} as const;
