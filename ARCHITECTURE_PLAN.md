# Refined Architecture and Implementation Plan

Below is a refined architecture/implementation plan that builds on the existing Angular groundwork without assuming current code must be reused. Existing style and structure from the previous draft are preserved.

## Current state (for context)
- A Mapbox-based map component already loads circular initiatives from a GeoJSON source, supports category filtering, popups, and a favorites overlay hook tied to a global `circeco` object.
- Routing is minimal (landing page + atlas).

### Scope of the latest incremental implementation
- Implemented only the guard foundation and placeholder Account/Admin pages (Step 2: Auth foundation). These are scaffolding pieces, not the full feature set outlined below.
- No unused code has been removed yet; cleanup is deferred until we migrate map/events/favorites into the new feature modules so we can safely delete or refactor legacy pieces with context.
- Style sheets keep the existing design conventions; future modules should continue to reuse the shared SCSS partials to maintain visual consistency.

## Refined target architecture (Angular + Firebase on the free Spark plan)
- **Frontend:** Angular standalone components, feature modules by domain (auth, map/places, events, favorites, admin). Use Angular Router lazy loading and route guards for authenticated areas.
- **Design system:** Tailwind/SCSS plus a shared UI library (buttons, forms, modals, cards) to keep admin and public views consistent.
- **Data layer (Spark-friendly):** Firebase (Auth + Firestore) as the source of truth for users, initiatives, events, favorites. Cloud Storage for images/assets sized for free-tier quotas. Cloud Functions used sparingly (no external network calls, region-limited) and only for Firestore/Storage triggers; replace paid Cloud Scheduler with Firestore TTL queries or client/admin-triggered cleanups.
- **Free-tier guardrails:** Prefer client-side aggregations and static GeoJSON generation to reduce read costs; batch writes where possible; enable caching (HTTP + IndexedDB) and pagination to avoid quota spikes; keep regional resources co-located to avoid cross-region egress.
- **Maps:** Mapbox GL JS for interactive atlas; Firestore-backed places with a server-side job to generate/update a public GeoJSON feed or map tiles (can be triggered manually via admin UI to stay within free-tier limits).
- **Events & calendar:** Firestore collections with start/end, recurrence, tags, location; ICS export and calendar view on the client.
- **Favorites:** User-scoped Firestore subcollections; optimistic UI updates with Firestore security rules.
- **Admin panel:** Protected routes for CRUD on initiatives/events, media uploads, moderation queues.
- **Integration services:** Geocoding/geolocation, reverse geocode for “near me”, analytics events (page/map interactions), and email (verification, notifications).

## Priority work items (with actionable stubs)
1. Establish project skeleton and environments (Angular + Firebase)
:::task-stub{title="Set up Angular-Firebase foundation"}
- Create Angular feature modules: `features/auth`, `features/places`, `features/events`, `features/admin`, `features/favorites`, with routing children.
- Add Firebase SDK/config; initialize modules (Auth, Firestore, Storage) in `app.config.ts` and environment files.
- Implement route guards (`auth`, `admin`) and a core `AuthService` wrapping Firebase Auth (login, signup, password reset, email verification).
- Add foundational tests: unit tests for `AuthService` mock Firebase responses; guard tests verifying redirects for anonymous vs. authenticated users.
:::

2. Places / map domain
:::task-stub{title="Refactor map domain to use Firestore-backed places"}
- Define Firestore collections for `places` and `placeCategories`; create a Cloud Function to materialize a `places.geojson` file in Storage for Mapbox.
- Update `MapService` to load the generated GeoJSON URL from config and sync favorite overlays from Firestore.
- Add CRUD services and forms for creating/editing places (category tags, coordinates, contact links).
- Testing: component tests for map/list integration (filtering, popup rendering), service tests for GeoJSON loading and error states; contract tests for the Cloud Function output shape.
:::

3. Events and calendar experience
:::task-stub{title="Implement event calendar backed by Firestore"}
- Create `events` collection schema (title, description, start/end, recurrence, placeId, tags, visibility).
- Build calendar/list components with filters (date range, tags, location proximity) and ICS export.
- Add admin forms for event creation and moderation, plus a Firestore TTL field or admin-triggered cleanup job (to avoid paid Cloud Scheduler) to archive past events.
- Testing: unit tests for recurrence/date utilities; component tests for calendar filtering; trigger tests for TTL/cleanup flows and Firestore writes using the emulator suite.
:::

4. Favorites system
:::task-stub{title="Add user favorites with optimistic UI"}
- Model favorites as `users/{uid}/favorites/{placeId}` documents.
- Expose a FavoritesService to toggle/save favorites, with local cache and syncing to map overlays.
- Add UI heart buttons on map popups/list items wired to the service and disable for anonymous users with an auth prompt.
- Testing: service tests for optimistic updates and rollback on errors; component tests ensuring UI state matches Firestore data and guards anonymous interactions.
:::

5. Admin panel
:::task-stub{title="Build admin dashboard for content management"}
- Create guarded admin routes with navigation for Places, Events, Users (read-only), and Assets.
- Implement CRUD tables/forms using Angular reactive forms with validation and upload support to Firebase Storage.
- Add audit logging (Cloud Functions) for admin changes, scoped to Firestore triggers only to stay within Spark limits.
- Testing: component tests for form validation and file uploads (mock Storage); e2e smoke tests for admin navigation and guard enforcement.
:::

