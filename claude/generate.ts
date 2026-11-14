// Generates ../homelab.svg and ../services/<service>/readme.md from ../homelab.json.
// homelab.json is the only source of truth; the layout is a pure function of its
// contents, so reruns produce identical output.
//
//   node generate.ts [input.json] [output.svg]   (readmes go to services/ next to the svg)

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Ajv } from "ajv";
import { writeServiceReadmes } from "./services.ts";
import { measure, outline, useFontDir } from "./fonts.ts";

const ROOT = dirname(fileURLToPath(import.meta.url));
const INPUT = resolve(process.argv[2] ?? join(ROOT, "..", "homelab.json"));
const OUTPUT = resolve(process.argv[3] ?? join(ROOT, "..", "homelab.svg"));
const SERVICES_DIR = join(dirname(OUTPUT), "services");
const SCHEMA = join(ROOT, "homelab.schema.json");
const ICON_DIR = join(ROOT, "icons");
useFontDir(join(ROOT, "fonts"));

// ---------------------------------------------------------------- types

type Opt<T> = T | null | undefined;

export interface Service { name: string; icon?: Opt<string>; status?: Opt<string> }
export interface Guest {
  id: string; name: string; type?: Opt<string>; vmid?: Opt<string | number>;
  ip?: Opt<string>; hostname?: Opt<string>; network?: Opt<string>;
  description?: Opt<string>; icon?: Opt<string>; status?: Opt<string>;
  services?: Opt<Service[]>;
}
// mode: "wan" marks the uplink port. status: "used" (something is plugged in
// that isn't in the JSON yet), "free" or "planned"; a port named by a link is connected.
export interface Port {
  id: string; name?: Opt<string>; speed?: Opt<string>; mode?: Opt<string>;
  status?: Opt<string>; note?: Opt<string>;
}
// kind: "cpu", "memory", "ssd", "hdd", "nvme", "nic", … (shown as the tile's label).
export interface Hardware { name: string; kind?: Opt<string>; detail?: Opt<string> }
export interface Device {
  id: string; name: string; role?: Opt<string>; model?: Opt<string>; os?: Opt<string>;
  ip?: Opt<string>; hostname?: Opt<string>; network?: Opt<string>;
  description?: Opt<string>; icon?: Opt<string>; status?: Opt<string>;
  ports?: Opt<Port[]>; hardware?: Opt<Hardware[]>; guests?: Opt<Guest[]>;
}
interface Network { id: string; name: string; cidr?: Opt<string>; domain?: Opt<string>; color?: Opt<string>; description?: Opt<string> }
export interface Link {
  from?: Opt<string>; to?: Opt<string>; fromPort?: Opt<string>; toPort?: Opt<string>;
  type?: Opt<string>; cable?: Opt<string>; speed?: Opt<string>; label?: Opt<string>; status?: Opt<string>;
}
interface Homelab {
  meta?: Opt<{ title?: Opt<string>; updated?: Opt<string> }>;
  networks?: Opt<Network[]>; devices?: Opt<Device[]>; links?: Opt<Link[]>;
}

// tab: width of the name tab on a tab card; the card body's top edge sits TAB_H lower.
interface Box { x: number; y: number; w: number; h: number; tab?: number }

// ---------------------------------------------------------------- style

const C = {
  bg: "#0b0f15",
  dot: "#1a212b",
  // Panels are translucent overlays, as in the reference: each nesting level
  // gets lighter and the dot grid shows through faintly.
  card: "rgba(110, 150, 200, 0.06)",
  cardInner: "rgba(110, 150, 200, 0.07)",
  border: "#2a333f",
  text: "#e6edf3",
  dim: "#8b949e",
  faint: "#5c6672",
  host: "#79a8e0",
  lan: "#c9d1d9",
  wan: "#e5534b",
  section: "#d4a373",
};
const ROLE_COLOR: Record<string, string> = {
  internet: "#9aa4b2", router: "#e5534b", switch: "#8b949e", server: "#6e7681",
};
const GUEST_COLOR: Record<string, string> = { lxc: "#d9822b", vm: "#4f9cf9" };
const NET_PALETTE = ["#4f9cf9", "#e5a54b", "#a371f7", "#3fb950", "#e5534b", "#39c5cf"];

const W = 1200;
const M = 40;
const TIER_GAP = 84;
const TAB_H = 28;

// ---------------------------------------------------------------- helpers

const warnings: string[] = [];
const warn = (msg: string) => warnings.push(msg);

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const has = (s: Opt<string>): s is string => typeof s === "string" && s.trim() !== "";
// Translucent fill in an outline's colour, for coloured panels and rows.
function tint(hex: string, alpha: number): string {
  const m = hex.match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  if (!m) return `rgba(110, 150, 200, ${alpha})`;
  return `rgba(${m.slice(1).map((h) => parseInt(h, 16)).join(", ")}, ${alpha})`;
}
const r1 = (n: number) => Math.round(n * 10) / 10;
const isPlanned = (x: { status?: Opt<string> }) => x.status === "planned";

// Text is drawn as outlines (see fonts.ts), so widths here are exact.
function textWidth(s: string, size: number, mono = false, weight = 400): number {
  return measure(s, { size, mono, weight });
}
function fit(s: string, max: number, size: number, mono = false, weight = 400): string {
  if (textWidth(s, size, mono, weight) <= max) return s;
  let out = s;
  while (out.length > 1 && textWidth(out + "…", size, mono, weight) > max) out = out.slice(0, -1);
  return out + "…";
}

interface TextOpts { size?: number; fill?: string; mono?: boolean; weight?: number; anchor?: "start" | "middle" | "end"; spacing?: number; max?: number }
function text(x: number, y: number, s: string, o: TextOpts = {}): string {
  const st = { size: o.size ?? 12, mono: o.mono, weight: o.weight ?? 400, spacing: o.spacing };
  const body = o.max ? fit(s, o.max, st.size, o.mono, st.weight) : s;
  const w = measure(body, st);
  const x0 = o.anchor === "middle" ? x - w / 2 : o.anchor === "end" ? x - w : x;
  const d = outline(body, x0, y, st);
  return d ? `<path d="${d}" fill="${o.fill ?? C.text}"/>` : "";
}
const sectionLabel = (x: number, y: number, s: string, fill = C.section) =>
  text(x, y, s.toUpperCase(), { size: 10, weight: 600, fill, spacing: 1.2 });

// ---------------------------------------------------------------- IPv4

