# Circeco MVC Architecture

## Overview
This repository hosts two generations of the Circeco front end: legacy build scripts in the repo root and the active Angular single-page app in `frontend/`. The Angular app is composed entirely of standalone components and RxJS-driven services. Because Angular already mixes view + controller ideas, this document explains how the existing folders map cleanly to a classic Model–View–Controller mental model so the team can reason about ownership boundaries while iterating.

## Directory quick map
| Path | Role |
| --- | --- |
| `frontend/src/main.ts` | Boots the Angular app, router, HTTP client, and Firebase providers. |
| `frontend/src/app/app.routes.ts` | Defines lazy-routed pages (`/` landing, `/atlas`). |
| `frontend/src/app/pages/*` | Page-level controllers + templates that orchestrate feature components. |
| `frontend/src/app/components/*` | Reusable feature controllers/views (map, navbar, footer, login, etc.). |
| `frontend/src/app/services/*` | Model layer services that manage data, Firebase, map state, and filtering. |
| `frontend/src/assets/data/*` | Source data (GeoJSON) consumed by the model layer. |
| `frontend/src/styles.scss` & `frontend/src/app/**/*.scss` | Global + scoped view styles. |

## MVC mapping summary
| Layer | Responsibility | Key modules |
| --- | --- | --- |
| **Model** | Own business state, persistence, and domain logic (map data, filters, favorites, auth, media config). | `services/places-filter.service.ts`, `services/map.service.ts`, `services/favorites.service.ts`, `services/auth.service.ts`, `config/media.ts`, `environments/`. |
| **View** | Present UI state with HTML/CSS and respond to bindings. | `*.component.html`, `*.component.scss`, `frontend/src/styles.scss`, assets under `src/assets/`. |
| **Controller** | Mediate user input, update the model, and select views. | Component classes in `pages/` & `components/`, router config (`app.routes.ts`), bootstrap logic (`main.ts`, `app.component.ts`). |

### Model layer details
- **Places + filtering domain**: `places-filter.service.ts` (model) ingests map features, dedupes them, provides category and free-text filtering streams, and enriches favorite features by rehydrating metadata from the GeoJSON index. `map.service.ts` encapsulates Mapbox GL JS, exposes observables such as `onReady()` and `onFeatureClick()`, and provides mutation APIs (`setCategoryFilter`, `openPopup`, favorites visibility). These two services form the core model for the atlas regardless of which controller requests the data.
- **User identity + favorites**: `auth.service.ts` wraps Firebase Auth and exposes `user$` plus UI state signals for the login modal. `favorites.service.ts` listens to `user$`, synchronizes Firestore favourites, maintains an in-memory cache, updates the Mapbox `favorites` source, and surfaces imperative helpers (`mountHeartButton`, `computePlaceKey`) to both Angular controllers and legacy DOM hooks via `window.circeco`. By dispatching DOM events such as `favorites:update` and `favorites:auth`, it keeps controllers decoupled from persistence.
- **Static configuration**: `environments/environments.ts` and `config/media.ts` act as read-only models for secrets (Mapbox token, Firebase, EmailJS) and media URLs. Assets like `assets/data/circular_places.geojson` and icon packs represent serialized model data that feed the services above.

### View layer details
- **Angular templates + styling**: Every component exposes its view via `*.component.html` and localized SCSS. Examples include `pages/landing/landing.component.html` for the hero + action cards, `components/map/map.component.html` for the atlas overlay, and `components/footer/footer.component.html` for the EmailJS contact form UI. Templates bind to controller properties (`listOpen`, `filteredList`, `auth.modalOpen()`, etc.) and render data emitted by the model layer.
- **Global presentation rules**: `frontend/src/styles.scss` sets typography, layout primitives, and scroll-snap utilities that controllers toggle (e.g., `NavbarComponent` adds the `snap-landing` class to `<body>`). Additional shared styles live in `assets/styles/` and component-level SCSS files to keep the View concerns separate from business logic.
- **Static media**: Images, icons, demo videos, and the GeoJSON dataset under `src/assets/` are consumed directly by templates or by the Mapbox layer definitions and therefore belong to the View layer when they drive presentation and to the Model layer when treated as data (e.g., `circular_places.geojson`).

### Controller layer details
- **Application shell**: `main.ts` bootstraps Angular with router, HTTP, and Firebase providers. `app.component.ts` injects `AuthService` and `FavoritesService` so their model side effects (Firebase init, global event bridges) run once, and it renders `NavbarComponent`, the login modal, and the active routed page. Together they act as the global controller.
- **Routing controllers**: `app.routes.ts` decides which page controller to activate. `pages/landing/landing.component.ts` manages scroll animations, CTA navigation, and Footer composition, while `pages/atlas/atlas.component.ts` simply hosts the atlas feature component.
- **Feature controllers**: Components under `components/` mediate between user input and services. `NavbarComponent.ts` tracks the current section, toggles responsive menus, and decides whether to route or smooth-scroll. `MapComponent.ts` listens to `MapService` observables, pushes filtering decisions into `PlacesFilter`, translates DOM events into model updates (category toggles, favorites visibility), and reacts to global `favorites:*` events. `FooterComponent.ts` handles contact form submission, driving EmailJS via injected environment values. `LoginComponent.ts` drives reactive forms and delegates credential flow to `AuthService`.

### Cross-layer flow
1. The router loads `LandingComponent` or `AtlasComponent`, instantiating their controllers and associated views.
2. Controllers compose feature components (e.g., `MapComponent` + `FooterComponent` on Landing) and subscribe to model services.
3. User gestures captured in controllers (filter toggles, scroll, nav clicks, auth actions) call the relevant service methods. Services mutate their internal model state (RxJS subjects, Firebase cache, Mapbox sources) and emit new values.
4. View templates react automatically through Angular change detection—list items update, buttons enable/disable, map overlays refresh—and services broadcast back to controllers via observables or DOM events when asynchronous work completes.

### Working within this MVC map
- To add features that touch business logic or persistence, create/extend services in `app/services/` (Model) and expose observable state or command APIs for controllers to use.
- To modify how data is presented, edit the relevant template/SCSS without leaking business logic into the view.
- To introduce new interactions, implement or update a component class (Controller) that binds to the appropriate services and templates.
- Global concerns (routing, Firebase bootstrapping, body classes) live in the shell controllers (`main.ts`, `app.component.ts`, `NavbarComponent.ts`) so the Model layer remains reusable.