6. Geolocation and search
:::task-stub{title="Add geolocation and search capabilities"}
- Integrate browser geolocation to center map and filter nearby places/events.
- Implement text search (name, tags, description) using Firestore indexes and optional client-side Fuse.js for on-page filtering.
- Add “near me” quick filters and map-driven bounding-box queries.
- Testing: utility tests for distance calculations; component tests ensuring geolocation prompts don’t break rendering; search tests to confirm index-backed queries and client-side fallbacks.
:::

7. Notifications and engagement
:::task-stub{title="Implement notifications and sharing"}
- Enable email verification and password reset flows via Firebase Auth.
- Add optional email or in-app notifications for saved-place updates or upcoming events (Cloud Functions + Firestore triggers).
- Provide shareable links for places/events with Open Graph metadata.
- Testing: Cloud Function trigger tests for notification dispatch; unit tests for email templating; component tests for notification opt-in/out flows.
:::

8. Testing and CI/CD
:::task-stub{title="Set up testing and CI/CD pipeline"}
- Add unit tests for services/components (Jasmine/Karma) and minimal e2e smoke tests (Cypress/Playwright).
- Configure GitHub Actions to run lint, tests, and deploy to Firebase Hosting (Spark) on main merges; set preview deploys for PRs using Firebase preview channels (free).
- Add coverage thresholds and reporting (Coveralls/Codecov) with badges in the README.
- Testing scope: CI should run lint, unit tests, and e2e smoke per PR against Firebase emulators to avoid quota usage; nightly workflow can run optional integration tests against a staging Firebase project with usage alerts.
:::

9. Accessibility, performance, and observability checks
:::task-stub{title="Bake QA into the delivery pipeline"}
- Add lint rules for accessibility (axe, template linting), performance budgets for bundle size, and logging standards for client analytics.
- Include Lighthouse/axe audits in CI (per PR for changed UI paths, nightly full sweep).
- Add synthetic monitors for map API availability and Firebase quotas.
- Testing: automated Lighthouse/axe runs, bundle-size checks, and alerting tests for monitoring thresholds.
:::

## Step-by-step delivery sequence (Spark-friendly)

This sequence is ordered to minimize Firebase Spark usage (start with emulators, avoid Cloud Functions until necessary) and to deliver user-visible value early.

1. **Project bootstrapping and tooling**
   - Initialize Angular workspace structure, environments, Firebase config, and route skeletons.
   - Wire Firebase emulators to all local dev/test workflows; add base lint/test CI using emulators only.
   - Deliverable: compiles, routes render placeholders, CI green on lint/unit basics.

2. **Auth foundation (minimal viable auth)**
   - Implement `AuthService`, guards, and basic UI for login/signup/password reset using Firebase Auth (emulator-backed in CI).
   - Add unit tests for guards and service flows; verify anonymous blocking on protected routes.
   - Deliverable: users can sign in/out; guarded routes redirect correctly.

3. **Places data model and GeoJSON feed**
   - Define Firestore schema for `places`/`placeCategories`; build admin-less seed import script (runs against emulator first) to populate sample data.
   - Implement Cloud Function to materialize `places.geojson` in Storage, triggered on `places` writes; expose manual trigger via admin-only endpoint to avoid schedulers.
   - Update map component/service to read the hosted GeoJSON; add service tests for loading/filtering and function contract tests against emulator.
   - Deliverable: map shows live places from Firestore-derived GeoJSON with category filters.

4. **Favorites (client-first)**
   - Build `FavoritesService` with optimistic updates to `users/{uid}/favorites/{placeId}`; integrate heart buttons in map/list views.
   - Add service/component tests to ensure offline-friendly toggles and auth-required prompts.
   - Deliverable: authenticated users can save/remove favorites; anonymous users get prompted to sign in.

5. **Events and calendar**
   - Create `events` collection, calendar/list UI with filters, and ICS export; reuse place data for event locations.
   - Add TTL field plus admin/manual cleanup flow (no paid scheduler); include recurrence utilities with unit tests.
   - Deliverable: calendar displays events, filters work, expired events can be cleaned via manual/admin action.

6. **Admin workflows (CRUD + assets)**
   - Build guarded admin area with reactive forms for places/events, Storage uploads for images, and audit logging via Firestore triggers only.
   - Add e2e smoke tests for navigation/guards and component tests for validation/upload flows.
   - Deliverable: admins can create/update places/events and assets within Spark limits.

7. **Geolocation, search, and UX polish**
   - Integrate geolocation centering, near-me filters, and text search (indexed queries + Fuse.js fallback).
   - Add accessibility/performance passes (Lighthouse/axe), bundle budgets, and analytics wiring.
   - Deliverable: performant, accessible map/search experience with observability hooks.

8. **Notifications and engagement (optional roll-out)**
   - Introduce email verification flows and in-app/email notifications via Firestore triggers, gated behind feature flags to monitor quota.
   - Add tests for notification triggers/templates; verify opt-in/out UX.
   - Deliverable: limited-scope notifications that respect Spark quotas and can be throttled or disabled quickly.
