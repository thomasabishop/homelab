// Crops icon SVGs to their visible content so every logo fills its slot the
// same way in the diagram. Rewrites the root viewBox in place and drops fixed
// width/height. Pixels under 8% opacity (anti-aliasing, invisible helpers) are
// ignored when measuring. Needs ImageMagick (`magick`) with SVG support.
//
//   node fit-icons.ts icons/foo.svg [icons/bar.svg ...]   (default: every icons/*.svg)

import { readFileSync, writeFileSync, readdirSync, mkdtempSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = dirname(fileURLToPath(import.meta.url));
const RENDER = 1024; // px along the longest side when measuring
const PAD = 0.02; // padding around the content, as a fraction of its longest side

const files = process.argv.length > 2
  ? process.argv.slice(2)
  : readdirSync(join(ROOT, "icons")).filter((f) => f.endsWith(".svg")).sort().map((f) => join(ROOT, "icons", f));

const num = (s: string | undefined) => (s === undefined ? NaN : parseFloat(s));
const attr = (tag: string, name: string) => tag.match(new RegExp(`\\s${name}\\s*=\\s*"([^"]*)"`))?.[1];
const setAttrs = (tag: string, attrs: Record<string, string | null>) => {
  let out = tag;
  for (const [name, value] of Object.entries(attrs)) {
    out = out.replace(new RegExp(`\\s${name}\\s*=\\s*"[^"]*"`), "");
    if (value !== null) out = out.replace(/^<svg\b/, `<svg ${name}="${value}"`);
  }
  return out;
};

const tmp = mkdtempSync(join(tmpdir(), "fit-icons-"));
try {
  for (const file of files) {
    const src = readFileSync(file, "utf8");
    const tag = src.match(/<svg\b[^>]*>/)?.[0];
    if (!tag) { console.warn(`skip ${file}: no <svg> root`); continue; }

    let [vx, vy, vw, vh] = (attr(tag, "viewBox") ?? "").split(/[\s,]+/).map(Number);
    if (![vx, vy, vw, vh].every(Number.isFinite)) {
      [vx, vy, vw, vh] = [0, 0, num(attr(tag, "width")), num(attr(tag, "height"))];
    }
    if (!(vw > 0 && vh > 0)) { console.warn(`skip ${file}: no usable viewBox or size`); continue; }

    // Render at a known pixel size so pixels map linearly onto viewBox units.
    const scale = RENDER / Math.max(vw, vh);
    const probe = join(tmp, "probe.svg");
    writeFileSync(probe, src.replace(tag, setAttrs(tag, {
      viewBox: `${vx} ${vy} ${vw} ${vh}`,
      width: String(Math.round(vw * scale)),
      height: String(Math.round(vh * scale)),
    })));
    const bbox = execFileSync("magick", ["-background", "none", "-density", "96", probe, "-alpha", "extract", "-threshold", "8%", "-format", "%@", "info:"], { encoding: "utf8" });
    const m = bbox.match(/^(\d+)x(\d+)\+(-?\d+)\+(-?\d+)/);
    if (!m) { console.warn(`skip ${file}: could not measure (${bbox.trim()})`); continue; }
    const [w, h, x, y] = m.slice(1).map(Number);

    const pad = (Math.max(w, h) / scale) * PAD;
    const round = (n: number) => Math.round(n * 1000) / 1000;
    const viewBox = [vx + x / scale - pad, vy + y / scale - pad, w / scale + 2 * pad, h / scale + 2 * pad].map(round).join(" ");
    writeFileSync(file, src.replace(tag, setAttrs(tag, { viewBox, width: null, height: null })));
    console.log(`${file}: viewBox ${vx} ${vy} ${vw} ${vh} → ${viewBox}`);
  }
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
