# Circeco architecture

How the product is put together **today**. There is no app server and no Cloud Functions. The browser talks to Firebase; discovery jobs run as Node scripts on GitHub Actions.

**Firebase project:** `circeco-bf511`  
**Public site:** [circeco.org](https://circeco.org)  
**GitHub:** [circeco/circulareconomy2.0](https://github.com/circeco/circulareconomy2.0)

Related docs: [`DATA_MODEL_AND_PIPELINE.md`](DATA_MODEL_AND_PIPELINE.md), [`DISCOVERY_SCRIPTS.md`](DISCOVERY_SCRIPTS.md), [`FIREBASE_ADMIN_AND_RULES.md`](FIREBASE_ADMIN_AND_RULES.md), [`CIRCULAR_TAXONOMY.md`](CIRCULAR_TAXONOMY.md), [`DIAGRAMS.md`](DIAGRAMS.md).

---

## Stack

| Piece | What it is |
|---|---|
| **Angular 18** | Standalone SPA in `frontend/`. Landing, atlas, events, account, admin. |
| **Firebase Auth** | Email/password. Admin is custom claim `admin: true`. |
| **Cloud Firestore** | Canonical data: cities, places, events, review queue, learning memory, user favourites. |
| **Firebase Hosting** | Serves the Angular production build. SPA rewrite to `index.html`. |
| **Mapbox GL JS v1.7** | Atlas map (CDN in `frontend/src/index.html`). Style + public token in `frontend/src/environments/`. |
| **GitHub Actions** | Hosting deploy on push to `main`; monthly/weekly discovery; optional queued admin discovery. |
| **Formspree** | Landing contact form. Not stored in Firestore. |
| **OpenStreetMap** | Place discovery via Overpass; admin geocode via Nominatim. |

**Not in this system:** Cloud Functions, Firebase Storage, a REST API, EmailJS, Mapbox Directions, Capacitor / native apps.

Local `ng serve` still uses the **production** Firebase project unless you set `FIRESTORE_EMULATOR_HOST` for the Node tools.

---

## Repository layout

| Path | Role |
|---|---|
| `frontend/` | The product UI (Angular). |
| `frontend/src/app/pages/` | Screens: `/`, `/atlas`, `/events`, `/account`, `/admin/*`. |
| `frontend/src/app/components/` | Map, navbar, phone chrome, login, calendar, city switcher, footer. |
| `frontend/src/app/services/` | Auth, Firestore reads, map, city, filters, favourites, geolocation. |
| `frontend/src/app/data/` | Taxonomy, Firestore path names, models, discovery query catalogs. |
| `frontend/src/environments/` | Mapbox, Firebase web config, Formspree. Prod file replaces this on `ng build`. |
| `tools/` | Node CLI: seed, OSM/event discovery, learning report, admin claim. Uses **firebase-admin**. |
| `firestore.rules` | Who can read/write each collection. |
| `firebase.json` | Hosting public dir, headers, SPA rewrite. |
| `.github/workflows/` | Deploy + discovery crons. |
| `secrets/` | Local Admin SDK JSON only. Gitignored except `secrets/README.md`. |

Root `package.json` is the **ops CLI**. `frontend/package.json` is the **app**.

```bash
cd frontend && npm install && npm start   # http://localhost:4200
```

---

## Hosting and deploy

Push to `main` runs `.github/workflows/firebase-hosting.yml`:

1. `npm --prefix frontend ci`
2. `npm --prefix frontend run build`
3. Deploy `frontend/dist/frontend/browser` to Hosting project `circeco-bf511` (live channel)

Secret: `FIREBASE_SERVICE_ACCOUNT_CIRCECO_BF511`.

`firebase.json` rewrites `**` → `/index.html` so client routes work.

**Firestore rules are not part of that workflow.** Publish them with `firebase deploy --only firestore:rules` (or paste in the Console). See [`FIREBASE_ADMIN_AND_RULES.md`](FIREBASE_ADMIN_AND_RULES.md).

Production builds register a service worker (`ngsw-config.json`, `frontend/public/manifest.webmanifest`). The installable shell can cache; **map tiles and Firestore stay network-only**.

---

## Runtime: how a page gets data

City is global (`CityContextService`): `?city=` in the URL plus `localStorage`. `CitiesService` reads `cities` and shows only `enabled !== false`. Default city is `stockholm`. Seeded enabled cities: **Stockholm** and **Milan**. Uppsala, Malmö, Göteborg, Lund, Turin exist in Firestore but are paused.

Every public catalogue query is **this city** and `status == 'approved'` (required by security rules).

| Route | Guard | Data |
|---|---|---|
| `/` | — | `FeaturedPlacesService` → `places`; `EventsService` → `events`; Formspree in the footer |
| `/atlas` | — | Same places query, mapped to GeoJSON in the browser → Mapbox |
| `/events` | — | Approved events + calendar |
| `/account` | `authGuard` | Profile, password, “use my location” |
| `/admin` and children | `adminGuard` | Review queues, catalogues, discovery query editors |

Phone layout (`< 1024px`): top bar + bottom tabs. Admin keeps desktop chrome.

**Atlas path**

1. `FeaturedPlacesService` queries `places` (`status==approved`, `cityId==current`, limit 500).
2. Docs with coordinates become a GeoJSON FeatureCollection in memory.
3. `MapComponent` passes that to `MapService` as the Mapbox `places` source.
4. Dots colour by primary action tag (`taxonomy.ts`).
5. `PlacesFilter` drives the list, search, action-tag filters, optional distance sort.
6. `GeolocationService` is one-shot browser GPS (no `watchPosition`). It never mixes catalogues or auto-switches city.
7. Favourites live at `users/{uid}/favourites`. Event hearts at `users/{uid}/eventFavourites`.

Events are a **list/calendar**. Event `coords` exist on the model; they are not map markers yet.

`frontend/src/assets/data/circular_places.geojson` is unused leftover. The atlas does not merge a static GeoJSON file.

---

## Database (Firestore)

Canonical types: `frontend/src/app/data/models.ts`. Collection names: `frontend/src/app/data/firestore-paths.ts`.

### Public (read approved / city metadata)

| Collection | Writes |
|---|---|
| `cities/{cityId}` | Admin |
| `places/{placeId}` | Admin (approve or catalogue CRUD) |
| `events/{eventId}` | Admin |

### Signed-in owner only

- `users/{uid}/favourites/{docId}`
- `users/{uid}/eventFavourites/{docId}`

### Admin only

| Collection | Role |
|---|---|
| `reviewQueue` | Discovery + manual candidates. Nothing is public until approve. |
| `reviewMemory*` | Place skip / penalty / boost for the next OSM run |
| `eventReviewMemory*` | Same for events |
| `discoveryConfig` | Shared OSM / event query overlays |
| `discoveryJobs` | Admin “Run discovery” (`{cityId}_places` / `{cityId}_events`) |
| `discoveryRuns` | Per-run telemetry |
| `learningStats` | Monthly aggregation |

Admin **routes** on localhost `ng serve` may skip the Angular claim check. **Firestore still requires `admin: true`.** Grant with `npm run admin:set-claim -- you@email`, then sign out and in.

---

## Content pipeline

Scripts never publish to `places` / `events`. Humans approve in `/admin/review`.

```text
Overpass (OSM places)          ── monthly cron / admin Run ──┐
Event web agent + RSS/ICS      ── weekly cron / admin Run ──┤
Manual add in admin            ────────────────────────────────┤
                                                               ▼
                                                    reviewQueue (needs_review)
                                                               │
                                          Admin approve / reject / edit
                                                               │
                         ┌─────────────────────────────────────┴──────────────────────────┐
                         ▼                                                                ▼
              places / events (status: approved)                     review memory collections
                         │                                                                │
                         ▼                                                                ▼
                 Public atlas / events                                      Next discovery skip/boost
```

**Admin → Run discovery** only writes `discoveryJobs/{city}_{places|events}`. Start the worker yourself: GitHub → Actions → **Queued Admin Discovery**, or `npm run discover:jobs` locally. There is no 10-minute poller.

**Scheduled (GitHub Actions, same service account)**

| When | Workflow | What |
|---|---|---|
| 1st of month 03:00 UTC | `monthly-discovery-learning.yml` | OSM places for Milan + Stockholm, then `learning:report` |
| Monday 03:00 UTC | `weekly-events-discovery.yml` | Event web agent + feeds |
| 15th 04:00 UTC | `schedule-keepalive.yml` | Empty commit so public-repo crons stay enabled |
| Manual | `queued-discovery.yml` | Drain `discoveryJobs` |

Commands, Overpass tags, and learning gates: [`DISCOVERY_SCRIPTS.md`](DISCOVERY_SCRIPTS.md).

---

## Where to change what

| Change | Look here |
|---|---|
| Public screen | `frontend/src/app/pages/` |
| Map dots, locate, list | `map.component.*`, `map.service.ts`, `places-filter.service.ts`, `geolocation.service.ts` |
| Atlas query | `featured-places.service.ts` |
| Calendar query | `events.service.ts` |
| City / `?city=` | `city-context.service.ts`, `cities.service.ts` |
| Tags and colours | `frontend/src/app/data/taxonomy.ts` |
| Firestore access | `firestore.rules` |
| OSM / event crawl | `tools/discover-*.js`, `tools/lib/` |
| Cron / hosting deploy | `.github/workflows/` |
| Grant admin | `tools/set-admin-claim.js` |