function parseIp(ip: string): number | null {
  const m = ip.trim().match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return null;
  const parts = m.slice(1).map(Number);
  if (parts.some((p) => p > 255)) return null;
  return ((parts[0] << 24) >>> 0) + (parts[1] << 16) + (parts[2] << 8) + parts[3];
}
function parseCidr(cidr: string): { base: number; mask: number } | null {
  const [ip, bits] = cidr.split("/");
  const base = parseIp(ip ?? "");
  const n = Number(bits);
  if (base === null || !Number.isInteger(n) || n < 0 || n > 32) return null;
  const mask = n === 0 ? 0 : (0xffffffff << (32 - n)) >>> 0;
  return { base: (base & mask) >>> 0, mask };
}
const lastOctet = (ip: string) => "." + ip.trim().split(".").pop();

// ---------------------------------------------------------------- load + validate

function load(): Homelab {
  let data: unknown;
  try {
    data = JSON.parse(readFileSync(INPUT, "utf8"));
  } catch (e) {
    console.error(`✗ ${INPUT} is not valid JSON: ${(e as Error).message}`);
    process.exit(1);
  }
  const ajv = new Ajv({ allErrors: true, allowUnionTypes: true });
  const validate = ajv.compile(JSON.parse(readFileSync(SCHEMA, "utf8")));
  if (!validate(data)) {
    console.error(`✗ ${INPUT} does not match homelab.schema.json:`);
    for (const err of validate.errors ?? []) console.error(`  ${err.instancePath || "/"} ${err.message}`);
    process.exit(1);
  }
  console.log(`✓ ${basename(INPUT)} matches schema`);
  return data as Homelab;
}

const lab = load();
const networks = lab.networks ?? [];
const devices = lab.devices ?? [];
const links = lab.links ?? [];

// Index every id (devices + guests) and flag duplicates.
const deviceById = new Map<string, Device>();
const guestOwner = new Map<string, Device>();
for (const d of devices) {
  if (deviceById.has(d.id) || guestOwner.has(d.id)) warn(`duplicate id "${d.id}"`);
  deviceById.set(d.id, d);
  for (const g of d.guests ?? []) {
    if (deviceById.has(g.id) || guestOwner.has(g.id)) warn(`duplicate id "${g.id}"`);
    guestOwner.set(g.id, d);
  }
}

// Networks: parse CIDRs, assign colours.
const netInfo = networks.map((n, i) => {
  const parsed = has(n.cidr) ? parseCidr(n.cidr) : null;
  if (has(n.cidr) && !parsed) warn(`network "${n.id}" has invalid CIDR "${n.cidr}"`);
  return { net: n, parsed, color: has(n.color) ? n.color : NET_PALETTE[i % NET_PALETTE.length] };
});
const netById = new Map(netInfo.map((n) => [n.net.id, n]));
function networkOf(ip: Opt<string>) {
  const v = has(ip) ? parseIp(ip) : null;
  if (v === null) return undefined;
  return netInfo.find((n) => n.parsed && ((v & n.parsed.mask) >>> 0) === n.parsed.base);
}
const ipColor = (ip: string) => networkOf(ip)?.color ?? NET_PALETTE[0];

// IP checks: format, membership in a network, duplicates.
{
  const seen = new Map<string, string>();
  const check = (owner: string, ip: Opt<string>, netId: Opt<string>) => {
    if (!has(ip)) return;
    if (parseIp(ip) === null) return warn(`${owner}: "${ip}" is not a valid IPv4 address`);
    if (seen.has(ip)) warn(`${owner}: IP ${ip} is also used by ${seen.get(ip)}`);
    else seen.set(ip, owner);
    if (has(netId)) {
      const n = netById.get(netId);
      if (!n) warn(`${owner}: unknown network "${netId}"`);
      else if (networkOf(ip) !== n) warn(`${owner}: IP ${ip} is outside network "${netId}" (${n.net.cidr ?? "no CIDR"})`);
    } else if (netInfo.length && !networkOf(ip)) {
      warn(`${owner}: IP ${ip} is not inside any network (${netInfo.map((n) => n.net.cidr).filter(Boolean).join(", ")})`);
    }
  };
  for (const d of devices) {
    check(`device "${d.id}"`, d.ip, d.network);
    for (const g of d.guests ?? []) check(`guest "${g.id}"`, g.ip, g.network ?? d.network);
  }
}

// Link checks: endpoints must name a device or guest, and ports must exist on it.
const validLinks: Link[] = [];
const portUse = new Map<string, Link>(); // "device:port" -> the link plugged into it
links.forEach((l, i) => {
  const label = `link #${i + 1} (${l.from ?? "?"} → ${l.to ?? "?"})`;
  const missing = [l.from, l.to].filter((e) => !has(e) || (!deviceById.has(e) && !guestOwner.has(e)));
  if (missing.length) return warn(`${label}: no device or guest named ${missing.map((m) => `"${m ?? ""}"`).join(", ")}`);
  if (l.from === l.to) return warn(`${label}: links a device to itself`);
  for (const [end, port] of [[l.from!, l.fromPort], [l.to!, l.toPort]] as const) {
    if (!has(port)) continue;
    const d = deviceById.get(end);
    if (!d?.ports?.some((p) => p.id === port)) warn(`${label}: "${end}" has no port "${port}"`);
    else if (portUse.has(`${end}:${port}`)) warn(`${label}: port "${port}" on "${end}" is already used by another link`);
    else portUse.set(`${end}:${port}`, l);
  }
  validLinks.push(l);
});
for (const d of devices) {
  const ids = (d.ports ?? []).map((p) => p.id);
  for (const id of new Set(ids)) if (ids.indexOf(id) !== ids.lastIndexOf(id)) warn(`device "${d.id}": duplicate port id "${id}"`);
}

// ---------------------------------------------------------------- icons

const iconSymbols = new Map<string, { id: string; aspect: number }>(); // file name -> symbol
const iconDefs: string[] = [];
const reportedMissing = new Set<string>();

