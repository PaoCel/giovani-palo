// Palo mostrato quando manca un utente con palo (pagine pubbliche, fallback).
// Per ambiente: la build di staging/demo imposta VITE_DEFAULT_STAKE_ID; in
// produzione resta il palo storico.
export const DEFAULT_STAKE_ID = import.meta.env.VITE_DEFAULT_STAKE_ID?.trim() || "roma-est";
export const DEFAULT_STAKE_SLUG = import.meta.env.VITE_DEFAULT_STAKE_SLUG?.trim() || DEFAULT_STAKE_ID;
export const DEFAULT_STAKE_NAME = import.meta.env.VITE_DEFAULT_STAKE_NAME?.trim() || "Palo di Roma Est";
export const DEFAULT_PUBLIC_BRAND = "Agenda Attività Giovani";

// Palo proprietario dei dati legacy, precedenti al multi-palo: collection
// top-level `events/` e `settings/organization` (rules: isStakeAdmin('roma-est')).
// Non segue DEFAULT_STAKE_ID: un altro palo non ha mai avuto dati legacy.
export const LEGACY_DATA_STAKE_ID = "roma-est";
export const LEGACY_DATA_STAKE_NAME = "Palo di Roma Est";
