import type { StandardFieldKey, StandardFieldOverrides } from "@/types";

export interface StandardFieldDefinition {
  key: StandardFieldKey;
  label: string;
  helpText: string;
  inputType: "text" | "textarea" | "select" | "checkbox" | "date";
  placeholder?: string;
  options?: string[];
}

export const standardFieldDefinitions: StandardFieldDefinition[] = [
  {
    key: "birthDate",
    label: "Data di nascita",
    helpText: "Serve per organizzare attività e autorizzazioni in modo corretto.",
    inputType: "date",
  },
  {
    key: "genderRoleCategory",
    label: "Organizzazione",
    helpText: "Seleziona se appartieni a GU, GD o ai dirigenti.",
    inputType: "select",
    options: ["giovane_uomo", "giovane_donna", "dirigente"],
  },
  {
    key: "youthGroup",
    label: "Organizzazione",
    helpText: "Seleziona se appartieni a GU, GD o ai dirigenti.",
    inputType: "select",
    options: ["Giovani Uomini", "Giovani Donne", "Dirigente"],
  },
  {
    key: "phone",
    label: "Telefono",
    helpText: "Numero di contatto principale.",
    inputType: "text",
  },
  {
    key: "unitName",
    label: "Rione o ramo",
    helpText: "Scegli l'unità di appartenenza.",
    inputType: "select",
  },
  {
    key: "city",
    label: "Comune",
    helpText: "Scegli il comune di provenienza dall'elenco dei comuni italiani.",
    inputType: "text",
  },
  {
    key: "transportMode",
    label: "Come arriverai",
    helpText: "Indica come pensi di raggiungere l'attività.",
    inputType: "select",
    options: ["Da definire", "Auto propria", "Passaggio", "Pullman", "Treno", "Altro"],
  },
  {
    key: "roomPreference1Name",
    label: "Nome e cognome compagno stanza 1",
    helpText: "Inserisci nome e cognome completi della prima preferenza stanza.",
    placeholder: "Es. Camilla Fiorillo",
    inputType: "text",
  },
  {
    key: "roomPreference2Name",
    label: "Nome e cognome compagno stanza 2",
    helpText: "Inserisci nome e cognome completi della seconda preferenza stanza.",
    placeholder: "Es. Giulia Rossi",
    inputType: "text",
  },
  {
    key: "roomNotes",
    label: "Note stanza",
    helpText: "Indicazioni utili per eventuali assegnazioni.",
    inputType: "textarea",
  },
  {
    key: "allergies",
    label: "Allergie",
    helpText: "Segnala eventuali allergie rilevanti.",
    inputType: "textarea",
  },
  {
    key: "dietaryNotes",
    label: "Note alimentari",
    helpText: "Preferenze o esigenze alimentari.",
    inputType: "textarea",
  },
  {
    key: "medicalNotes",
    label: "Note mediche",
    helpText: "Informazioni mediche importanti per gli organizzatori.",
    inputType: "textarea",
  },
  {
    key: "photoInternalConsent",
    label: "Consenso foto uso interno",
    helpText: "Autorizzo l'uso interno delle immagini secondo la comunicazione dedicata.",
    inputType: "checkbox",
  },
  {
    key: "photoPublicConsent",
    label: "Consenso foto uso pubblico",
    helpText: "Autorizzo l'uso pubblico delle immagini secondo la comunicazione dedicata.",
    inputType: "checkbox",
  },
  {
    key: "parentConfirmed",
    label: "Autorizzazione genitore o tutore",
    helpText: "Il consenso per i minori viene raccolto tramite caricamento di una foto del foglio firmato.",
    inputType: "checkbox",
  },
];

export const roomRelatedStandardFieldKeys: StandardFieldKey[] = [
  "roomPreference1Name",
  "roomPreference2Name",
  "roomNotes",
];

function normalizeOptions(value: unknown) {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const options = value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);

  return options.length > 0 ? options : undefined;
}

export function getStandardFieldDefinitions(overrides?: StandardFieldOverrides) {
  return standardFieldDefinitions.map((field) => {
    const override = overrides?.[field.key];

    if (!override) {
      return field;
    }

    return {
      ...field,
      label:
        typeof override.label === "string" && override.label.trim()
          ? override.label.trim()
          : field.label,
      helpText:
        typeof override.helpText === "string" && override.helpText.trim()
          ? override.helpText.trim()
          : field.helpText,
      options: normalizeOptions(override.options) ?? field.options,
    };
  });
}

export function getVisibleStandardFieldDefinitions(overrides?: StandardFieldOverrides) {
  return getStandardFieldDefinitions(overrides).filter((field) => field.key !== "youthGroup");
}

export const visibleStandardFieldDefinitions = getVisibleStandardFieldDefinitions();

export function canonicalizeStandardFieldKey(key: StandardFieldKey): StandardFieldKey {
  return key === "youthGroup" ? "genderRoleCategory" : key;
}

export function normalizeStandardFieldKeys(keys: readonly StandardFieldKey[]) {
  const seen = new Set<StandardFieldKey>();

  return keys.reduce<StandardFieldKey[]>((accumulator, key) => {
    const normalizedKey = canonicalizeStandardFieldKey(key);

    if (seen.has(normalizedKey)) {
      return accumulator;
    }

    seen.add(normalizedKey);
    accumulator.push(normalizedKey);
    return accumulator;
  }, []);
}

export function removeRoomStandardFieldKeys(keys: readonly StandardFieldKey[]) {
  return normalizeStandardFieldKeys(
    keys.filter((key) => !roomRelatedStandardFieldKeys.includes(key)),
  );
}

export function isRoomRelatedStandardFieldKey(key: StandardFieldKey) {
  return roomRelatedStandardFieldKeys.includes(key);
}

export function getStandardFieldDefinition(
  key: StandardFieldKey,
  overrides?: StandardFieldOverrides,
) {
  const normalizedKey = canonicalizeStandardFieldKey(key);
  return getVisibleStandardFieldDefinitions(overrides).find(
    (field) => field.key === normalizedKey,
  );
}