function iconFile(name: Opt<string>, owner: string): string | null {
  if (!has(name)) return null;
  for (const ext of [".svg", ".png"]) {
    const f = join(ICON_DIR, name + ext);
    if (existsSync(f)) return f;
  }
  if (!reportedMissing.has(name)) warn(`${owner}: icon "${name}" has no file in icons/`);
  reportedMissing.add(name);
  return null;
}
// Width/height ratio of an SVG icon, from its root viewBox (run fit-icons.ts so
// the viewBox hugs the artwork). PNGs and unreadable SVGs count as square.
function iconAspect(file: string, data: Buffer): number {
  if (!file.endsWith(".svg")) return 1;
  const tag = data.toString("utf8").match(/<svg\b[^>]*>/)?.[0] ?? "";
  const vb = tag.match(/\sviewBox\s*=\s*"([^"]*)"/)?.[1]?.split(/[\s,]+/).map(Number) ?? [];
  const a = vb[2] / vb[3];
  return Number.isFinite(a) && a > 0 ? a : 1;
}
function iconSymbol(file: string): { id: string; aspect: number } {
  let sym = iconSymbols.get(file);
  if (sym) return sym;
  const data = readFileSync(file);
  sym = { id: `icon-${iconSymbols.size}`, aspect: iconAspect(file, data) };
  const a = r1(sym.aspect * 1000) / 1000;
  const mime = file.endsWith(".png") ? "image/png" : "image/svg+xml";
  iconDefs.push(`<symbol id="${sym.id}" viewBox="0 0 ${a} 1"><image width="${a}" height="1" preserveAspectRatio="xMidYMid meet" href="data:${mime};base64,${data.toString("base64")}"/></symbol>`);
  iconSymbols.set(file, sym);
  return sym;
}
// Draws an icon centred in an s×s slot, sized by area rather than by fitting the
// square, so wide and tall logos look as big as square ones. Wide icons may
// spill sideways a little; nothing grows taller than the slot.
function useIcon(file: string, x: number, y: number, s: number): string {
  const { id, aspect } = iconSymbol(file);
  let w = s * Math.sqrt(0.9 * aspect), h = s * Math.sqrt(0.9 / aspect);
  const shrink = Math.min(1, (1.25 * s) / w, s / h);
  w *= shrink; h *= shrink;
  return `<use href="#${id}" x="${r1(x + (s - w) / 2)}" y="${r1(y + (s - h) / 2)}" width="${r1(w)}" height="${r1(h)}"/>`;
}

// Built-in fallbacks for when no icon file exists.
function glyph(kind: string, x: number, y: number, s: number, color: string, label: string): string {
  const k = s / 24;
  const t = (d: string) => `<g transform="translate(${r1(x)} ${r1(y)}) scale(${r1(k * 100) / 100})" fill="none" stroke="${color}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${d}</g>`;
  switch (kind) {
    case "switch":
      return t(`<rect x="2" y="7" width="20" height="10" rx="2"/>` +
        [5, 9, 13].map((cx) => `<rect x="${cx}" y="10" width="2.6" height="3" fill="${color}" stroke="none"/>`).join("") +
        `<circle cx="18.5" cy="11.5" r="1" fill="${color}" stroke="none"/>`);
    case "router":
      return t(`<rect x="2" y="13" width="20" height="7" rx="2"/><path d="M7 13V9M17 13V9M8 5a6 6 0 0 1 8 0"/><circle cx="6" cy="16.5" r="0.9" fill="${color}" stroke="none"/><circle cx="9" cy="16.5" r="0.9" fill="${color}" stroke="none"/>`);
    case "server":
      return t(`<rect x="3" y="3" width="18" height="8" rx="2"/><rect x="3" y="13" width="18" height="8" rx="2"/><path d="M7 7h.01M7 17h.01"/>`);
    default: {
      const ch = (label.trim()[0] ?? "?").toUpperCase();
      return `<rect x="${r1(x)}" y="${r1(y)}" width="${s}" height="${s}" rx="${r1(s / 4)}" fill="none" stroke="${color}" stroke-width="1.4"/>` +
        text(x + s / 2, y + s / 2 + s * 0.18, ch, { size: r1(s * 0.5), weight: 600, fill: color, anchor: "middle" });
    }
  }
}
function icon(names: Opt<string>[], owner: string, fallback: string, x: number, y: number, s: number, color: string, label: string): string {
  for (const n of names) {
    const f = iconFile(n, owner);
    if (f) return useIcon(f, x, y, s);
  }
  if (!names.some(has)) warn(`${owner}: no icon set, using the "${fallback}" fallback`);
  const typeFile = existsSync(join(ICON_DIR, fallback + ".svg")) ? join(ICON_DIR, fallback + ".svg") : null;
  if (typeFile) return useIcon(typeFile, x, y, s);
  return glyph(fallback, x, y, s, color, label);
}

// ---------------------------------------------------------------- shapes

// Card with a name tab on its top-left edge, like the reference.
function tabCard(b: Box, tabW: number, stroke: string, planned: boolean): string {
  const { x, y, w, h } = b;
  const r = 10, top = y + TAB_H;
  const d = [
    `M${x} ${y + r}`, `Q${x} ${y} ${x + r} ${y}`, `H${x + tabW - 10}`,
    `L${x + tabW + 10} ${top}`, `H${x + w - r}`, `Q${x + w} ${top} ${x + w} ${top + r}`,
    `V${y + h - r}`, `Q${x + w} ${y + h} ${x + w - r} ${y + h}`, `H${x + r}`,
    `Q${x} ${y + h} ${x} ${y + h - r}`, "Z",
  ].map((s) => s.replace(/(\d+\.\d{2,})/g, (n) => String(r1(Number(n))))).join(" ");
  return `<path d="${d}" fill="${C.card}" stroke="${stroke}" stroke-width="1.3"${planned ? ` stroke-dasharray="6 4"` : ""}/>`;
}
function roundRect(b: Box, fill: string, stroke: string, rx = 10, planned = false, width = 1.2): string {
  return `<rect x="${r1(b.x)}" y="${r1(b.y)}" width="${r1(b.w)}" height="${r1(b.h)}" rx="${rx}" fill="${fill}" stroke="${stroke}" stroke-width="${width}"${planned ? ` stroke-dasharray="6 4"` : ""}/>`;
}
function dimmed(planned: boolean, inner: string): string {
  return planned ? `<g opacity="0.5">${inner}</g>` : inner;
}

// ---------------------------------------------------------------- device cards

const roleOf = (d: Device) => (has(d.role) ? d.role.toLowerCase() : "other");
const roleColor = (d: Device) => ROLE_COLOR[roleOf(d)] ?? C.dim;

function tabTitle(d: Device): { title: string; width: number; svg: (x: number, y: number) => string } {
  const role = has(d.role) ? d.role : "";
  const nameW = textWidth(d.name, 15, false, 700);
  const roleW = role ? textWidth(` · ${role}`, 11) : 0;
  return {
    title: d.name,
    width: Math.max(80, nameW + roleW + 30),
    svg: (x, y) =>
      text(x + 14, y + 19, d.name, { size: 15, weight: 700 }) +
      (role ? text(x + 14 + nameW, y + 19, ` · ${role}`, { size: 11, fill: C.dim }) : ""),
  };
}

const tabWidth = (d: Device, cardW: number) => Math.min(tabTitle(d).width, cardW - 30);

