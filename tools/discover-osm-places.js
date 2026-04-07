/* eslint-disable no-console */
/**
 * Discovers circular-economy-related places from OpenStreetMap (Overpass API)
 * and upserts candidates into Firestore `reviewQueue` with status `needs_review`.
 *
 * Usage:
 *   node tools/discover-osm-places.js --city=milan
 *   node tools/discover-osm-places.js --city=turin --radius=12000 --limit=80
 *   node tools/discover-osm-places.js --city=stockholm --dry-run
 *
 * Requires firebase-admin (repo root) and credentials like seed-firestore.js.
 */

const path = require('path');
const { readFileSync, existsSync } = require('fs');
const { initializeApp, cert, getApps } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');

const PROJECT_ID = process.env.FIREBASE_PROJECT_ID || 'circeco-bf511';
const REJECT_ONLY_RETENTION_DAYS = Math.max(30, parseInt(process.env.REVIEW_MEMORY_REJECT_TTL_DAYS || '180', 10) || 180);
const MEMORY_SOFT_PENALTY_NAME_GEO = 0.14;
const MEMORY_SOFT_PENALTY_NAME = 0.08;
const MIN_CONFIDENCE_AFTER_MEMORY = 0.52;

/** Try mirrors if the public endpoint is overloaded (502/503/504). Override with OVERPASS_URL. */
const DEFAULT_OVERPASS_MIRRORS = [
  'https://overpass-api.de/api/interpreter',
  'https://lz4.overpass-api.de/api/interpreter',
  'https://z.overpass-api.de/api/interpreter',
];

/** Fallback centers if `cities/{cityId}` is missing in Firestore */
const FALLBACK_CENTERS = {
  stockholm: { lat: 59.325, lng: 18.072 },
  uppsala: { lat: 59.8586, lng: 17.6389 },
  milan: { lat: 45.4642, lng: 9.19 },
  turin: { lat: 45.0703, lng: 7.6869 },
};

function initAdminApp() {
  if (getApps().length > 0) return;
  if (process.env.FIRESTORE_EMULATOR_HOST) {
    initializeApp({ projectId: PROJECT_ID });
    return;
  }
  const repoRoot = path.resolve(__dirname, '..');
  const defaultCredPath = path.join(repoRoot, 'secrets', 'firebase-adminsdk.json');
  const credPath = process.env.GOOGLE_APPLICATION_CREDENTIALS || defaultCredPath;
  if (!existsSync(credPath)) {
    console.error(
      '[discover-osm] No credentials. Add secrets/firebase-adminsdk.json or set GOOGLE_APPLICATION_CREDENTIALS.'
    );
    process.exit(1);
  }
  const sa = JSON.parse(readFileSync(credPath, 'utf8'));
  initializeApp({ credential: cert(sa), projectId: sa.project_id || PROJECT_ID });
}

function parseArgs() {
  const out = {
    city: '',
    /** Smaller default radius reduces Overpass load (504 timeouts on busy servers). */
    radiusM: 9000,
    limit: 100,
    dryRun: false,
  };
  for (const a of process.argv.slice(2)) {
    if (a === '--dry-run') out.dryRun = true;
    else if (a.startsWith('--city=')) out.city = a.slice('--city='.length).trim().toLowerCase();
    else if (a.startsWith('--radius=')) out.radiusM = Math.max(1000, parseInt(a.slice('--radius='.length), 10) || 9000);
    else if (a.startsWith('--limit=')) out.limit = Math.max(1, parseInt(a.slice('--limit='.length), 10) || 100);
  }
  if (!out.city) {
    console.error('Usage: node tools/discover-osm-places.js --city=milan [--radius=9000] [--limit=100] [--dry-run]');
    process.exit(1);
  }
  return out;
}

