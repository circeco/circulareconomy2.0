# Review-queue place enrichment — progress

Snapshot: `needs_review_places.snapshot.json` (175 `reviewQueue` places, status `needs_review`, exported 2026-09-01).

Patches apply only to `reviewQueue/{id}.candidate` (+ `updatedAt`). Never the live `places` collection.

## Snapshot baseline

| City | Count |
|---|---|
| Stockholm | 79 |
| Turin | 46 |
| Milan | 26 |
| Uppsala | 24 |
| **Total** | **175** |

| Field | Empty / unusable in snapshot |
|---|---|
| description | 170 empty |
| address | 124 missing or lat,lng only |
| website | 94 empty |
| actionTags | 2 empty (most present but often pre-canonical: `rental`, `books`, `clothing`) |
| sectorCategories | 134 empty |

## This commit (batch 1)

Researched **41** places (mix of all four cities). Remaining **134**.

| | Milan | Stockholm | Turin | Uppsala | Total |
|---|---:|---:|---:|---:|---:|
| Patched this batch | 13 | 11 | 8 | 9 | **41** |
| Remaining | 13 | 68 | 38 | 15 | **134** |

### Batch 1 outcomes

| Outcome | Count | Notes |
|---|---:|---|
| Enriched (on-concept, real fields) | 33 | Description and/or street address and/or official website and/or canonical tags |
| Flagged `off_concept` | 8 | Yoga studio, fashion brand store, car rental, moto school, fair-trade new-goods shop, metal scrap, 2 sample placeholders |
| Flagged `placeholder` | 2 | `Sample place (Milan)`, `Sample place (Uppsala)` |
| Flagged `uncertain` | 2 | Recupero Metalli (scrap); 59 Vintage Store (possibly closed) |
| Flagged `duplicate_chain` | 12 | Libraccio, Humana, Myrorna, Artikel2, Il Mercatino, Humana Vintage |

Off-concept patches still record a street address when found, and **clear** incorrect `reuse`/`rental` tags rather than inventing a circular story.

### Field fills in batch 1 proposed patches

Counts are “proposed a new/replacement value”, not “still missing in snapshot”.

| Field | Proposed in batch 1 |
|---|---:|
| description | 30 |
| address | 22 |
| website | 16 |
| actionTags | 41 (canonicalized or cleared) |
| sectorCategories | 41 (canonicalized, filled, or left/cleared `[]`) |

Canonical mappings applied: `rental`/`share` → `reuse`; `refurbish`/`refurnish` → `repair`; `books` → `books-comics-magazines`; `clothing`/`accessories` → `apparel`. Max 2 action tags.

### Still missing (whole snapshot, after this batch is applied)

These are remaining unpatched docs, plus patched docs that still omit a field:

- Descriptions: ~140 still empty (170 − 30 proposed).
- Street addresses: many of the 124 coord-only rows remain (Stockholm vintage shops, Turin ecocentri, Milan piattaforme).
- Websites: ~80 still empty.
- Full 175 coverage is not done; next batches continue city by city.

## Apply

```bash
node tools/review-queue-enrichment/apply-patches.js          # dry-run (default)
node tools/review-queue-enrichment/apply-patches.js --apply  # production reviewQueue only
```

Do **not** run `--apply` against production unless credentials are present and Piero asks. Default is dry-run.

## Research notes / hunches verified

- OSM ingest **did** stuff `lat, lng` into `candidate.address` for most nodes.
- Pre-canonical tags `books`, `clothing`, `rental`, `reuse; rental`, `repair|refurnish` appear in the snapshot and are mapped in patches + in `apply-patches.js`.
- Several OSM `shop=second_hand` tags are wrong (yoga studio, Twist & Tango, Globalen fair trade).
