# Discovery scripts and review queue

**Living ops doc** for discovery: how to run scripts, limitations, **current learning behaviour**, and a short dev log.

| Doc | Role |
|-----|------|
| **This file** | How it works today (commands, memory collections, gates) |
| [`SCHEDULED_DISCOVERY_LEARNING_PLAN.md`](SCHEDULED_DISCOVERY_LEARNING_PLAN.md) | Cadence, phases, KPIs, roadmap |
| [`LEARNING_V1_SPEC.md`](LEARNING_V1_SPEC.md) | Target contracts / auto-policy guardrails (not all implemented) |
| [`DATA_MODEL_AND_PIPELINE.md`](DATA_MODEL_AND_PIPELINE.md) | Schema / pipeline overview |

---

## What is in `reviewQueue` for Milan (and other cities)?

There are **two different sources** of queue items:

### 1. Seed samples (always the same doc IDs if you run the seed)

`npm run seed:firestore` upserts **one sample place and one sample event per city**, including Milan:

| Document ID              | Kind   | Notes                                      |
|-------------------------|--------|--------------------------------------------|
| `place_milan_sample`    | place  | Placeholder text, not from a real source   |
| `event_milan_sample`    | event  | Placeholder event ~7 days from seed run    |

So **yes**: after seeding, Milan (and Stockholm, Turin, Uppsala) already have **two** `needs_review` candidates each—unless someone changed or deleted them in Firestore.

### 2. OSM discovery (real-world candidates, optional)

`npm run discover:osm -- --city=milan` (without `--dry-run`) writes **OpenStreetMap–derived** place candidates with IDs like:

`osm_milan_node_<id>` / `osm_milan_way_<id>`

These only appear **after you run** the discovery script against production (or emulator) with valid Admin credentials. A **dry run** does not write anything.

---

## Scripts (repo root `package.json`)

| Script | Command | Purpose |
|--------|---------|---------|
| Seed cities + sample queue | `npm run seed:firestore` | Upserts `cities/*` and sample `reviewQueue/*` per city (including Milan). |
| OSM place discovery | `npm run discover:osm -- --city=<id> [opts]` | Queries Overpass, merges candidates into `reviewQueue` (places only). |
| Event feed discovery | `npm run discover:events -- --city=<id> [opts]` | Fetches RSS/Atom/ICS feeds and writes circular event candidates into `reviewQueue`. |
| Event web agent | `npm run discover:events:agent -- --city=<id> [opts]` | Searches the open web for circular events, extracts candidates, applies memory gates, writes `reviewQueue`. |
| Scheduled multi-city discovery | `npm run discover:monthly -- [opts]` | Runs place and/or event discovery for enabled cities and logs each run to `discoveryRuns`. |
| Monthly learning report | `npm run learning:report -- --period=YYYY-MM [--city=<id>]` | Aggregates moderation outcomes and writes per-city stats to `learningStats`. |
| Admin claim | `npm run admin:set-claim -- <email>` | Sets Firebase Auth custom claim `admin: true` for the review UI. |

### Credentials

Same pattern as other tools:

- Production: `secrets/firebase-adminsdk.json` or `GOOGLE_APPLICATION_CREDENTIALS`
- Emulator: set `FIRESTORE_EMULATOR_HOST` (see comments in `tools/seed-firestore.js`)

---

## Learning strategy (how discovery improves)

Learning is part of this discovery pipeline: **rules + compact Firestore memory + monthly stats**, not an ML model. Humans remain the publish gate.

```text
Discovery run  →  reviewQueue (needs_review)
                      ↓
            Admin approve / reject / edit
                      ↓
            Write compact review memory
                      ↓
       Next discovery run reads memory
       (hard skip / soft penalty / light boost)
                      ↓
       Monthly learning:report → learningStats
       (metrics; rule changes stay mostly manual)
```

**What “teaching” means:** approve/reject mainly teaches *don’t re-queue this pattern* (and lightly bias confidence). It does **not** train a model of circular language. Monthly `learningStats` help you tune OSM tags, keywords, seeds, and blocklists by hand.

### Places (online memory — mature)

| Collection | Role |
|------------|------|
| `reviewMemory` | Fingerprint city+name+address; counters; optional rejection signals |
| `reviewMemoryNameIndex` / `reviewMemoryNameGeoIndex` | Soft name / name+geo penalties |
| `reviewMemoryRollups` | City counters |

