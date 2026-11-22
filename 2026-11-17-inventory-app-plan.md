# Inventory App — Implementation Plan

**Date:** 2026-11-17 (revised 2026-11-21 with decisions, see §10)
**Status:** Approved for implementation

## 1. Goals

Build an inventory system for heterogeneous items (electronic components, electrical wire, tools, consumables, …) where:

- **Categories** are user-defined, and each category declares its own **custom fields** (e.g. Resistor → resistance, tolerance, package; Wire → gauge, color, insulation, length unit).
- Each **item record** has a `sku` primary key, a `qty_on_hand`, and a JSON object holding the category-specific field values.
- A **Svelte PWA** lets users search items, generate inventory reports, reserve parts for projects, and scan barcodes / QR codes with a phone camera.
- The backend runs on **SQLite** (simplest, default) or **Postgres** (if you already run one), selected by configuration.

### Non-goals (v1)

- Purchasing / supplier ordering workflow
- Multi-tenant SaaS (one inventory per deployment)
- Multiple users / roles (single user; see §7)
- Stock for one SKU split across several locations
- Full offline write sync with conflict resolution (v1 is offline-read, see §7.4)

## 2. Architecture Overview

```
┌──────────────────────────────┐        HTTPS/JSON        ┌──────────────────────────────┐
│  PWA (SvelteKit, static SPA) │ ───────────────────────▶ │  API server (Node + Hono)    │
│  - Search / item views       │                          │  - REST endpoints            │
│  - Reports                   │ ◀─────────────────────── │  - Validation (Zod)          │
│  - Project reservations      │                          │  - Auth                      │
│  - Camera barcode/QR scan    │                          │  - Kysely query builder      │
│  - Service worker / cache    │                          └──────────────┬───────────────┘
└──────────────────────────────┘                                         │
                                                              ┌──────────┴──────────┐
                                                              │ SQLite  │ Postgres  │
                                                              └─────────────────────┘
```

### Tech stack

| Layer | Choice | Rationale |
|---|---|---|
| Language | TypeScript end-to-end | Shared types/validation between API and PWA |
| Frontend | SvelteKit 3 + Svelte 5 (runes), `adapter-static` (SPA mode) | Requested framework; static output is easy to serve and cache as a PWA |
| PWA | `@vite-pwa/sveltekit` (Workbox) | Manifest, service worker, install prompt, update flow |
| UI | Tailwind CSS + a light component lib (e.g. Skeleton or bits-ui) | Fast, mobile-friendly |
| Scanning | Native `BarcodeDetector` API, fallback to `zxing-wasm` | Native is fast on Android/Chrome; iOS Safari needs the WASM fallback |
| API | Hono on Node 24 LTS | Small, typed, fast; easy to test |
| DB access | **Kysely** with `better-sqlite3` and `pg` dialects | One query builder, two dialects; thin enough to drop to raw SQL for JSON ops |
| Migrations | Kysely migrations with per-dialect branches where needed | Single migration history for both DBs |
| Validation | Zod (shared package) | Validates both fixed columns and dynamic custom fields |
| Reports | Server-side CSV + PDF (`pdfkit`) or client-side print CSS | CSV first, PDF later |
| Testing | Vitest (unit/API), Playwright (E2E), test matrix on both DBs | Dual-DB support must be proven continuously |

### Repository layout (pnpm monorepo)

```
inventory/
├─ apps/
│  ├─ web/            # SvelteKit PWA
│  └─ api/            # Hono API server
├─ packages/
│  ├─ shared/         # Zod schemas, types, field-definition logic
│  └─ db/             # Kysely setup, dialect adapters, migrations, repositories
├─ docker/            # Dockerfile, docker-compose (api + postgres)
└─ docs/
```

> Alternative considered: a single SvelteKit app with server routes (`adapter-node`) instead of a separate API. Simpler to deploy, but couples the PWA build to the server and makes the static/offline story harder. A separate API is recommended; it can still be served from the same origin behind a reverse proxy.

## 3. Data Model

### 3.1 Core tables

**`categories`**

