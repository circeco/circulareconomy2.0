## Data model and ingestion pipeline (draft)

This document defines the **canonical database schema** and the **human-in-the-loop ingestion workflow** for Circeco, optimized for:

- Multi-city expansion (first targets: **Milan**, **Turin**, **Uppsala**)
- **Free sources only** for discovery
- Single reviewer cadence: **weekly events**, **monthly places**
- Shared taxonomy for places and events (sector categories + circular action tags)
- Future support for **events as map markers** (coords optional now, supported later)

### Goals

- **Canonical truth** lives in the database (e.g. Firestore).
- The map consumes **city-scoped GeoJSON snapshots** for performance/cost control.
- Discovery automation produces **candidates** that require **human review** before publishing.

---

## Taxonomy (shared by places and events)

Source of truth for action descriptions and colours: [`CIRCULAR_TAXONOMY.md`](CIRCULAR_TAXONOMY.md).  
Canonical slugs and aliases are implemented in `frontend/src/app/data/taxonomy.ts`.

### Circular action tags (controlled list)

Canonical keys (store in DB as lowercase slugs):

- `refuse`
- `reuse`
- `repair`
- `repurpose`
- `recycle`
- `reduce`

Notes:

- A place/event may have **one or more** action tags (multi-select in admin).
- A reviewer may fill or correct tags during moderation.
- Landing UI copy uses **Repurpose**; the **data key remains `repurpose`**.
- Legacy / discovery aliases are canonicalized on write and read, for example:
  - `reporpouse` → `repurpose`
  - `rethink` → `refuse`
  - `refurbish` → `repair`
  - `remanufacture` → `repurpose`
  - `share` / `rental` → `reuse`

Do **not** store the older 10-tag set (`rethink`, `share`, `refurbish`, `remanufacture`, …) as primary keys.

### Sector categories (controlled vocabulary)

Canonical keys:

- `apparel`
- `home-garden`
- `cycling-sports`
- `electronics`
- `books-comics-magazines`
- `music`

Rules:

- Stored as an array of slugs: `sectorCategories: string[]`
- Optional at ingestion; reviewer may fill when unclear.
- Common aliases (e.g. `clothing` → `apparel`, `furniture` → `home-garden`, `books` → `books-comics-magazines`) are normalized via `canonicalizeSectorCategories`.

---

## Canonical entities

Field naming convention: camelCase in DB documents.

### `cities/{cityId}`

Required:

- `name`: string (display name)
- `countryCode`: string (e.g. `SE`, `IT`)
- `center`: `{ lat: number; lng: number }`

Recommended:

- `bounds`: `{ sw: {lat,lng}, ne: {lat,lng} }` (for map view constraints)
- `timezone`: string (e.g. `Europe/Stockholm`)
- `enabled`: boolean (controls visibility in UI)
- `createdAt`, `updatedAt`

Seed targets:

- Stockholm (existing)
- Milan
- Turin
- Uppsala

### `places/{placeId}`

Required:

- `cityId`: string
- `name`: string
- `address`: string

Optional:

- `locationName`: string (venue/shop name variant)
- `coords`: `{ lat: number; lng: number }`
- `website`: string
- `description`: string
- `sectorCategories`: string[]
- `actionTags`: string[]
- `sourceRefs`: `SourceRef[]`
- `status`: `RecordStatus`
- `review`: `ReviewMeta`
- `createdAt`, `updatedAt`

#### Place dedupe key

Store a deterministic key for suggesting merges:

- `placeKey = cityId + '|' + norm(name) + '|' + norm(address)`

Merge policy:

- **Never merge by website domain alone** (chains share domains across locations).
- Auto-suggest merges only when `cityId`, normalized `name`, and normalized `address` match.
- Reviewer is final authority.

### `events/{eventId}`

Required:

- `cityId`: string
- `title`: string
- `startDate`: string (ISO date, e.g. `2026-03-25`)
- `locationText`: string (either address text or venue name)

Optional:

- `endDate`: string (ISO date; omit or equal to startDate if single-day)
- `address`: string (structured address text if available)
- `locationName`: string
- `coords`: `{ lat: number; lng: number }` (optional now; enables map markers later)
- `website`: string
- `description`: string
- `sectorCategories`: string[]
- `actionTags`: string[]
- `sourceRefs`: `SourceRef[]`
- `status`: `RecordStatus`
- `review`: `ReviewMeta`
- `createdAt`, `updatedAt`

