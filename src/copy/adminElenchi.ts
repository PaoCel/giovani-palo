// Pagine admin di elenco e di servizio (home, Attività, Calendario, Gallerie,
// Feed, Altro, Statistiche), fase 6b del restyling. Convenzioni in ./parole.ts.

import { TESTATA } from "./testata.ts";

export const ADMIN_ELENCHI = {
  // Home /admin. Senza nome del palo nel profilo, come la testata.
  homeTitoloDiRiserva: TESTATA.ilMioPalo,
  homeDescrizione: "Panoramica delle attività e delle iscrizioni del palo.",
  homeErrore: "Home non disponibile",
  nuovaAttivita: "Nuova attività",
  // Nome del tasto rotondo «+» per i lettori di schermo.
  creaAttivita: "Crea nuova attività",
  totali: "Totali del palo",
  attivitaCreate: "Attività create",
  iscrizioniAperte: "Iscrizioni aperte",
  partecipantiTotali: "Partecipanti totali",
  apertiTitolo: "Iscrizioni aperte adesso",
  apertiCaricamento: "Sto preparando le attività aperte...",
  apertiVuotoTitolo: "Nessuna attività aperta",
  apertiVuotoCorpo: "Le attività con iscrizioni aperte compariranno qui in ordine temporale.",
  vediTutteLeAttivita: "Vedi tutte le attività",
  feedTitolo: "Dalle attività",
  feedDescrizione: "Ultime novità e gallerie del palo.",

  // Card di un'attività negli elenchi admin. {n}: numero di iscritti.
  iscritti: "{n} iscritti",
  iscrittiUno: "1 iscritto",
  pernottamento: "Pernottamento",
  luogoDaDefinire: "Luogo da definire",

  // Elenco /admin/events.
  attivitaTitolo: "Attività",
  attivitaDescrizione: "Tutte le attività del palo, bozze comprese. Tocca una card per gestirla.",
  attivitaErrore: "Attività non disponibili",
  attivitaCaricamento: "Sto preparando le attività...",
  prossime: "Prossime e in corso",
  concluse: "Concluse",
  attivitaVuotoTitolo: "Nessuna attività ancora creata",
  attivitaVuotoCorpo: "Crea la prima attività: parti dalle cose essenziali e pubblichi dopo il riepilogo.",

  // Calendario (/admin/calendar e /me/calendar).
  calendarioTitolo: "Calendario",
  calendarioErrore: "Calendario non disponibile",
  calendarioCaricamento: "Sto preparando il calendario...",
  annoPrecedente: "Anno precedente",
  annoSuccessivo: "Anno successivo",
  // {n}: attività in più che non stanno nel riquadro del mese.
  altreAttivita: "+{n} altre",
  meseLibero: "Spazio libero",
  attivitaDelMese: "Attività del mese",
  meseVuotoTitolo: "Nessuna attività prevista",
  meseVuotoCorpo: "Questo mese è ancora libero.",
  // Nome del riquadro del mese per i lettori di schermo: «Novembre, 3 attività».
  meseConAttivita: "{mese}, {n} attività",
  meseConUnaAttivita: "{mese}, 1 attività",
  meseSenzaAttivita: "{mese}, nessuna attività",
  chiudi: "Chiudi",

  // Gallerie.
  gallerieOcchiello: "Gallerie",
  gallerieTitolo: "Gallerie foto e video",
  gallerieDescrizione:
    "Le foto e i video sono visibili a tutti gli utenti registrati che hanno autorizzato l'uso delle immagini. Quando pubblichi una galleria appare nel feed dei giovani.",
  nuovaGalleria: "Nuova galleria",
  annulla: "Annulla",
  tutteLeGallerie: "Tutte le gallerie",
  gallerieElencoDescrizione: "Elenco delle gallerie configurate per il tuo palo.",
  caricamento: "Sto caricando…",
  gallerieVuotoTitolo: "Nessuna galleria",
  gallerieVuotoCorpo: "Crea la prima galleria per condividere foto e video con i giovani.",
  // {n}: numero di foto e video della galleria.
  elementi: "{n} elementi",
  elementoUno: "1 elemento",
  pubblicata: "Pubblicata",
  bozza: "Bozza",
  galleriaNonTrovata: "Galleria non trovata",
  galleriaNonTrovataCorpo: "Forse è stata eliminata. Torna all'elenco.",
  tornaAlleGallerie: "Torna alle gallerie",
  galleriaErrore: "Galleria non disponibile",

  // Feed.
  feedOcchiello: "Feed",
  feedPaginaTitolo: "Annunci e reminder",
  feedPaginaDescrizione:
    "Crea annunci e reminder che appariranno nella home dei giovani. I post di tipo galleria vengono creati automaticamente quando pubblichi una galleria.",
  tuttiIPost: "Tutti i post",
  tuttiIPostDescrizione: "Inclusi quelli generati automaticamente dalle gallerie.",
  postVuotoTitolo: "Nessun post",
  postVuotoCorpo: "Crea il primo annuncio con il modulo qui sopra.",
  scriviPost: "Scrivi un annuncio",
  tipoGalleria: "Galleria",
  tipoReminder: "Reminder",
  tipoAnnuncio: "Annuncio",
  pubblicato: "Pubblicato",
  fissato: "Fissato",
  mettiInBozza: "Metti in bozza",
  pubblica: "Pubblica",
  elimina: "Elimina",

  // Altro /admin/settings.
  altroTitolo: "Altro",
  altroDescrizione: "Gallerie, feed, statistiche e impostazioni del palo.",
  altroErrore: "Altro non disponibile",
  altroCaricamento: "Sto preparando l'area operativa...",
  operativita: "Operatività",
  organizzazione: "Organizzazione",

  // Statistiche.
  statisticheTitolo: "Statistiche",
  statisticheDescrizione: "Iscritti del palo per unità, organizzazione e città.",
  statisticheErrore: "Statistiche non disponibili",
  statisticheCaricamento: "Sto preparando gli iscritti del palo...",
  iscrittiGlobali: "Iscritti globali del palo",
  statisticheVuotoTitolo: "Nessuna registrazione",
  statisticheVuotoCorpo: "Le iscrizioni globali compariranno qui.",
  apriAttivita: "Apri attività",
};