Discovery (`discover-osm-places.js`): hard-skip on exact memory / approved catalogue match; soft-penalize weaker name hits; drop if confidence &lt; ~0.52. Rejected-only memory can expire (~180 days); approved stays for dedupe. Admin ↔ discovery fingerprints use the same FNV hash.

### Events (online memory — catching up)

| Collection / kind | Role |
|-------------------|------|
| `eventReviewMemory` (dated) | city + title + **startDate** + location |
| `eventReviewMemory` (series) | same title+location with date key `series` (multi-date / recurring / multi-member reject) |
| `eventReviewMemory` (source) | website/evidence **host** — trust or downrank |
| `eventReviewMemoryTitleIndex` | title counters; approve stores `approvalSignals` (tags, sectors, keywords) |
| `eventReviewMemoryRollups` | City counters |

Discovery (`discover-events-agent.js` + `tools/lib/event-discovery-common.js`):

1. Hard skip — dated fingerprint, series fingerprint, title rejected with zero approves, or source rejected ≥2× with reject bias  
2. Soft penalty — weaker title/source reject → lower confidence  
3. Soft boost — approved title/source (+ keyword/tag overlap)

Write path: `admin-review` → `persistEventReviewMemoryLearning`. IDs must stay hash-compatible with `event-discovery-common.js` (FNV; fixed 2026-08 — older SHA1 memory docs won’t match until re-reviewed).

Extraction guardrails (adjacent to learning): circular signal preferably in **title**; HTML dates need an explicit **year** near circular context (no inventing day-dates from a whole circular page).

### Offline report

`npm run learning:report -- --period=YYYY-MM` → `learningStats/{cityId}_{period}`. CI runs it after monthly places discovery. Use it to spot noisy signals; auto policy apply from the report is specified in `LEARNING_V1_SPEC.md` but not the main operating mode yet.

### Status snapshot

| Capability | Places | Events |
|------------|--------|--------|
| Memory on approve/reject | Yes | Yes |
| Hard duplicate skip | Yes | Yes (date + series + title + source) |
| Soft penalty | Yes | Yes |
| Soft boost from approvals | Minimal | Yes |
| Source/host learning | No (domain dedupe off for chains) | Yes |
| Series / recurrence memory | N/A | Yes |
| Admin ↔ discovery hash aligned | Yes | Yes (2026-08) |
| Structured reject reasons in UI | No | No |
| Auto policy from monthly report | No | No |

### Improve along the way

1. Edit title/address/tags before approve; reject junk groups so series + source update.  
2. Watch `discoveryRuns` counters (`skippedMemoryHard` / `skippedMemorySoft` / …).  
3. Read `learningStats` → adjust OSM allowlist, event keywords, seeds, block domains.  
4. Later: structured reject reasons; series re-open after materialization window; guarded auto soft-penalties (`LEARNING_V1_SPEC.md`).  
5. ML re-ranker only in shadow mode, still behind human review.

---

## OSM discovery (`tools/discover-osm-places.js`)

### What it does

- Reads **`cities/{cityId}.center`** from Firestore (fallback centers exist for `stockholm`, `uppsala`, `milan`, `turin`).
- Builds **two** **Overpass** queries around that point (default **9 km** radius).
- Maps OSM tags into our **`candidate`** shape (name, address, coords, inferred `actionTags` / `sectorCategories`).
- Writes **`reviewQueue`** with `status: needs_review`, `kind: place`, stable doc id `osm_{cityId}_{node|way}_{osmId}` (**merge** = safe to re-run).
- Before enqueueing, applies **place learning / dedupe** (see **Learning strategy** above) plus approved-catalogue checks below.

#### Approved-place dedupe rules (authoritative)

For candidates in the same `cityId`, discovery skips enqueue when one of these is true:

- same OSM queue doc id already has a final reviewed status in `reviewQueue` (`approved|rejected|edited|superseded`)
- review-memory fingerprint/placeKey exact match (`reviewMemory`) → hard skip
- computed `placeKey` matches an approved place
- normalized `name + address` matches an approved place
- normalized `name` matches and coordinates are very close (~120m)

Soft-penalty (not immediate skip) — see **Learning strategy**:

- `reviewMemoryNameGeoIndex` / `reviewMemoryNameIndex` lower confidence; drop if below ~0.52

Intentionally **not used** for dedupe:

- website domain + name (disabled, because same-chain branches in one city can share domains)

Rejected-only `reviewMemory` TTL default **180 days** (`REVIEW_MEMORY_REJECT_TTL_DAYS`); discovery may compact expired reject docs. Approved memory is long-lived.

