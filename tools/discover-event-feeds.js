/* eslint-disable no-console */
/**
 * Discovers event candidates from RSS/Atom/ICS feeds and upserts them into
 * Firestore `reviewQueue` as `kind=event`, `status=needs_review`.
 *
 * Usage:
 *   node tools/discover-event-feeds.js --city=milan
 *   node tools/discover-event-feeds.js --city=stockholm --feed=https://example.org/events.ics
 *   node tools/discover-event-feeds.js --city=turin --limit=80 --dry-run
 *
 * Feed sources (deduped by URL):
 * - --feed=<url>[,<url2>]
 * - env DISCOVERY_EVENT_FEEDS (comma-separated URLs)
 * - cities/{cityId}.eventFeeds
 * - cities/{cityId}.discovery.eventFeeds
 *
 * Feed object form in Firestore:
 * { url, type?: "rss"|"atom"|"ics", label?, actionTags?: string[], sectorCategories?: string[] }
 */

const path = require('path');
const { readFileSync, existsSync } = require('fs');
const { initializeApp, cert, getApps } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');

const PROJECT_ID = process.env.FIREBASE_PROJECT_ID || 'circeco-bf511';
const CITY_ALIASES = { torino: 'turin', milano: 'milan' };

const DEFAULT_CIRCULAR_KEYWORDS = [
  'second hand',
  'second-hand',
  'used',
  'pre-loved',
  'preloved',
  'swap',
  'swapping',
  'baratto',
  'reuse',
  'riuso',
  'kilo sale',
  'kilo sales',
  'vintage',
  'antique',
  'antiques',
  'mercatino',
  'flea market',
  'street market',
  'repair',
  'repair cafe',
  'fix',
  'riparazione',
  'aggiusta',
  'refurb',
  'ricondizionato',
  'recycle',
  'riciclo',
  'zero waste',
];

const ACTION_INTENT_KEYWORDS = {
  refuse: ['refuse', 'boycott', 'plastic free', 'senza plastica', 'rifiuta'],
  reuse: ['reuse', 'riuso', 'second hand', 'second-hand', 'usato', 'usati', 'swap', 'baratto', 'vintage', 'kilo sale', 'flea market', 'mercatino'],
  repair: ['repair', 'repair cafe', 'fix', 'mend', 'riparazione', 'ripara', 'aggiusta', 'refurb'],
  repurpose: ['repurpose', 'upcycle', 'upcycling', 'riuso creativo', 'restyling'],
  recycle: ['recycle', 'recycling', 'riciclo', 'raccolta differenziata'],
  reduce: ['reduce', 'riduzione', 'zero waste', 'waste less', 'spreco'],
};

const MONTHS = {
  january: 1, jan: 1, gennaio: 1,
  february: 2, feb: 2, febbraio: 2,
  march: 3, mar: 3, marzo: 3,
  april: 4, apr: 4, aprile: 4,
  may: 5, maggio: 5,
  june: 6, jun: 6, giugno: 6,
  july: 7, jul: 7, luglio: 7,
  august: 8, aug: 8, agosto: 8,
  september: 9, sep: 9, sept: 9, settembre: 9,
  october: 10, oct: 10, ottobre: 10,
  november: 11, nov: 11, novembre: 11,
  december: 12, dec: 12, dicembre: 12,
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
    console.error('[discover-events] No credentials. Add secrets/firebase-adminsdk.json or set GOOGLE_APPLICATION_CREDENTIALS.');
    process.exit(1);
  }
  const sa = JSON.parse(readFileSync(credPath, 'utf8'));
  initializeApp({ credential: cert(sa), projectId: sa.project_id || PROJECT_ID });
}

