import { test } from "node:test";
import assert from "node:assert/strict";
import { isGalleryUploadOpen } from "../src/utils/galleryWindow.ts";
const gallery = { uploadsClosed: false, uploadsOpenFrom: 1000, uploadsOpenUntil: 2000 };
test("Home feed senza attività può aprire la finestra esplicita della galleria", () => {
  assert.equal(isGalleryUploadOpen(null, gallery, 1500), true);
});
test("Home senza attività né galleria non propone upload", () => {
  assert.equal(isGalleryUploadOpen(null, null, 1500), false);
});
test("apertura inclusa e chiusura esclusa, anche nel feed senza attività", () => {
  assert.equal(isGalleryUploadOpen(null, gallery, 999), false);
  assert.equal(isGalleryUploadOpen(null, gallery, 1000), true);
  assert.equal(isGalleryUploadOpen(null, gallery, 1999), true);
  assert.equal(isGalleryUploadOpen(null, gallery, 2000), false);
});
test("chiusura manuale prevale sull'orario ancora valido", () => {
  assert.equal(isGalleryUploadOpen(null, { ...gallery, uploadsClosed: true }, 1500), false);
});
test("finestra assente non diventa upload sempre aperto", () => {
  assert.equal(isGalleryUploadOpen(null, { ...gallery, uploadsOpenFrom: null }, 1500), false);
  assert.equal(isGalleryUploadOpen(null, { ...gallery, uploadsOpenUntil: null }, 1500), false);
});
test("la galleria esplicita prevale su date attività ancora aperte", () => {
  const event = { startDate: "2026-10-26T10:00:00.000Z", endDate: "2026-10-26T12:00:00.000Z" };
  assert.equal(isGalleryUploadOpen(event, gallery, Date.parse(event.startDate)), false);
});