#### Event matching (soft dedupe)

Because events are more ambiguous, we prefer “match suggestions” rather than automatic merges:

- same `cityId`
- overlapping or equal date range
- same normalized `address` OR same normalized `locationName`
- title similarity is a confidence booster only

Reviewer confirms merge or keeps separate.

---

## Review queue (human-in-the-loop)

Discovery automation writes to a queue; only reviewed items are published into `places/` and `events/`.

### `reviewQueue/{queueId}`

Required:

- `kind`: `'place' | 'event'`
- `cityId`: string
- `status`: `QueueStatus`
- `candidate`: `PlaceCandidate | EventCandidate` (may be partial)
- `evidence`: `EvidenceItem[]`
- `matchCandidates`: `MatchCandidate[]` (optional suggestions)
- `confidence`: number (0–1)
- `createdAt`, `updatedAt`

Optional:

- `review`: `ReviewMeta`
- `publishedRef`: `{ collection: 'places' | 'events'; id: string }` (after approval)

#### Queue statuses

- `needs_review`
- `approved`
- `rejected`
- `edited`
- `superseded`

### Minimum candidate completeness (before queue insertion)

- Place: `name` + `address`
- Event: `title` + `startDate` + (`address` or `locationName` via `locationText`)

---

## Source references and evidence

### `SourceRef`

- `sourceType`: `'osm' | 'rss' | 'ics' | 'website' | 'other'`
- `url`: string
- `retrievedAt`: string (ISO timestamp)
- `licenseNote`: string (optional; store attribution requirements)

### `EvidenceItem`

- `url`: string
- `snippet`: string (short extracted text)
- `capturedAt`: string (ISO timestamp)

---

## GeoJSON publishing (map consumption)

The map should load **city-scoped snapshots** rather than raw Firestore queries:

- `geojson/{cityId}/places.geojson`
- (future) `geojson/{cityId}/events.geojson`

Publishing options (pick one later):

- Manual “Publish” action from Admin UI (Spark-friendly)
- Firestore trigger batching into a snapshot (use sparingly)

---

## Cadence (single reviewer operations)

- Weekly: review `reviewQueue` where `kind='event'` and `status='needs_review'`
- Monthly: review `kind='place'` and clean up stale/low-confidence candidates

Suggested sorting:

- Highest confidence first
- Items with full evidence/structured fields first
- Items with likely duplicates grouped together

---

## App implementation status (incremental)

- **Review queues** at `/admin/review/places` and `/admin/review/events` with approve / reject / edit, and manual add.
- **Catalogues** at `/admin/places` and `/admin/events` for city-scoped approved records (edit / delete).
- **Approve** creates/updates a document in `places` or `events` with `status: approved` and updates the `reviewQueue` item (`status`, `publishedRef`, `review.reviewedAt`).
- **Atlas** (`/atlas`) loads approved Firestore places for the selected city (Stockholm also merges static GeoJSON fallback). Map dots colour by primary action tag.
- **Events** (landing featured block + `/events`): approved Firestore `events`, with static demo fallback if the read fails.
- Action tags and sector categories are canonicalized through `frontend/src/app/data/taxonomy.ts` before save.

### Firestore security rules

Rules live in `firestore.rules` (deploy with Firebase CLI). Typical posture:

- **Public read** of approved `places` / `events` (and city metadata as needed).
- **Admin-only** write on `reviewQueue`, `places`, `events`, and related moderation collections.

If Approve/Reject fails, the review page shows the Firestore error (often `permission-denied`).

---

## Related: CLI discovery and scripts

For seed vs OSM discovery, Overpass troubleshooting, **current learning behaviour**, review notes, and a **dev log**, see [`DISCOVERY_SCRIPTS.md`](DISCOVERY_SCRIPTS.md).  
Cadence / roadmap / KPIs: [`SCHEDULED_DISCOVERY_LEARNING_PLAN.md`](SCHEDULED_DISCOVERY_LEARNING_PLAN.md).  
Target learning contracts: [`LEARNING_V1_SPEC.md`](LEARNING_V1_SPEC.md).
