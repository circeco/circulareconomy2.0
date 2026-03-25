# Typography, spelling, and taxonomy decisions

## UI spelling corrections (2026-03-24)

| Location | Before | After |
|----------|--------|-------|
| Landing intro paragraph | reparing | repairing |
| Landing intro paragraph | minimasing | minimizing |
| Landing repair card | Mantain | Maintain |
| Landing repair card | reparing | repairing |
| Landing repair card | functionl | function |
| `frontend/src/assets/data/circular_places.geojson` (Verdandi) | Sundyberg | Sundbyberg |
| `frontend/src/assets/data/circular_places.geojson` (Verdandi) | homware, forniture and Antik | homeware, furniture and antiques |
| `circular_places.geojson` (bike shops) | reparing of bikes | repairing bikes |

## Circular action words (rotating headline)

The landing page rotating headline intentionally keeps the original eight words, including **Reporpouse** (historic UI copy). Canonical data keys for APIs/DB still use corrected spellings (`repurpose`, `remanufacture`, etc.); see below.

The `.rw-words-1` animation remains **8s** with eight staggered delays.

## Canonical data keys (for Firestore / APIs later)

Use normalized lowercase slugs in data; the UI may use Title Case.

| Display | Canonical key |
|---------|----------------|
| Remanufacture | `remanufacture` |
| Repurpose | `repurpose` |
| (same pattern) | `refuse`, `rethink`, `reduce`, `reuse`, `repair`, `refurbish`, `recycle`, `share` |

## Taxonomy (places and events)

- **Action tags:** controlled list above; a reviewer may fill missing values after ingestion.
- **Sector categories:** shared between places and events (e.g. clothing, music, furniture); reviewer fills when the source is unclear.

## Dedup (summary)

- **Places:** same `cityId` + normalized name + normalized address. Do not merge by website domain alone (chains share domains across locations).
- **Events:** suggest duplicates from overlapping date range + location identity; the reviewer confirms merge.

## Next implementation step

- Move places and events off static assets into a database (e.g. Firestore) with a `reviewQueue`, then publish per-city GeoJSON for the map. See `ARCHITECTURE_PLAN.md` for alignment with the Angular + Firebase direction.