// Detail lines shown next to a device's icon. Missing fields are skipped.
function detailLines(d: Device, x: number, y: number, maxW: number): { svg: string; h: number } {
  const out: string[] = [];
  let cy = y;
  if (has(d.model)) { out.push(text(x, cy, d.model, { size: 13, weight: 600, max: maxW })); cy += 18; }
  const addr = addrLine(d.ip, d.hostname, x, cy, maxW, 12);
  if (addr) { out.push(addr); cy += 18; }
  if (has(d.os)) { out.push(text(x, cy, d.os, { size: 11, fill: C.dim, max: maxW })); cy += 16; }
  if (has(d.description)) { out.push(text(x, cy, d.description, { size: 11, fill: C.dim, max: maxW })); cy += 16; }
  if (!out.length) { out.push(text(x, cy, "no details", { size: 11, fill: C.faint })); cy += 16; }
  return { svg: out.join(""), h: cy - y };
}
function addrLine(ip: Opt<string>, host: Opt<string>, x: number, y: number, maxW: number, size: number): string | null {
  if (!has(ip) && !has(host)) return null;
  const parts: string[] = [];
  let cx = x;
  if (has(ip)) {
    parts.push(text(cx, y, ip, { size, mono: true, fill: ipColor(ip) }));
    cx += textWidth(ip, size, true);
  }
  if (has(host)) {
    const prefix = has(ip) ? " · " : "";
    const room = maxW - (cx - x) - textWidth(prefix, size, true);
    parts.push(text(cx, y, prefix + fit(host, room, size, true), { size, mono: true, fill: C.host }));
  }
  return parts.join("");
}

// Port row on the right of a device card, as in the reference: speed above
// each port, its name and what it connects to below.
const PORT_STEP = 58, PORT_W = 30, PORT_H = 24, PORT_ROW_H = 92, DETAILS_W = 230;
const portAnchors = new Map<string, { x: number; top: number; bottom: number }>(); // "device:port"
// Port labels are drawn above the links on a patch of the card's colour, so a
// cable running into a port breaks around its labels instead of crossing them.
const portLabels: string[] = [];
const LABEL_BG = "#101720"; // C.card over C.bg
function portLabel(cx: number, y: number, s: string, o: TextOpts): string {
  const size = o.size ?? 12;
  const w = textWidth(o.max ? fit(s, o.max, size, o.mono, o.weight) : s, size, o.mono, o.weight);
  return `<rect x="${r1(cx - w / 2 - 3)}" y="${r1(y - size)}" width="${r1(w + 6)}" height="${r1(size + 4)}" fill="${LABEL_BG}"/>` +
    text(cx, y, s, { ...o, anchor: "middle" });
}

const portsWidth = (d: Device) => (d.ports?.length ?? 0) * PORT_STEP;
const deviceCardWidth = (d: Device) => (d.ports?.length ? 74 + DETAILS_W + portsWidth(d) + 12 : 360);

function portState(d: Device, p: Port): { color: string; fill: string; caption: string; planned: boolean } {
  const link = portUse.get(`${d.id}:${p.id}`);
  const wan = (p.mode ?? "").toLowerCase() === "wan" || (link?.type ?? "").toLowerCase() === "wan";
  const planned = p.status === "planned" || (link ? isPlanned(link) : false);
  if (link) {
    const other = link.from === d.id ? link.to! : link.from!;
    const name = deviceById.get(other)?.name ?? guestOwner.get(other)?.guests?.find((g) => g.id === other)?.name ?? other;
    const color = wan ? C.wan : C.lan;
    return { color, fill: tint(color, 0.12), caption: has(p.note) ? p.note : name, planned };
  }
  if (wan) return { color: C.wan, fill: tint(C.wan, 0.12), caption: has(p.note) ? p.note : "WAN", planned };
  if (p.status === "used") return { color: C.dim, fill: tint(C.dim, 0.18), caption: has(p.note) ? p.note : "in use", planned };
  // Only say "free" when the JSON says so; an unknown port just shows its name.
  const caption = has(p.note) ? p.note : planned ? "planned" : p.status === "free" ? "free" : "";
  if (p.status === "free") return { color: C.faint, fill: "none", caption, planned };
  return { color: C.dim, fill: tint(C.lan, 0.12), caption, planned };
}

function portRow(d: Device, b: Box): string {
  const ports = d.ports ?? [];
  if (!ports.length) return "";
  const bodyY = b.y + TAB_H;
  const top = bodyY + 26;
  const x0 = b.x + b.w - 12 - portsWidth(d);
  return ports.map((p, i) => {
    const cx = x0 + i * PORT_STEP + PORT_STEP / 2;
    const px = cx - PORT_W / 2;
    const st = portState(d, p);
    portAnchors.set(`${d.id}:${p.id}`, { x: cx, top, bottom: top + PORT_H });
    const jack = `M${r1(px + 8)} ${r1(top + 9)} H${r1(px + 11)} V${r1(top + 6)} H${r1(px + 19)} V${r1(top + 9)} H${r1(px + 22)} V${r1(top + 18)} H${r1(px + 8)} Z`;
    const dim = (svg: string) => dimmed((st.planned && !isPlanned(d)) || isPlanned(d), svg);
    portLabels.push(dim(
      (has(p.speed) ? portLabel(cx, top - 7, p.speed, { size: 10, mono: true, fill: C.dim }) : "") +
      portLabel(cx, top + PORT_H + 14, has(p.name) ? p.name : p.id, { size: 10, fill: C.dim, max: PORT_STEP - 4 }) +
      (st.caption ? portLabel(cx, top + PORT_H + 27, st.caption, { size: 10, weight: 600, fill: st.color, max: PORT_STEP - 2 }) : ""),
    ));
    const svg =
      `<rect x="${r1(px)}" y="${r1(top)}" width="${PORT_W}" height="${PORT_H}" rx="4" fill="${st.fill}" stroke="${st.color}" stroke-width="1.3"${st.planned ? ` stroke-dasharray="3 2"` : ""}/>` +
      `<path d="${jack}" fill="${C.bg}"/>`;
    return dimmed(st.planned && !isPlanned(d), svg);
  }).join("");
}

function measureDeviceCard(d: Device, w: number): number {
  const details = detailLines(d, 0, 0, (d.ports?.length ? DETAILS_W : w) - 90).h;
  return TAB_H + Math.max(42 + 30, details + 30, d.ports?.length ? PORT_ROW_H : 0);
}
function deviceCard(d: Device, b: Box): string {
  const planned = isPlanned(d);
  const tab = tabTitle(d);
  const color = roleColor(d);
  const bodyY = b.y + TAB_H;
  const detailsW = d.ports?.length ? b.w - 90 - portsWidth(d) - 12 : b.w - 90;
  const details = detailLines(d, b.x + 74, bodyY + 28, detailsW);
  const svg =
    tabCard(b, tabWidth(d, b.w), color, planned) +
    tab.svg(b.x, b.y) +
    icon([d.icon], `device "${d.id}"`, roleOf(d), b.x + 18, bodyY + 14, 42, color, d.name) +
    details.svg +
    portRow(d, b);
  return dimmed(planned, svg);
}

