# Circular taxonomy

Canonical actions, order, copy, and colours for landing cards, atlas dots, and filters.

**Code:** `frontend/src/app/data/taxonomy.ts` (`ACTION_TAGS`, `ACTION_TAG_LABELS`, `ACTION_TAG_COLORS`, `SECTOR_CATEGORIES`, canonicalize helpers).

## Action tags (order)

1. Refuse
2. Reuse
3. Repair
4. Repurpose
5. Recycle
6. Reduce

Store the lowercase slug (`refuse`, `reuse`, …). Visitor-facing spelling is **Repurpose**. Historic `reporpouse` canonicalizes to `repurpose`.

### Refuse — `#0c343d`

Refuse ownership towards sharing systems. Remove redundancy. Make overconsumption unappealing and unnecessary. Make product use more intensive with multifunctional products and long-lasting design.

### Reuse — `#134f5c`

Extend usage time by one or several users until the product or material reaches the end of its service-life and its condition does not allow it to fulfil the original function.

### Repair — `#45818e`

Maintain product functionality for longer through repairing and refurbishing so that the product or material can be used in its original function.

### Repurpose — `#76a5af`

Use a product or its part for a new product with a different function, also upcycling. Use materials from a discarded product for remanufacturing new products that have the same function, removing the need of new material.

### Recycle — `#a2c4c9`

Process material from a discarded product that in part can be used to create a new product with a function that has a lower or same quality, also downcycling.

### Reduce — `#d0e0e3`

Phase-out waste, harmful emissions and the use of non-renewable resources throughout the supply chain, while increasing efficiency in product manufacturing, distribution and use.

## Sector categories

Used on places and events (multi-select). Labels are UI copy; keys are stored.

| Key | Label |
|---|---|
| `apparel` | Clothing & Accessories |
| `home-garden` | Home & Garden |
| `cycling-sports` | Cycling & Sports |
| `electronics` | Electronics |
| `books-comics-magazines` | Books - Comics - Magazines |
| `music` | Music |

Aliases (canonicalize on read/write): `clothing` / `accessories` → `apparel`; `furniture` / `antiques` → `home-garden`; `books` → `books-comics-magazines`; `sport` / `cycling` → `cycling-sports`. Action aliases: `rental` / `share` → `reuse`; `refurbish` → `repair`.
