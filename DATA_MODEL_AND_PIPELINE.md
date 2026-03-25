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

### Circular action tags (controlled list)

Canonical keys (store in DB as lowercase slugs):

- `refuse`
- `rethink`
- `reduce`
- `reuse`
- `repair`
- `refurbish`
- `remanufacture`
- `repurpose`
- `recycle`
- `share`

Notes:

- A reviewer may fill missing tags during moderation.
- UI copy may differ (see `TYPOGRAPHY_AND_TAXONOMY_DECISIONS.md`), but **data keys must stay canonical**.

### Sector categories (controlled vocabulary, reviewer-curated)

Examples (not exhaustive): `clothing`, `music`, `furniture`, `electronics`, `books`, `home`, `cycling-sport`, `food`.

Rules:

- Stored as an array of slugs: `sectorCategories: string[]`
- Optional at ingestion; reviewer may fill when unclear.

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

- **Review queue UI** at `/admin/review` with **Approve / Reject**: creates a document in `places` or `events` (with `status: approved`) and updates the `reviewQueue` item (`status`, `publishedRef`, `review.reviewedAt`).
- **Events on the site** (landing featured block + `/events`): `EventsService.events$` merges **approved** Firestore `events` with the built-in static demo events. If Firestore read fails or security rules deny access, only static events are shown.

### Firestore security rules

Configure rules in the Firebase Console (or `firestore.rules` if you add them to the repo). You typically need:

- **Read** access to `events` for the data you want public on the website.
- **Write** access to `reviewQueue`, `places`, and `events` for trusted admins (custom claims), or use the **emulators** during development.

If Approve/Reject fails, the review page shows the error returned by Firestore (often `permission-denied`).

