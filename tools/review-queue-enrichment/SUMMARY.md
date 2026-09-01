# Review-queue place enrichment — progress

Snapshot: `needs_review_places.snapshot.json` (175 `reviewQueue` places, status `needs_review`, exported 2026-09-01).

Patches apply only to `reviewQueue/{id}.candidate` (+ `updatedAt`). Never the live `places` collection.

## Snapshot baseline

| City | Count |
|---|---:|
| Stockholm | 79 |
| Turin | 46 |
| Milan | 26 |
| Uppsala | 24 |
| **Total** | **175** |

| Field | Empty / unusable in snapshot |
|---|---:|
| description | 170 empty |
| address | 124 missing or lat,lng only |
| website | 94 empty |
| actionTags | 2 empty (most present but often pre-canonical: `rental`, `books`, `clothing`) |
| sectorCategories | 134 empty |

## Coverage

**175 / 175** snapshot IDs have a patch.

| | Milan | Stockholm | Turin | Uppsala | Total |
|---|---:|---:|---:|---:|---:|
| Patched | 26 | 79 | 46 | 24 | **175** |

### Outcomes

| Outcome | Count | Notes |
|---|---:|---|
| On-concept, researched fields | 162 | Description and/or street address and/or official website and/or canonical tags |
| Flagged `off_concept` | 12 | Not circular-economy venues (see list below) |
| Flagged `placeholder` | 2 | `Sample place (Milan)`, `Sample place (Uppsala)` |
| Flagged `uncertain` | 5 | Could not fully confirm the circular service |
| Flagged `duplicate_chain` | 39 | Same chain, several OSM nodes (Libraccio, Humana, Myrorna, Artikel2, Il Mercatino, Stadsmissionen, …) |

### Off-concept (do not invent a circular story)

| City | Name | Why |
|---|---|---|
| Milan | YogAmica Di Micaela | Yoga / wellness studio |
| Milan | Recupero Metalli | Generic metal-scrap point |
| Milan | Sample place (Milan) | Seed placeholder |
| Stockholm | Twist & Tango | Fashion brand store (own collections) |
| Stockholm | Humana (Högbergsgatan) | Begravningsbyrån Humana, funeral directors |
| Turin | GaldieriRent | Conventional car hire |
| Turin | Motonolo | Motorcycle driving-school hire |
| Turin | de Martino | Van/car hire |
| Turin | Vintage Loundrette | Self-service laundry |
| Turin | Humana (Corso Turati) | OSM is **Umana** employment agency |
| Uppsala | Globalen | New-goods fair-trade shop |
| Uppsala | Sample place (Uppsala) | Seed placeholder |

Uncertain (kept factual, no invented copy): Spazio Sarca (OSM second_hand vs event-space listings); Recupero Metalli; C.U.S.L. (stationery/printing with some used books); 59 Vintage Store (possibly closed); Bokhandeln Röda Stjärnan (party bookshop).

## After these patches are applied

| Field | Still missing |
|---|---:|
| description | 12 (off-concept / uncertain — intentionally no circular copy) + 1 Spazio Sarca |
| street address | 2 placeholders only (`Sample address, …`) |
| website | 72 (mostly municipal recycling centres and small shops with no official site; Facebook not used as a substitute) |

### Proposed-field counts (new or replacement values)

| Field | Patches that propose it |
|---|---:|
| description | 158 |
| address | 130 |
| website | 32 |
| actionTags | 175 (canonicalized or cleared) |
| sectorCategories | 175 (canonicalized, filled, or `[]`) |

Canonical mappings: `rental`/`share` → `reuse`; `refurbish`/`refurnish` → `repair`; `books` → `books-comics-magazines`; `clothing`/`accessories` → `apparel`. Max 2 action tags. Municipal recycling centres keep `recycle` and empty sectors.

## Apply

```bash
node tools/review-queue-enrichment/apply-patches.js          # dry-run (default)
node tools/review-queue-enrichment/apply-patches.js --apply  # production reviewQueue only
```

Do **not** run `--apply` against production unless credentials are present and Piero asks. Default is dry-run.

## Research notes / hunches verified

- OSM ingest **did** stuff `lat, lng` into `candidate.address` for most nodes (124 of 175).
- Pre-canonical tags `books`, `clothing`, `rental`, `reuse; rental`, `repair|refurnish` appear in the snapshot and are mapped in patches + in `apply-patches.js`.
- Several OSM tags are wrong for this product: yoga studio, Twist & Tango, Globalen, funeral Humana, Umana employment agency, Vintage Laundrette.

Helpers: `fetch-osm-meta.js` (Overpass + Nominatim, writes local `osm-meta.json`, not committed) and `build-remaining-patches.js` (batch-2 generator).