| Column | Type | Notes |
|---|---|---|
| `id` | integer PK | |
| `name` | text, unique | e.g. "Resistors" |
| `parent_id` | integer FK → categories, nullable | Optional hierarchy (Electronics → Passives → Resistors) |
| `sku_prefix` | text, nullable | Used for SKU generation, e.g. `RES-` |
| `unit_kind` | text | `count` \| `length` \| `mass` \| `volume` — determines the integer base unit (§3.4) |
| `display_unit` | text | Unit shown in the UI, e.g. `pcs`, `m`, `ft`, `g`, `kg` |
| `field_defs` | JSON | Array of field definitions (§3.2) |
| `created_at`, `updated_at` | timestamp | |

**`items`**

| Column | Type | Notes |
|---|---|---|
| `sku` | text **PK** | User-supplied or generated; **immutable** after creation (§10) |
| `category_id` | integer FK → categories | |
| `name` | text | Human-readable title |
| `description` | text, nullable | |
| `qty_on_hand` | integer (BIGINT on PG) | In base units of the category's `unit_kind` (§3.4); `CHECK (qty_on_hand >= 0)` |
| `qty_min` | integer, nullable | Reorder threshold for low-stock report, base units |
| `location_id` | integer FK → locations, nullable | Exactly one location per SKU (§10) |
| `barcode` | text, nullable, unique | Manufacturer barcode (EAN/UPC) if different from SKU |
| `attributes` | JSON (`jsonb` on PG, `text` w/ JSON1 on SQLite) | Custom field values keyed by field `key` |
| `search_text` | text | Denormalized: name + description + SKU + attribute values, for search |
| `created_at`, `updated_at` | timestamp | |
| `version` | integer | Optimistic concurrency |

**`locations`** — `id`, `name`, `parent_id` (Room → Shelf → Bin), `code` (printed on bin labels as QR).

**`projects`** — `id`, `name`, `description`, `status` (`planning` | `active` | `completed` | `cancelled`), timestamps.

**`reservations`** (parts set aside for projects)

| Column | Type | Notes |
|---|---|---|
| `id` | integer PK | |
| `project_id` | FK → projects | |
| `sku` | FK → items | |
| `qty_reserved` | integer | Base units |
| `status` | `reserved` \| `consumed` \| `released` | |
| `note` | text | |
| timestamps | | |

`qty_available = qty_on_hand − SUM(qty_reserved WHERE status = 'reserved')` — computed in a view / query, not stored.

**`stock_movements`** (append-only ledger / audit trail)

| Column | Type | Notes |
|---|---|---|
| `id` | integer PK | |
| `sku` | FK → items | |
| `delta` | integer | Base units; +received / −used / ±adjust |
| `reason` | `receive` \| `consume` \| `adjust` \| `count` \| `reserve_consume` | |
| `project_id` | FK, nullable | |
| `note` | text | |
| `created_at` | timestamp | |

Every quantity change goes through a movement row in the same transaction as the `qty_on_hand` update. This gives history, undo, and usage reports for free.

There is no `users` table: the app is single-user (§7).

### 3.2 Category field definitions

`categories.field_defs` is a JSON array; each entry:

```json
{
  "key": "resistance",
  "label": "Resistance",
  "type": "quantity",
  "unit": "Ω",
  "required": true,
  "searchable": true,
  "filterable": true,
  "showInList": true,
  "order": 10
}
```

Supported `type` values (v1):

| Type | Stored as | Extra options |
|---|---|---|
| `text` | string | `maxLength`, `pattern` |
| `number` | number | `min`, `max`, `integer` |
| `quantity` | number (base unit) | `unit`, `allowedPrefixes` (k, M, µ…) — UI parses `4.7k` → `4700` |
| `boolean` | boolean | |
| `enum` | string | `options: string[]` |
| `multi_enum` | string[] | `options: string[]` |
| `date` | ISO string | |
| `url` | string | e.g. datasheet link |

- The shared package turns `field_defs` into a **Zod schema at runtime**, used by the API (authoritative validation on write) and by the PWA (form generation + client validation).
- **Inheritance:** a child category inherits parent fields (Passives → `package`, `mounting`; Resistors adds `resistance`, `tolerance`).
- **Schema evolution:** adding a field is free; removing a field hides it (data stays in JSON); renaming a `key` or changing `type` runs a guided migration job that rewrites `attributes` for that category's items.

**Implementation notes (M2):**