### Current selection criteria (tracked)

The script currently includes an OSM element only when **all** of the following are true:

1. It matches one of the queried tags inside the city radius.
2. Element type is `node` or `way`.
3. It has a non-empty `name` (or `name:en`).
4. It has coordinates (`lat/lon` for nodes, `center` for ways).

#### Queried OSM tags (current allowlist)

- `shop=second_hand`
- `shop=charity`
- `shop=variety_store`
- `shop=rental`
- `shop=vintage`
- `shop=books`
- `amenity=recycling`
- `amenity=recycling_centre`
- `shop` with `name` containing `vintage` (case-insensitive)
- `shop` with `name` containing `humana` (case-insensitive)

#### Mapping to app fields

- `actionTags` inference:
  - `reuse`: `shop=second_hand|charity|vintage`
  - `reuse` for bookstores (`shop=books`) **only** when second-hand signals are present
    (e.g. `second_hand=yes|only`, or strong text markers such as `Libraccio`, `used books`, `libri usati`)
  - `reuse` for `shop=variety_store` **only** when used/vintage signals are present
  - `reuse` for trusted reuse-brand signal (`humana*`)
  - `rental`: `shop=rental` (dedicated action tag, not `share`)
  - `refurbish`: when text signals indicate refurbished/reconditioned offers
    (e.g. `refurbish`, `refurbished`, `ricondizionato`)
  - `recycle`: `amenity=recycling|recycling_centre`
  - `vintage` signal (e.g. `shop=vintage` or name contains `vintage`) adds `reuse`
- `sectorCategories`: up to 3 values from this controlled list:
  - `books`
  - `music`
  - `electronics`
  - `clothing` (includes bags/accessories/shoes in current mapping)
  - `accessories`
  - `furniture`
  - `antiques`
  - `sport` (includes cycling in current mapping)
- `rental` uses its own action tag (`rental`) and is not used as a sector category.
- `evidence[0].snippet`: compact tag evidence such as `shop=books`

#### Confidence score (current)

Base score is `0.45`, then:

- `+0.12` if `name` exists
- `+0.10` if address parts exist (`addr:street` or `addr:place` or `addr:city`)
- `+0.08` if website exists (`website` or `contact_website`)
- `+0.05` if `opening_hours` exists
- capped at `0.92`

Candidates are sorted by confidence (desc), deduped by doc id (`osm_{city}_{type}_{id}`), then capped by `--limit`.
Memory soft-penalties are applied before sorting/capping and logged per run.

#### Why a chain like Feltrinelli is picked

Previously this happened because criteria were **tag-driven**, not brand-driven.

Example from Milan queue:

- `id`: `osm_milan_node_10137737859`
- `name`: `Feltrinelli`
- `evidence.snippet`: `shop=books`
- `actionTags`: historically `["reuse"]` (older policy mapped `shop=books` to reuse)
- `confidence`: `0.80` (name + address + website + opening-hours-related metadata when present)

Now this has been tightened: generic `shop=books` entries are skipped unless they show second-hand evidence. So mainstream bookstores without second-hand signals should no longer be added by discovery.

### Common options

```bash
npm run discover:osm -- --city=milan --dry-run
npm run discover:events -- --city=milan --dry-run
npm run discover:events:agent -- --city=milan --dry-run
npm run discover:events -- --city=milan --max-past-days=0 --feed=https://example.org/events.ics
npm run discover:osm -- --city=turin --radius=12000 --limit=80
npm run discover:osm -- --city=torino --radius=6000 --dry-run
npm run discover:monthly -- --radius=6000 --limit=100 --dry-run
npm run discover:monthly -- --cities=milan,stockholm,turin,uppsala --radius=6000 --limit=100 --sources=places
npm run discover:monthly -- --cities=milan,stockholm --limit=100 --sources=events --event-max-past-days=0
npm run learning:report -- --period=2026-03
```

- **`--dry-run`**: calls Overpass, prints a sample of what would be written; **no Firestore writes**.
- **`--radius`**: meters around city center (default `9000`).
- **`--limit`**: max documents to write after dedupe (default `100`).
- **`--max-past-days`** (`discover:events`): include events that started up to N days ago (default `0`, so only today/future).
- **`--sources`** (`discover:monthly`): `places`, `events`, or both.
- **`--event-max-past-days`** (`discover:monthly`): same upcoming filter forwarded to event discovery.
- **`--city=torino`** is supported and mapped to `turin` automatically (`milano -> milan` as well).
- For `discover:monthly`, omit `--cities` to run all enabled cities from `cities/*`.

