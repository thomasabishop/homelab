# wavelog


|Property| Details|
|--|--|
|Server| `pve1.home.arpa`|
|IP| `192.168.178.70`|
|Hostname| `wavelog.home.arpa` (LXC)|
|PORT| `:8086`|


- Installed with the **Proxmox community helper script** (`wavelog`),
- **Update:** run `update` in the LXC console. The helper script installs this command; it backs up the config and swaps in the new release.
- **Sync jobs (LoTW, Club Log, QRZ…):** the script sets up no cron. Wavelog drives these from Admin → Cron Manager, which needs a single system cron entry calling Wavelog's cron URL *(verify it's set up: `crontab -l`)*.
