# pihole



|Property| Details|
|--|--|
|Server| `pve1.home.arpa`|
|IP| `192.168.178.68`|
|Hostname| `pihole.home.arpa` (LXC)|
|frontend PORT| `:80`|
|DNS PORT (TCP/UDP)| `:53`|




- **Installed with:** the official installer, `curl -sSL https://install.pi-hole.net | bash` *(verify)*
- **Config:** `/etc/pihole/pihole.toml` holds every setting (upstream DNS, DHCP, web port,...)
- **Data:** `/etc/pihole/gravity.db` (blocklists, allow/deny lists, groups) and `/etc/pihole/pihole-FTL.db` (query history)
- **Service:** `pihole-FTL` runs both DNS and the web UI. Restart with `systemctl restart pihole-FTL`.

- **Logs:** `/var/log/pihole/pihole.log` (queries) and `/var/log/pihole/FTL.log`. Use `pihole -t` to watch live.
- **Handy commands:** `pihole status`, `pihole -g` (reload blocklists), `pihole setpassword`, `pihole -up` (update Pi-hole), `apt update && apt upgrade` (update the LXC's OS)


> It is running as my DNS server but not DHCP server. Set as DNS address in Fritzbox -> Network Settings -> IPv4 Settings -> Local DNS Server

