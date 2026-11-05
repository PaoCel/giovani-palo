import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// La cache può contenere solo i media delle anteprime (query con limit): le
// schermate admin leggono l'elenco completo dal server, altrimenti contano
// "3 elementi" su 8 e "Pubblica" crea i post del feed da una lista parziale.
const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("listMedia con fresh legge dal server, senza la cache", () => {
  const source = read("src/services/firestore/galleriesService.ts");
  assert.match(source, /options\.fresh \? await getDocs\(collectionRef\) : await getDocsCacheFirst\(collectionRef\)/);
});

test("ogni chiamata admin a listMedia chiede l'elenco fresco", () => {
  for (const path of [
    "src/components/admin/gallery/GalleryAdminTab.tsx",
    "src/components/admin/gallery/GalleryAdminPanel.tsx",
    "src/pages/admin/AdminGalleryDetailPage.tsx",
  ]) {
    const calls = read(path).match(/galleriesService\.listMedia\([^)]*\)/g) ?? [];
    assert.ok(calls.length > 0, `${path}: nessuna chiamata`);
    for (const call of calls) assert.match(call, /\{ fresh: true \}/, `${path}: ${call}`);
  }
});
