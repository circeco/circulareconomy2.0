# Data model and ingestion pipeline

Canonical schema as stored in Firestore and typed in `frontend/src/app/data/models.ts`. Collection names: `frontend/src/app/data/firestore-paths.ts`.

- **Canonical truth** is Firestore (`places`, `events`, `cities`).
- The atlas builds a **city-scoped GeoJSON object in the browser** from approved places. Nothing publishes a GeoJSON file to Storage.
- Discovery writes **candidates** to `reviewQueue`. Humans approve before anything is public.

Discovery how-to: [`DISCOVERY_SCRIPTS.md`](DISCOVERY_SCRIPTS.md). Stack: [`ARCHITECTURE.md`](ARCHITECTURE.md).

---

## Taxonomy (places and events)

Source for action copy and colours: [`CIRCULAR_TAXONOMY.md`](CIRCULAR_TAXONOMY.md).  
Slugs, aliases, and sector list: `frontend/src/app/data/taxonomy.ts`.

### Circular action tags

Store lowercase slugs. A place/event may have one or more.

- `refuse`, `reuse`, `repair`, `repurpose`, `recycle`, `reduce`

Landing copy uses **Repurpose**; the data key is `repurpose`.

`canonicalizeActionTag` / `canonicalizeActionTags` run on read and on admin save. Aliases:

- `reporpouse` → `repurpose`
- `rethink` → `refuse`
- `refurbish` → `repair`
- `remanufacture` / `remanifacture` → `repurpose`
- `share` / `rental` → `reuse`

OSM discovery may still **write** `rental` or `refurbish` on queue candidates. The public UI maps those to `reuse` / `repair`. Prefer canonical slugs when approving.

Do not store the old 10-tag set (`rethink`, `share`, `refurbish`, `remanufacture`, …) as primary keys on published docs.

### Sector categories

Canonical keys (`sectorCategories: string[]`):

- `apparel`
- `home-garden`
- `cycling-sports`
- `electronics`
- `books-comics-magazines`
- `music`

`canonicalizeSectorCategories` maps aliases such as `clothing` / `accessories` → `apparel`, `furniture` / `antiques` → `home-garden`, `books` → `books-comics-magazines`, `sport` → `cycling-sports`.

OSM discovery still infers short slugs (`books`, `clothing`, `furniture`, `sport`, …). Canonicalize on approve.

---

## Canonical entities

Field names: camelCase.

### `cities/{cityId}`

Required: `name`, `countryCode`, `center: { lat, lng }`.

Also used: `bounds`, `timezone`, `enabled` (UI hides the city when `enabled === false`), `discovery.*` (OSM/event query overlays, last-run stats, learning penalties/suggestions), `createdAt`, `updatedAt`.

Seeded IDs: `stockholm`, `uppsala`, `malmo`, `goteborg`, `lund`, `milan`, `turin`.  
Seed `enabled: true` only for **stockholm** and **milan**.

### `places/{placeId}`

Required: `cityId`, `name`, `address`.

Optional: `locationName`, `coords: { lat, lng }`, `website`, `websiteLabel`, `description`, `sectorCategories`, `actionTags`, `sourceRefs`, `status`, `review`, `placeKey`, `osmClauses`, `osmTags`, `createdAt`, `updatedAt`.

Public atlas query: `status == 'approved'` and `cityId == current` (limit 500). Places without finite coords do not get a map dot.

**Dedupe key:** `placeKey = cityId + '|' + norm(name) + '|' + norm(address)`. Never merge by website domain alone (chains share domains). Reviewer is final.

### `events/{eventId}`

Required: `cityId`, `title`, `startDate` (ISO date `YYYY-MM-DD`), `locationText`.

Optional: `endDate`, `address`, `locationName`, `coords`, `website`, `description`, `timeDisplay`, `imageUrl`, `sectorCategories`, `actionTags`, `sourceRefs`, `eventQueries`, `seriesId`, `recurrence`, `status`, `review`, `createdAt`, `updatedAt`.

