// Text as outlines. Every string in the diagram is converted to an SVG <path>
// using the Fira Sans / Fira Code TTFs in fonts/, so homelab.svg looks the same
// everywhere, with or without the fonts installed. Also gives exact text widths.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import opentype from "opentype.js";

const FILES: Record<string, string> = {
  "sans-400": "FiraSans-Regular.ttf",
  "sans-500": "FiraSans-Medium.ttf",
  "sans-600": "FiraSans-SemiBold.ttf",
  "sans-700": "FiraSans-Bold.ttf",
  "mono-400": "FiraCode-Regular.ttf",
  "mono-500": "FiraCode-Medium.ttf",
};
const SANS_WEIGHTS = [400, 500, 600, 700];
const MONO_WEIGHTS = [400, 500];
// Plain glyphs only: no ligatures (Fira Code would merge e.g. "->" or "www").
const SHAPING = { kerning: true, features: { liga: false, rlig: false } };

const cache = new Map<string, opentype.Font>();
let fontDir = "";
export function useFontDir(dir: string): void { fontDir = dir; }

function font(mono: boolean, weight: number): opentype.Font {
  const weights = mono ? MONO_WEIGHTS : SANS_WEIGHTS;
  const w = weights.reduce((best, x) => (Math.abs(x - weight) < Math.abs(best - weight) ? x : best));
  const key = `${mono ? "mono" : "sans"}-${w}`;
  let f = cache.get(key);
  if (!f) {
    const buf = readFileSync(join(fontDir, FILES[key]));
    f = opentype.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
    cache.set(key, f);
  }
  return f;
}

export interface Style { size: number; mono?: boolean; weight?: number; spacing?: number }

// x offset of each glyph (in px from the string's start) and the total advance.
function layout(s: string, st: Style): { f: opentype.Font; glyphs: opentype.Glyph[]; xs: number[]; width: number } {
  const f = font(st.mono ?? false, st.weight ?? 400);
  const scale = st.size / f.unitsPerEm;
  // opentype.js takes shaping options here; @types/opentype.js omits the parameter.
  const glyphs = (f.stringToGlyphs as (s: string, o: typeof SHAPING) => opentype.Glyph[]).call(f, s, SHAPING);
  const xs: number[] = [];
  let x = 0;
  glyphs.forEach((g, i) => {
    xs.push(x);
    x += (g.advanceWidth ?? 0) * scale;
    if (i < glyphs.length - 1) x += f.getKerningValue(g, glyphs[i + 1]) * scale + (st.spacing ?? 0);
  });
  return { f, glyphs, xs, width: x };
}

export function measure(s: string, st: Style): number {
  return s ? layout(s, st).width : 0;
}

// Outline path data for `s` with its baseline starting at (x, y).
export function outline(s: string, x: number, y: number, st: Style): string {
  if (!s) return "";
  const { glyphs, xs } = layout(s, st);
  return glyphs.map((g, i) => g.getPath(x + xs[i], y, st.size).toPathData(2)).filter(Boolean).join("");
}