// ---------------------------------------------------------------- internet cloud

function cloud(d: Device, cx: number, top: number): { svg: string; box: Box } {
  const cy = top + 70;
  const p = (dx: number, dy: number) => `${r1(cx + dx)} ${r1(cy + dy)}`;
  const d_ = `M${p(-110, 45)} A34 34 0 0 1 ${p(-92, -12)} A44 44 0 0 1 ${p(-20, -52)} A54 54 0 0 1 ${p(80, -18)} A34 34 0 0 1 ${p(110, 45)} Z`;
  const planned = isPlanned(d);
  const iconFileName = iconFile(d.icon, `device "${d.id}"`);
  const sub = has(d.description) ? d.description : has(d.model) ? d.model : "";
  const svg =
    `<path d="${d_}" fill="${C.card}" stroke="${roleColor(d)}" stroke-width="1.3"${planned ? ` stroke-dasharray="6 4"` : ""}/>` +
    (iconFileName ? useIcon(iconFileName, cx - 13, cy - 44, 26) : "") +
    text(cx, cy + 8, d.name, { size: 20, weight: 600, anchor: "middle", max: 190 }) +
    (sub ? text(cx, cy + 27, sub, { size: 11, fill: C.dim, anchor: "middle", max: 190 }) : "");
  return { svg: dimmed(planned, svg), box: { x: cx - CLOUD_HALF_W, y: top, w: 2 * CLOUD_HALF_W, h: CLOUD_H } };
}

// ---------------------------------------------------------------- servers + guests

const GUEST_W_MIN = 220;
const GUEST_GAP = 12;
const GUEST_BASE_H = 64;
const SERVICE_ROW = 18;

const guestKind = (g: Guest) => (has(g.type) ? g.type.toLowerCase() : "other");
const guestServices = (g: Guest) => (g.services ?? []).filter((s) => has(s.name));
const guestHeight = (g: Guest) => {
  const n = guestServices(g).length;
  return GUEST_BASE_H + (n > 1 ? n * SERVICE_ROW + 6 : 0);
};

// parentPlanned: the server is already dimmed, so don't dim the guest a second time.
function guestCard(g: Guest, b: Box, parentPlanned: boolean): string {
  const planned = isPlanned(g) && !parentPlanned;
  const kind = guestKind(g);
  const services = guestServices(g);
  const multi = services.length > 1;
  const textX = b.x + 50;
  const right = b.x + b.w - 12;
  const rightW = (has(g.ip) ? 40 : 0) + 6;
  const parts: string[] = [roundRect(b, C.cardInner, C.border, 8, planned, 1)];
  parts.push(icon([g.icon, ...services.map((s) => s.icon)], `guest "${g.id}"`, kind, b.x + 12, b.y + 13, 28, GUEST_COLOR[kind] ?? C.dim, g.name));
  parts.push(text(textX, b.y + 24, g.name, { size: 13, weight: 600, max: b.w - 62 - rightW - 30 }));

  const sub = has(g.description) ? g.description
    : !multi && services.length === 1 && services[0].name !== g.name ? services[0].name : "";
  let cy = b.y + 39;
  if (sub) { parts.push(text(textX, cy, sub, { size: 11, fill: C.dim, max: b.w - 62 })); cy += 15; }
  const addr = addrLine(g.ip, g.hostname, textX, sub ? cy : b.y + 44, b.w - 62, 11);
  if (addr) parts.push(addr);

  const tag = g.vmid !== null && g.vmid !== undefined && String(g.vmid) !== ""
    ? `${kind === "vm" ? "VM" : "CT"} ${g.vmid}` : kind === "other" ? "" : kind.toUpperCase();
  if (tag) parts.push(text(right, b.y + 22, tag, { size: 10, mono: true, fill: C.faint, anchor: "end" }));
  if (has(g.ip) && parseIp(g.ip) !== null) parts.push(text(right, b.y + 36, lastOctet(g.ip), { size: 10, mono: true, fill: C.faint, anchor: "end" }));

  if (multi) {
    let sy = b.y + GUEST_BASE_H;
    for (const s of services) {
      const row = icon([s.icon], `service "${s.name}" in "${g.id}"`, "other", textX, sy - 11, 13, C.dim, s.name) +
        text(textX + 20, sy, s.name, { size: 11, weight: 500, max: b.w - 82 });
      parts.push(dimmed(isPlanned(s), row));
      sy += SERVICE_ROW;
    }
  }
  return dimmed(planned, parts.join(""));
}

const GROUP_ORDER = ["lxc", "vm"];
const GROUP_TITLE: Record<string, string> = { lxc: "LXC containers", vm: "Virtual machines", other: "Other guests" };

// One panel per guest type: LXCs first, then VMs, then anything else in JSON order.
function guestGroups(d: Device): { kind: string; guests: Guest[] }[] {
  const all = d.guests ?? [];
  const rank = (k: string) => (GROUP_ORDER.includes(k) ? GROUP_ORDER.indexOf(k) : GROUP_ORDER.length);
  const kinds = [...new Set(all.map(guestKind))].sort((a, b) => rank(a) - rank(b));
  return kinds.map((kind) => ({ kind, guests: all.filter((g) => guestKind(g) === kind) }));
}

// Hardware tiles sit in the server card's header, right-aligned beside the
// model/IP block, in neutral colours so the guest panels below stay the focus.
const HW_W = 200, HW_TILE_H = 46, HW_GAP = 10, HW_LEFT_RESERVE = 420;

function hwGlyph(kind: string, x: number, y: number, s: number, color: string): string {
  const k = kind.toLowerCase();
  const body =
    /cpu|processor/.test(k)
      ? `<rect x="6" y="6" width="12" height="12" rx="1.5"/><rect x="9.5" y="9.5" width="5" height="5" rx="0.5"/><path d="M9 3v3M12 3v3M15 3v3M9 18v3M12 18v3M15 18v3M3 9h3M3 12h3M3 15h3M18 9h3M18 12h3M18 15h3"/>`
      : /mem|ram/.test(k)
        ? `<rect x="2" y="7" width="20" height="9" rx="1"/><path d="M6 10v3M10 10v3M14 10v3M18 10v3M5 16v3M8 16v3M11 16v3M14 16v3M17 16v3"/>`
        : /ssd|hdd|nvme|disk|storage|drive/.test(k)
          ? `<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 15h18"/><circle cx="17.5" cy="17" r="0.6" fill="${color}"/>`
          : /nic|net|ethernet/.test(k)
            ? `<rect x="3" y="7" width="18" height="11" rx="1.5"/><path d="M8 18v-4h8v4M10 14v-2h4v2"/>`
            : `<circle cx="12" cy="12" r="8"/>`;
  return `<g transform="translate(${r1(x)} ${r1(y)}) scale(${r1((s / 24) * 100) / 100})" fill="none" stroke="${color}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${body}</g>`;
}