- **No shadowing.** A key may be declared only once along any root-to-leaf path. A child cannot redeclare an inherited field, and a parent cannot add a key that a descendant already declares. Sibling branches may reuse keys.
- **Guarded changes.** Before a field change is saved, existing values are revalidated in the whole subtree. This covers a changed type, options, range, pattern or `required`, a field that is added back over leftover data, and re-parenting that changes which fields are inherited. If any value would become invalid, the change is refused with `409 field_change_conflict` and the offending SKU and key pairs. Label, order, help, unit and list/search flags never trigger revalidation.
- **Rename.** `POST /api/categories/:id/fields/:key/rename` renames the key and moves the stored values across the subtree, bumping each item's version. Type conversions are not automated: change the item values first, then change the type.
- **Unknown attribute keys.** The attribute schema rejects keys that no field declares, except keys the item already has. This way, values of removed fields survive later edits. It is wired into item writes in M3.
- **`fieldDefs` replaces the whole list.** In PATCH, omitting a field removes it (data is kept). The M4 field editor must make removals explicit to the user.

### 3.3 Example records

```json
// category: Resistors (unit_kind: count)
{ "sku": "RES-0001", "name": "10kΩ 1% 0603", "qty_on_hand": 450,
  "attributes": { "resistance": 10000, "tolerance": "1%", "package": "0603", "power_w": 0.1 } }

// category: Wire (unit_kind: length, display_unit: m) — 37.5 m stored as 37500 mm
{ "sku": "WIR-0012", "name": "Hookup wire 22AWG red", "qty_on_hand": 37500,
  "attributes": { "gauge_awg": 22, "color": "red", "stranded": true, "insulation": "PVC" } }

// category: Tools
{ "sku": "TOL-0003", "name": "Wire stripper", "qty_on_hand": 1,
  "attributes": { "brand": "Knipex", "model": "12 62 180", "serial": "…" } }
```

### 3.4 Quantities

All quantities (`qty_on_hand`, `qty_min`, `qty_reserved`, `delta`) are stored as **whole numbers in a small base unit**. This is exact on both databases, so there are no floating-point or decimal-type differences between them.

| `unit_kind` | Base unit (stored) | Allowed display units (conversion factor to base) |
|---|---|---|
| `count` | 1 piece | `pcs` (1) |
| `length` | 1 mm | `mm` (1), `cm` (10), `m` (1000), `in` (25.4 → rounded), `ft` (304.8 → rounded) |
| `mass` | 1 mg | `mg` (1), `g` (1000), `kg` (1 000 000), `oz` (28 349.5 → rounded), `lb` (453 592.37 → rounded) |
| `volume` | 1 µL | `µL` (1), `mL` (1000), `L` (1 000 000) |

- The table above lives in `packages/shared/units.ts`, along with `toBase(value, unit)` and `fromBase(int, unit)`. The API and the UI both use these functions, and the API only ever receives and returns base-unit integers.
- Imperial input is converted and rounded to the nearest base unit (0.5 mm or less of error per entry, which is negligible for wire).
- The UI formats values for display (`37500` → "37.5 m") and accepts input in any allowed unit for the category.
- Columns are `INTEGER` on SQLite (64-bit) and `BIGINT` on Postgres. In JS, values stay below `Number.MAX_SAFE_INTEGER` (that is 9 billion metres of wire), so plain `number` is fine. Configure `pg` to parse int8 as number.
- A category's `unit_kind` cannot change once it has items. Its `display_unit` can change freely, because stored values are not affected.

### 3.5 Dual-database JSON strategy

| Concern | SQLite | Postgres |
|---|---|---|
| Column type | `TEXT` + `CHECK (json_valid(attributes))` | `JSONB` |
| Read a field | `json_extract(attributes, '$.gauge_awg')` | `attributes->>'gauge_awg'` |
| Containment filter | `json_extract(...) = ?` | `attributes @> '{"color":"red"}'` (GIN index) |
| Indexing | Expression index per hot field, created on demand | GIN on `attributes` + optional expression indexes |
| Full-text search | FTS5 table keyed by SKU, synced by triggers | `tsvector` generated column (`simple` config) + GIN |

All dialect differences live behind a small **`DialectAdapter`** interface in `packages/db`:

```ts
interface DialectAdapter {
  supportsRowLocks: boolean;                       // SELECT … FOR UPDATE (PG) vs serialized writers (SQLite)
  json(value: unknown): RawBuilder<unknown>;       // bind a JSON column value
  parseJson<T>(raw: unknown): T;                   // TEXT on SQLite, parsed jsonb on PG
  jsonField(column: string, key: string, cast?: 'text' | 'number' | 'boolean'): RawBuilder<unknown>;
  jsonEquals(column: string, key: string, value: string | number | boolean): RawBuilder<SqlBool>;
  jsonArrayContains(column: string, key: string, value: string): RawBuilder<SqlBool>; // multi_enum
  itemTextMatch(query: string): RawBuilder<SqlBool> | null;
  ensureFieldIndex(db, key: string, cast?: JsonCast): Promise<void>;
  constraintViolation(err: unknown): 'unique' | 'foreign_key' | 'check' | null;
}
```

Repositories never write dialect-specific SQL directly. CI runs the full test suite against both databases.

**Implementation notes (M1):**

- **Search tokens.** `items.search_text` stores normalized tokens: lower-case, diacritics stripped, split on anything that isn't a letter or digit. Queries are tokenized the same way and matched as prefixes (`res 00` finds `RES-0001`). This gives identical results on FTS5 and tsvector. Fuzzy matching with `pg_trgm` is deferred, because it needs an extension that not every Postgres host allows.
- **SQLite FTS table.** It is a standalone FTS5 table keyed by SKU, not an external-content table keyed by rowid. Items have a TEXT primary key, so `VACUUM` may renumber rowids.
- **Timestamps.** They are ISO-8601 strings on both databases: TEXT on SQLite, and `timestamptz` on PG, parsed back to ISO by the driver.
- **Attribute keys** are restricted to `^[a-z][a-z0-9_]{0,62}$`, because they are inlined in JSON paths and index names. The adapter re-checks every key.
- **`searchable: false`.** Fields marked this way are still indexed for search in M1. Honouring the flag needs resolved (inherited) field definitions, so it is done in M3.

## 4. API Design (REST, JSON)

All quantities in requests and responses are integers in base units.

Errors use a single shape: `{ "error": { "code", "message", "details"? } }`.

