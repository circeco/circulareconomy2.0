# Frontend

Angular 18 standalone app for [circeco.org](https://circeco.org). Product architecture: [`../ARCHITECTURE.md`](../ARCHITECTURE.md).

## Develop

```bash
npm install
npm start
```

[http://localhost:4200](http://localhost:4200) — `ng serve`, reload on change. Uses the Firebase project in `src/environments/environments.ts` (same project as production).

```bash
npm test          # Karma / Jasmine
npm run build     # production build → dist/frontend/browser
```

Hosting deploys that build from GitHub Actions on `main` (see repo-root `.github/workflows/firebase-hosting.yml`).

## Layout

| Path | Role |
|---|---|
| `src/app/pages/` | Routes: landing, atlas, events, account, admin |
| `src/app/components/` | Map, nav, phone chrome, login, calendar, city switcher, footer |
| `src/app/services/` | Firestore, auth, map, city, filters, favourites, geolocation |
| `src/app/data/` | Models, taxonomy, Firestore paths, discovery catalogs |
| `src/environments/` | Mapbox, Firebase web config, Formspree |
| `public/manifest.webmanifest` | PWA install metadata |

`src/assets/data/circular_places.geojson` is not loaded by the app.