function hardwareTile(hw: Hardware, b: Box): string {
  const kind = has(hw.kind) ? hw.kind : "";
  const tx = b.x + 38, maxW = b.w - 46;
  const { x, y, w, h } = b;
  // Square left side with a straight accent along its full height; rounded right side.
  return `<path d="M${r1(x)} ${r1(y)} H${r1(x + w - 6)} Q${r1(x + w)} ${r1(y)} ${r1(x + w)} ${r1(y + 6)} V${r1(y + h - 6)} Q${r1(x + w)} ${r1(y + h)} ${r1(x + w - 6)} ${r1(y + h)} H${r1(x)} Z" fill="${C.cardInner}" stroke="${C.border}" stroke-width="1"/>` +
    `<rect x="${r1(x - 0.5)}" y="${r1(y - 0.5)}" width="2.5" height="${r1(h + 1)}" fill="${C.faint}"/>` +
    hwGlyph(kind, b.x + 11, b.y + 14, 18, C.dim) +
    (kind ? text(tx, b.y + 15, kind.toUpperCase(), { size: 8.5, weight: 600, fill: C.dim, spacing: 1, max: maxW }) : "") +
    text(tx, b.y + (kind ? 28 : 22), hw.name, { size: 12, weight: 600, max: maxW }) +
    (has(hw.detail) ? text(tx, b.y + (kind ? 40 : 36), hw.detail, { size: 9.5, fill: C.dim, max: maxW }) : "");
}

// Tile boxes for a server header: right-aligned rows that wrap when space runs out.
function hardwareLayout(hardware: Hardware[], x: number, top: number, w: number): { boxes: Box[]; h: number } {
  if (!hardware.length) return { boxes: [], h: 0 };
  const avail = w - 18 - HW_LEFT_RESERVE;
  const perRow = Math.max(1, Math.min(hardware.length, Math.floor((avail + HW_GAP) / (HW_W + HW_GAP))));
  const boxes = hardware.map((_, i) => {
    const row = Math.floor(i / perRow);
    const inRow = Math.min(perRow, hardware.length - row * perRow);
    const col = i % perRow;
    const rowW = inRow * HW_W + (inRow - 1) * HW_GAP;
    return { x: x + w - 18 - rowW + col * (HW_W + HW_GAP), y: top + row * (HW_TILE_H + HW_GAP), w: HW_W, h: HW_TILE_H };
  });
  const rows = Math.ceil(hardware.length / perRow);
  return { boxes, h: rows * (HW_TILE_H + HW_GAP) - HW_GAP };
}

// Lays out a server card; returns height and a render function bound to that layout.
function layoutServer(d: Device, x: number, y: number, w: number) {
  const hardware = (d.hardware ?? []).filter((hw) => has(hw.name));
  const hwTop = y + TAB_H + 16;
  const hw = hardwareLayout(hardware, x, hwTop, w);
  const headerH = Math.max(
    TAB_H + Math.max(56, detailLines(d, 0, 0, HW_LEFT_RESERVE - 110).h + 8) + 22,
    hw.h ? hwTop - y + hw.h + 18 : 0,
  );
  const panelX = x + 18;
  const panelW = w - 36;
  const pad = 14;
  const innerW = panelW - pad * 2;
  const cols = Math.max(1, Math.floor((innerW + GUEST_GAP) / (GUEST_W_MIN + GUEST_GAP)));
  const cardW = (innerW - GUEST_GAP * (cols - 1)) / cols;

  const panels: { kind: string; box: Box; cards: { g: Guest; box: Box }[] }[] = [];
  let py = y + headerH;
  for (const grp of guestGroups(d)) {
    const cards: { g: Guest; box: Box }[] = [];
    let rowY = py + 34;
    for (let i = 0; i < grp.guests.length; i += cols) {
      const row = grp.guests.slice(i, i + cols);
      const rowH = Math.max(...row.map(guestHeight));
      row.forEach((g, j) => cards.push({ g, box: { x: panelX + pad + j * (cardW + GUEST_GAP), y: rowY, w: cardW, h: rowH } }));
      rowY += rowH + GUEST_GAP;
    }
    const box = { x: panelX, y: py, w: panelW, h: rowY - py + pad - GUEST_GAP };
    panels.push({ kind: grp.kind, box, cards });
    py = box.y + box.h + 14;
  }
  const h = (panels.length ? py - y + 4 : headerH);

  const render = () => {
    const planned = isPlanned(d);
    const tab = tabTitle(d);
    const color = roleColor(d);
    const box = { x, y, w, h };
    const out: string[] = [
      tabCard(box, tabWidth(d, w), color, planned),
      tab.svg(x, y),
      icon([d.icon], `device "${d.id}"`, roleOf(d), x + 20, y + TAB_H + 18, 48, color, d.name),
      detailLines(d, x + 84, y + TAB_H + 32, (hardware.length ? HW_LEFT_RESERVE : w) - 110).svg,
      ...hardware.map((item, i) => hardwareTile(item, hw.boxes[i])),
    ];
    for (const p of panels) {
      const pc = GUEST_COLOR[p.kind] ?? C.dim;
      out.push(roundRect(p.box, tint(pc, 0.05), pc, 10, false, 1) .replace(`stroke="${pc}"`, `stroke="${pc}" stroke-opacity="0.75"`));
      out.push(sectionLabel(p.box.x + pad, p.box.y + 21, `${GROUP_TITLE[p.kind] ?? p.kind} · ${p.cards.length}`, pc));
      for (const c of p.cards) out.push(guestCard(c.g, c.box, planned));
    }
    return dimmed(planned, out.join(""));
  };
  return { h, render };
}

// ---------------------------------------------------------------- top panels

function networksPanel(x: number, y: number, w: number): { svg: string; h: number } {
  if (!netInfo.length) return { svg: "", h: 0 };
  const out: string[] = [text(x + 16, y + 28, "Networks", { size: 15, weight: 600 })];
  let ry = y + 42;
  for (const { net, color } of netInfo) {
    const rh = has(net.domain) || has(net.description) ? 44 : 32;
    out.push(roundRect({ x: x + 12, y: ry, w: w - 24, h: rh }, tint(color, 0.07), C.border, 6, false, 1));
    out.push(`<rect x="${x + 12}" y="${ry}" width="3" height="${rh}" rx="1.5" fill="${color}"/>`);
    out.push(text(x + 26, ry + 20, net.name, { size: 13, weight: 600, fill: color, max: w / 2 - 30 }));
    if (has(net.cidr)) out.push(text(x + w - 24, ry + 20, net.cidr, { size: 12, mono: true, anchor: "end" }));
    const sub = [net.domain, net.description].filter(has).join(" · ");
    if (sub) out.push(text(x + 26, ry + 35, sub, { size: 10, mono: has(net.domain) && !has(net.description), fill: C.dim, max: w - 50 }));
    ry += rh + 8;
  }
  const h = ry - y + 6;
  return { svg: roundRect({ x, y, w, h }, C.card, C.border, 10) + out.join(""), h };
}