/** Split into two lighter queries to avoid Overpass timeouts (504). */
function buildOverpassQueryShops(lat, lng, radiusM) {
  const r = radiusM;
  const q = lat;
  const p = lng;
  return `
[out:json][timeout:90];
(
  node["shop"="second_hand"](around:${r},${q},${p});
  way["shop"="second_hand"](around:${r},${q},${p});
  node["shop"="charity"](around:${r},${q},${p});
  way["shop"="charity"](around:${r},${q},${p});
  node["shop"="variety_store"](around:${r},${q},${p});
  way["shop"="variety_store"](around:${r},${q},${p});
  node["shop"="rental"](around:${r},${q},${p});
  way["shop"="rental"](around:${r},${q},${p});
  node["shop"="vintage"](around:${r},${q},${p});
  way["shop"="vintage"](around:${r},${q},${p});
  node["shop"]["name"~"vintage",i](around:${r},${q},${p});
  way["shop"]["name"~"vintage",i](around:${r},${q},${p});
  node["shop"]["name"~"humana",i](around:${r},${q},${p});
  way["shop"]["name"~"humana",i](around:${r},${q},${p});
  node["shop"="books"](around:${r},${q},${p});
  way["shop"="books"](around:${r},${q},${p});
);
out center;
`;
}

function buildOverpassQueryAmenitiesCraft(lat, lng, radiusM) {
  const r = radiusM;
  const q = lat;
  const p = lng;
  return `
[out:json][timeout:90];
(
  node["amenity"="recycling"](around:${r},${q},${p});
  way["amenity"="recycling"](around:${r},${q},${p});
  node["amenity"="recycling_centre"](around:${r},${q},${p});
  way["amenity"="recycling_centre"](around:${r},${q},${p});
);
out center;
`;
}

function overpassMirrorUrls() {
  if (process.env.OVERPASS_URL) return [process.env.OVERPASS_URL];
  if (process.env.OVERPASS_URLS) {
    return String(process.env.OVERPASS_URLS)
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return DEFAULT_OVERPASS_MIRRORS;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runOverpass(query) {
  const urls = overpassMirrorUrls();
  const transient = (status) => status === 502 || status === 503 || status === 504;
  let lastErr = null;

  for (let i = 0; i < urls.length; i++) {
    const base = urls[i];
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const res = await fetch(base, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
          body: `data=${encodeURIComponent(query)}`,
        });
        if (!res.ok) {
          const t = await res.text();
          const err = new Error(`Overpass HTTP ${res.status}: ${t.slice(0, 400)}`);
          if (transient(res.status) && attempt < 3) {
            const wait = 2000 * attempt;
            console.warn(`[discover-osm] ${base} attempt ${attempt} failed (${res.status}), retry in ${wait}ms…`);
            await sleep(wait);
            lastErr = err;
            continue;
          }
          if (transient(res.status) && i < urls.length - 1) {
            console.warn(`[discover-osm] ${base} gave ${res.status}, trying next mirror…`);
            lastErr = err;
            break;
          }
          throw err;
        }
        return res.json();
      } catch (e) {
        lastErr = e;
        if (attempt < 3) {
          const wait = 2000 * attempt;
          console.warn(`[discover-osm] network error on ${base}, retry in ${wait}ms…`, e.message || e);
          await sleep(wait);
        }
      }
    }
  }
  throw lastErr || new Error('Overpass: all mirrors failed');
}

function osmUrl(el) {
  const t = el.type === 'way' ? 'way' : el.type === 'relation' ? 'relation' : 'node';
  return `https://www.openstreetmap.org/${t}/${el.id}`;
}

function buildAddress(tags) {
  const parts = [];
  const street = [tags['addr:street'], tags['addr:housenumber']].filter(Boolean).join(' ').trim();
  if (street) parts.push(street);
  const city = tags['addr:city'] || tags['addr:place'] || '';
  if (city) parts.push(city);
  const pc = tags['addr:postcode'] || '';
  if (pc) parts.push(pc);
  return parts.join(', ') || tags['addr:full'] || '';
}

function hasVintageSignal(tags, name, description) {
  const t = `${name || ''} ${description || ''} ${tags.vintage || ''} ${tags['second_hand:type'] || ''}`.toLowerCase();
  return t.includes('vintage');
}

function hasUsedOrVintageSignal(tags, name, description) {
  const secondHandTag = String(tags.second_hand || tags['second_hand:books'] || tags['second_hand:type'] || '').toLowerCase();
  if (['yes', 'only', 'true', '1'].includes(secondHandTag)) return true;
  const text = `${name || ''} ${description || ''}`.toLowerCase();
  const usedHints = [
    'second hand',
    'second-hand',
    'used',
    'used books',
    'used book',
    'vintage',
    'pre-owned',
    'preowned',
    'libri usati',
    'libro usato',
    'usato',
    'usati',
    'di seconda mano',
    'occasione',
  ];
  return usedHints.some((h) => text.includes(h)) || hasVintageSignal(tags, name, description);
}