Public events query: `status == 'approved'` and `cityId == current` (limit 250). Missing `imageUrl` uses a default image on the client. Coords are stored for later map use; the events page is a calendar/list.

**Soft dedupe:** same `cityId`, overlapping dates, same normalized address or location name; title similarity is a hint. Reviewer confirms.

---

## Review queue

### `reviewQueue/{queueId}`

Required: `kind: 'place' | 'event'`, `cityId`, `status`, `candidate`, `evidence`, `confidence`, `createdAt`, `updatedAt`.

Optional: `matchCandidates`, `osmClauses` (places), `eventQueries` (events), `review`, `publishedRef: { collection, id }`.

Statuses: `needs_review`, `approved`, `rejected`, `edited`, `superseded`.

Minimum before enqueue: place `name` + `address`; event `title` + `startDate` + (`address` or `locationName` via `locationText`).

### Source and evidence

`SourceRef`: `sourceType` (`osm` | `rss` | `ics` | `website` | `other`), `url`, `retrievedAt`, optional `licenseNote`.

`EvidenceItem`: `url`, `snippet`, `capturedAt`.

---

## Learning and discovery ops collections

Admin-only. Used by scripts and `/admin/discovery/*`, not by the public site.

| Collection | Role |
|---|---|
| `reviewMemory` | Place fingerprint (city+name+address), counters, last decision |
| `reviewMemoryNameIndex` / `reviewMemoryNameGeoIndex` | Name / name+geo penalties and approval signals |
| `reviewMemoryRollups` | Per-city counters |
| `eventReviewMemory` | Dated, series, and source-host memory |
| `eventReviewMemoryTitleIndex` / `eventReviewMemoryRollups` | Event title signals and city counters |
| `discoveryConfig/osmPlaces` | Global OSM clause extras/disables |
| `discoveryConfig/eventDiscovery` | Global event query/seed/block overlays |
| `discoveryJobs/{cityId}_{places\|events}` | Admin-requested run (`queued` → `running` → `done`/`failed`) |
| `discoveryRuns/{runId}` | Telemetry for a city run |
| `learningStats/{cityId}_{period}` and `{cityId}_{period}_events` | Monthly moderation aggregates + query suggestions |

`learning:report` also writes `cities/{id}.discovery.osmClausePenalties`, `osmQuerySuggestions`, `eventQueryPenalties`, `eventQuerySuggestions`. Those **down-rank / suggest**; they do not auto-add or auto-disable Overpass clauses. Apply in Admin → Discovery Queries.

---

## User data

- `users/{uid}/favourites/{docId}` — atlas hearts (owner only)
- `users/{uid}/eventFavourites/{docId}` — event hearts (owner only)

---

## Cadence

- **Weekly (Monday 03:00 UTC):** event discovery → `reviewQueue`
- **Monthly (day 1, 03:00 UTC):** OSM places → `reviewQueue`, then `learning:report`
- **On demand:** Admin Run → `discoveryJobs` → worker

Review in `/admin/review/places` and `/admin/review/events`. Sort by confidence; keep likely duplicates together.

---

## App behaviour

- **Approve** creates/updates `places` or `events` with `status: approved`, updates the queue row (`status`, `publishedRef`, `review.reviewedAt`), and writes review memory.
- **Atlas** loads approved Firestore places for the selected city only (no static GeoJSON merge).
- **Events** (landing + `/events`) load approved Firestore events for the selected city. Read failure → empty list.
- **Catalogues** `/admin/places` and `/admin/events`: edit/delete approved rows; add new published rows.
- Action tags and sectors are canonicalized through `taxonomy.ts` before save in admin UI.

Security rules: [`FIREBASE_ADMIN_AND_RULES.md`](FIREBASE_ADMIN_AND_RULES.md) and `firestore.rules`. If Approve fails, the review page shows the Firestore error (often `permission-denied`).
