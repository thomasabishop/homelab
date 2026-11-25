# open-ham-clock


|Property| Details|
|--|--|
|Server| `pve1.home.arpa`|
|IP| `192.168.178.68`|
|Hostname| `openhamclock.home.arpa` (LXC)|
|frontend PORT| `:3001`|
|backend PORT| `:3000`|




- **Installed with:** `git clone https://github.com/accius/openhamclock.git`, then `npm ci`, then `npm start`.


- **Config:** `.env` in the app folder, created from `.env.example` on first start. The key settings:
  - `CALLSIGN`, `LOCATOR` (or `LATITUDE`/`LONGITUDE`)
  - `PORT`
  - `HOST`: must be `0.0.0.0` for other devices on the LAN to reach it
  - `API_WRITE_KEY`

- **Update:** `./scripts/update.sh` in the app folder, then restart the service. If an update breaks it, run `./scripts/update.sh --repair`; both keep `.env`.

  - There is a bug with run.sh 