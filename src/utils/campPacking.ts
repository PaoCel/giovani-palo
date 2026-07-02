import type { Event } from "@/types";

export interface PackingItem {
  id: string;
  label: string;
}

export interface PackingSection {
  id: string;
  title: string;
  items: PackingItem[];
}

export function isCampPackingActivity(event: Pick<Event, "activityType" | "overnight">) {
  return event.activityType === "camp" || event.activityType === "overnight" || event.overnight;
}

export const defaultCampPackingSections: PackingSection[] = [
  {
    id: "essentials",
    title: "Essenziali",
    items: [
      { id: "sleeping-bag", label: "Sacco a pelo e/o materassino da campeggio" },
      { id: "pillow", label: "Cuscino da viaggio o piccolo gonfiabile" },
      { id: "water-bottle", label: "Borraccia riutilizzabile (1-2 litri)" },
      { id: "daypack", label: "Zainetto o piccola borsa per escursioni" },
      { id: "flashlight", label: "Torcia/lampada da campeggio" },
      { id: "scriptures", label: "Scritture cartacee" },
      { id: "journal", label: "Diario personale/quaderno + matita" },
    ],
  },
  {
    id: "cooking",
    title: "Pranzo e stoviglie",
    items: [
      { id: "lunch-box", label: "Porta pranzo/ciotola personale" },
      { id: "cutlery", label: "Posate riutilizzabili" },
      { id: "plate", label: "Piatto riutilizzabile" },
    ],
  },
  {
    id: "clothes",
    title: "Indumenti",
    items: [
      { id: "shirts", label: "3 magliette traspiranti" },
      { id: "fleece", label: "Felpa/pile" },
      { id: "rain-jacket", label: "Giacca impermeabile (tipo k-way)" },
      { id: "socks", label: "3 paia di calzini (+1 extra)" },
      { id: "underwear", label: "3 cambi biancheria intima" },
      { id: "long-pants", label: "Pantalone lungo o convertibile" },
      { id: "shorts", label: "Pantalone corto" },
      { id: "hat", label: "Cappellino per il sole" },
      { id: "shoes", label: "Scarpe da ginnastica" },
      { id: "sandals", label: "Ciabatte/sandali da campeggio" },
      { id: "swimsuit", label: "Costume da bagno" },
    ],
  },
  {
    id: "hygiene",
    title: "Igiene personale",
    items: [
      { id: "soap", label: "Saponetta/sapone biodegradabile" },
      { id: "toothbrush", label: "Spazzolino + dentifricio" },
      { id: "wet-wipes", label: "Salviette umidificate" },
      { id: "toilet-paper", label: "Carta igienica + sacchetti" },
      { id: "sunscreen", label: "Crema solare" },
      { id: "mosquito", label: "Anti zanzare" },
      { id: "towel", label: "Asciugamano piccolo" },
      { id: "personal-hygiene", label: "Materiale igienico personale" },
      { id: "comb", label: "Spazzola/pettine" },
    ],
  },
];

function normalizeItemId(value: string) {
  return value
    .toLocaleLowerCase("it-IT")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
}

function parseExtraItems(text: string): PackingItem[] {
  return text
    .split(/\r?\n|[;•]/)
    .map((item) => item.replace(/^[-*–—]\s*/, "").trim())
    .filter((item) => item.length >= 3)
    .slice(0, 12)
    .map((label, index) => ({
      id: `event-${normalizeItemId(label) || index}`,
      label,
    }));
}

export function buildCampPackingSections(whatToBring: string): PackingSection[] {
  const eventItems = parseExtraItems(whatToBring);

  if (eventItems.length === 0) {
    return defaultCampPackingSections;
  }

  return [
    {
      id: "event",
      title: "Richiesto dall'attività",
      items: eventItems,
    },
    ...defaultCampPackingSections,
  ];
}
