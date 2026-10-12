"use strict";

// Elenco dello staff scelto da Paolo il 2026-10-12. Gli id restano stabili
// per le prove già presenti; seed e sostituzione usano la stessa sorgente.
const IDEAS = Object.freeze([
  {
    id: "idea-plank",
    title: "Plank",
    category: "resistenza",
    measure: "longest_time",
    notes: "Sugli avambracci, corpo in linea dalla testa ai piedi. Il tempo si ferma quando i fianchi cedono o toccano terra.",
  },
  {
    id: "idea-piegamenti",
    title: "Piegamenti in 1 minuto",
    category: "resistenza",
    measure: "count_in_time",
    durationSeconds: 60,
    notes: "Si conta ogni piegamento completo, petto vicino a terra. Si può fare anche con le ginocchia a terra.",
  },
  {
    id: "idea-torre-montata-smontata",
    title: "Torre di bicchieri montata e smontata",
    category: "velocita",
    measure: "fastest_time",
    notes: "Si monta e si smonta la torre. Vale il tempo totale.",
  },
  {
    id: "idea-scoppio-palloncini",
    title: "Scoppio di 7 palloncini",
    category: "velocita",
    measure: "fastest_time",
    notes: "Vale il tempo per scoppiare tutti e 7 i palloncini. Materiale e modalità uguali per tutti, stabiliti dallo staff prima della prova.",
  },
  {
    id: "idea-bottle-flip",
    title: "Bottle flip in 1 minuto",
    category: "precisione",
    measure: "count_in_time",
    durationSeconds: 60,
    notes: "Si contano i lanci in cui la bottiglietta resta in piedi. Stessa bottiglietta, quantità d'acqua e superficie per tutti.",
  },
  {
    id: "idea-magliette",
    title: "Magliette indossate in 1 minuto",
    category: "velocita",
    measure: "count_in_time",
    durationSeconds: 60,
    notes: "Si contano solo le magliette completamente indossate allo scadere del minuto. Magliette della stessa misura per tutti.",
  },
  {
    id: "idea-marshmallow",
    title: "Marshmallow in bocca in 1 minuto",
    category: "fantasia",
    measure: "count_in_time",
    durationSeconds: 60,
    notes: "",
  },
  {
    id: "idea-bottiglietta-acqua",
    title: "Bottiglietta d'acqua bevuta nel minor tempo",
    category: "velocita",
    measure: "fastest_time",
    notes: "",
  },
  {
    id: "idea-operazioni",
    title: "Gara di operazioni",
    category: "mente",
    measure: "other",
    notes: "",
  },
  {
    id: "idea-aereo-di-carta",
    title: "Gara di aeroplani",
    category: "fantasia",
    measure: "distance",
    notes: "Si costruisce un aeroplano in 1 minuto. Vince chi lo lancia più lontano.",
  },
]);

module.exports = { IDEAS };
