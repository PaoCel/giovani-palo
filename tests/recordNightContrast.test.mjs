import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Contrasto del testo a inchiostro sulle card colorate "Ci sei" (.rn-mine--in) della
// Notte dei Record: il fondo è il gradiente della categoria (72% colore + bianco,
// colore a metà, 86% colore + nero in fondo). Soglia WCAG AA per il testo piccolo.

const css = readFileSync(new URL("../src/styles/recordNight.css", import.meta.url), "utf8");

const hexToRgb = (hex) => [1, 3, 5].map((index) => Number.parseInt(hex.slice(index, index + 2), 16));
const channel = (value) => {
  const unit = value / 255;
  return unit <= 0.03928 ? unit / 12.92 : ((unit + 0.055) / 1.055) ** 2.4;
};
const luminance = ([red, green, blue]) => 0.2126 * channel(red) + 0.7152 * channel(green) + 0.0722 * channel(blue);
const ratio = (left, right) => {
  const [high, low] = [luminance(left), luminance(right)].sort((a, b) => b - a);
  return (high + 0.05) / (low + 0.05);
};
const mix = (from, to, share) => from.map((value, index) => value * share + to[index] * (1 - share));

const INK = hexToRgb("#0b0d12");
const categories = Object.fromEntries(
  [...css.matchAll(/--rn-cat-(\w+):\s*(#[0-9a-f]{6});/gi)].map((match) => [match[1], hexToRgb(match[2])]),
);

test("le sei categorie sono nel CSS", () => {
  assert.deepEqual(Object.keys(categories).sort(), ["equilibrio", "fantasia", "mente", "precisione", "resistenza", "velocita"]);
});

test("inchiostro pieno sul gradiente di ogni categoria: almeno 4,5:1 a inizio, centro e fondo", () => {
  for (const [name, color] of Object.entries(categories)) {
    const points = {
      inizio: mix(color, [255, 255, 255], 0.72),
      centro: color,
      fondo: mix(color, [0, 0, 0], 0.86),
    };
    for (const [where, background] of Object.entries(points)) {
      assert.ok(ratio(INK, background) >= 4.5, `${name} ${where}: ${ratio(INK, background).toFixed(2)}`);
    }
  }
});

test("riga di stato e nota di origine sulla card colorata usano l'inchiostro pieno", () => {
  assert.match(css, /\.rn-mine--in \.rn-private \{ color: var\(--tb-ink\);/);
  assert.match(css, /\.rn-mine--in \.rn-origin-note \{ color: var\(--tb-ink\); \}/);
});
