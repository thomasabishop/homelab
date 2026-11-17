// Writes services/<service>/readme.md for every service in homelab.json.
//
// Each readme has a generated block (network + host facts, rewritten on every
// run) and a hand-written part below it (description + crib) that is kept.
// A new service gets a TODO stub for the hand-written part.

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import type { Device, Guest, Link, Service } from "./generate.ts";

const START = "<!-- generated:start: rewritten from homelab.json on every run; edit that file, not this block -->";
const END = "<!-- generated:end -->";

export interface ReadmeContext {
  devices: Device[];
  links: Link[];
  network: (ip: string) => { name: string; cidr?: string | null } | undefined;
  dnsFor: (ip: string) => string[]; // names of networks this IP is the DNS server for
  warn: (msg: string) => void;
  servicesDir: string;
}

const has = (s: unknown): s is string => typeof s === "string" && s.trim() !== "";
export const slug = (name: string) =>
  name.normalize("NFKD").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

// Shortest link path from the internet to `target`, walking links in JSON order.
function pathTo(ctx: ReadmeContext, target: string, names: Map<string, string>): string[] | null {
  const start = ctx.devices.find((d) => (d.role ?? "").toLowerCase() === "internet");
  if (!start) return null;
  const adj = new Map<string, string[]>();
  for (const l of ctx.links) {
    if (!has(l.from) || !has(l.to)) continue;
    adj.set(l.from, [...(adj.get(l.from) ?? []), l.to]);
    adj.set(l.to, [...(adj.get(l.to) ?? []), l.from]);
  }
  const prev = new Map<string, string | null>([[start.id, null]]);
  const queue = [start.id];
  while (queue.length) {
    const id = queue.shift()!;
    if (id === target) break;
    for (const next of adj.get(id) ?? []) if (!prev.has(next)) { prev.set(next, id); queue.push(next); }
  }
  if (!prev.has(target)) return null;
  const path: string[] = [];
  for (let id: string | null = target; id !== null; id = prev.get(id) ?? null) path.unshift(names.get(id) ?? id);
  return path;
}

function generatedBlock(ctx: ReadmeContext, host: Device, guest: Guest, service: Service, names: Map<string, string>): string {
  const kind = has(guest.type) ? guest.type.toUpperCase() : "guest";
  const rows: [string, string][] = [];
  if (service.status === "planned" || guest.status === "planned" || host.status === "planned") rows.push(["Status", "planned"]);
  rows.push(["Runs in", `${kind} ${guest.vmid ?? ""} \`${guest.id}\``.replace(/\s+/g, " ")]);
  if (has(guest.ip)) {
    rows.push(["IP", `\`${guest.ip}\``]);
    if (has(guest.hostname)) rows.push(["Hostname", `\`${guest.hostname}\``]);
    const net = ctx.network(guest.ip);
    if (net) rows.push(["Network", `${net.name}${has(net.cidr) ? ` · \`${net.cidr}\`` : ""}`]);
    const dns = ctx.dnsFor(guest.ip);
    if (dns.length) rows.push(["DNS", `DNS server for ${dns.join(", ")}`]);
  }
  const hostBits = [host.model, host.os, has(host.ip) ? `\`${host.ip}\`` : null].filter(has);
  rows.push(["Host", `${host.name}${hostBits.length ? ` (${hostBits.join(", ")})` : ""}`]);
  const linked = ctx.links.some((l) => l.from === guest.id || l.to === guest.id);
  const path = pathTo(ctx, linked ? guest.id : host.id, names);
  if (path) rows.push(["Path", [...path, ...(linked ? [] : [`${guest.name} (${kind})`])].join(" → ")]);
  const ports = (service.ports ?? []).filter((p) => Number.isInteger(p.port));
  if (ports.length) rows.push(["Ports", ports.map((p) => `\`${p.port}\`${has(p.label) ? ` ${p.label}` : ""}${has(p.protocol) ? ` (${p.protocol})` : ""}`).join(" · ")]);
  const neighbours = (guest.services ?? []).filter((s) => s !== service && has(s.name)).map((s) => s.name);
  if (neighbours.length) rows.push(["Shares the guest with", neighbours.join(", ")]);
  return [START, "", "| | |", "|---|---|", ...rows.map(([k, v]) => `| **${k}** | ${v} |`), "", END].join("\n");
}

const stub = (name: string) => `# ${name}

${"{BLOCK}"}

## What it does

TODO: one sentence on what the software does.

## Crib

TODO: install method, config file, data, service unit, ports, logs, update/restart.
`;

export function writeServiceReadmes(ctx: ReadmeContext): void {
  const names = new Map<string, string>();
  for (const d of ctx.devices) {
    names.set(d.id, d.name);
    for (const g of d.guests ?? []) names.set(g.id, g.name);
  }

  const used = new Set<string>();
  let created = 0, updated = 0, unchanged = 0;
  for (const host of ctx.devices) {
    for (const guest of host.guests ?? []) {
      for (const service of guest.services ?? []) {
        if (!has(service.name)) continue;
        let dir = slug(service.name);
        if (used.has(dir)) {
          ctx.warn(`two services are named "${service.name}"; the one in "${guest.id}" goes to services/${dir}-${guest.id}/`);
          dir = `${dir}-${slug(guest.id)}`;
        }
        used.add(dir);

        const file = join(ctx.servicesDir, dir, "readme.md");
        const shown = relative(join(ctx.servicesDir, ".."), file);
        const block = generatedBlock(ctx, host, guest, service, names);
        let next: string;
        if (!existsSync(file)) {
          next = stub(service.name).replace("{BLOCK}", block);
          ctx.warn(`${shown}: new; its description and crib still need writing`);
          created++;
        } else {
          const current = readFileSync(file, "utf8");
          const a = current.indexOf(START.slice(0, 22)), b = current.indexOf(END);
          if (a === -1 || b === -1 || b < a) {
            ctx.warn(`${shown}: generated-block markers are missing, left untouched`);
            continue;
          }
          next = current.slice(0, a) + block + current.slice(b + END.length);
          if (next === current) { unchanged++; continue; }
          updated++;
        }
        mkdirSync(join(ctx.servicesDir, dir), { recursive: true });
        writeFileSync(file, next);
      }
    }
  }

  if (existsSync(ctx.servicesDir)) {
    for (const entry of readdirSync(ctx.servicesDir, { withFileTypes: true }).sort((p, q) => p.name.localeCompare(q.name))) {
      if (entry.isDirectory() && !used.has(entry.name)) {
        ctx.warn(`services/${entry.name}/ has no matching service in homelab.json (kept; delete it if the service is gone)`);
      }
    }
  }
  console.log(`✓ service readmes: ${created} new, ${updated} updated, ${unchanged} unchanged`);
}
