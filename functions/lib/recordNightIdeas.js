"use strict";

// Elenco dello staff scelto da Paolo il 2026-10-12. Gli id restano stabili
// per le prove già presenti; seed e sostituzione usano la stessa sorgente.
const IDEAS = Object.freeze([
  {
    id: "idea-plank",
    title: "Plank più lungo",
    category: "resistenza",
    measure: "longest_time",
    notes: "Sugli avambracci, corpo in linea dalla testa ai piedi. Il tempo si ferma quando i fianchi cedono o toccano terra.",
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
    id: "idea-scoppio-palloncini",
    title: "Scoppio di 7 palloncini, il più veloce",
    category: "velocita",
    measure: "fastest_time",
    notes: "Vale il tempo per scoppiare tutti e 7 i palloncini. Materiale e modalità uguali per tutti, stabiliti dallo staff prima della prova.",
  },
  {
    id: "idea-bottle-flip",
    title: "Bottle flip in 60 secondi",
    category: "precisione",
    measure: "count_in_time",
    durationSeconds: 60,
    notes: "Si contano i lanci in cui la bottiglietta resta in piedi. Stessa bottiglietta, quantità d'acqua e superficie per tutti.",
  },
  {
    id: "idea-magliette",
    title: "Magliette indossate in 60 secondi",
    category: "velocita",
    measure: "count_in_time",
    durationSeconds: 60,
    notes: "Si contano solo le magliette completamente indossate allo scadere del minuto. Magliette della stessa misura per tutti.",
  },
  {
    id: "idea-marshmallow",
    title: "Marshmallow in bocca in 60 secondi",
    category: "fantasia",
    measure: "count_in_time",
    durationSeconds: 60,
    notes: "",
  },
  {
    id: "idea-bottiglietta-acqua",
    title: "Bottiglietta d'acqua bevuta, il più veloce",
    category: "velocita",
    measure: "fastest_time",
    notes: "",
  },
  {
    id: "idea-operazioni",
    title: "Gara di operazioni in 60 secondi",
    category: "mente",
    measure: "count_in_time",
    durationSeconds: 60,
    notes: "Si contano le operazioni risolte correttamente in un minuto. Stesso foglio di esercizi per tutti, senza calcolatrice.",
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
