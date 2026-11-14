# Homelab diagram and service summaries

`homelab.json` (in the repo root) describes my homelab and is the only
source of truth. From it, `claude/generate.ts` produces the outputs, which
also live in the root:

- `homelab.svg`: the network diagram
- `services/<service>/readme.md`: one at-a-glance summary per service

Everything else needed to make the outputs lives in `claude/`; keep it
there and keep the root to `homelab.json`, the outputs and my `readme.md`. Don't hand-draw the diagram. The generator
already exists: extend it, don't rewrite it.

Run: `./claude/generate.sh` (or `npm run build` inside `claude/`).
Type-check: `npm run check` inside `claude/`.
After changes, render a preview and look at it, e.g.
`magick -density 144 homelab.svg <scratchpad>/preview.png`.

## When I say "generate updated diagram and service summaries"

1. Read `homelab.json` and tell me about anything that doesn't make
   sense (invalid JSON, missing names, icon names with no file) before
   changing anything.
2. Resolve icons (see Style) and run `./claude/generate.sh`.
3. For every readme the script reports as **new**, replace the TODO
   "What it does" and "Crib" sections (see Service readmes).
4. Report the script's warnings, which icons you added, and which readmes
   you wrote. Never delete a `services/` folder the script flags as
   orphaned; ask me.

## Service readmes

- One per service in `guests[].services[]`. The folder is the service name
  lowercased with hyphens (`Pi-hole` → `services/pi-hole/`).
- Everything between `<!-- generated:start … -->` and `<!-- generated:end -->`
  is rewritten every run from the JSON: LXC, IP, network, host, path from
  the internet. Change the JSON, not that block.
- Everything else is hand-written and kept between runs:
  - **What it does:** one sentence.
  - **Crib:** web UI (as `<IP>`, not a hard-coded address), install method,
    config file, data location, systemd unit, ports, logs, update/restart.
- No hostnames: I don't use them, IPs only.
- "Location" means the host the service runs on, not a physical place.
- Look up the facts online. Wavelog was installed with a Proxmox community
  helper script, so follow that script's layout. Everything else was
  installed by hand, so give the standard default paths and mark anything
  uncertain *(verify)*.

## Style

- Copy the look of `claude/reference_image.jpg` (actually a PNG): dark
  background, rounded card panels, thin coloured outlines, small uppercase
  section labels.
- Font: Fira Sans for names and labels, Fira Code for IPs and hostnames.
  All text is converted to outlines (`claude/fonts.ts`, TTFs in
  `claude/fonts/`), so the SVG looks the same on any machine; never emit
  `<text>` or rely on installed fonts. (Both families are also installed
  for my user in `~/.local/share/fonts/`.)
- Icons: for each `icon` value, use the matching file in `claude/icons/`.
  If `icon` is missing, null, or has no file there, get the SVG from
  https://dashboardicons.com/ (search by the service or device name; files
  are at `https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/svg/<name>.svg`,
  index at `.../main/tree.json` on raw.githubusercontent.com), save it into
  `claude/icons/` with the same name as the `icon` value, and set that value
  in `homelab.json` if it was empty. Tell me which icons you added.
  - Check downloaded SVGs for `<script>` or external `href`s before use.
  - Prefer the `-light` variant when the normal one is dark and would
    vanish on the dark background (e.g. `proxmox-light`).
  - Prefer a square mark over a wide wordmark.
  - If dashboardicons has nothing suitable, draw a simple SVG yourself in
    the diagram's palette (like `icons/internet.svg`, `icons/switch.svg`).
    Exception: guests without an icon fall back to `icons/lxc.svg`;
    that's fine, don't draw one for them (e.g. OpenHamClock).
  - Run `node fit-icons.ts icons/<name>.svg` (inside `claude/`) on every new
    or changed icon so its viewBox hugs the artwork (no white space). The
    generator then sizes icons by visible area so they all look
    proportional; keep it so.
- Layout, top to bottom: internet, router, switch, then one card per
  server with its LXCs in a grid inside it. A server's `hardware` list
  (`kind`, `name`, `detail`) is drawn as small neutral tiles in the card's
  header, right of the model/IP; the LXC panel stays full width and is the
  visual focus.
- Draw items with `"status": "planned"` dashed and dimmed.
- Links must meet the card outlines at both ends.
- Devices can list `ports` (drawn as a port row like the reference); a link's
  `fromPort`/`toPort` plugs it into a port, `cable`/`speed` label it. Fritz!Box
  7530 AX: 4 × 1G LAN, LAN 1 runs in WAN mode for the fibre uplink.

## Rules

- Validate the JSON against `claude/homelab.schema.json` before rendering,
  and report links or IPs that don't match a device or the network.
- Treat every field except `id` and `name` as optional, and handle missing
  fields without breaking. LXC guests need a `name` too.
- Rerunning the generator must give the same diagram and readmes every time
  (check by running it twice and comparing hashes).
