// Hook di caricamento solo per i test: i file di `src/` che importano "react"
// ricevono `reactHooks.mjs`, che passa a React vero salvo dentro `mountHooks`.
// Chi sta fuori da `src/` (i test, node_modules) vede React com'è.
// Si registra insieme a `aliasLoader.mjs`.
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const srcUrl = pathToFileURL(path.resolve(here, "../../src") + path.sep).href;
const shimUrl = pathToFileURL(path.join(here, "reactHooks.mjs")).href;

export async function resolve(specifier, context, nextResolve) {
  if (specifier === "react" && context.parentURL?.startsWith(srcUrl)) {
    return { url: shimUrl, shortCircuit: true };
  }
  return nextResolve(specifier, context);
}
