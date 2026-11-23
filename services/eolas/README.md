# eolas

> Frontend application, API and database that comprise my technical knowledge management system 

|Property| Details|
|--|--|
|Server| `pve1.home.arpa`|
|IP| `192.168.178.66`|
|Hostname| `eolas.home.arpa` (LXC)|
|eolas-api PORT| `:3001`|
|eolas-app PORT| `:3000`|

## Directory structure

```
root/
    api/
        eolas.api (NodeJS exectuable)
    db/
        eolas.db (SQLite database)
        eolas-db (Python executable)
    app/
    systemd/
        eolas-api.service
        eolas-app.service
    entries/
        ... (raw Markdown files processed by DB)
    regenerate.sh
```

The `regenerate.sh` script is run remotely each time the entries are updated from a client machine. It suspends the systemd services and regenerates the SQLite database file, then restarts the systemd services.

## Service repositories

- [eolas (raw entries)](https://github.com/thomasabishop/eolas)

- [eolas-api](https://github.com/thomasabishop/eolas-api)

- [eolas-db](https://github.com/thomasabishop/eolas-db)

- [eolas-app](https://github.com/thomasabishop/eolas-app)

## Deployment scripts

See Utilities repo

|Script| Function|
|--|--|
|regenerate.sh| Rebuilds database every time `entries/` dir is rsynced |
|server-sync.sh| Sync local entry files with server  |
|update-db.sh| Copy over new version of `eolas-db` against latest tag |
|update-api.sh| Copy over new version of `eolas-api` against latest tag |
|