function legendPanel(x: number, y: number, w: number): { svg: string; h: number } {
  const rows: [string, string][] = [
    [`<line x1="0" y1="0" x2="34" y2="0" stroke="${C.lan}" stroke-width="2"/>`, "LAN link"],
    [`<line x1="0" y1="0" x2="34" y2="0" stroke="${C.wan}" stroke-width="2"/>`, "WAN link"],
    [`<line x1="0" y1="0" x2="34" y2="0" stroke="${C.lan}" stroke-width="2" stroke-dasharray="5 5" opacity="0.5"/>`, "planned link"],
    [`<rect x="0" y="-8" width="34" height="16" rx="4" fill="none" stroke="${C.dim}" stroke-dasharray="4 3" opacity="0.6"/>`, "planned device / service"],
    [`<rect x="0" y="-8" width="34" height="16" rx="4" fill="${tint(GUEST_COLOR.lxc, 0.08)}" stroke="${GUEST_COLOR.lxc}"/>`, "LXC containers"],
  ];
  // Port rows only when some device lists ports in that state.
  const portSym = (color: string, fill: string) => `<rect x="9" y="-8" width="16" height="14" rx="3" fill="${fill}" stroke="${color}" stroke-width="1.2"/>`;
  const allPorts = devices.flatMap((d) => (d.ports ?? []).map((p) => ({ d, p })));
  if (allPorts.some(({ d, p }) => !portUse.has(`${d.id}:${p.id}`) && p.status === "used")) rows.push([portSym(C.dim, tint(C.dim, 0.18)), "port in use, device not shown"]);
  if (allPorts.some(({ d, p }) => !portUse.has(`${d.id}:${p.id}`) && (p.mode ?? "").toLowerCase() !== "wan" && p.status === "free")) rows.push([portSym(C.faint, "none"), "free port"]);
  const out = [text(x + 16, y + 28, "Legend", { size: 15, weight: 600 })];
  rows.forEach(([sym, label], i) => {
    const ry = y + 56 + i * 24;
    out.push(`<g transform="translate(${x + 18} ${ry - 4})">${sym}</g>`);
    out.push(text(x + 66, ry, label, { size: 11, fill: C.dim }));
  });
  const h = 56 + rows.length * 24 - 4;
  return { svg: roundRect({ x, y, w, h }, C.card, C.border, 10) + out.join(""), h };
}

// ---------------------------------------------------------------- layout

const TIERS = ["internet", "router", "switch", "other"];
const tierOf = (d: Device) => {
  const r = roleOf(d);
  return r === "server" ? "server" : TIERS.includes(r) ? r : "other";
};

const body: string[] = [];
const boxes = new Map<string, Box>(); // device id -> box used for link anchors

const title = has(lab.meta?.title) ? lab.meta.title : "Homelab";
body.push(text(M, 66, title, { size: 34, weight: 700 }));
if (has(lab.meta?.updated)) body.push(text(W - M, 66, `updated ${lab.meta.updated}`, { size: 12, mono: true, fill: C.dim, anchor: "end" }));

let y = 104;

// Row 1: networks (left), internet (centre), legend (right).
const nets = networksPanel(M, y, 320);
const legend = legendPanel(W - M - 260, y, 260);
body.push(nets.svg, legend.svg);
// Clouds are drawn after the device tiers (below), once the port they plug
// into has a position, so each can sit centred above it.
const internet = devices.filter((d) => tierOf(d) === "internet");
const CLOUD_H = 115, CLOUD_HALF_W = 110;
const cloudTop = y;
y += Math.max(nets.h, legend.h, internet.length ? CLOUD_H : 0);

// Device tiers: router, switch, other.
for (const tier of TIERS.slice(1)) {
  const tierDevices = devices.filter((d) => tierOf(d) === tier);
  if (!tierDevices.length) continue;
  y += TIER_GAP;
  const gap = 40;
  const wanted = tierDevices.map(deviceCardWidth);
  const fit = Math.min(1, (W - 2 * M - gap * (tierDevices.length - 1)) / wanted.reduce((a, b) => a + b, 0));
  const widths = wanted.map((w) => w * fit);
  const totalW = widths.reduce((a, b) => a + b, 0) + (tierDevices.length - 1) * gap;
  const h = Math.max(...tierDevices.map((d, i) => measureDeviceCard(d, widths[i])));
  let x = (W - totalW) / 2;
  tierDevices.forEach((d, i) => {
    const b = { x, y, w: widths[i], h };
    boxes.set(d.id, { ...b, tab: tabWidth(d, b.w) });
    body.push(deviceCard(d, b));
    x += widths[i] + gap;
  });
  y += h;
}

// Internet clouds: centred over the port their single link plugs into, else
// spread around the middle; always kept clear of the networks and legend panels.
{
  const minX = M + 320 + 20 + CLOUD_HALF_W, maxX = W - M - 260 - 20 - CLOUD_HALF_W;
  internet.forEach((d, i) => {
    let cx = W / 2 + (i - (internet.length - 1) / 2) * 240;
    const own = validLinks.filter((l) => l.from === d.id || l.to === d.id);
    if (internet.length === 1 && own.length === 1) {
      const l = own[0];
      const [other, port] = l.from === d.id ? [l.to!, l.toPort] : [l.from!, l.fromPort];
      const anchor = has(port) ? portAnchors.get(`${other}:${port}`) : undefined;
      if (anchor) cx = Math.min(maxX, Math.max(minX, anchor.x));
    }
    const c = cloud(d, cx, cloudTop);
    body.push(c.svg);
    boxes.set(d.id, c.box);
  });
}

// Servers: one card each, side by side, sharing the full width.
const servers = devices.filter((d) => tierOf(d) === "server");
if (servers.length) {
  y += TIER_GAP;
  const gap = 24;
  const w = (W - 2 * M - gap * (servers.length - 1)) / servers.length;
  const laid = servers.map((d, i) => ({ d, x: M + i * (w + gap), l: layoutServer(d, M + i * (w + gap), y, w) }));
  const h = Math.max(...laid.map((s) => s.l.h));
  for (const s of laid) {
    boxes.set(s.d.id, { x: s.x, y, w, h: s.l.h, tab: tabWidth(s.d, w) });
    body.push(s.l.render());
  }
  y += h;
}
const H = Math.ceil(y + 48);

