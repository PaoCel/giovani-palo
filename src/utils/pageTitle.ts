// Sullo staging (demo.gugditalia.it) il titolo della scheda porta il prefisso
// "[DEMO]": vite.config.ts lo scrive nell'HTML, ma le pagine che riscrivono
// `document.title` lo perderebbero. In produzione `VITE_APP_ENV` non è
// "staging" e il titolo resta com'è.
export const DEMO_TITLE_PREFIX = "[DEMO] ";

export function formatPageTitle(title: string, appEnv: string | undefined): string {
  if (appEnv !== "staging" || title.startsWith(DEMO_TITLE_PREFIX)) {
    return title;
  }

  return `${DEMO_TITLE_PREFIX}${title}`;
}

export function pageTitle(title: string): string {
  return formatPageTitle(title, import.meta.env?.VITE_APP_ENV);
}
