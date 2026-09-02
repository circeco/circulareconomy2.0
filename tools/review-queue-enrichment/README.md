# Review-queue place enrichment (queues-review)

Snapshot of Firestore `reviewQueue` places with `status: needs_review` (circeco-bf511).

Goal: fill missing description, street address (when the current value is only lat/lng), website, `actionTags`, and `sectorCategories` using CIRCULAR_TAXONOMY.md / frontend/src/app/data/taxonomy.ts.

Do **not** write to live `places` collection. Patches apply only to `reviewQueue/{id}.candidate`.

## Files

- `needs_review_places.snapshot.json` — read-only export of 175 `needs_review` places
- `patches.json` — researched `{ id, proposed, flags, sources }` updates
- `SUMMARY.md` — progress counts
- `apply-patches.js` — writes **only** `reviewQueue/{id}` candidate fields + `updatedAt` (default `--dry-run`)

```bash
node tools/review-queue-enrichment/apply-patches.js
node tools/review-queue-enrichment/apply-patches.js --apply   # production, Piero only
```