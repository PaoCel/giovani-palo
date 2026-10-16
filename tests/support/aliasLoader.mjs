// Hook di caricamento solo per i test: risolve l'alias `@/` verso `src/`,
// trasforma i `.tsx` con il compilatore TypeScript del progetto e svuota i
// `.css`. Il codice sotto test non viene toccato.
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import ts from "typescript";

const srcDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../src");
const candidates = ["", ".ts", ".tsx", "/index.ts", "/index.tsx"];

function resolveAlias(specifier) {
  const base = path.join(srcDir, specifier.slice(2));
  for (const suffix of candidates) {
    const file = base + suffix;
    if (path.extname(file) && existsSync(file)) return file;
  }
  return null;
}

export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith("@/")) {
    const file = resolveAlias(specifier);
    if (file) return { url: pathToFileURL(file).href, shortCircuit: true };
  }
  return nextResolve(specifier, context);
}

export async function load(url, context, nextLoad) {
  if (url.endsWith(".css")) {
    return { format: "module", source: "export {};", shortCircuit: true };
  }
  if (url.endsWith(".tsx")) {
    const source = await readFile(fileURLToPath(url), "utf8");
    const { outputText } = ts.transpileModule(source, {
      compilerOptions: {
        jsx: ts.JsxEmit.ReactJSX,
        module: ts.ModuleKind.ESNext,
        target: ts.ScriptTarget.ES2022,
      },
      fileName: fileURLToPath(url),
    });
    return { format: "module", source: outputText, shortCircuit: true };
  }
  return nextLoad(url, context);
}
