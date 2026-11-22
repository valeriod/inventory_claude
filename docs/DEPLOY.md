# Deploying Inventory

Inventory runs as **one Docker container**. The API serves the web app, database migrations run on
start-up, and nightly backups are built in. Pick the setup that matches where you want to use it:

| Setup | Good for | HTTPS from | Password |
|---|---|---|---|
| [A. Home server + Tailscale](#a-home-server--tailscale-recommended) (recommended) | NAS, Raspberry Pi, a spare PC; use from anywhere on your tailnet | Tailscale | optional |
| [B. Home network with Caddy](#b-home-network-with-caddy-no-tailscale) | Only at home, no Tailscale | Caddy's own certificate (install once on each phone) | recommended |
| [C. Public server (VPS)](#c-public-server-vps) | Reachable from the internet | Let's Encrypt via Caddy | **required** |

Any of them can use [Postgres instead of SQLite](#postgres-instead-of-sqlite). SQLite is the
default and right for a single user.

> **Why HTTPS everywhere?** Phones only allow camera access (barcode scanning), installation and
> offline mode on HTTPS pages.

> **Choose the address before printing labels.** QR labels contain the app's address
> (`PUBLIC_URL`). Labels printed with one address keep pointing there.

## Before you start

- A machine with Docker Engine and Docker Compose v2.24 or newer (`docker compose version`).
- The code: `git clone https://github.com/valeriod/inventory_claude.git inventory && cd inventory`
- Every command below runs from that folder. Settings go in a `.env` file next to it. Start with
  an empty one (`touch .env`) and add the lines each setup lists. (`.env.example` is for local
  development; don't copy it for a deployment.)

The image is built on your machine the first time (`--build`, a few minutes on a Raspberry Pi).
Data lives in `./data`: the SQLite database and `./data/backups`.

To set a password, add both lines to `.env`:

```sh
APP_PASSWORD=choose-a-long-password
SESSION_SECRET=$(openssl rand -hex 32)   # paste the generated value, not this command
```

Changing `APP_PASSWORD` later logs out every device.

## A. Home server + Tailscale (recommended)

[Tailscale](https://tailscale.com) gives the server a private name with a real HTTPS certificate,
reachable from your phone wherever you are, and keeps the app off the public internet.

1. Install Tailscale on the server and your phone, and sign in on both
   ([download](https://tailscale.com/download)). In the Tailscale admin console, enable
   **MagicDNS** and **HTTPS certificates** (DNS page).
2. Find the server's name: `tailscale status` shows it, e.g. `nas.tail1234.ts.net`.
3. Add to `.env`:

   ```sh
   PUBLIC_URL=https://nas.tail1234.ts.net
   TRUST_PROXY=true
   ```

4. Start the app (it listens on `127.0.0.1:3000` on the server only):

   ```sh
   docker compose --env-file .env -f docker/compose.yml up -d --build
   ```

5. Publish it on your tailnet with HTTPS:

   ```sh
   sudo tailscale serve --bg 3000
   ```

6. Open `https://nas.tail1234.ts.net` on your phone. Use "Install app" (Android/desktop Chrome) or
   Share → Add to Home Screen (iPhone).

A password is optional here: only devices on your tailnet can reach the app.

## B. Home network with Caddy (no Tailscale)

[Caddy](https://caddyserver.com) serves HTTPS with its own certificate authority. Each phone has
to trust that authority once.

1. Give the server a fixed LAN address (router setting), e.g. `192.168.1.20`.
2. Add to `.env`:

   ```sh
   CADDYFILE=Caddyfile.lan
   SITE_ADDRESS=192.168.1.20
   APP_PASSWORD=…
   SESSION_SECRET=…
   ```

   (A password is recommended because everyone on the network can reach the app. If you really
   want none, set `ALLOW_NO_AUTH=true`.)

3. Start the app with Caddy in front (ports 80 and 443):

   ```sh
   docker compose --env-file .env -f docker/compose.yml -f docker/compose.caddy.yml up -d --build
   ```

4. Copy Caddy's root certificate out of the container:

   ```sh
   docker compose --env-file .env -f docker/compose.yml -f docker/compose.caddy.yml \
     cp caddy:/data/caddy/pki/authorities/local/root.crt ./caddy-root.crt
   ```

5. Install it on each phone:
   - **iPhone/iPad:** send yourself the file (AirDrop or email) and open it → Settings → General →
     VPN & Device Management → install the profile. Then Settings → General → About →
     Certificate Trust Settings → turn on full trust for "Caddy Local Authority".
   - **Android:** copy the file to the phone → Settings → Security → Encryption & credentials →
     Install a certificate → CA certificate.
   - **Computers:** add it to the system's trusted root certificates (macOS: Keychain Access →
     System → "Always Trust").

6. Open `https://192.168.1.20`.

## C. Public server (VPS)

1. Point a DNS name at the server, e.g. `inventory.example.com`.
2. Allow only SSH, HTTP and HTTPS in the firewall. With `ufw`:

   ```sh
   sudo ufw allow OpenSSH && sudo ufw allow 80,443/tcp && sudo ufw allow 443/udp && sudo ufw enable
   ```

3. Add to `.env` (a password is **required**; the app refuses to start without one):

   ```sh
   CADDYFILE=Caddyfile.public
   SITE_ADDRESS=inventory.example.com
   ACME_EMAIL=you@example.com
   APP_PASSWORD=…
   SESSION_SECRET=…
   ```

4. Start:

   ```sh
   docker compose --env-file .env -f docker/compose.yml -f docker/compose.caddy.yml up -d --build
   ```

   Caddy gets the certificate automatically within a minute. `PUBLIC_URL` defaults to
   `https://SITE_ADDRESS`. Failed logins are limited to 10 per 15 minutes per address.

## Postgres instead of SQLite

Add `docker/compose.postgres.yml` to any of the commands above and set a database password:

```sh
echo "POSTGRES_PASSWORD=$(openssl rand -hex 16)" >> .env
docker compose --env-file .env -f docker/compose.yml -f docker/compose.postgres.yml up -d --build
# with Caddy: … -f docker/compose.yml -f docker/compose.postgres.yml -f docker/compose.caddy.yml …
```

Postgres data is kept in the `pgdata` Docker volume.

## Settings reference

| Variable | Default (Docker) | Meaning |
|---|---|---|
| `DATABASE_URL` | `sqlite:///data/inventory.db` | `sqlite:///path` or `postgres://user:pass@host:5432/db` |
| `APP_PASSWORD` / `SESSION_SECRET` | none | Password login; the secret must be 32+ characters |
| `ALLOW_NO_AUTH` | `true` in `compose.yml`, `false` with Caddy | Allow no password on a non-local address |
| `PUBLIC_URL` | request address (Caddy: `https://SITE_ADDRESS`) | Address encoded in QR labels |
| `TRUST_PROXY` | `true` with Caddy | Read client addresses from `X-Forwarded-For` (set it behind `tailscale serve` too) |
| `BACKUP_DIR` | `/data/backups` (= `./data/backups`) | Nightly backups; empty turns them off |
| `BACKUP_KEEP` | `14` | Number of backups kept |
| `BACKUP_HOUR` | `3` | Hour of the nightly backup (container time, UTC unless `TZ` is set) |
| `PORT` | `3000` | Port published on `127.0.0.1` by `compose.yml` |
| `CADDYFILE`, `SITE_ADDRESS`, `ACME_EMAIL` | | Caddy setups (B, C) |
| `POSTGRES_PASSWORD` | | Postgres setup |

## Operations

The commands below use the plain SQLite setup. Add the same `-f` files you started with (Caddy,
Postgres). To shorten them, define an alias:

```sh
alias inv='docker compose --env-file .env -f docker/compose.yml'   # add -f … as needed
```

### Backups

- **Automatic:** every night at `BACKUP_HOUR` the app writes `./data/backups/inventory-YYYYMMDD-HHMMSS.db`
  (SQLite, a complete database file) or `….json.gz` (Postgres, a full export), keeping the last
  `BACKUP_KEEP`. Settings in the app shows the latest backup.
- **Now:** `inv exec -u node app node dist/cli.js backup`
- **Download:** Settings → "Export everything (JSON)" in the app.
- **Off the machine:** copy `./data/backups` elsewhere regularly (another disk, a NAS, cloud
  storage with `rclone`, …). A backup on the same disk does not survive the disk.

### Restoring

**SQLite from a `.db` backup:**

```sh
inv stop app
cp data/inventory.db data/inventory.db.broken          # keep the old one, just in case
cp data/backups/inventory-20261121-030000.db data/inventory.db
rm -f data/inventory.db-wal data/inventory.db-shm
inv start app
```

**From a JSON export (`.json` or `.json.gz`)** into an empty database. This works for both
databases and for moving between machines:

```sh
inv stop app
mv data/inventory.db data/inventory.db.old              # SQLite: start from an empty file
cp ~/Downloads/inventory-2026-11-21.json data/restore.json
inv run --rm -u node app node dist/cli.js transfer --from /data/restore.json --to sqlite:///data/inventory.db
inv start app
```

For Postgres, restore into a fresh database: `inv down`, `docker volume rm inventory_pgdata`,
`inv up -d db`, then the same `transfer` with `--to "$DATABASE_URL"` (run it with `sh -c`
inside the container).

### Moving from SQLite to Postgres

```sh
inv exec -u node app node dist/cli.js transfer --from sqlite:///data/inventory.db --to /data/move.json.gz
inv down
docker compose --env-file .env -f docker/compose.yml -f docker/compose.postgres.yml up -d --build
docker compose --env-file .env -f docker/compose.yml -f docker/compose.postgres.yml \
  exec -u node app sh -c 'node dist/cli.js transfer --from /data/move.json.gz --to "$DATABASE_URL"'
```

The target must be empty. The app starts with an empty Postgres database, so restore right after
the first start, before using it.

### Upgrading

```sh
git pull
inv up -d --build
```

Migrations run automatically on start. Take a backup first (see above). Open apps show "A new
version is ready" and reload when you tap it.

### Logs and health

```sh
inv logs -f app
curl -fsS localhost:3000/api/health       # {"status":"ok",…}
```

## Troubleshooting

| Problem | Fix |
|---|---|
| The camera does not start on the phone | The page must be HTTPS (setups A–C). On Caddy LAN, install the root certificate. |
| "Refusing to listen on 0.0.0.0 without APP_PASSWORD" | Set `APP_PASSWORD` and `SESSION_SECRET`, or `ALLOW_NO_AUTH=true` on a trusted network. |
| QR labels open the wrong address | Set `PUBLIC_URL` to the address you use on the phone, restart, and reprint. |
| Forgot the password | Change `APP_PASSWORD` in `.env` and `inv up -d`. All devices log in again. |
| "Too many attempts" on login | Wait 15 minutes. Behind a proxy, set `TRUST_PROXY=true` so attempts are counted per device. |
| Changes made offline did not arrive | Open Offline & sync in the app. Failed changes are listed with the reason; retry or discard. |
| Permission errors on `./data` | The container fixes ownership on start. If you copied files in as another user, restart the app. |
