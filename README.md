## [CIRCECO.org](https://circeco.org)

A multi-city platform for finding circular ♻︎ places and events.

![circulareconomy](https://circeco.github.io/circulareconomy/assets/img/demo/home_page.jpg)

Circeco maps circular initiatives and events at city scope. The atlas is searchable by circular action; the events calendar lists upcoming circular happenings in the selected city.

## Technologies

| | |
|---|---|
| **Angular 18** | SPA: landing, Circular Atlas, events, account, admin. |
| **Firebase** | Auth, Firestore (canonical data), Hosting (live site). |
| **Mapbox** | Interactive city map. Dots use action-tag colours; favourites are red when signed in. |
| **OpenStreetMap** | Place discovery (Overpass) and admin geocoding (Nominatim). |
| **Formspree** | Contact form on the landing page. |
| **GitHub Actions** | Hosting deploy on `main`; monthly/weekly discovery jobs. |

How it is wired: [`ARCHITECTURE.md`](ARCHITECTURE.md). Diagrams: [`DIAGRAMS.md`](DIAGRAMS.md).

## UX

A sticky nav (or phone top bar + tabs under 1024px) keeps Atlas, Events, city, and account available. Landing introduces the idea and search; Atlas and Events are dedicated screens.

The Circular Atlas is the main task: find a place on the map, open details, optionally save it. Dots use the taxonomy colour of the place’s action tag. Clicking a dot or list item zooms and opens name, address, and website. Filters, search, and pan/zoom work together. The city switcher scopes places, events, and the map. Hearts appear when signed in.

## Taxonomy

Places and events use six circular actions. Copy, order, and colours: [`CIRCULAR_TAXONOMY.md`](CIRCULAR_TAXONOMY.md). Code: `frontend/src/app/data/taxonomy.ts`.

- refuse, reuse, repair, repurpose, recycle, reduce

## Data and moderation

Canonical data is Firestore. Discovery writes **candidates** to `reviewQueue`; humans publish to `places` / `events`.

- Architecture: [`ARCHITECTURE.md`](ARCHITECTURE.md)
- Schema: [`DATA_MODEL_AND_PIPELINE.md`](DATA_MODEL_AND_PIPELINE.md)
- Discovery commands and learning: [`DISCOVERY_SCRIPTS.md`](DISCOVERY_SCRIPTS.md)
- Auth, rules, admin claim: [`FIREBASE_ADMIN_AND_RULES.md`](FIREBASE_ADMIN_AND_RULES.md)

## Run locally

```bash
cd frontend
npm install
npm start
```

Open [http://localhost:4200](http://localhost:4200). The app uses the production Firebase project unless you point the Node tools at the emulator (`FIRESTORE_EMULATOR_HOST`).

## Licence and Copyright

Circeco.org holds the copyright for the product idea, content, and code in this repository.

Author **Piero Grilli**
