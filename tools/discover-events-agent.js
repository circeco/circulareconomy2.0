/* eslint-disable no-console */
/**
 * Automated event discovery agent (v1).
 *
 * Searches the open web for circular-economy events per city, extracts candidates
 * (JSON-LD Event, linked ICS/RSS, dated search snippets), applies circular + memory
 * gates, and writes to Firestore `reviewQueue` as kind=event.
 *
 * Usage:
 *   node tools/discover-events-agent.js --city=milan
 *   node tools/discover-events-agent.js --city=stockholm --limit=40 --dry-run
 *   node tools/discover-events-agent.js --city=milan --max-past-days=0
 */
const path = require('path');
const { readFileSync, existsSync } = require('fs');
const { initializeApp, cert, getApps } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const {
  hashString,
  normalizeText,
  eventDedupeKey,
  circularKeywordsFromCity,
  circularSignals,
  inferActionTags,
  confidenceForEvent,
  createEventMemoryLookup,
} = require('./lib/event-discovery-common');

const PROJECT_ID = process.env.FIREBASE_PROJECT_ID || 'circeco-bf511';
const CITY_ALIASES = { torino: 'turin', milano: 'milan' };
const USER_AGENT = 'circeco-discovery-events-agent/1.0 (+https://github.com/circeco/circulareconomy2.0)';
const MIN_CONFIDENCE_AFTER_MEMORY = 0.52;

const DEFAULT_CITY_QUERIES = {
  milan: [
    'repair cafe Milano',
    'mercatino dell usato Milano',
    'swap party Milano',
    'economia circolare evento Milano',
    'riparazione laboratorio Milano evento',
    'zero waste Milano evento',
  ],
  stockholm: [
    'repair cafe Stockholm',
    'second hand market Stockholm',
    'swap event Stockholm',
    'circular economy event Stockholm',
    'fixit clinic Stockholm',
    'loppis Stockholm event',
  ],
  turin: [
    'repair cafe Torino',
    'mercatino dell usato Torino',
    'swap party Torino',
    'economia circolare evento Torino',
  ],
  uppsala: [
    'repair cafe Uppsala',
    'second hand market Uppsala',
    'circular economy event Uppsala',
    'bytfest Uppsala',
  ],
};

const MONTHS = {
  january: 1, jan: 1, gennaio: 1,
  february: 2, feb: 2, febbraio: 2,
  march: 3, mar: 3, marzo: 3,
  april: 4, apr: 4, aprile: 4,
  may: 5, maggio: 5,
  june: 6, jun: 6, juni: 6, giugno: 6,
  july: 7, jul: 7, juli: 7, luglio: 7,
  august: 8, aug: 8, agosto: 8,
  september: 9, sep: 9, sept: 9, settembre: 9,
  october: 10, oct: 10, oktober: 10, ottobre: 10,
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
    console.error('[discover-events-agent] No credentials. Add secrets/firebase-adminsdk.json or set GOOGLE_APPLICATION_CREDENTIALS.');
    process.exit(1);
  }
  const sa = JSON.parse(readFileSync(credPath, 'utf8'));
  initializeApp({ credential: cert(sa), projectId: sa.project_id || PROJECT_ID });
}

