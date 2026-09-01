/* eslint-disable no-console */
/**
 * Fetch OSM tags + Nominatim reverse addresses for snapshot places.
 * Read-only research helper; does not write Firestore.
 *
 * Usage:
 *   node tools/review-queue-enrichment/fetch-osm-meta.js
 *   node tools/review-queue-enrichment/fetch-osm-meta.js --limit=40
 */
const { readFileSync, writeFileSync } = require('fs');
const path = require('path');

const SNAPSHOT = path.join(__dirname, 'needs_review_places.snapshot.json');
const OUT = path.join(__dirname, 'osm-meta.json');
const USER_AGENT = 'circeco-review-queue-enrichment/1.0 (+https://github.com/circeco/circulareconomy2.0)';
const OVERPASS_URLS = [
  'https://overpass-api.de/api/interpreter',
  'https://lz4.overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];
const NOMINATIM = 'https://nominatim.openstreetmap.org/reverse';

function parseOsmId(docId) {
  const m = String(docId).match(/^osm_[^_]+_(node|way|relation)_(\d+)$/);
  if (!m) return null;
  return { type: m[1], id: m[2] };
}

function isCoordAddress(address) {
  return !address || /^-?\d+\.\d+\s*,\s*-?\d+\.\d+$/.test(String(address).trim());
}

function formatOsmAddress(tags) {
  if (!tags) return '';
  const street = [tags['addr:street'] || tags['addr:place'] || '', tags['addr:housenumber'] || '']
    .join(' ')
    .trim();
  const city = tags['addr:city'] || tags['addr:suburb'] || '';
  const postcode = tags['addr:postcode'] || '';
  const parts = [street, [postcode, city].filter(Boolean).join(' ')].filter(Boolean);
  return parts.join(', ');
}

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function overpassQuery(query) {
  let lastErr = null;
  for (const url of OVERPASS_URLS) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'User-Agent': USER_AGENT,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: `data=${encodeURIComponent(query)}`,
      });
      if (!res.ok) {
        lastErr = new Error(`Overpass ${url} HTTP ${res.status}`);
        continue;
      }
      return await res.json();
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr || new Error('Overpass failed');
}

async function fetchOsmBatch(elements) {
  if (!elements.length) return {};
  const nodes = elements.filter((e) => e.type === 'node').map((e) => e.id);
  const ways = elements.filter((e) => e.type === 'way').map((e) => e.id);
  const rels = elements.filter((e) => e.type === 'relation').map((e) => e.id);
  const parts = [];
  if (nodes.length) parts.push(`node(id:${nodes.join(',')});`);
  if (ways.length) parts.push(`way(id:${ways.join(',')});`);
  if (rels.length) parts.push(`relation(id:${rels.join(',')});`);
  const query = `[out:json][timeout:60];(${parts.join('')});out tags center;`;
  const json = await overpassQuery(query);
  const map = {};
  for (const el of json.elements || []) {
    map[`${el.type}/${el.id}`] = el;
  }
  return map;
}

async function nominatimReverse(lat, lng) {
  const url = `${NOMINATIM}?lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lng)}&format=jsonv2&addressdetails=1&zoom=18`;
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT, 'Accept-Language': 'en' } });
  if (!res.ok) throw new Error(`Nominatim HTTP ${res.status}`);
  return res.json();
}

function formatNominatim(json) {
  const a = json.address || {};
  const street = [a.road || a.pedestrian || a.footway || a.square || a.neighbourhood || '', a.house_number || '']
    .join(' ')
    .trim();
  const city = a.city || a.town || a.village || a.municipality || a.suburb || '';
  const postcode = a.postcode || '';
  const parts = [street, [postcode, city].filter(Boolean).join(' ')].filter(Boolean);
  return parts.join(', ');
}

async function main() {
  const args = process.argv.slice(2);
  let limit = 0;
  for (const a of args) {
    if (a.startsWith('--limit=')) limit = parseInt(a.slice('--limit='.length), 10) || 0;
  }
  const snapshot = JSON.parse(readFileSync(SNAPSHOT, 'utf8'));
  let items = snapshot.items;
  if (limit) items = items.slice(0, limit);

  const osmEls = [];
  for (const it of items) {
    const parsed = parseOsmId(it.id);
    if (parsed) osmEls.push(parsed);
  }

  const osmMap = {};
  const BATCH = 40;
  for (let i = 0; i < osmEls.length; i += BATCH) {
    const chunk = osmEls.slice(i, i + BATCH);
    console.error(`[osm] fetching ${i + 1}-${Math.min(i + BATCH, osmEls.length)} / ${osmEls.length}`);
    try {
      const part = await fetchOsmBatch(chunk);
      Object.assign(osmMap, part);
    } catch (err) {
      console.error('[osm] batch failed', err.message || err);
    }
    await sleep(1500);
  }

  const out = [];
  for (const it of items) {
    const c = it.candidate || {};
    const parsed = parseOsmId(it.id);
    const osm = parsed ? osmMap[`${parsed.type}/${parsed.id}`] : null;
    const tags = osm?.tags || {};
    const osmAddress = formatOsmAddress(tags);
    out.push({
      id: it.id,
      cityId: it.cityId,
      name: c.name,
      current: {
        description: c.description || '',
        address: c.address || '',
        website: c.website || '',
        actionTags: c.actionTags || [],
        sectorCategories: c.sectorCategories || [],
      },
      coords: c.coords || null,
      osm: osm
        ? {
            type: osm.type,
            osmId: osm.id,
            tags,
            osmAddress,
            website: tags.website || tags['contact:website'] || tags.url || '',
            phone: tags.phone || tags['contact:phone'] || '',
            shop: tags.shop || '',
            amenity: tags.amenity || '',
            recycling: tags.recycling_type || tags.recycling || '',
            operator: tags.operator || '',
            description: tags.description || tags['description:en'] || tags['description:it'] || tags['description:sv'] || '',
          }
        : null,
      nominatimAddress: '',
    });
  }

  const needGeo = out.filter((p) => isCoordAddress(p.current.address) && !p.osm?.osmAddress && p.coords);
  console.error(`[nominatim] reverse geocoding ${needGeo.length} places`);
  for (const p of needGeo) {
    try {
      const json = await nominatimReverse(p.coords.lat, p.coords.lng);
      p.nominatimAddress = formatNominatim(json);
      p.nominatimDisplay = json.display_name || '';
    } catch (err) {
      console.error('[nominatim] fail', p.id, err.message || err);
    }
    await sleep(1100);
  }

  writeFileSync(OUT, JSON.stringify(out, null, 2));
  console.error(`wrote ${OUT} (${out.length} places, osm hits ${out.filter((p) => p.osm).length})`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