Optional env: `OVERPASS_URL` (single endpoint) or `OVERPASS_URLS` (comma-separated mirrors).

### Overpass errors (406 / 502 / 503 / 504)

Public Overpass servers can time out under load or reject anonymous clients.

- Uses **two smaller queries** per run (shops vs amenities/craft) instead of one huge query.
- Defaults to a **smaller radius** (9000 m) to reduce work; increase with `--radius=` if needed.
- Sends an identifying **User-Agent** + `Accept: application/json` (required; missing agent often returns **HTTP 406**).
- **Retries** transient 502/503/504 and rotates **public mirrors** (`overpass-api.de`, `lz4`, `z`, `kumi.systems`) unless you set `OVERPASS_URL` or `OVERPASS_URLS`.
- **406 / 403 / 429** switch to the next mirror immediately (not treated as a network flake).
- Applies **adaptive radius fallback** on failure (`requested -> 4500 -> 3000 -> 2200`) so city runs can still produce candidates under load.

If it still fails, wait a few minutes and retry, or run with `--radius=6000`.

### Scheduled automation

- Monthly places + learning: `.github/workflows/monthly-discovery-learning.yml`
  - trigger day 1 monthly (`cron: 0 3 1 * *`, UTC)
  - runs discovery with `--sources=places`, then learning report (**learning still runs if discovery fails**)
- Weekly events: `.github/workflows/weekly-events-discovery.yml`
  - trigger weekly Monday (`cron: 0 3 * * 1`, UTC)
  - runs discovery with `--sources=events` (web search agent + optional feeds) and `event_max_past_days` default `0`
  - learning behaviour: **Learning strategy** above
- Schedule keepalive: `.github/workflows/schedule-keepalive.yml` (empty commit mid-month) so public-repo crons are not auto-disabled after 60 quiet days
- Both discovery workflows use Firebase service account secret `FIREBASE_SERVICE_ACCOUNT_CIRCECO_BF511`
- Telemetry: `discoveryRuns`; monthly report: `learningStats`
- If Actions shows `disabled_inactivity`, re-enable the workflow in the Actions tab (or `gh workflow enable <file>`) and push to `main`

### Event web agent (automated search)

`npm run discover:events:agent -- --city=<id>`:

1. Runs city search queries (defaults per city, or `cities/{id}.discovery.eventSearchQueries`)
2. Visits proposed seed pages (`DEFAULT_CITY_SEED_URLS`, or `discovery.eventSeedUrls` override)
3. Extracts JSON-LD `Event`, dated HTML heuristics; linked ICS/RSS **only from seed pages**
4. Keeps only candidates with circular signals in **title** (preferred) or strong multi-word keywords in description
5. Skips blocked domains (defaults include `milanopocket.it`, ticket vendors, social noise)
6. Skips via approved events, reviewed queue ids, and `eventReviewMemory` (exact date, series fingerprint, hard title rejects, repeatedly rejected sources)
7. Writes `reviewQueue` candidates for admin review

Weekly CI defaults: upcoming-only (`event_max_past_days=0`) and `limit=40`.

Learning gates for this agent are summarized under **Learning strategy** above (series, source host, title signals, year-required HTML dates).

This is the primary weekly path so the queue can fill without manually pasting events. Optional city overrides: `eventKeywords`, `eventBlockDomains`, `eventSeedUrls`, `eventSearchQueries` under `cities/{id}` or `cities/{id}.discovery`.

### Limitations (important)

- **Data quality**: OSM is community-maintained. You will get **noise** (generic chains, weak addresses) and **misses** (many circular businesses are not mapped with our tag filter).
- **Tag filter is opinionated**: we query a **subset** of tags (e.g. second_hand, charity, vintage, recycling). Expanding or tightening the Overpass query is an iterative task.
- **Event feed coverage**: RSS/Atom/ICS availability varies by city; good source configuration (`cities/{cityId}.eventFeeds`) is required for stable weekly yield.
- **Circular relevance gate**: event discovery intentionally skips non-circular events via keyword/action-tag signals and may miss weakly described circular events.
- **Rate limits / etiquette**: public Overpass servers can throttle; avoid tight loops and huge radii in automation; prefer off-peak or a self-hosted Overpass for heavy use.
- **Legal / licensing**: OSM data is ODbL; keep attribution requirements in mind for public-facing copy (see OSM attribution guidelines when you publish derived lists).
- **Review is mandatory**: nothing here publishes to `places` / `events`; humans approve in `/admin/review`.