function parseArgs() {
  const out = { city: '', limit: 100, dryRun: false, maxPastDays: 0, feeds: [] };
  for (const a of process.argv.slice(2)) {
    if (a === '--dry-run') out.dryRun = true;
    else if (a.startsWith('--city=')) out.city = a.slice('--city='.length).trim().toLowerCase();
    else if (a.startsWith('--limit=')) out.limit = Math.max(1, parseInt(a.slice('--limit='.length), 10) || 100);
    else if (a.startsWith('--max-past-days=')) out.maxPastDays = Math.max(0, parseInt(a.slice('--max-past-days='.length), 10) || 0);
    else if (a.startsWith('--feed=')) {
      const value = a.slice('--feed='.length).trim();
      if (!value) continue;
      for (const raw of value.split(',')) {
        const url = raw.trim();
        if (url) out.feeds.push(url);
      }
    }
  }
  if (!out.city) {
    console.error('Usage: node tools/discover-event-feeds.js --city=milan [--feed=https://...] [--limit=100] [--max-past-days=0] [--dry-run]');
    process.exit(1);
  }
  out.city = CITY_ALIASES[out.city] || out.city;
  return out;
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

function decodeEntities(v) {
  return String(v || '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/&nbsp;/g, ' ');
}

function stripHtml(v) {
  return decodeEntities(String(v || '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}

function hashString(input) {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = (h >>> 0) * 0x01000193;
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

function feedTypeFromUrl(url) {
  return String(url || '').toLowerCase().includes('.ics') ? 'ics' : 'rss';
}

function normalizeFeed(feedLike) {
  if (typeof feedLike === 'string') {
    const url = feedLike.trim();
    if (!url) return null;
    return { url, type: feedTypeFromUrl(url), label: url, actionTags: [], sectorCategories: [] };
  }
  if (!feedLike || typeof feedLike !== 'object') return null;
  const url = String(feedLike.url || '').trim();
  if (!url) return null;
  const typeRaw = String(feedLike.type || feedLike.format || '').toLowerCase().trim();
  return {
    url,
    type: typeRaw === 'rss' || typeRaw === 'atom' || typeRaw === 'ics' ? typeRaw : feedTypeFromUrl(url),
    label: String(feedLike.label || feedLike.name || url),
    actionTags: Array.isArray(feedLike.actionTags) ? feedLike.actionTags.map((x) => String(x)) : [],
    sectorCategories: Array.isArray(feedLike.sectorCategories) ? feedLike.sectorCategories.map((x) => String(x)) : [],
  };
}

async function resolveFeeds(db, cityId, cliFeeds) {
  const out = [];
  const push = (f) => {
    const n = normalizeFeed(f);
    if (n && !out.some((x) => x.url === n.url)) out.push(n);
  };
  for (const f of cliFeeds) push(f);
  for (const f of String(process.env.DISCOVERY_EVENT_FEEDS || '').split(',').map((x) => x.trim()).filter(Boolean)) push(f);

  const citySnap = await db.collection('cities').doc(cityId).get();
  const city = citySnap.exists ? citySnap.data() || {} : {};
  if (Array.isArray(city.eventFeeds)) for (const f of city.eventFeeds) push(f);
  if (city.discovery && Array.isArray(city.discovery.eventFeeds)) for (const f of city.discovery.eventFeeds) push(f);
  return out;
}

async function loadCircularKeywords(db, cityId) {
  const keywords = new Set(DEFAULT_CIRCULAR_KEYWORDS.map((x) => x.toLowerCase()));
  for (const k of String(process.env.DISCOVERY_EVENT_KEYWORDS || '').split(',').map((x) => x.trim().toLowerCase()).filter(Boolean)) keywords.add(k);
  const citySnap = await db.collection('cities').doc(cityId).get();
  const city = citySnap.exists ? citySnap.data() || {} : {};
  if (Array.isArray(city.eventKeywords)) for (const k of city.eventKeywords) keywords.add(String(k || '').trim().toLowerCase());
  if (city.discovery && Array.isArray(city.discovery.eventKeywords)) for (const k of city.discovery.eventKeywords) keywords.add(String(k || '').trim().toLowerCase());
  return [...keywords].filter(Boolean);
}

function xmlFirstTag(xml, tags) {
  for (const tag of tags) {
    const safe = String(tag).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const rx = new RegExp(`<${safe}\\b[^>]*>([\\s\\S]*?)<\\/${safe}>`, 'i');
    const m = xml.match(rx);
    if (m && m[1]) return stripHtml(m[1]);
  }
  return '';
}

function extractXmlBlocks(xml, tagName) {
  const safe = String(tagName).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const rx = new RegExp(`<${safe}\\b[^>]*>[\\s\\S]*?<\\/${safe}>`, 'gi');
  return String(xml || '').match(rx) || [];
}

function atomHref(xml) {
  const m = String(xml).match(/<link\b[^>]*\bhref=["']([^"']+)["'][^>]*>/i);
  return m && m[1] ? String(m[1]).trim() : '';
}

function parseDateToIsoDay(v) {
  const raw = String(v || '').trim();
  if (!raw) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  if (/^\d{8}$/.test(raw)) return `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
  const compact = raw.match(/^(\d{8})(?:T\d{4,6}Z?)?$/);
  if (compact) return `${compact[1].slice(0, 4)}-${compact[1].slice(4, 6)}-${compact[1].slice(6, 8)}`;
  const dt = new Date(raw);
  if (!Number.isNaN(dt.getTime())) return dt.toISOString().slice(0, 10);
  return '';
}

function dateToIsoDay(year, month, day) {
  const y = Number(year), m = Number(month), d = Number(day);
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return '';
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return '';
  return dt.toISOString().slice(0, 10);
}

function extractDateFromText(text) {
  const raw = String(text || '').toLowerCase();
  if (!raw) return '';
  const nowYear = new Date().getUTCFullYear();
  const rangeMatch = raw.match(/\b(\d{1,2})\s*[-–]\s*(\d{1,2})\s+(gennaio|febbraio|marzo|aprile|maggio|giugno|luglio|agosto|settembre|ottobre|novembre|dicembre|january|february|march|april|may|june|july|august|september|october|november|december)\s*(\d{4})?\b/);
  if (rangeMatch) {
    const iso = dateToIsoDay(Number(rangeMatch[4] || nowYear), MONTHS[rangeMatch[3]], Number(rangeMatch[1]));
    if (iso) return iso;
  }
  const dayMonthMatch = raw.match(/\b(\d{1,2})\s+(gennaio|febbraio|marzo|aprile|maggio|giugno|luglio|agosto|settembre|ottobre|novembre|dicembre|january|february|march|april|may|june|july|august|september|october|november|december)\s*(\d{4})?\b/);
  if (dayMonthMatch) {
    const iso = dateToIsoDay(Number(dayMonthMatch[3] || nowYear), MONTHS[dayMonthMatch[2]], Number(dayMonthMatch[1]));
    if (iso) return iso;
  }
  const numericMatch = raw.match(/\b(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})\b/);
  if (numericMatch) {
    let year = Number(numericMatch[3]);
    if (year < 100) year += 2000;
    const iso = dateToIsoDay(year, Number(numericMatch[2]), Number(numericMatch[1]));
    if (iso) return iso;
  }
  return '';
}

function extractLocationFromText(text) {
  const raw = String(text || '').replace(/\s+/g, ' ').trim();
  if (!raw) return '';
  const viaMatch = raw.match(/\b(via|viale|piazza|piazzale|alzaia|corso)\s+[a-z0-9'’ .-]{3,80}(?:,\s*\d+[a-z]?)?(?:,\s*milano)?\b/i);
  if (viaMatch) return viaMatch[0].trim();
  const label = raw.match(/\b(location|where|dove)\s*[:\-]\s*([^.;\n]{4,120})/i);
  if (label && label[2]) return label[2].trim();
  return '';
}

function parseTimeDisplay(v) {
  const raw = String(v || '').trim();
  if (!raw) return '';
  const compact = raw.match(/T(\d{2})(\d{2})/);
  if (compact) return `${compact[1]}:${compact[2]}`;
  const dt = new Date(raw);
  if (!Number.isNaN(dt.getTime())) {
    const hh = String(dt.getUTCHours()).padStart(2, '0');
    const mm = String(dt.getUTCMinutes()).padStart(2, '0');
    if (hh !== '00' || mm !== '00') return `${hh}:${mm} UTC`;
  }
  return '';
}

function unfoldIcsLines(text) {
  const lines = String(text || '').replace(/\r/g, '').split('\n');
  const out = [];
  for (const line of lines) {
    if (!out.length) out.push(line);
    else if (line.startsWith(' ') || line.startsWith('\t')) out[out.length - 1] += line.slice(1);
    else out.push(line);
  }
  return out;
}

function parseIcs(text, feed) {
  const lines = unfoldIcsLines(text);
  const out = [];
  let cur = null;
  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') { cur = {}; continue; }
    if (line === 'END:VEVENT') {
      if (cur && cur.summary && cur.dtstart) {
        const startDate = parseDateToIsoDay(cur.dtstart);
        if (startDate) {
          out.push({
            sourceType: 'ics',
            sourceUrl: feed.url,
            externalId: cur.uid || `${cur.summary}|${startDate}|${cur.location || ''}`,
            title: stripHtml(cur.summary),
            startDate,
            endDate: parseDateToIsoDay(cur.dtend) || startDate,
            locationText: stripHtml(cur.location || ''),
            address: stripHtml(cur.location || ''),
            website: stripHtml(cur.url || feed.url),
            description: stripHtml(cur.description || '').slice(0, 2000),
            timeDisplay: parseTimeDisplay(cur.dtstart),
            evidenceSnippet: `feed=${feed.label}; summary=${stripHtml(cur.summary).slice(0, 100)}`,
            actionTags: feed.actionTags.slice(),
            sectorCategories: feed.sectorCategories.slice(),
          });
        }
      }
      cur = null;
      continue;
    }
    if (!cur) continue;
    const idx = line.indexOf(':');
    if (idx <= 0) continue;
    const key = line.slice(0, idx).split(';')[0].toLowerCase();
    const value = line.slice(idx + 1).trim();
    if (key === 'uid') cur.uid = value;
    else if (key === 'summary') cur.summary = value;
    else if (key === 'description') cur.description = value;
    else if (key === 'location') cur.location = value;
    else if (key === 'url') cur.url = value;
    else if (key === 'dtstart') cur.dtstart = value;
    else if (key === 'dtend') cur.dtend = value;
  }
  return out;
}

function parseRssOrAtom(text, feed) {
  const blocks = [...extractXmlBlocks(text, 'item'), ...extractXmlBlocks(text, 'entry')];
  const out = [];
  for (const block of blocks) {
    const title = xmlFirstTag(block, ['title']);
    if (!title) continue;
    const description = xmlFirstTag(block, ['description', 'summary', 'content', 'content:encoded']);
    const hint = `${title}\n${description}`;
    const startRaw = xmlFirstTag(block, ['startDate', 'ev:startDate', 'dc:date', 'published', 'updated', 'pubDate']);
    const startDate = parseDateToIsoDay(startRaw) || extractDateFromText(hint);
    if (!startDate) continue;
    const endRaw = xmlFirstTag(block, ['endDate', 'ev:endDate']);
    const location = xmlFirstTag(block, ['location', 'ev:where', 'address', 'venue', 'georss:featureName']) || extractLocationFromText(hint);
    const link = xmlFirstTag(block, ['link']) || atomHref(block) || feed.url;
    const guid = xmlFirstTag(block, ['guid', 'id']);
    out.push({
      sourceType: feed.type === 'ics' ? 'ics' : 'rss',
      sourceUrl: feed.url,
      externalId: guid || `${title}|${startDate}|${location}`,
      title,
      startDate,
      endDate: parseDateToIsoDay(endRaw) || startDate,
      locationText: location,
      address: location,
      website: String(link || '').trim(),
      description: description.slice(0, 2000),
      timeDisplay: parseTimeDisplay(startRaw),
      evidenceSnippet: `feed=${feed.label}; title=${title.slice(0, 100)}`,
      actionTags: feed.actionTags.slice(),
      sectorCategories: feed.sectorCategories.slice(),
    });
  }
  return out;
}

async function fetchText(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 25000);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        Accept: 'application/rss+xml, application/atom+xml, text/calendar, text/xml, application/xml;q=0.9, */*;q=0.5',
        'User-Agent': 'circeco-discovery-event-feeds/1.0',
      },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(timeout);
  }
}

function inferActionTags(title, description, existing, matchedActionHints = []) {
  const set = new Set((existing || []).map((x) => String(x || '').trim().toLowerCase()).filter(Boolean));
  for (const tag of matchedActionHints) set.add(String(tag || '').toLowerCase());
  const text = `${title || ''} ${description || ''}`.toLowerCase();
  if (/(repair|fix|mend|ripar|aggiusta|refurb)/.test(text)) set.add('repair');
  if (/(reuse|swap|second hand|second-hand|usato|usati|vintage)/.test(text)) set.add('reuse');
  if (/(recycl|ricicl)/.test(text)) set.add('recycle');
  if (/(reduce|riduz|zero waste|waste less)/.test(text)) set.add('reduce');
  if (/(repurpose|upcycl|riuso creativo)/.test(text)) set.add('repurpose');
  if (/(boycott|refuse|plastic free|senza plastica)/.test(text)) set.add('refuse');
  const allowed = ['refuse', 'reuse', 'repair', 'repurpose', 'recycle', 'reduce'];
  return [...set].filter((x) => allowed.includes(x)).slice(0, 3);
}

function circularSignals(title, description, keywords) {
  const text = `${title || ''} ${description || ''}`.toLowerCase();
  const matchedKeywords = [];
  for (const keyword of keywords) {
    if (keyword && text.includes(keyword) && !matchedKeywords.includes(keyword)) matchedKeywords.push(keyword);
    if (matchedKeywords.length >= 8) break;
  }
  const matchedActionTags = [];
  for (const [actionTag, hints] of Object.entries(ACTION_INTENT_KEYWORDS)) {
    if (hints.some((h) => text.includes(h)) && !matchedActionTags.includes(actionTag)) matchedActionTags.push(actionTag);
  }
  return { matchedKeywords, matchedActionTags };
}

function inferSectorCategories(title, description, existing, actionTags = []) {
  const set = new Set((existing || []).map((x) => String(x || '').trim().toLowerCase()).filter(Boolean));
  const text = `${title || ''} ${description || ''}`.toLowerCase();
  if (/(cloth|fashion|apparel|wardrobe|textile|abbigli|vestit)/.test(text)) set.add('apparel');
  if (/(furniture|home|garden|house|arredo|mobili)/.test(text)) set.add('home-garden');
  if (/(bike|bicycle|cycling|sport|cicl|sport)/.test(text)) set.add('cycling-sports');
  if (/(electronic|phone|laptop|computer|tech|elettron)/.test(text)) set.add('electronics');
  if (/(book|books|comic|magazine|libri|fumett|rivist)/.test(text)) set.add('books-comics-magazines');
  if (/(music|vinyl|record|strument|concerto)/.test(text)) set.add('music');
  if (set.size === 0) {
    const tags = new Set((actionTags || []).map((x) => String(x || '').trim().toLowerCase()).filter(Boolean));
    if (tags.has('repair')) set.add('electronics');
    if (tags.has('reuse')) set.add('apparel');
    if (tags.has('recycle') || tags.has('reduce') || tags.has('refuse') || tags.has('repurpose')) set.add('home-garden');
  }
  if (set.size === 0) set.add('home-garden');
  const allowed = ['apparel', 'home-garden', 'cycling-sports', 'electronics', 'books-comics-magazines', 'music'];
  return [...set].filter((x) => allowed.includes(x)).slice(0, 3);
}

function confidenceForEvent(candidate) {
  let c = 0.42;
  if (candidate.title) c += 0.14;
  if (candidate.startDate) c += 0.14;
  if (candidate.locationText) c += 0.08;
  if (candidate.description) c += 0.07;
  if (candidate.website) c += 0.06;
  if (candidate.actionTags && candidate.actionTags.length) c += 0.05;
  return Math.min(0.92, c);
}

function eventKey(cityId, title, startDate, locationText) {
  return `${cityId}|${normalizeText(title)}|${startDate}|${normalizeText(locationText)}`;
}

async function loadApprovedEventKeys(db, cityId) {
  const snap = await db.collection('events').where('cityId', '==', cityId).get();
  const keys = new Set();
  for (const d of snap.docs) {
    const row = d.data() || {};
    if (String(row.status || '').toLowerCase() !== 'approved') continue;
    const startDate = String(row.startDate || '').trim();
    const title = String(row.title || '').trim();
    const locationText = String(row.locationText || row.address || '').trim();
    if (!startDate || !title) continue;
    keys.add(eventKey(cityId, title, startDate, locationText));
  }
  return keys;
}

async function loadReviewedQueueEventIds(db, cityId) {
  const reviewedStates = ['approved', 'rejected', 'edited', 'superseded'];
  const snap = await db.collection('reviewQueue')
    .where('cityId', '==', cityId)
    .where('kind', '==', 'event')
    .where('status', 'in', reviewedStates)
    .get();
  const ids = new Set();
  for (const d of snap.docs) ids.add(d.id);
  return ids;
}

async function parseFeedEntries(feed) {
  const text = await fetchText(feed.url);
  if (feed.type === 'ics') return parseIcs(text, feed);
  return parseRssOrAtom(text, feed);
}

function nowIso() { return new Date().toISOString(); }
function isoDayOffset(days) {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

async function main() {
  const args = parseArgs();
  initAdminApp();
  const db = getFirestore();

  const feeds = await resolveFeeds(db, args.city, args.feeds);
  const circularKeywords = await loadCircularKeywords(db, args.city);
  console.log(`[discover-events] city=${args.city} dryRun=${args.dryRun} limit=${args.limit} maxPastDays=${args.maxPastDays} feeds=${feeds.length} circularKeywords=${circularKeywords.length}`);
  if (!feeds.length) {
    console.log(`[discover-events] no feeds configured for city=${args.city}; nothing to do.`);
    return;
  }

  const reviewedQueueIds = await loadReviewedQueueEventIds(db, args.city);
  const approvedKeys = await loadApprovedEventKeys(db, args.city);
  const minDate = isoDayOffset(-args.maxPastDays);

  const byDocId = new Map();
  const runSeenKeys = new Set();
  let fetchedRaw = 0;
  let skippedPast = 0;
  let skippedReviewed = 0;
  let skippedApprovedExisting = 0;
  let skippedRunDuplicates = 0;
  let skippedMissingLocation = 0;
  let skippedNotCircular = 0;
  let failedFeeds = 0;

  for (const feed of feeds) {
    try {
      const entries = await parseFeedEntries(feed);
      fetchedRaw += entries.length;
      for (const raw of entries) {
        if (!raw.title || !raw.startDate) continue;
        if (raw.startDate < minDate) { skippedPast++; continue; }

        let locationText = String(raw.locationText || raw.address || extractLocationFromText(`${raw.title || ''}\n${raw.description || ''}`)).trim();
        if (!locationText) {
          const cityHint = `${raw.title || ''} ${raw.description || ''}`.toLowerCase();
          if (cityHint.includes('milano') || cityHint.includes('milan')) locationText = 'Milan';
        }
        if (!locationText) { skippedMissingLocation++; continue; }

        const key = eventKey(args.city, raw.title, raw.startDate, locationText);
        if (approvedKeys.has(key)) { skippedApprovedExisting++; continue; }
        if (runSeenKeys.has(key)) { skippedRunDuplicates++; continue; }

        const stableKey = `${raw.sourceType}|${raw.sourceUrl}|${raw.externalId || `${raw.title}|${raw.startDate}|${locationText}`}`;
        const docId = `event_${args.city}_${hashString(stableKey)}`;
        if (reviewedQueueIds.has(docId)) { skippedReviewed++; continue; }

        const matchedCircular = circularSignals(raw.title, raw.description, circularKeywords);
        const actionTags = inferActionTags(raw.title, raw.description, raw.actionTags, matchedCircular.matchedActionTags);
        const hasCircular = matchedCircular.matchedKeywords.length > 0 || matchedCircular.matchedActionTags.length > 0 || actionTags.length > 0;
        if (!hasCircular) { skippedNotCircular++; continue; }

        const sectorCategories = inferSectorCategories(raw.title, raw.description, raw.sectorCategories, actionTags);
        const candidate = {
          title: raw.title.trim(),
          startDate: raw.startDate,
          endDate: raw.endDate || raw.startDate,
          locationText,
          address: String(raw.address || locationText).trim(),
          website: String(raw.website || '').trim(),
          description: String(raw.description || '').slice(0, 2000),
          timeDisplay: String(raw.timeDisplay || '').trim(),
          actionTags,
          sectorCategories,
        };

        byDocId.set(docId, {
          docId,
          payload: {
            kind: 'event',
            cityId: args.city,
            status: 'needs_review',
            confidence: confidenceForEvent(candidate),
            candidate,
            evidence: [
              {
                url: raw.website || raw.sourceUrl,
                snippet: `${String(raw.evidenceSnippet || '').slice(0, 140)}; circularSignals=${matchedCircular.matchedKeywords.slice(0, 3).join(',')}; actionTags=${matchedCircular.matchedActionTags.join(',')}`.trim(),
                capturedAt: nowIso(),
              },
            ],
            matchCandidates: [],
            updatedAt: FieldValue.serverTimestamp(),
            createdAt: FieldValue.serverTimestamp(),
          },
        });
        runSeenKeys.add(key);
      }
    } catch (e) {
      failedFeeds++;
      console.warn(`[discover-events] feed failed: ${feed.url}`, e && e.message ? e.message : e);
    }
  }

  const sorted = [...byDocId.values()].sort((a, b) => Number(b.payload.confidence || 0) - Number(a.payload.confidence || 0)).slice(0, args.limit);
  console.log(
    `[discover-events] fetched ${fetchedRaw} raw entries, ${byDocId.size} candidates after filters (` +
    `${skippedPast} past skipped; ${skippedReviewed} reviewed queue skipped; ${skippedApprovedExisting} existing approved skipped; ` +
    `${skippedRunDuplicates} run duplicates skipped; ${skippedMissingLocation} missing location skipped; ${skippedNotCircular} non-circular skipped; ` +
    `${failedFeeds} feeds failed); writing ${sorted.length} (limit ${args.limit})`
  );

  if (args.dryRun) {
    for (const row of sorted.slice(0, 20)) {
      const c = row.payload.candidate;
      console.log(`  [dry-run] ${row.docId} ${c.title} @ ${c.startDate} (${row.payload.confidence.toFixed(2)})`);
    }
    if (sorted.length > 20) console.log(`  ... ${sorted.length - 20} more`);
    return;
  }

  let written = 0;
  const batchSize = 400;
  for (let i = 0; i < sorted.length; i += batchSize) {
    const batch = db.batch();
    const chunk = sorted.slice(i, i + batchSize);
    for (const row of chunk) batch.set(db.collection('reviewQueue').doc(row.docId), row.payload, { merge: true });
    await batch.commit();
    written += chunk.length;
    console.log(`[discover-events] committed ${written}/${sorted.length}`);
  }
  console.log('[discover-events] done');
}

main().catch((err) => {
  console.error('[discover-events] failed', err);
  process.exitCode = 1;
});
