# Homelab diagram and service summaries

`homelab.json` (in the repo root) describes my homelab and is the only
source of truth. From it, `claude/generate.ts` produces the outputs, which
also live in the root:

- `homelab.svg`: the network diagram
- `services/<service>/readme.md`: one at-a-glance summary per service
- `history/homelab_<timestamp>.svg`: every earlier version of the diagram,
  named after its `updated` stamp (`-2`, `-3` … for clashes). Never edit or
  delete these.

When the diagram changes (anything except the stamp), the generator copies
the old `homelab.svg` into `history/` and sets `meta.updated` in
`homelab.json` to the current local time (`YYYY-MM-DD HH:MM`). Don't set
`updated` by hand.

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
3. Report the script's warnings, which icons you added, and which readmes
   the script reports as **new**. Never delete a `services/` folder the
   script flags as orphaned; ask me.

## Service readmes

- One per service in `guests[].services[]`. The folder is the service name
  lowercased with hyphens (`Pi-hole` → `services/pi-hole/`).
- Everything between `<!-- generated:start … -->` and `<!-- generated:end -->`
  is rewritten every run from the JSON: LXC, IP, hostname, network, DNS role,
  host, path from the internet, ports (with labels). Change the JSON, not
  that block.
- Everything else (the "What it does" and "Crib" sections) is written by
  me, by hand, and kept between runs. Don't write, fill in, research or
  edit these sections, even when they still say TODO; leave the script's
  placeholder as it is.

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
- `claude/refrence-two.png` is a second reference: the cloud (puffy, filled,
  slate outline, no icon), links coloured by network, tan accent bars on
  hardware tiles and ports tinted with their cable's colour come from it.
- A server's `osIcon` (e.g. `debian`) is drawn beside its main icon. All my
  Proxmox nodes and LXCs are Debian; don't add `osIcon` to LXCs.
- Links are coloured by the network their ends' IPs sit on (LAN blue); WAN
  links are red. A plugged-in port is filled with its cable's colour.
- DNS: a network's `dns` (an IP, or a list) is the DNS server its DHCP hands
  out (mine: Pi-hole, `192.168.178.73`). It shows as `DNS <ip>` in the
  Networks panel (keep it there) and as a red `DNS` pill beside the name of
  the guest with that IP. Don't hardcode which guest is DNS; it follows the IP.
- Hostnames: I use them alongside IPs (`<name>.home.arpa`, in each device's
  and guest's `hostname`). Show both. On guest tiles the hostname gets its
  own line under the IP.
- Guest tiles: 40px icon, name (+ DNS pill), IP, hostname; the service's
  `ports` top right. Each port is `{ "port", "label", "protocol"? }`, most
  important (web UI) first. One port: just `:8086`. Several: one per line
  (name row, then IP row), each with its label in small faint text before
  the number (`web UI :80` / `DNS :53`); extras beyond two show as `+n`.
- The legend shows link, LXC, DNS and port symbols only; no planned-item
  rows and no IP/hostname samples (they are self-evident).
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
  (check by running it twice and comparing hashes): an unchanged diagram
  must not be restamped or archived.
- Test history/stamping changes on copies in the scratchpad
  (`node generate.ts <copy.json> <copy.svg>`), not on the real files, so
  `history/` only gets real iterations.