function hasRefurbishSignal(tags, name, description) {
  const t = `${name || ''} ${description || ''} ${tags.refurbished || ''} ${tags['service:repair'] || ''}`.toLowerCase();
  const hints = [
    'refurbish',
    'refurbished',
    'reconditioned',
    'ricondizionato',
    'ricondizionati',
    'ricondizionata',
    'ricondizionate',
  ];
  return hints.some((h) => t.includes(h));
}

function hasTrustedReuseBrandSignal(name, description) {
  const t = `${name || ''} ${description || ''}`.toLowerCase();
  return t.includes('humana');
}

/** Map OSM tags to our action tag vocabulary (subset of taxonomy) */
function inferActionTags(tags, name, description) {
  const shop = String(tags.shop || '');
  const amenity = String(tags.amenity || '');
  const out = [];
  const knownNoAutoAction = shop === 'rental';
  const vintage = hasVintageSignal(tags, name, description);
  if (shop === 'second_hand' || shop === 'charity' || shop === 'vintage') out.push('reuse');
  if (shop === 'books' && isSecondHandBookstore(tags, name, description)) out.push('reuse');
  if (shop === 'variety_store' && isCircularVarietyStore(tags, name, description)) out.push('reuse');
  if (hasTrustedReuseBrandSignal(name, description)) out.push('reuse');
  if (shop === 'rental') out.push('rental');
  if (shop === 'vintage' || vintage) out.push('reuse');
  if (hasRefurbishSignal(tags, name, description)) out.push('refurbish');
  if (amenity === 'recycling' || amenity === 'recycling_centre') out.push('recycle');
  // Keep unknowns in "reuse", but avoid forcing a semantic guess for rentals.
  if (!out.length && !knownNoAutoAction) out.push('reuse');
  return [...new Set(out)];
}

function textHasAny(haystack, needles) {
  const t = String(haystack || '').toLowerCase();
  return needles.some((n) => t.includes(n));
}

/**
 * Keep bookstores only when they have clear second-hand signals.
 * This prevents generic chain bookstores from being auto-ingested as circular reuse.
 */
function isSecondHandBookstore(tags, name, description) {
  if (String(tags.shop || '') !== 'books') return false;
  const text = `${name || ''} ${description || ''}`;
  return textHasAny(text, ['libraccio']) || hasUsedOrVintageSignal(tags, name, description);
}

function isCircularVarietyStore(tags, name, description) {
  if (String(tags.shop || '') !== 'variety_store') return false;
  return hasUsedOrVintageSignal(tags, name, description);
}

function inferSector(tags) {
  const shop = String(tags.shop || '').toLowerCase();
  const amenity = String(tags.amenity || '').toLowerCase();
  const rentalKind = String(tags.rental || tags['rental:type'] || '').toLowerCase();
  const shopBits = shop.split(/[;,]/).map((s) => s.trim()).filter(Boolean);
  const hasShop = (v) => shop === v || shopBits.includes(v);
  const out = [];

  const push = (x) => {
    if (x && !out.includes(x)) out.push(x);
  };

  // Controlled sector vocabulary:
  // books, music, electronics, clothing, accessories, furniture, antiques, sport
  if (hasShop('books')) push('books');
  if (hasShop('music')) push('music');

  if (
    hasShop('electronics') ||
    hasShop('computer') ||
    hasShop('mobile_phone') ||
    hasShop('hifi') ||
    hasShop('video_games')
  ) {
    push('electronics');
  }

  if (
    hasShop('clothes') ||
    hasShop('fashion') ||
    hasShop('boutique') ||
    hasShop('shoes') ||
    hasShop('shoe_repair') ||
    hasShop('bag')
  ) {
    push('clothing');
  }

  if (
    hasShop('jewelry') ||
    hasShop('watches') ||
    hasShop('leather') ||
    hasShop('accessories')
  ) {
    push('accessories');
  }

  if (hasShop('furniture') || hasShop('interior_decoration')) push('furniture');
  if (hasShop('antiques')) push('antiques');

  if (
    hasShop('sports') ||
    hasShop('bicycle') ||
    rentalKind === 'bicycle' ||
    rentalKind === 'bike' ||
    rentalKind === 'sports'
  ) {
    push('sport');
  }

  // Keep recycling uncategorized unless another sector fits.
  // "rental" is intentionally an action tag, not a sector category.
  if (amenity === 'recycling' || amenity === 'recycling_centre') {
    // no-op
  }

  return out.slice(0, 3);
}

