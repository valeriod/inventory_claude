# Inventory

Inventory system for electronic components, wire, tools and other items. It uses user-defined
categories with custom fields, a Svelte PWA with barcode/QR scanning, project reservations and
reports. It runs on SQLite or Postgres.

See [`2026-11-17-inventory-app-plan.md`](2026-11-17-inventory-app-plan.md) for the full design and milestones.

**Status:** M0–M5 are done: setup, data layer, categories with custom fields and units, the items and stock API, the web app (login, search, items, categories, locations), and barcode/QR scanning with printable QR labels. Next is M6 (projects and reservations).

## Requirements

- Node.js 24+ (`.nvmrc`)
- pnpm 12 (`npm install -g pnpm@12`)
- Optional: Docker (for the container build and a local Postgres)

## Getting started

```sh
pnpm install
cp .env.example .env      # optional, defaults work out of the box
pnpm dev                  # API on :3000, PWA on http://localhost:5173 (proxies /api)
```

By default the API uses a SQLite file at `./data/inventory.db` (relative to `apps/api`). It
creates the file and runs migrations on startup.

### Testing on a phone (HTTPS)

Phone cameras only work in a secure context, so barcode scanning needs HTTPS:

```sh
pnpm dev:https
```

This serves the PWA over HTTPS on your LAN IP using a locally trusted certificate
([`vite-plugin-mkcert`](https://github.com/liuweiGL/vite-plugin-mkcert)). The first run installs a
local certificate authority, which may ask for your password. To make the phone trust the
certificate, install the mkcert root CA on it: run `mkcert -CAROOT` to find the file (the plugin
keeps its copy under `~/.vite-plugin-mkcert`).

## Scripts

| Command | What it does |
|---|---|
| `pnpm dev` / `pnpm dev:https` | API (tsx watch) + PWA (Vite) dev servers |
| `pnpm build` | Static PWA → `apps/web/build`, bundled API → `apps/api/dist/server.js` |
| `pnpm start` | Run the production build (API serves the PWA) |
| `pnpm lint` / `pnpm format` | ESLint + Prettier |
| `pnpm typecheck` | `tsc` / `svelte-check` in every package |
| `pnpm test` | Vitest against in-memory SQLite |
| `pnpm test:pg` | Same suite against Postgres (`docker compose -f docker/compose.dev.yml up -d` first) |
| `pnpm test:e2e` | Playwright end-to-end tests against the production build (`pnpm build` first; installs: `pnpm --filter web exec playwright install chromium`) |
| `pnpm db:migrate` | Apply migrations to `DATABASE_URL` |
| `pnpm db:seed` | Add demo categories, locations, items and a project (empty database only) |

## Configuration

Set environment variables in `.env` (see [`.env.example`](.env.example)):

| Variable | Default | Notes |
|---|---|---|
| `DATABASE_URL` | `sqlite://./data/inventory.db` | `sqlite:///abs/path.db`, `sqlite::memory:` or `postgres://…` |
| `HOST` / `PORT` | `127.0.0.1` / `3000` | Binding to a non-local address requires `APP_PASSWORD` or `ALLOW_NO_AUTH=true` |
| `APP_PASSWORD` / `SESSION_SECRET` | none | Single-user password; when set, the app shows a login screen and the API requires the session cookie |
| `PUBLIC_URL` | none | Base URL encoded into printed QR labels |
| `STATIC_DIR` | none (`pnpm start` uses `apps/web/build`) | Directory of the built PWA served by the API |

## Docker

```sh
docker compose -f docker/compose.yml up -d --build                       # SQLite in ./data
POSTGRES_PASSWORD=change-me docker compose -f docker/compose.yml \
  -f docker/compose.postgres.yml up -d --build                           # with Postgres
```

The app is published on `127.0.0.1:3000`. Full deploy instructions (Tailscale, LAN, VPS, backups)
come with M9 in `docs/DEPLOY.md`.

## Repository layout

```
apps/
  api/        Hono API server (Node). Bundled with esbuild for production
  web/        SvelteKit 3 PWA (static SPA, adapter-static)
packages/
  db/         Kysely connection (SQLite/Postgres), dialect adapter, migrations, repositories, seed data
  shared/     Zod schemas and types shared by API and PWA
docker/       Dockerfile and compose files
```
