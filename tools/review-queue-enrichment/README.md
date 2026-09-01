# Review-queue place enrichment (queues-review)

Snapshot of Firestore `reviewQueue` places with `status: needs_review` (circeco-bf511).

Goal: fill missing description, street address (when the current value is only lat/lng), website, `actionTags`, and `sectorCategories` using CIRCULAR_TAXONOMY.md / frontend/src/app/data/taxonomy.ts.

Do **not** write to live `places` collection. Patches apply only to `reviewQueue/{id}.candidate`.