function parseArgs() {
  const out = { city: '', limit: 80, dryRun: false, maxPastDays: 0, maxQueries: 6, maxPages: 12 };
  for (const a of process.argv.slice(2)) {
    if (a === '--dry-run') out.dryRun = true;
    else if (a.startsWith('--city=')) out.city = a.slice('--city='.length).trim().toLowerCase();
    else if (a.startsWith('--limit=')) out.limit = Math.max(1, parseInt(a.slice('--limit='.length), 10) || 80);
    else if (a.startsWith('--max-past-days=')) out.maxPastDays = Math.max(0, parseInt(a.slice('--max-past-days='.length), 10) || 0);
    else if (a.startsWith('--max-queries=')) out.maxQueries = Math.max(1, parseInt(a.slice('--max-queries='.length), 10) || 6);
    else if (a.startsWith('--max-pages=')) out.maxPages = Math.max(1, parseInt(a.slice('--max-pages='.length), 10) || 12);
  }
  if (!out.city) {
    console.error('Usage: node tools/discover-events-agent.js --city=milan [--limit=80] [--dry-run]');
    process.exit(1);
  }
  out.city = CITY_ALIASES[out.city] || out.city;
  return out;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function stripHtml(html) {
  return String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function decodeBasicEntities(s) {
  return String(s || '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x2F;/gi, '/');
}

function dateToIsoDay(year, month, day) {
  const y = Number(year);
  const m = Number(month);
  const d = Number(day);
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return '';
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return '';
  return dt.toISOString().slice(0, 10);
}

function parseDateToIsoDay(v) {
  const raw = String(v || '').trim();
  if (!raw) return '';
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10);
  const dt = new Date(raw);
  if (!Number.isNaN(dt.getTime())) return dt.toISOString().slice(0, 10);
  return '';
}

function extractDateFromText(text, { preferFuture = true } = {}) {
  const raw = String(text || '').toLowerCase();
  if (!raw) return '';
  const nowYear = new Date().getUTCFullYear();
  const today = isoDayOffset(0);
  const found = [];

  const push = (iso) => {
    if (iso) found.push(iso);
  };

  const dayMonthRx =
    /\b(\d{1,2})\s+(gennaio|febbraio|marzo|aprile|maggio|giugno|luglio|agosto|settembre|ottobre|novembre|dicembre|january|february|march|april|may|june|july|juli|august|september|october|oktober|november|december)\s*(\d{4})?\b/g;
  let m;
  while ((m = dayMonthRx.exec(raw))) {
    push(dateToIsoDay(Number(m[3] || nowYear), MONTHS[m[2]], Number(m[1])));
  }
  const numericRx = /\b(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})\b/g;
  while ((m = numericRx.exec(raw))) {
    let year = Number(m[3]);
    if (year < 100) year += 2000;
    push(dateToIsoDay(year, Number(m[2]), Number(m[1])));
  }
  const isoRx = /\b(20\d{2}-\d{2}-\d{2})\b/g;
  while ((m = isoRx.exec(raw))) push(m[1]);

  const unique = [...new Set(found.filter(Boolean))];
  if (!unique.length) return '';
  if (preferFuture) {
    const future = unique.filter((d) => d >= today).sort();
    if (future.length) return future[0];
  }
  return unique.sort().reverse()[0];
}

function extractLocationFromText(text, cityLabel) {
  const raw = String(text || '').replace(/\s+/g, ' ').trim();
  if (!raw) return '';
  const viaMatch = raw.match(/\b(via|viale|piazza|piazzale|corso|street|st\.|väg|gatan)\s+[a-z0-9'’ .-]{3,80}\b/i);
  if (viaMatch) return viaMatch[0].trim();
  const label = raw.match(/\b(location|where|dove|plats|address)\s*[:\-]\s*([^.;\n]{4,120})/i);
  if (label && label[2]) return label[2].trim();
  if (cityLabel && raw.toLowerCase().includes(String(cityLabel).toLowerCase())) return cityLabel;
  return '';
}

function isoDayOffset(days) {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

async function fetchText(url, accept) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: {
        Accept: accept || 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'User-Agent': USER_AGENT,
      },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return { finalUrl: res.url || url, text: await res.text() };
  } finally {
    clearTimeout(timeout);
  }
}

function absoluteUrl(base, href) {
  try {
    return new URL(href, base).toString();
  } catch {
    return '';
  }
}

async function searchDuckDuckGo(query) {
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  const { text } = await fetchText(url);
  const results = [];
  const rx = /<a[^>]+class="[^"]*result__a[^"]*"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?(?:class="result__snippet"[^>]*>([\s\S]*?)<\/(?:a|td|div)>)?/gi;
  let m;
  while ((m = rx.exec(text)) && results.length < 8) {
    let href = decodeBasicEntities(m[1]);
    // DDG sometimes wraps redirects
    const uddg = href.match(/[?&]uddg=([^&]+)/);
    if (uddg) {
      try {
        href = decodeURIComponent(uddg[1]);
      } catch {
        /* keep */
      }
    }
    if (!/^https?:\/\//i.test(href)) continue;
    if (/duckduckgo\.com/i.test(href)) continue;
    results.push({
      url: href,
      title: stripHtml(m[2]).slice(0, 200),
      snippet: stripHtml(m[3] || '').slice(0, 400),
    });
  }
  return results;
}

async function searchBingRss(query) {
  const url = `https://www.bing.com/search?format=rss&q=${encodeURIComponent(query)}`;
  try {
    const { text } = await fetchText(url, 'application/rss+xml, application/xml, text/xml, */*;q=0.5');
    const results = [];
    const items = text.match(/<item[\s\S]*?<\/item>/gi) || [];
    for (const item of items.slice(0, 8)) {
      const title = stripHtml((item.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || '');
      const link = stripHtml((item.match(/<link[^>]*>([\s\S]*?)<\/link>/i) || [])[1] || '');
      const snippet = stripHtml((item.match(/<description[^>]*>([\s\S]*?)<\/description>/i) || [])[1] || '');
      if (!link || !/^https?:\/\//i.test(link)) continue;
      results.push({ url: link, title: title.slice(0, 200), snippet: snippet.slice(0, 400) });
    }
    return results;
  } catch {
    return [];
  }
}

async function searchWeb(query) {
  try {
    const ddg = await searchDuckDuckGo(query);
    if (ddg.length) return { engine: 'duckduckgo', results: ddg };
  } catch (e) {
    console.warn('[discover-events-agent] duckduckgo search failed:', e.message || e);
  }
  try {
    const bing = await searchBingRss(query);
    if (bing.length) return { engine: 'bing-rss', results: bing };
  } catch (e) {
    console.warn('[discover-events-agent] bing search failed:', e.message || e);
  }
  return { engine: 'none', results: [] };
}

function extractJsonLdEvents(html, pageUrl) {
  const out = [];
  const scripts = String(html || '').match(/<script[^>]*type=["']application\/ld\+json["'][^>]*>[\s\S]*?<\/script>/gi) || [];
  for (const block of scripts) {
    const raw = block.replace(/^[\s\S]*?>/, '').replace(/<\/script>$/i, '');
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      continue;
    }
    const nodes = Array.isArray(parsed) ? parsed : [parsed];
    const stack = [...nodes];
    while (stack.length) {
      const node = stack.pop();
      if (!node || typeof node !== 'object') continue;
      if (Array.isArray(node['@graph'])) stack.push(...node['@graph']);
      const types = [].concat(node['@type'] || []).map((x) => String(x).toLowerCase());
      if (!types.some((t) => t === 'event' || t.endsWith('/event'))) continue;
      const title = String(node.name || node.headline || '').trim();
      const startDate = parseDateToIsoDay(node.startDate || node.startTime || '');
      if (!title || !startDate) continue;
      const locationObj = node.location || {};
      const locationText =
        typeof locationObj === 'string'
          ? locationObj
          : String(locationObj.name || locationObj.address?.streetAddress || locationObj.address || '').trim();
      out.push({
        sourceType: 'jsonld',
        sourceUrl: pageUrl,
        externalId: String(node['@id'] || node.url || `${title}|${startDate}|${locationText}`),
        title,
        startDate,
        endDate: parseDateToIsoDay(node.endDate || '') || startDate,
        locationText,
        address: locationText,
        website: String(node.url || pageUrl).trim(),
        description: String(node.description || '').slice(0, 2000),
        timeDisplay: '',
        evidenceSnippet: `jsonld event on ${pageUrl}`,
      });
    }
  }
  return out;
}

function extractFeedLinks(html, pageUrl) {
  const links = [];
  const rx = /<a[^>]+href=["']([^"']+\.(?:ics|rss|atom)(?:\?[^"']*)?)["'][^>]*>/gi;
  let m;
  while ((m = rx.exec(html))) {
    const abs = absoluteUrl(pageUrl, m[1]);
    if (abs) links.push(abs);
  }
  const alt = /<link[^>]+type=["']application\/(rss|atom)\+xml["'][^>]+href=["']([^"']+)["']/gi;
  while ((m = alt.exec(html))) {
    const abs = absoluteUrl(pageUrl, m[2]);
    if (abs) links.push(abs);
  }
  const ical = /<link[^>]+href=["']([^"']+)["'][^>]+type=["']text\/calendar["']/gi;
  while ((m = ical.exec(html))) {
    const abs = absoluteUrl(pageUrl, m[1]);
    if (abs) links.push(abs);
  }
  // Common calendar subscribe query params
  const calQ = /<a[^>]+href=["']([^"']*(?:ical|calendar\.ics|format=ics|output=xml)[^"']*)["'][^>]*>/gi;
  while ((m = calQ.exec(html))) {
    const abs = absoluteUrl(pageUrl, m[1]);
    if (abs) links.push(abs);
  }
  return [...new Set(links)].slice(0, 6);
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

function parseRssOrAtom(text, sourceUrl) {
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
    const location = xmlFirstTag(block, ['location', 'ev:where', 'address', 'venue']) || extractLocationFromText(hint, '');
    const link = xmlFirstTag(block, ['link']) || sourceUrl;
    out.push({
      sourceType: 'rss',
      sourceUrl,
      externalId: xmlFirstTag(block, ['guid', 'id']) || `${title}|${startDate}|${location}`,
      title,
      startDate,
      endDate: startDate,
      locationText: location,
      address: location,
      website: String(link || sourceUrl).trim(),
      description: description.slice(0, 2000),
      timeDisplay: '',
      evidenceSnippet: `rss/atom from ${sourceUrl}`,
    });
  }
  return out;
}

function extractHeuristicEventsFromHtml(html, pageUrl, cityLabel, keywords) {
  const out = [];
  const text = stripHtml(html);
  if (!text || text.length < 40) return out;
  // Split into rough chunks around headings / sentences with dates.
  const chunks = [];
  const headingBlocks = String(html || '').match(/<h[1-4][^>]*>[\s\S]*?<\/h[1-4]>[\s\S]{0,500}/gi) || [];
  for (const block of headingBlocks) chunks.push(stripHtml(block));
  const timeBlocks = String(html || '').match(/<time[^>]*>[\s\S]{0,300}/gi) || [];
  for (const block of timeBlocks) chunks.push(stripHtml(block));
  if (!chunks.length) {
    // Fallback: scan sliding windows around circular keywords
    const lower = text.toLowerCase();
    for (const kw of keywords.slice(0, 20)) {
      let idx = lower.indexOf(kw);
      let guard = 0;
      while (idx >= 0 && guard < 3) {
        chunks.push(text.slice(Math.max(0, idx - 80), Math.min(text.length, idx + 220)));
        idx = lower.indexOf(kw, idx + kw.length);
        guard += 1;
      }
    }
  }

  const seen = new Set();
  for (const chunk of chunks) {
    const matched = circularSignals(chunk, '', keywords);
    if (!matched.matchedKeywords.length && !matched.matchedActionTags.length) continue;
    const startDate = extractDateFromText(chunk);
    if (!startDate) continue;
    const titleMatch = chunk.match(/^(.{12,120}?)(?:\.|\n|$)/);
    const title = String(titleMatch ? titleMatch[1] : chunk)
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 140);
    if (!title || title.length < 12) continue;
    const locationText = extractLocationFromText(chunk, cityLabel) || cityLabel;
    const key = `${normalizeText(title)}|${startDate}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      sourceType: 'html_heuristic',
      sourceUrl: pageUrl,
      externalId: key,
      title,
      startDate,
      endDate: startDate,
      locationText,
      address: locationText,
      website: pageUrl,
      description: chunk.slice(0, 2000),
      timeDisplay: '',
      evidenceSnippet: `html heuristic on ${pageUrl}; kw=${matched.matchedKeywords.slice(0, 2).join(',')}`,
    });
  }
  return out.slice(0, 15);
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

function parseIcs(text, sourceUrl) {
  const lines = unfoldIcsLines(text);
  const out = [];
  let cur = null;
  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') {
      cur = {};
      continue;
    }
    if (line === 'END:VEVENT') {
      if (cur && cur.summary && cur.dtstart) {
        const startDate = parseDateToIsoDay(cur.dtstart);
        if (startDate) {
          out.push({
            sourceType: 'ics',
            sourceUrl,
            externalId: cur.uid || `${cur.summary}|${startDate}|${cur.location || ''}`,
            title: stripHtml(cur.summary),
            startDate,
            endDate: parseDateToIsoDay(cur.dtend) || startDate,
            locationText: stripHtml(cur.location || ''),
            address: stripHtml(cur.location || ''),
            website: stripHtml(cur.url || sourceUrl),
            description: stripHtml(cur.description || '').slice(0, 2000),
            timeDisplay: '',
            evidenceSnippet: `ics from ${sourceUrl}`,
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

function candidateFromSnippet(hit, cityLabel) {
  const blob = `${hit.title}\n${hit.snippet}`;
  const startDate = extractDateFromText(blob);
  if (!startDate) return null;
  const locationText = extractLocationFromText(blob, cityLabel) || cityLabel;
  return {
    sourceType: 'web_snippet',
    sourceUrl: hit.url,
    externalId: `${hit.title}|${startDate}|${locationText}`,
    title: hit.title || stripHtml(hit.snippet).slice(0, 120),
    startDate,
    endDate: startDate,
    locationText,
    address: locationText,
    website: hit.url,
    description: hit.snippet.slice(0, 2000),
    timeDisplay: '',
    evidenceSnippet: `search snippet; url=${hit.url}`,
  };
}

async function loadApprovedEventKeys(db, cityId) {
  const snap = await db.collection('events').where('cityId', '==', cityId).where('status', '==', 'approved').get();
  const keys = new Set();
  for (const d of snap.docs) {
    const row = d.data() || {};
    const title = String(row.title || '').trim();
    const startDate = String(row.startDate || '').trim();
    const locationText = String(row.locationText || row.address || '').trim();
    if (!startDate || !title) continue;
    keys.add(eventDedupeKey(cityId, title, startDate, locationText));
  }
  return keys;
}

async function loadReviewedQueueEventIds(db, cityId) {
  const reviewedStates = ['approved', 'rejected', 'edited', 'superseded'];
  const snap = await db
    .collection('reviewQueue')
    .where('cityId', '==', cityId)
    .where('kind', '==', 'event')
    .where('status', 'in', reviewedStates)
    .get();
  return new Set(snap.docs.map((d) => d.id));
}

function resolveQueries(cityId, cityDoc) {
  const fromCity = []
    .concat(cityDoc?.discovery?.eventSearchQueries || [])
    .concat(cityDoc?.eventSearchQueries || [])
    .map((x) => String(x || '').trim())
    .filter(Boolean);
  const defaults = DEFAULT_CITY_QUERIES[cityId] || [
    `repair cafe ${cityId}`,
    `second hand market ${cityId}`,
    `circular economy event ${cityId}`,
  ];
  return [...new Set(fromCity.length ? fromCity : defaults)];
}

function resolveSeedUrls(cityDoc) {
  return []
    .concat(cityDoc?.discovery?.eventSeedUrls || [])
    .concat(cityDoc?.eventSeedUrls || [])
    .map((x) => String(x || '').trim())
    .filter((u) => /^https?:\/\//i.test(u));
}

async function main() {
  const args = parseArgs();
  initAdminApp();
  const db = getFirestore();

  const citySnap = await db.collection('cities').doc(args.city).get();
  const cityDoc = citySnap.exists ? citySnap.data() || {} : {};
  const cityLabel = String(cityDoc.name || args.city);
  const keywords = circularKeywordsFromCity(cityDoc);
  const queries = resolveQueries(args.city, cityDoc).slice(0, args.maxQueries);
  const seedUrls = resolveSeedUrls(cityDoc);

  console.log(
    `[discover-events-agent] city=${args.city} dryRun=${args.dryRun} limit=${args.limit} maxPastDays=${args.maxPastDays} queries=${queries.length} seeds=${seedUrls.length} keywords=${keywords.length}`
  );

  const reviewedQueueIds = await loadReviewedQueueEventIds(db, args.city);
  const approvedKeys = await loadApprovedEventKeys(db, args.city);
  const memoryLookup = await createEventMemoryLookup(db, args.city);
  const minDate = isoDayOffset(-args.maxPastDays);

  const rawCandidates = [];
  const pageUrls = new Set(seedUrls);
  let searchHits = 0;
  let pagesFetched = 0;
  let feedsParsed = 0;
  let searchFailures = 0;

  for (const query of queries) {
    const { engine, results } = await searchWeb(query);
    console.log(`[discover-events-agent] query="${query}" engine=${engine} hits=${results.length}`);
    if (!results.length) searchFailures += 1;
    for (const hit of results) {
      searchHits += 1;
      pageUrls.add(hit.url);
      const fromSnippet = candidateFromSnippet(hit, cityLabel);
      if (fromSnippet) rawCandidates.push(fromSnippet);
    }
    await sleep(800);
  }

  let pageCount = 0;
  for (const pageUrl of pageUrls) {
    if (pageCount >= args.maxPages) break;
    pageCount += 1;
    try {
      const { finalUrl, text } = await fetchText(pageUrl);
      pagesFetched += 1;
      for (const ev of extractJsonLdEvents(text, finalUrl)) rawCandidates.push(ev);
      for (const ev of extractHeuristicEventsFromHtml(text, finalUrl, cityLabel, keywords)) rawCandidates.push(ev);
      for (const feedUrl of extractFeedLinks(text, finalUrl)) {
        try {
          const feed = await fetchText(feedUrl, 'text/calendar, application/rss+xml, application/xml, text/xml, */*;q=0.5');
          feedsParsed += 1;
          if (/BEGIN:VCALENDAR|BEGIN:VEVENT/i.test(feed.text)) {
            for (const ev of parseIcs(feed.text, feedUrl)) rawCandidates.push(ev);
          } else if (/<rss[\s>]|<feed[\s>]/i.test(feed.text)) {
            for (const ev of parseRssOrAtom(feed.text, feedUrl)) rawCandidates.push(ev);
          }
        } catch (e) {
          console.warn(`[discover-events-agent] feed fetch failed ${feedUrl}:`, e.message || e);
        }
      }
    } catch (e) {
      console.warn(`[discover-events-agent] page fetch failed ${pageUrl}:`, e.message || e);
    }
    await sleep(400);
  }

  const byDocId = new Map();
  const runSeenKeys = new Set();
  let skippedPast = 0;
  let skippedReviewed = 0;
  let skippedApproved = 0;
  let skippedRunDup = 0;
  let skippedMissingLocation = 0;
  let skippedNotCircular = 0;
  let skippedMemoryHard = 0;
  let skippedMemorySoft = 0;
  let memoryPenalties = 0;

  for (const raw of rawCandidates) {
    if (!raw.title || !raw.startDate) continue;
    if (raw.startDate < minDate) {
      skippedPast += 1;
      continue;
    }
    let locationText = String(raw.locationText || raw.address || '').trim();
    if (!locationText) locationText = extractLocationFromText(`${raw.title}\n${raw.description || ''}`, cityLabel);
    if (!locationText) {
      skippedMissingLocation += 1;
      continue;
    }

    const matched = circularSignals(raw.title, raw.description, keywords);
    const actionTags = inferActionTags(raw.title, raw.description, matched.matchedActionTags);
    const hasCircular = matched.matchedKeywords.length > 0 || actionTags.length > 0;
    if (!hasCircular) {
      skippedNotCircular += 1;
      continue;
    }

    const key = eventDedupeKey(args.city, raw.title, raw.startDate, locationText);
    if (approvedKeys.has(key)) {
      skippedApproved += 1;
      continue;
    }
    if (runSeenKeys.has(key)) {
      skippedRunDup += 1;
      continue;
    }

    const stableKey = `${raw.sourceType}|${raw.sourceUrl}|${raw.externalId || key}`;
    const docId = `event_${args.city}_${hashString(stableKey)}`;
    if (reviewedQueueIds.has(docId)) {
      skippedReviewed += 1;
      continue;
    }

    const candidate = {
      title: String(raw.title).trim(),
      startDate: raw.startDate,
      endDate: raw.endDate || raw.startDate,
      locationText,
      address: String(raw.address || locationText).trim(),
      website: String(raw.website || raw.sourceUrl || '').trim(),
      description: String(raw.description || '').slice(0, 2000),
      timeDisplay: String(raw.timeDisplay || '').trim(),
      actionTags,
      sectorCategories: [],
      source: 'web_agent',
    };

    const memorySignal = await memoryLookup.assess(candidate);
    if (memorySignal.hardDuplicate) {
      skippedMemoryHard += 1;
      continue;
    }

    let confidence = confidenceForEvent(candidate, matched.matchedKeywords.length);
    if (memorySignal.penalty > 0) {
      confidence = Math.max(0.05, confidence - memorySignal.penalty);
      memoryPenalties += 1;
      if (confidence < MIN_CONFIDENCE_AFTER_MEMORY) {
        skippedMemorySoft += 1;
        continue;
      }
    }

    byDocId.set(docId, {
      docId,
      payload: {
        kind: 'event',
        cityId: args.city,
        status: 'needs_review',
        confidence,
        candidate,
        evidence: [
          {
            url: candidate.website || raw.sourceUrl,
            snippet: `${String(raw.evidenceSnippet || '').slice(0, 140)}; circular=${matched.matchedKeywords.slice(0, 3).join(',')}; actions=${actionTags.join(',')}${
              memorySignal.reasons.length ? `; memory=${memorySignal.reasons.join(',')}` : ''
            }`,
            capturedAt: new Date().toISOString(),
          },
        ],
        matchCandidates: [],
        updatedAt: FieldValue.serverTimestamp(),
        createdAt: FieldValue.serverTimestamp(),
      },
    });
    runSeenKeys.add(key);
  }

  const sorted = [...byDocId.values()]
    .sort((a, b) => Number(b.payload.confidence || 0) - Number(a.payload.confidence || 0))
    .slice(0, args.limit);

  console.log(
    `[discover-events-agent] fetched ${rawCandidates.length} raw entries, ${byDocId.size} candidates after filters (` +
      `${skippedPast} past skipped; ${skippedReviewed} reviewed queue skipped; ${skippedApproved} existing approved skipped; ` +
      `${skippedRunDup} run duplicates skipped; ${skippedMissingLocation} missing location skipped; ${skippedNotCircular} non-circular skipped; ` +
      `${skippedMemoryHard} hard memory skips; ${skippedMemorySoft} soft-memory confidence skips; ${memoryPenalties} soft-memory penalties; ` +
      `${searchFailures} queries without hits; pages=${pagesFetched}; feedsParsed=${feedsParsed}; searchHits=${searchHits}); writing ${sorted.length} (limit ${args.limit})`
  );

  if (args.dryRun) {
    for (const row of sorted.slice(0, 25)) {
      const c = row.payload.candidate;
      console.log(`  [dry-run] ${row.docId} ${c.title} @ ${c.startDate} (${row.payload.confidence.toFixed(2)}) ${c.website}`);
    }
    if (sorted.length > 25) console.log(`  ... ${sorted.length - 25} more`);
    return;
  }

  let written = 0;
  for (const row of sorted) {
    await db.collection('reviewQueue').doc(row.docId).set(row.payload, { merge: true });
    written += 1;
  }
  console.log(`[discover-events-agent] committed ${written}/${sorted.length}`);
  console.log('[discover-events-agent] done');
}

main().catch((err) => {
  console.error('[discover-events-agent] failed', err);
  process.exitCode = 1;
});