---

## Admin review UI (`/admin/review`)

- **Route guard**: `adminGuard` allows **localhost** / **127.0.0.1** in dev without the admin claim; other hosts need Firebase Auth custom claim `admin: true`.
- **Firestore**: reads/writes on `reviewQueue` still require **`admin: true`** in the token. After `npm run admin:set-claim -- <email>`, have the user **sign out and sign in** (or wait for token refresh) so `getIdTokenResult` includes the claim; otherwise you may see `permission-denied` in the browser console.
- **Bugfix**: `AuthService.isAdmin()` must not use `takeUntilDestroyed()` inside a service method (it broke the observable). Fixed so non-localhost admin checks work reliably.

---

## Dev log (update as we go)

| Date | Change |
|------|--------|
| 2026-03-26 | Added `discover-osm-places.js`, `npm run discover:osm`, and this doc. |
| 2026-03-26 | Overpass: split query + retries + mirrors; default radius 9 km. |
| 2026-03-26 | Admin review: fixed `AuthService.isAdmin()` (removed invalid `takeUntilDestroyed` in service). Routes: `admin/review` registered before `admin`. |
| 2026-03-27 | Documented explicit OSM selection criteria, confidence formula, and why chain bookstores (e.g. Feltrinelli) can appear. |
| 2026-03-27 | Tightened bookstore policy: `shop=books` is ingested only with second-hand signals (e.g. `second_hand=yes`, `Libraccio`, `used books`/`libri usati`). |
| 2026-03-28 | Added controlled sector categories (`books`, `music`, `electronics`, `clothing`, `accessories`, `furniture`, `antiques`, `sport`). |
| 2026-03-28 | Replaced `shop=rental -> share` with dedicated action tag `rental`; added `vintage` reuse signal and Overpass search for vintage shops/names. |
| 2026-03-28 | Tightened `variety_store` to require used/vintage signals; excluded repair/tailor/shoemaker from discovery ingestion. |
| 2026-03-28 | Kept `refurbish` via explicit refurbished/reconditioned text-signal mapping. |
| 2026-03-28 | Added pre-enqueue dedupe against approved `places` (same city) to avoid re-reviewing already-approved places. |
| 2026-03-28 | Removed website-domain dedupe check (chains can share a domain across multiple same-city branches). |
| 2026-03-28 | Added targeted Humana rule: include `humana*` as reuse-brand signal. |
| 2026-03-28 | Added `reviewMemory` feedback loop from admin approve/reject and discovery skip checks (reviewed queue ids + memory + approved places). |
| 2026-03-28 | Added scalable dedupe controls: rejected-only memory TTL/compaction, city-scoped name/name+geo memory indexes, hard-skip vs soft-penalty matching, and per-run observability counters. |
| 2026-04-11 | Added `discover:monthly` + `learning:report` scripts and Firestore logging to `discoveryRuns` / `learningStats`. |
| 2026-04-11 | Added monthly GitHub Actions workflow (`monthly-discovery-learning.yml`) for automated discovery + learning report generation. |
| 2026-04-11 | Added city aliases (`torino -> turin`, `milano -> milan`) and adaptive radius fallback to improve reliability under Overpass timeouts. |
| 2026-04-18 | Added `discover:events` (`tools/discover-event-feeds.js`) for RSS/Atom/ICS event ingestion with circular relevance filtering and dedupe. |
| 2026-04-18 | Updated scheduled runner to support `--sources=places|events` and split cadence: monthly places + weekly events workflows. |
| 2026-04-18 | Event discovery default changed to upcoming-only (`maxPastDays=0`) and now skips missing-location / non-circular events with explicit counters. |
| 2026-08-24 | Fixed Overpass CI 406s (User-Agent + Accept, kumi mirror, no network-retry on 406); learning step runs after discovery failure; added schedule keepalive for 60-day inactivity disable. |
| 2026-08-24 | Added automated event web agent (`discover:events:agent`), event review memory on admin decisions, and event learning stats alongside places. |
| 2026-08-25 | Tightened event agent: require title/strong circular signals (no query auto-pass), domain blocklist, seed-only feed parsing, lower weekly limit. |
| 2026-08-27 | Event learning: series+source memory, title approvalSignals, confidence boost/penalty; safer HTML date extraction; aligned event memory hashes with admin FNV. Documented under **Learning strategy** in this file. |

_Add a row when you change Overpass tags, add event ingestion, or change queue ID strategy._