function confidenceFromTags(tags) {
  let c = 0.45;
  if (tags.name) c += 0.12;
  if (tags['addr:street'] || tags['addr:place'] || tags['addr:city']) c += 0.1;
  if (tags.website || tags.contact_website) c += 0.08;
  if (tags.opening_hours) c += 0.05;
  return Math.min(0.92, c);
}

function elementCoords(el) {
  if (typeof el.lat === 'number' && typeof el.lon === 'number') {
    return { lat: el.lat, lng: el.lon };
  }
  if (el.center && typeof el.center.lat === 'number' && typeof el.center.lon === 'number') {
    return { lat: el.center.lat, lng: el.center.lon };
  }
  return null;
}

function normalizeText(v) {
  return String(v || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function normalizeAddressText(v) {
  const raw = String(v || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[.,;:]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!raw) return '';
  const m = raw.match(/^(\d+[a-z]?)\s+(.+)$/i);
  if (m) return `${m[2]} ${m[1]}`.trim().replace(/\s+/g, ' ');
  return raw;
}

function placeKey(cityId, name, address) {
  return `${cityId}|${normalizeText(name)}|${normalizeAddressText(address)}`;
}

function hashString(input) {
  // FNV-1a 32-bit hash (compact deterministic fingerprint for Firestore ids/keys).
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = (h >>> 0) * 0x01000193;
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

function fingerprintForPlace(cityId, name, address) {
  const key = placeKey(cityId, name, address);
  return hashString(key);
}

function geoBucket(coords) {
  if (!hasValidCoords(coords)) return '';
  // ~110m latitude granularity, enough to distinguish most branches.
  return `${coords.lat.toFixed(3)},${coords.lng.toFixed(3)}`;
}

function haversineMeters(a, b) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad((b.lat || 0) - (a.lat || 0));
  const dLng = toRad((b.lng || 0) - (a.lng || 0));
  const s1 = Math.sin(dLat / 2);
  const s2 = Math.sin(dLng / 2);
  const q =
    s1 * s1 +
    Math.cos(toRad(a.lat || 0)) * Math.cos(toRad(b.lat || 0)) * s2 * s2;
  return 2 * R * Math.asin(Math.sqrt(q));
}

function hasValidCoords(c) {
  return !!c && Number.isFinite(c.lat) && Number.isFinite(c.lng);
}

async function loadApprovedPlacesIndex(db, cityId) {
  const snap = await db.collection('places').where('cityId', '==', cityId).get();
  const byPlaceKey = new Set();
  const byName = new Map();
  let total = 0;

  for (const d of snap.docs) {
    const p = d.data() || {};
    const status = String(p.status || 'approved').toLowerCase();
    if (status && status !== 'approved') continue;
    total++;
    const name = normalizeText(p.name || '');
    const address = normalizeAddressText(p.address || '');
    if (!name) continue;
    const key = String(p.placeKey || placeKey(cityId, p.name || '', p.address || ''));
    byPlaceKey.add(key);
    const entry = {
      name,
      address,
      coords: hasValidCoords(p.coords) ? { lat: Number(p.coords.lat), lng: Number(p.coords.lng) } : null,
    };
    if (!byName.has(name)) byName.set(name, []);
    byName.get(name).push(entry);
  }

  return { total, byPlaceKey, byName };
}

async function loadReviewedQueueDocIds(db, cityId) {
  const reviewedStates = ['approved', 'rejected', 'edited', 'superseded'];
  const snap = await db
    .collection('reviewQueue')
    .where('cityId', '==', cityId)
    .where('kind', '==', 'place')
    .where('status', 'in', reviewedStates)
    .get();
  const ids = new Set();
  for (const d of snap.docs) ids.add(d.id);
  return ids;
}

function isDuplicateOfApproved(index, cityId, candidate) {
  const name = normalizeText(candidate.name || '');
  const address = normalizeAddressText(candidate.address || '');
  if (!name) return false;
  const key = placeKey(cityId, name, address);
  if (index.byPlaceKey.has(key)) return true;

  const peers = index.byName.get(name) || [];
  for (const p of peers) {
    if (address && p.address && address === p.address) return true;
    if (hasValidCoords(candidate.coords) && hasValidCoords(p.coords)) {
      if (haversineMeters(candidate.coords, p.coords) <= 120) return true;
    }
  }
  return false;
}

function reviewMemoryDocId(cityId, candidate) {
  return `${cityId}_${fingerprintForPlace(cityId, candidate.name || '', candidate.address || '')}`;
}

function reviewMemoryNameIndexDocId(cityId, nameNorm) {
  return `${cityId}_${hashString(`name|${nameNorm}`)}`;
}

function reviewMemoryNameGeoIndexDocId(cityId, nameNorm, bucket) {
  return `${cityId}_${hashString(`namegeo|${nameNorm}|${bucket}`)}`;
}

function isExpiredRejectOnlyMemory(docData, nowMs) {
  const approvedCount = Number(docData.approvedCount || 0);
  if (approvedCount > 0) return false;
  const expiresAt = String(docData.expiresAt || '');
  if (!expiresAt) return false;
  const t = Date.parse(expiresAt);
  if (Number.isFinite(t)) return t <= nowMs;
  const reviewedAt = Date.parse(String(docData.lastReviewedAt || ''));
  if (!Number.isFinite(reviewedAt)) return false;
  const maxAgeMs = REJECT_ONLY_RETENTION_DAYS * 24 * 60 * 60 * 1000;
  return reviewedAt + maxAgeMs <= nowMs;
}

function hasRejectBias(docData) {
  const approvedCount = Number(docData.approvedCount || 0);
  const rejectedCount = Number(docData.rejectedCount || 0);
  return rejectedCount > approvedCount && rejectedCount > 0;
}

async function compactExpiredRejectedMemory(db, maxDeletes = 250) {
  const nowIso = new Date().toISOString();
  const snap = await db.collection('reviewMemory').where('expiresAt', '<=', nowIso).limit(maxDeletes).get();
  if (snap.empty) return 0;
  const batch = db.batch();
  let deleted = 0;
  for (const d of snap.docs) {
    const mem = d.data() || {};
    if (Number(mem.approvedCount || 0) > 0) continue;
    batch.delete(d.ref);
    deleted++;
  }
  if (deleted > 0) await batch.commit();
  return deleted;
}

async function loadCityMemoryRollup(db, cityId) {
  const snap = await db.collection('reviewMemoryRollups').doc(cityId).get();
  if (!snap.exists) return { indexedCount: 0, approvedCount: 0, rejectedCount: 0 };
  const d = snap.data() || {};
  return {
    indexedCount: Number(d.indexedCount || 0),
    approvedCount: Number(d.approvedCount || 0),
    rejectedCount: Number(d.rejectedCount || 0),
  };
}

function createMemoryLookup(db, cityId, nowMs) {
  const memoryById = new Map();
  const nameById = new Map();
  const nameGeoById = new Map();
  let reads = 0;

  async function getCached(cache, ref) {
    if (cache.has(ref.path)) return cache.get(ref.path);
    const snap = await ref.get();
    reads++;
    const value = snap.exists ? (snap.data() || {}) : null;
    cache.set(ref.path, value);
    return value;
  }

  return {
    async assess(candidate) {
      const nameNorm = normalizeText(candidate.name || '');
      const addressNorm = normalizeAddressText(candidate.address || '');
      if (!nameNorm) return { hardDuplicate: false, penalty: 0, reasons: [] };
      const memRef = db.collection('reviewMemory').doc(reviewMemoryDocId(cityId, candidate));
      const mem = await getCached(memoryById, memRef);
      if (mem && !isExpiredRejectOnlyMemory(mem, nowMs)) {
        const exactKey = placeKey(cityId, nameNorm, addressNorm);
        if (String(mem.fingerprint || '') === fingerprintForPlace(cityId, candidate.name || '', candidate.address || '')) {
          return { hardDuplicate: true, penalty: 0, reasons: ['memory:fingerprint'] };
        }
        if (String(mem.placeKey || '') === exactKey) {
          return { hardDuplicate: true, penalty: 0, reasons: ['memory:placeKey'] };
        }
      }

      const reasons = [];
      let penalty = 0;
      const bucket = geoBucket(candidate.coords);
      if (bucket) {
        const geoRef = db
          .collection('reviewMemoryNameGeoIndex')
          .doc(reviewMemoryNameGeoIndexDocId(cityId, nameNorm, bucket));
        const geo = await getCached(nameGeoById, geoRef);
        if (geo && !isExpiredRejectOnlyMemory(geo, nowMs)) {
          penalty += hasRejectBias(geo) ? MEMORY_SOFT_PENALTY_NAME_GEO : MEMORY_SOFT_PENALTY_NAME_GEO * 0.4;
          reasons.push('memory:name+geo');
        }
      }

      const nameRef = db.collection('reviewMemoryNameIndex').doc(reviewMemoryNameIndexDocId(cityId, nameNorm));
      const byName = await getCached(nameById, nameRef);
      if (byName && !isExpiredRejectOnlyMemory(byName, nowMs)) {
        penalty += hasRejectBias(byName) ? MEMORY_SOFT_PENALTY_NAME : MEMORY_SOFT_PENALTY_NAME * 0.4;
        reasons.push('memory:name');
      }

      return { hardDuplicate: false, penalty: Math.min(0.24, penalty), reasons };
    },
    stats() {
      return {
        reads,
        memoryCacheSize: memoryById.size,
        nameCacheSize: nameById.size,
        nameGeoCacheSize: nameGeoById.size,
      };
    },
  };
}

async function fetchCityCenter(db, cityId) {
  const snap = await db.collection('cities').doc(cityId).get();
  const d = snap.data();
  if (d && d.center && typeof d.center.lat === 'number' && typeof d.center.lng === 'number') {
    return { lat: d.center.lat, lng: d.center.lng };
  }
  const fb = FALLBACK_CENTERS[cityId];
  if (fb) {
    console.warn(`[discover-osm] cities/${cityId} missing or no center; using fallback`);
    return fb;
  }
  throw new Error(`Unknown cityId: ${cityId} (no Firestore doc and no fallback)`);
}

async function main() {
  const { city, radiusM, limit, dryRun } = parseArgs();
  initAdminApp();
  const db = getFirestore();

  console.log(`[discover-osm] city=${city} radius=${radiusM}m limit=${limit} dryRun=${dryRun}`);
  console.log(`[discover-osm] projectId=${PROJECT_ID} mirrors=${overpassMirrorUrls().join(' | ')}`);

  const compacted = await compactExpiredRejectedMemory(db);
  const center = await fetchCityCenter(db, city);
  const approvedIndex = await loadApprovedPlacesIndex(db, city);
  const memoryRollup = await loadCityMemoryRollup(db, city);
  const reviewedQueueIds = await loadReviewedQueueDocIds(db, city);
  const memoryLookup = createMemoryLookup(db, city, Date.now());
  const qShops = buildOverpassQueryShops(center.lat, center.lng, radiusM);
  const qAmenity = buildOverpassQueryAmenitiesCraft(center.lat, center.lng, radiusM);
  console.log('[discover-osm] fetching Overpass (2 smaller queries)…');

  let data1;
  let data2;
  try {
    data1 = await runOverpass(qShops);
    data2 = await runOverpass(qAmenity);
  } catch (e) {
    console.error('[discover-osm] Overpass failed', e.message || e);
    process.exitCode = 1;
    return;
  }

  const merged = new Map();
  for (const el of [...(data1.elements || []), ...(data2.elements || [])]) {
    if (!el || (el.type !== 'node' && el.type !== 'way')) continue;
    merged.set(`${el.type}-${el.id}`, el);
  }
  const elements = [...merged.values()];
  const candidates = [];
  let skippedAsDuplicate = 0;
  let skippedAsReviewedQueue = 0;
  let skippedAsMemoryHard = 0;
  let penalizedByMemory = 0;
  let skippedAsMemoryLowConfidence = 0;

  for (const el of elements) {
    if (el.type !== 'node' && el.type !== 'way') continue;
    const tags = el.tags || {};
    const name = String(tags.name || tags['name:en'] || '').trim();
    if (!name) continue;
    const coords = elementCoords(el);
    if (!coords) continue;
    const description = String(tags.description || tags['description:en'] || '');
    const shopVal = String(tags.shop || '').toLowerCase();
    const isBooks = String(tags.shop || '') === 'books';
    const isVarietyStore = String(tags.shop || '') === 'variety_store';
    if (isBooks && !isSecondHandBookstore(tags, name, description)) continue;
    if (isVarietyStore && !isCircularVarietyStore(tags, name, description)) continue;
    if (
      shopVal === 'clothes' &&
      !hasUsedOrVintageSignal(tags, name, description) &&
      !hasTrustedReuseBrandSignal(name, description)
    ) {
      continue;
    }

    const address = buildAddress(tags) || `${coords.lat.toFixed(5)}, ${coords.lng.toFixed(5)}`;
    const docId = `osm_${city}_${el.type}_${el.id}`;
    if (reviewedQueueIds.has(docId)) {
      skippedAsReviewedQueue++;
      continue;
    }
    const website = String(tags.website || tags.contact_website || tags['contact:website'] || '').trim();
    const candidateForDupes = { name, address, coords, website };
    const memorySignal = await memoryLookup.assess(candidateForDupes);
    if (memorySignal.hardDuplicate) {
      skippedAsMemoryHard++;
      continue;
    }
    if (isDuplicateOfApproved(approvedIndex, city, candidateForDupes)) {
      skippedAsDuplicate++;
      continue;
    }
    const evidenceUrl = osmUrl(el);
    const snippet = [
      tags.shop ? `shop=${tags.shop}` : '',
      tags.amenity ? `amenity=${tags.amenity}` : '',
      tags.craft ? `craft=${tags.craft}` : '',
    ]
      .filter(Boolean)
      .join(' · ');

    candidates.push({
      docId,
      payload: {
        kind: 'place',
        cityId: city,
        status: 'needs_review',
        confidence: confidenceFromTags(tags),
        candidate: {
          name,
          address,
          description: description.slice(0, 2000),
          website,
          coords,
          sectorCategories: inferSector(tags),
          actionTags: inferActionTags(tags, name, description),
        },
        evidence: [
          {
            url: evidenceUrl,
            snippet: snippet || 'OSM feature',
            capturedAt: new Date().toISOString(),
          },
        ],
        matchCandidates: [],
        updatedAt: FieldValue.serverTimestamp(),
        createdAt: FieldValue.serverTimestamp(),
      },
    });

    if (memorySignal.penalty > 0) {
      const item = candidates[candidates.length - 1];
      item.payload.confidence = Math.max(0.05, item.payload.confidence - memorySignal.penalty);
      item.payload.memorySignals = memorySignal.reasons;
      penalizedByMemory++;
      if (item.payload.confidence < MIN_CONFIDENCE_AFTER_MEMORY) {
        candidates.pop();
        skippedAsMemoryLowConfidence++;
      }
    }
  }

  // Dedupe by doc id, sort by confidence, cap limit
  const byId = new Map();
  for (const c of candidates) byId.set(c.docId, c);
  const sorted = [...byId.values()].sort((a, b) => a.payload.confidence - b.payload.confidence).reverse();
  const capped = sorted.slice(0, limit);

  console.log(
    `[discover-osm] Overpass returned ${elements.length} elements, ${candidates.length} candidates after filters (` +
      `${skippedAsReviewedQueue} reviewed queue skipped; ` +
      `${skippedAsMemoryHard} hard memory skips; ` +
      `${skippedAsMemoryLowConfidence} soft-memory confidence skips; ` +
      `${penalizedByMemory} soft-memory penalties; ` +
      `${skippedAsDuplicate} duplicates vs approved skipped; ` +
      `memory compaction deleted ${compacted}; ` +
      `memory rollup city=${city} indexed=${memoryRollup.indexedCount} approved=${memoryRollup.approvedCount} rejected=${memoryRollup.rejectedCount}; ` +
      `approved index ${approvedIndex.total}; memory reads ${memoryLookup.stats().reads}` +
      `); writing ${capped.length} (limit ${limit})`
  );

  if (dryRun) {
    for (const c of capped.slice(0, 20)) {
      console.log(`  [dry-run] ${c.docId} ${c.payload.candidate.name} (${c.payload.confidence.toFixed(2)})`);
    }
    if (capped.length > 20) console.log(`  … ${capped.length - 20} more`);
    return;
  }

  let written = 0;
  const batchSize = 400;
  for (let i = 0; i < capped.length; i += batchSize) {
    const batch = db.batch();
    const chunk = capped.slice(i, i + batchSize);
    for (const c of chunk) {
      const ref = db.collection('reviewQueue').doc(c.docId);
      batch.set(ref, c.payload, { merge: true });
    }
    await batch.commit();
    written += chunk.length;
    console.log(`[discover-osm] committed ${written}/${capped.length}`);
  }

  console.log('[discover-osm] done');
}

main().catch((err) => {
  console.error('[discover-osm] failed', err);
  process.exitCode = 1;
});