| Status | Codes |
|---|---|
| 400 | `bad_request`, `validation` (details list the failing fields; attribute errors use `attributes.<key>`) |
| 404 | `not_found` |
| 409 | `conflict`, `field_change_conflict`, `insufficient_stock` |
| 412 | `version_conflict` (If-Match did not match the item's current version) |
| 422 | `invalid_operation` |

```
Auth (only active when APP_PASSWORD is set, see §7)
  POST   /api/auth/login             { password } → session cookie (httpOnly)
  POST   /api/auth/logout

Categories
  GET    /api/categories             (flat list; each with own fieldDefs + resolvedFieldDefs)
  POST   /api/categories
  GET    /api/categories/:id
  PATCH  /api/categories/:id         (fieldDefs changes revalidate existing values → 409 with violations)
  DELETE /api/categories/:id         (only if no items or sub-categories)
  POST   /api/categories/:id/fields/:key/rename   { newKey }
  GET    /api/units                  (unit table per unit kind)

Items
  GET    /api/items?q=&category=&subcategories=&location=&sublocations=&lowStock=&includeArchived=
                    &attr.color=red&attr.gauge_awg[gte]=18&attr.tags[contains]=smd
                    &sort=name|sku|qty|updated&dir=asc|desc&page=&pageSize=
                    → { items, total, page, pageSize }
  POST   /api/items                  (201, ETag, Location; SKU generated when omitted)
  GET    /api/items/:sku             (ETag: "<version>")
  PATCH  /api/items/:sku             (If-Match optional → 412 on stale version; attributes are merged,
                                      null clears a value; sku and quantity are not editable)
  DELETE /api/items/:sku             (archive; ?permanent=true hard-deletes items without history)
  POST   /api/items/:sku/restore
  POST   /api/items/:sku/movements   { delta, reason: receive|consume|adjust, note?, projectId? }
  GET    /api/items/:sku/movements   (?limit&offset, newest first)
  POST   /api/items/:sku/count       { countedQty, note? } → movement for the difference (or none)
  GET    /api/items/:sku/reservations

Lookup (scanner)
  GET    /api/lookup?code=…          (QR URL /i/<sku>, /l/<code>, /p/<id>; else SKU → barcode → location code)
                                     (not under /api/items: "lookup" is a valid SKU)

Attribute filters are typed using the fields of the selected category subtree (or all categories).
Numeric fields support `eq`/`gte`/`lte`, yes/no fields `eq` (`true`/`false`), multi-select fields
`contains` (the default for them), and other fields `eq`. Unknown or ambiguous keys → 400.

Locations / Projects
  CRUD   /api/locations
  CRUD   /api/projects
  GET    /api/projects/:id/reservations
  POST   /api/projects/:id/reservations      { sku, qty }   → 409 if insufficient available qty
  PATCH  /api/reservations/:id               { qty | status: consumed | released }
  POST   /api/projects/:id/consume-all       (converts reservations into stock movements)

Reports
  GET    /api/reports/inventory?category=&location=&format=json|csv|pdf
  GET    /api/reports/low-stock
  GET    /api/reports/project/:id            (BOM / pick list with shortages)
  GET    /api/reports/movements?from=&to=&sku=
  GET    /api/reports/valuation              (if unit cost field is added)

Labels
  GET    /api/labels?skus=…&format=pdf       (printable QR labels for items/bins)

Import / Export
  POST   /api/import/csv?category=…          (dry-run + commit)
  GET    /api/export?format=csv|json
```

**Concurrency rules**

- Stock decrements use a guarded atomic update:
  `UPDATE items SET qty_on_hand = qty_on_hand - :n, version = version + 1 WHERE sku = :sku AND qty_on_hand - :n >= 0`
- Reservations check availability inside a transaction (`SERIALIZABLE` on PG; SQLite's single-writer lock covers it).
- Item edits use optimistic locking via `version` / `If-Match`.

## 5. Barcode & QR Strategy

- **What gets scanned**
  - Manufacturer barcodes (EAN-13, UPC-A, Code128) → matched against `items.barcode`.
  - Our own **QR labels** encoding a URL: `https://<host>/i/<SKU>` for items, `/l/<code>` for bins, `/p/<id>` for projects. A URL means a phone's native camera app also opens the right page.
  - DigiKey/Mouser bag labels (Data Matrix / ECIA 2D format) — stretch goal: parse manufacturer part number and quantity to speed up receiving.
- **Scanner component** (`<Scanner>`): `getUserMedia` rear camera → `BarcodeDetector` if available, else `zxing-wasm` in a Web Worker; torch toggle; continuous mode for stocktakes; haptic/beep feedback.
- **Scan flows**
  1. *Lookup*: scan → item page.
  2. *Quick adjust*: scan → ± quantity sheet → save movement.
  3. *Receive*: scan unknown code → "create item" form pre-filled with the barcode.
  4. *Pick for project*: open project → scan each part → marks reservation consumed.
  5. *Stocktake*: scan a bin → scan items in it → enter counts → generates `count` movements for differences.
- Camera access requires **HTTPS** (except localhost) — dev setup uses `vite --host` with mkcert.

**Implementation notes (M5):**

- **Engines.** The native `BarcodeDetector` is used when it reads QR codes (Android, macOS); otherwise zxing-wasm decodes downscaled frames in a Web Worker. The WASM file (~950 kB, ~415 kB brotli) is bundled and served from our own origin, not the library's default CDN, so scanning works on a LAN without internet. Setting `localStorage['inventory.scanner.engine'] = 'zxing'` forces the fallback.
- **Formats.** QR, Data Matrix, EAN-13/8, UPC-A/E, Code 128, Code 39. Parsing ECIA Data Matrix bag labels is still a stretch goal.
- **Repeat suppression.** A code is ignored while it stays in view (2.5 s after it was last seen), and the timer restarts when the scanner resumes after a dialog, so a label left under the camera does not reopen the dialog.
- **`/scan` modes:** look up (item page or bin contents), adjust (± sheet), receive (receive sheet; unknown barcodes open "new item" with the barcode filled in). A text field accepts typed codes and USB/Bluetooth barcode scanners, which type like a keyboard. Flows 4 (pick for project) and 5 (stocktake) come with M6 and M9.
- **Labels.** `GET /api/labels?skus=…&locations=…&projects=…&layout=…&skip=…&outline=…` renders vector QR codes with pdfkit. Layouts: A4 3×8 (70×37 mm), A4 5×13 (Avery L7651), Letter 3×10 (Avery 5160), and 62×29 / 50×25 mm label rolls. `skip` reuses partly used sheets. At most 300 labels per request. QR codes use `PUBLIC_URL`, or the request origin when it is unset (the print dialog warns). The built-in PDF fonts only cover Windows-1252, so `Ω` prints as "Ohm".
- **Printing from the UI:** "Print label" on an item, a selection on the items list, and per location (with everything inside it) or all locations.
- **Packaging.** pdfkit loads font data from disk, so it is not bundled. `apps/api/package.json` `runtimeDependencies` lists the packages the build leaves external and the Docker image installs (better-sqlite3, pdfkit).
- **E2E.** Chromium's fake camera plays a generated Y4M video of a QR label, so the tests exercise the real camera → decoder → lookup path with both engines.

## 6. PWA Front End

### 6.1 Screens

| Route | Purpose |
|---|---|
| `/` | Dashboard: search box, scan button, low-stock count, active projects |
| `/search` | Full-text search + faceted filters generated from the category's `filterable` fields |
| `/items/new`, `/items/[sku]`, `/items/[sku]/edit` | Item detail with movement history, reservations, dynamic form |
| `/scan` | Full-screen scanner with mode selector (lookup / adjust / receive / stocktake) |
| `/categories`, `/categories/[id]` | Category tree + **field definition editor** (drag to reorder, type pickers, preview form) |
| `/locations` | Location tree, print bin labels |
| `/projects`, `/projects/[id]` | Project list, reservation list (BOM), shortages, consume/release actions |
| `/reports` | Report picker, filters, preview, CSV/PDF download, print |
| `/settings` | Backup/export, about |
| `/i/[sku]`, `/l/[code]`, `/p/[id]` | Short links used by QR labels (redirect) |

### 6.2 Key components

- `DynamicForm` — renders inputs from `field_defs`; `quantity` inputs parse SI prefixes.
- `QtyInput` — number + unit selector limited to the category's `unit_kind`; emits base-unit integers.
- `DynamicFilters` — facets from `filterable` fields (enum → checkboxes, number → range).
- `ItemTable` — columns from `showInList` fields, virtualized for large lists.
- `Scanner` — see §5.
- `QtyAdjustSheet` — bottom sheet for ± with reason.

### 6.3 State & data

- Svelte 5 runes. Data is loaded in SvelteKit `load` functions and refreshed with `invalidateAll()` after mutations. TanStack Query was dropped in M4, because `load` covers this app's needs without another dependency.
- Typed API client (`apps/web/src/lib/api.ts`) using the request/response types and Zod schemas from `packages/shared`.

**Implementation notes (M4):**

- **Item list state is in the URL.** Filter, sort and page are query parameters that pass straight through to `GET /api/items`, so filtered views can be bookmarked and shared.
- **Attribute forms reuse the API's validation.** They convert values to and from editable text (quantities as `4.7k`) and validate with the same `buildAttributesSchema` the API uses, so errors appear before saving. Server errors map back to the field they belong to.
- **Field editor.** Saved keys are read-only; renaming is a separate action that moves stored values. Removing saved fields asks for confirmation. Changes that would invalidate items show the affected SKUs as links.
- **Login.** It sets a stateless signed cookie (`HttpOnly`, `SameSite=Strict`, `Secure` behind HTTPS), valid 180 days. The signing key is derived from `SESSION_SECRET` and `APP_PASSWORD`, so changing the password logs out every device. Failed logins are rate-limited to 10 per 15 minutes.
- **End-to-end tests.** Playwright runs the production build with demo data and a password, on a desktop and a phone viewport, locally and in CI.

**Implementation notes (M6):**

- **API.** `/api/projects` CRUD (`?status=planning,active`) returns line counts (`openLines`, `shortLines`, `consumedLines`). `GET /api/projects/:id/reservations` is the pick list: every line with the item's name, location, on-hand and available quantity, and `shortBy`. Also `consume-all`, `release-all` and `PATCH /api/reservations/:id`. `GET /api/items/:sku/reservations` includes the project's name and status.
- **Partial picks.** `PATCH /api/reservations/:id {status:'consumed', qty}` with `qty` smaller than the reservation takes that much out of stock (a `reserve_consume` movement linked to the reservation) and leaves the rest reserved. Consuming more than is reserved is refused; extra use goes through a normal movement.
- **Use all is all or nothing.** It runs in one transaction: if one line is short, nothing is taken out of stock.
- **Shortages.** Reservations cannot exceed available stock, so shortages only appear when stock drops afterwards (ad-hoc use, a count). A line is *short* when on hand < reserved (`shortBy` = the difference). Separately, *over-committed* means available < 0, i.e. all projects together reserve more than is on hand. Planning parts you do not have yet ("wanted" quantities) is not modelled; it could be added for the M7 BOM report.
- **Closing projects.** `completed` / `cancelled` is refused while lines are open, so closed projects never hold stock. Reserving archived items is refused. Deleting a project removes its reservations (open ones return to stock) and keeps the movement history.
- **UI.** `/projects` (Open / Completed / Cancelled / All), `/projects/[id]` (add parts by search, pick / change / release per line, use all, release all, project QR label), "Reserve…" on item pages, active projects on the dashboard. `/p/[id]` redirects to the project.
- **Scanner pick mode** (`/scan?mode=pick&project=…`, the "Pick with scanner" button): each scan of a reserved part opens the pick sheet; a "Still to pick" list shrinks as parts are taken. Scanning a project label in look-up mode opens the project.
- **Phone navigation:** Home, Items, Scan, Projects, Locations. Categories are reached from the dashboard (and the top bar on larger screens).

### 6.4 Offline behaviour (v1)

- App shell precached by Workbox → app opens offline.
- Item catalogue cached in IndexedDB (stale-while-revalidate) → search and lookup work offline.
- Quantity adjustments made offline are **queued** (Workbox Background Sync) and replayed when online; the server applies them as deltas (not absolute values) so they merge safely. Conflicts (e.g. would go negative) are surfaced in an "outbox" view.
- Full offline editing of categories/items is out of scope for v1.

## 7. Security

This is a **single-user** app: there are no accounts, roles or users table.

- **`APP_PASSWORD` unset:** no login. Meant for localhost, a trusted LAN, or behind Tailscale or another VPN.
- **`APP_PASSWORD` set:** a single password screen. A successful login sets a signed, long-lived session cookie (httpOnly, SameSite=Strict, Secure), so the phone stays logged in. The API refuses to start on a non-localhost bind without `APP_PASSWORD` unless `ALLOW_NO_AUTH=true` is set explicitly.
- The API and PWA are served from **one origin**, so no CORS is needed and SameSite=Strict blocks CSRF.
- Login attempts are rate-limited, and the password is compared in constant time.
- All input is validated with Zod, JSON attributes are validated against the category schema, and queries are always parameterized.
- `stock_movements` serves as the audit trail.

## 8. Deployment

There is one artifact: a **single Docker image** in which the API serves the built PWA. Migrations run on startup.

### 8.1 Configuration (env)

| Var | Example | Notes |
|---|---|---|
| `DATABASE_URL` | `sqlite:///data/inventory.db` or `postgres://inv:…@db:5432/inventory` | Selects the dialect |
| `APP_PASSWORD` | — | Enables login (§7) |
| `SESSION_SECRET` | random 32+ bytes | Required when `APP_PASSWORD` is set |
| `PORT` / `HOST` | `3000` / `0.0.0.0` | |
| `PUBLIC_URL` | `https://inventory.example.com` | Encoded in QR labels; **choose it before printing labels** |
| `BACKUP_DIR` | `/data/backups` | Destination for nightly SQLite backups |

### 8.2 Deploy instructions (deliverable: `docs/DEPLOY.md`)

Camera scanning requires **HTTPS** on the phone, so every option below ends with HTTPS. The guide will include copy-paste steps for:

1. **Local dev:** `pnpm dev`, with mkcert for HTTPS so you can test scanning from a phone on the LAN.
2. **Home server / NAS / Raspberry Pi + SQLite (recommended default):** `docker compose up -d` with a `./data` volume, reached over Tailscale with `tailscale serve`, which gives a real HTTPS cert and keeps the app off the public internet. In this setup, `APP_PASSWORD` is optional.
3. **LAN without Tailscale:** Caddy in front, using its internal CA, plus steps to install the root cert on iOS and Android.
4. **Public VPS:** compose with Caddy (automatic Let's Encrypt), with a firewall that allows only 80/443. `APP_PASSWORD` is mandatory here.
5. **Postgres variant:** a compose override file that adds a `postgres:18` service.
6. **Operations:**
   - Backups: SQLite `VACUUM INTO` nightly with retention; `pg_dump` for Postgres.
   - Restoring from backup.
   - Upgrading: pull the image and restart; migrations run automatically.
   - Moving from SQLite to Postgres: `pnpm db:transfer --from sqlite:… --to postgres:…`, which exports JSON and imports it into the new database.

The compose files and Caddyfile examples ship in `docker/`. Updating the guide is part of the definition of done for any change that touches config.

## 9. Milestones

| # | Milestone | Deliverables |
|---|---|---|
| **M0** ✅ | Project setup | Monorepo, lint/format, CI with SQLite + Postgres matrix, Docker compose, HTTPS dev |
| **M1** ✅ | Data layer | Kysely setup, `DialectAdapter`, migrations for all tables, repositories (including the transactional stock-movement and reservation logic), seed data (`pnpm db:seed`: sample categories Resistors, Capacitors, ICs, Wire, Tools) |
| **M2** ✅ | Categories, dynamic fields & units | Field-def schema, runtime Zod builder, inheritance, `units.ts` (base-unit conversion), category CRUD API + tests |
| **M3** ✅ | Items & stock | Item and stock HTTP API on top of the M1 repositories, attribute validation against resolved field definitions, `searchable` flag, search and JSON-filter query parameters |
| **M4** ✅ | PWA foundation | SvelteKit SPA, optional password login, layout, dashboard, search, item detail/edit with `DynamicForm`, category field editor |
| **M5** ✅ | Scanning | `Scanner` component, lookup/adjust/receive flows, QR label PDF generation |
| **M6** ✅ | Projects & reservations | Project CRUD, reservations with availability checks, pick list, consume/release |
| **M7** | Reports | Inventory, low-stock, project BOM/shortage, movement history; CSV + PDF + print CSS |
| **M8** | PWA polish & offline | Manifest, icons, install prompt, offline catalogue, queued adjustments, update toast |
| **M9** | Import/export, deploy & hardening | CSV import with dry-run, stocktake flow, more E2E coverage, Docker image, compose/Caddy examples, backup job, `db:transfer`, `docs/DEPLOY.md` verified end-to-end on a clean machine |

M1–M3 (backend) and M4 (PWA shell against a mock API) can proceed in parallel once the shared schemas from M2 are stable.

## 10. Decisions

| # | Topic | Decision (2026-11-21) | Consequence |
|---|---|---|---|
| D1 | Multiple locations per SKU | **No**: one location per SKU | `items.location_id` + `items.qty_on_hand`; no `item_stock` table |
| D2 | Editable SKUs | **No**: SKUs are immutable | `sku` is the true PK and is referenced directly by FKs; there is no surrogate id, and the API rejects `sku` in PATCH. To "rename" an item, create a new one and transfer the stock |
| D3 | Fractional quantities | **Whole numbers in a small base unit** | §3.4: mm / mg / µL / pieces, integer columns on both DBs |
| D4 | Users & hosting | **Single user, with deploy instructions** | §7 optional `APP_PASSWORD`; §8.2 `docs/DEPLOY.md` covering home server/Tailscale, LAN and VPS |

### Remaining minor defaults (go with these unless you say otherwise)

- **SKU generation:** both options. The SKU is auto-suggested from `category.sku_prefix` + a zero-padded sequence (`RES-0001`), and the user can override it at creation.
- **Cost / valuation:** not in v1. If needed, add a `unit_cost` custom field per category; a fixed column can come later.

## 11. Testing Strategy

- **Unit:** field-def → Zod builder, SI-prefix parser, unit conversion and rounding (property-based), availability math, report aggregations.
- **Repository/API:** Vitest against real SQLite (in-memory) and Postgres (Testcontainers) — same suite, both dialects.
- **Concurrency:** parallel decrement / reservation tests to prove no negative stock or over-reservation.
- **E2E:** Playwright with mobile emulation; scanner tested with injected fake camera streams of barcode images.
- **PWA:** Lighthouse PWA audit in CI.