// ---------------------------------------------------------------- links

// Guests attach to their server's card. Links always run downward from the
// higher card; anchors on a shared edge are spread out, ordered by the other end's x.
const anchorBox = (id: string) => boxes.get(id) ?? boxes.get(guestOwner.get(id)?.id ?? "");
interface Routed { l: Link; up: Box; down: Box; upId: string; downId: string }
const routed: Routed[] = [];
for (const l of validLinks) {
  const a = anchorBox(l.from!), b = anchorBox(l.to!);
  if (!a || !b) continue;
  if (a === b) { warn(`link ${l.from} → ${l.to}: both ends are drawn in the same card, skipped`); continue; }
  const [up, down, upId, downId] = a.y <= b.y ? [a, b, l.from!, l.to!] : [b, a, l.to!, l.from!];
  routed.push({ l, up, down, upId, downId });
}
const cx = (b: Box) => b.x + b.w / 2;
// Y of a card's top outline at x: on the tab, its slanted edge, or the body below it.
function topAt(b: Box, x: number): number {
  if (b.tab === undefined) return b.y;
  const t = (x - (b.x + b.tab - 10)) / 20; // 0..1 across the tab's slanted edge
  return b.y + TAB_H * Math.min(1, Math.max(0, t));
}
function spread(key: (r: Routed) => Box, other: (r: Routed) => Box): Map<Routed, number> {
  const groups = new Map<Box, Routed[]>();
  for (const r of routed) groups.set(key(r), [...(groups.get(key(r)) ?? []), r]);
  const out = new Map<Routed, number>();
  for (const [box, rs] of groups) {
    rs.sort((p, q) => cx(other(p)) - cx(other(q)));
    rs.forEach((r, i) => out.set(r, cx(box) + (i - (rs.length - 1) / 2) * 26));
  }
  return out;
}
const upX = spread((r) => r.up, (r) => r.down);
const downX = spread((r) => r.down, (r) => r.up);
// The port (if any) a link plugs into at its upper / lower end.
const portAt = (r: Routed, end: "up" | "down") => {
  const id = end === "up" ? r.upId : r.downId;
  const port = id === r.l.from ? r.l.fromPort : r.l.toPort;
  return has(port) ? portAnchors.get(`${id}:${port}`) : undefined;
};

// Links that skip a tier detour through a lane left of the cards in between.
const allBoxes = [...boxes.values()];
let lanes = 0;

// A box end with no port of its own lines up with the port at the other end
// when it can, so the link drops straight instead of bending.
const linksOn = (box: Box, side: "up" | "down") => routed.filter((q) => (side === "up" ? q.up : q.down) === box).length;
const spans = (b: Box, x: number) => x >= b.x + 12 && x <= b.x + b.w - 12;

const linkSvg: string[] = [];
const portSvg: string[] = [];
for (const r of routed) {
  const planned = isPlanned(r.l);
  const wan = (r.l.type ?? "").toLowerCase() === "wan";
  const color = wan ? C.wan : C.lan;
  const upPort = portAt(r, "up"), downPort = portAt(r, "down");
  let x1 = upPort?.x ?? upX.get(r)!, x2 = downPort?.x ?? downX.get(r)!;
  if (!upPort && downPort && linksOn(r.up, "up") === 1 && spans(r.up, x2)) x1 = x2;
  if (!downPort && upPort && linksOn(r.down, "down") === 1 && spans(r.down, x1)) x2 = x1;
  const y1 = upPort?.bottom ?? r.up.y + r.up.h;
  const y2 = downPort?.top ?? topAt(r.down, x2);
  const ym = r1(r.down.y - TIER_GAP / 2);
  const between = allBoxes.filter((b) => b.y >= r.up.y + r.up.h && b.y + b.h <= r.down.y);
  let d: string;
  if (between.length) {
    const i = lanes++;
    const lane = r1(Math.min(...between.map((b) => b.x)) - 24 - 14 * i);
    d = `M${r1(x1)} ${r1(y1)} V${r1(r.up.y + r.up.h + TIER_GAP / 2 - 12 + 7 * i)} H${lane} V${r1(ym - 6 + 7 * i)} H${r1(x2)} V${r1(y2)}`;
  } else {
    d = x1 === x2 ? `M${r1(x1)} ${r1(y1)} V${r1(y2)}` : `M${r1(x1)} ${r1(y1)} V${ym} H${r1(x2)} V${r1(y2)}`;
  }
  linkSvg.push(`<path d="${d}" fill="none" stroke="${color}" stroke-width="2"${planned ? ` stroke-dasharray="5 5" opacity="0.5"` : ""}/>`);
  for (const [px, py, port] of [[x1, y1, upPort], [x2, y2, downPort]] as const) {
    if (port) continue; // the port glyph is the connector
    portSvg.push(`<rect x="${r1(px - 5)}" y="${r1(py - 3)}" width="10" height="6" rx="1.5" fill="${C.bg}" stroke="${color}" stroke-width="1.2"${planned ? ` opacity="0.5"` : ""}/>`);
  }
  const guest = guestOwner.get(r.downId)?.guests?.find((g) => g.id === r.downId);
  const label = [r.l.label, r.l.cable, r.l.speed, guest ? `→ ${guest.name}` : null].filter(has).join(" · ");
  if (label) linkSvg.push(text(x2 + 9, ym + 22, label, { size: 10, mono: true, fill: wan ? C.wan : C.dim }));
}

// ---------------------------------------------------------------- output

const svg = [
  `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`,
  `<title>${esc(title)}</title>`,
  `<defs><pattern id="dots" width="22" height="22" patternUnits="userSpaceOnUse"><circle cx="11" cy="11" r="0.9" fill="${C.dot}"/></pattern>${iconDefs.join("")}</defs>`,
  `<rect width="${W}" height="${H}" fill="${C.bg}"/><rect width="${W}" height="${H}" fill="url(#dots)"/>`,
  `<g id="nodes">${body.join("")}</g>`,
  `<g id="links">${linkSvg.join("")}</g>`,
  `<g id="port-labels">${portLabels.join("")}</g>`,
  `<g id="ports">${portSvg.join("")}</g>`,
  `</svg>`,
].join("\n");

writeFileSync(OUTPUT, svg + "\n");

writeServiceReadmes({
  devices, links, warn, servicesDir: SERVICES_DIR,
  network: (ip) => networkOf(ip)?.net,
});

if (warnings.length) {
  console.log(`⚠ ${warnings.length} issue(s) in ${INPUT}:`);
  for (const w of warnings) console.log(`  - ${w}`);
} else {
  console.log("✓ all links and IPs resolve to a device and network");
}
console.log(`✓ wrote ${OUTPUT} (${W}×${H})`);
