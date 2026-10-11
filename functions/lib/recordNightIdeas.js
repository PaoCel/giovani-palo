"use strict";

// Idee dello staff per la Notte dei Record: record `featured` che si vedono ai
// ragazzi anche a zero iscritti ("Sii il primo"). Scelti da Paolo il 2026-10-11.
// Gli id sono fissi: lo script che li scrive (scripts/seedRecordNightIdeas.js)
// non sovrascrive mai un record già presente, così le modifiche dello staff
// restano. Titolo, note e misure rispettano gli stessi limiti della callable.

const IDEAS = Object.freeze([
  {
    id: "idea-plank",
    title: "Plank più lungo",
    category: "resistenza",
    measure: "longest_time",
    notes: "Sugli avambracci, corpo in linea dalla testa ai piedi. Il tempo si ferma quando i fianchi cedono o toccano terra.",
  },
  {
    id: "idea-wall-sit",
    title: "Wall sit (la sedia al muro) più a lungo",
    category: "resistenza",
    measure: "longest_time",
    notes: "Schiena al muro, gambe piegate a 90 gradi, mani lontane dalle gambe. Serve un muro libero.",
  },
  {
    id: "idea-salti-piedi-uniti",
    title: "Salti a piedi uniti in 60 secondi",
    category: "resistenza",
    measure: "count_in_time",
    durationSeconds: 60,
    notes: "Vale il numero di salti in 60 secondi, sempre a piedi uniti.",
  },
  {
    id: "idea-apnea",
    title: "Apnea: quanto trattieni il fiato",
    category: "resistenza",
    measure: "longest_time",
    notes: "Da fermi e seduti, senza respirare forte prima. Un adulto cronometra. Si smette quando si vuole.",
  },
  {
    id: "idea-piegamenti",
    title: "Piegamenti sulle braccia in 60 secondi",
    category: "resistenza",
    measure: "count_in_time",
    durationSeconds: 60,
    notes: "Si conta ogni piegamento completo, petto vicino a terra. Si può fare anche con le ginocchia a terra.",
  },
  {
    id: "idea-torre-montata-smontata",
    title: "Torre di 6 bicchieri montata e smontata, il più veloce",
    category: "velocita",
    measure: "fastest_time",
    notes: "Si monta la piramide (3, 2, 1) e si smonta rimettendo i bicchieri in pila. Vale il tempo totale. Servono 6 bicchieri di plastica.",
  },
  {
    id: "idea-salti-corda",
    title: "Salti con la corda in 60 secondi",
    category: "velocita",
    measure: "count_in_time",
    durationSeconds: 60,
    notes: "Vale il numero di salti in 60 secondi. Servono una corda e lo spazio per girarla.",
  },
  {
    id: "idea-torre-alta",
    title: "Torre di bicchieri più alta in 60 secondi",
    category: "precisione",
    measure: "distance",
    notes: "Si misura l'altezza della torre allo scadere dei 60 secondi. Servono bicchieri di plastica.",
  },
  {
    id: "idea-palleggi",
    title: "Palleggi con un pallone senza farlo cadere",
    category: "precisione",
    measure: "count_streak",
    notes: "Si contano i tocchi di fila prima che il pallone tocchi terra. Serve un pallone.",
  },
  {
    id: "idea-palloncino",
    title: "Palloncino tenuto in aria soffiando, senza toccarlo",
    category: "equilibrio",
    measure: "longest_time",
    notes: "Si può solo soffiare: niente mani né corpo. Il tempo si ferma quando il palloncino tocca terra. Serve un palloncino.",
  },
  {
    id: "idea-salti-un-piede",
    title: "Salti su un piede solo in 60 secondi",
    category: "equilibrio",
    measure: "count_in_time",
    durationSeconds: 60,
    notes: "Un piede solo, l'altro non tocca terra. Vale il numero di salti in 60 secondi.",
  },
  {
    id: "idea-hula-hop",
    title: "Hula hop che gira più a lungo",
    category: "equilibrio",
    measure: "longest_time",
    notes: "Il tempo si ferma quando l'hula hop tocca terra. Serve un hula hop.",
  },
  {
    id: "idea-alfabeto-al-contrario",
    title: "Alfabeto al contrario, il più veloce",
    category: "mente",
    measure: "fastest_time",
    notes: "Dalla Z alla A con le 21 lettere dell'alfabeto italiano, senza saltarne nessuna.",
  },
  {
    id: "idea-aereo-di-carta",
    title: "Aereo di carta costruito in 60 secondi, vince il lancio più lontano",
    category: "fantasia",
    measure: "distance",
    notes: "Si costruisce in meno di 60 secondi, poi due lanci: conta il più lontano. Serve un foglio.",
  },
]);

module.exports = { IDEAS };
