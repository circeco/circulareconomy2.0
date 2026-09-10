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
  isCircularEventCandidate,
  inferActionTags,
  confidenceForEvent,
  createEventMemoryLookup,
  envBlockDomains,
  isBlockedHost,
  hostFromUrl,
  matchEventGeography,
} = require('./lib/event-discovery-common');
const {
  MAX_QUERIES_HARD_CAP,
  queryPenaltyFor,
  queryYieldToObject,
  resolveEventDiscoveryPlan,
  seedId,
} = require('./lib/event-discovery-queries');

const PROJECT_ID = process.env.FIREBASE_PROJECT_ID || 'circeco-bf511';
const CITY_ALIASES = {
  torino: 'turin',
  milano: 'milan',
  malmö: 'malmo',
  malmoe: 'malmo',
  gothenburg: 'goteborg',
  göteborg: 'goteborg',
};
const USER_AGENT = 'circeco-discovery-events-agent/1.0 (+https://github.com/circeco/circulareconomy2.0)';
const MIN_CONFIDENCE_AFTER_MEMORY = 0.52;

const MONTHS = {
  january: 1, jan: 1, gennaio: 1, januari: 1,
  february: 2, feb: 2, febbraio: 2, februari: 2,
  march: 3, mar: 3, marzo: 3, mars: 3,
  april: 4, apr: 4, aprile: 4,
  may: 5, maggio: 5, maj: 5,
  june: 6, jun: 6, juni: 6, giugno: 6,
  july: 7, jul: 7, juli: 7, luglio: 7,
  august: 8, aug: 8, agosto: 8, augusti: 8,
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
  const out = { city: '', limit: 80, dryRun: false, maxPastDays: 0, maxQueries: 20, maxPages: 18 };
  for (const a of process.argv.slice(2)) {
    if (a === '--dry-run') out.dryRun = true;
    else if (a.startsWith('--city=')) out.city = a.slice('--city='.length).trim().toLowerCase();
    else if (a.startsWith('--limit=')) out.limit = Math.max(1, parseInt(a.slice('--limit='.length), 10) || 80);
    else if (a.startsWith('--max-past-days=')) out.maxPastDays = Math.max(0, parseInt(a.slice('--max-past-days='.length), 10) || 0);
    else if (a.startsWith('--max-queries=')) out.maxQueries = Math.max(1, parseInt(a.slice('--max-queries='.length), 10) || 20);
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

function collectDatesFromText(text, { requireYear = false } = {}) {
  const raw = String(text || '').toLowerCase();
  if (!raw) return [];
  const nowYear = new Date().getUTCFullYear();
  const found = [];
  const push = (iso) => {
    if (iso) found.push(iso);
  };

  const dayMonthRx =
    /\b(\d{1,2})\s+(gennaio|febbraio|marzo|aprile|maggio|giugno|luglio|agosto|settembre|ottobre|novembre|dicembre|january|february|march|april|may|june|july|juli|august|augusti|september|october|oktober|november|december|januari|februari|mars|maj|juni)\s*(\d{4})?\b/g;
  let m;
  while ((m = dayMonthRx.exec(raw))) {
    if (requireYear && !m[3]) continue;
    push(dateToIsoDay(Number(m[3] || nowYear), MONTHS[m[2]], Number(m[1])));
  }
  const weekdayRx =
    /\b(?:domenica|luned[iì]|marted[iì]|mercoled[iì]|gioved[iì]|venerd[iì]|sabato|söndag|sondag|måndag|mandag|tisdag|onsdag|torsdag|fredag|lördag|lordag)\s+(\d{1,2})\s+(gennaio|febbraio|marzo|aprile|maggio|giugno|luglio|agosto|settembre|ottobre|novembre|dicembre|january|february|march|april|may|june|july|august|augusti|september|october|oktober|november|december|januari|februari|mars|maj|juni)\s*(\d{4})?\b/gi;
  while ((m = weekdayRx.exec(raw))) {
    if (requireYear && !m[3]) continue;
    push(dateToIsoDay(Number(m[3] || nowYear), MONTHS[String(m[2]).toLowerCase()], Number(m[1])));
  }
  const numericRx = /\b(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})\b/g;
  while ((m = numericRx.exec(raw))) {
    let year = Number(m[3]);
    if (year < 100) year += 2000;
    push(dateToIsoDay(year, Number(m[2]), Number(m[1])));
  }
  const isoRx = /\b(20\d{2}-\d{2}-\d{2})\b/g;
  while ((m = isoRx.exec(raw))) push(m[1]);
  return [...new Set(found.filter(Boolean))].sort();
}

function extractDateFromText(text, { preferFuture = true, requireYear = false } = {}) {
  const unique = collectDatesFromText(text, { requireYear });
  if (!unique.length) return '';
  const today = isoDayOffset(0);
  if (preferFuture) {
    const future = unique.filter((d) => d >= today);
    if (future.length) return future[0];
  }
  return unique[unique.length - 1];
}

function looksLikeJunkEventTitle(title) {
  const t = String(title || '').trim();
  if (!t || t.length < 12) return true;
  // Quotes / celebrity one-liners / pure month labels without event framing.
  if (/[“”"]/.test(t) && !/(swap|party|mercato|mercatino|repair|evento|event|loppis)/i.test(t)) return true;
  if (/^(coco chanel|bacheca|news\s*&)/i.test(t)) return true;
  return false;
}

function extractLocationFromText(text, cityLabel) {
  const raw = String(text || '').replace(/\s+/g, ' ').trim();
  if (!raw) return '';
  const viaMatch = raw.match(/\b(via|viale|piazza|piazzale|corso|alzaia|street|st\.|väg|gatan|vägen)\s+[a-z0-9'’ .-]{3,80}\b/i);
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
  const pageCircular = circularSignals(text.slice(0, 4000), '', keywords);
  const pageIsCircular = pageCircular.matchedKeywords.length > 0 || pageCircular.matchedActionTags.length > 0;

  // Prefer dated heading/time chunks — do NOT explode every date found on a circular page
  // (that invented Swap-in-the-City day dates from unrelated page text).
  const chunks = [];
  const headingBlocks = String(html || '').match(/<h[1-4][^>]*>[\s\S]*?<\/h[1-4]>[\s\S]{0,500}/gi) || [];
  for (const block of headingBlocks) chunks.push(stripHtml(block));
  const timeBlocks = String(html || '').match(/<time[^>]*>[\s\S]{0,300}/gi) || [];
  for (const block of timeBlocks) chunks.push(stripHtml(block));
  if (!chunks.length) {
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
    // Require an explicit year in the chunk so month labels / stray day numbers don't invent dates.
    const startDate = extractDateFromText(chunk, { requireYear: true });
    if (!startDate) continue;
    const titleMatch = chunk.match(/^(.{12,120}?)(?:\.|\n|$)/);
    const title = String(titleMatch ? titleMatch[1] : chunk)
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 140);
    if (looksLikeJunkEventTitle(title)) continue;
    const locationText = extractLocationFromText(chunk, cityLabel) || '';
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

  // Optional: explicit full dates next to circular keywords on otherwise thin pages.
  if (!out.length && pageIsCircular) {
    const today = isoDayOffset(0);
    const lower = text.toLowerCase();
    for (const kw of pageCircular.matchedKeywords.slice(0, 6)) {
      let idx = lower.indexOf(kw);
      let guard = 0;
      while (idx >= 0 && guard < 2) {
        const window = text.slice(Math.max(0, idx - 60), Math.min(text.length, idx + 160));
        const dates = collectDatesFromText(window, { requireYear: true }).filter((d) => d >= today);
        for (const startDate of dates.slice(0, 2)) {
          const title = window.replace(/\s+/g, ' ').trim().slice(0, 140);
          if (looksLikeJunkEventTitle(title)) continue;
          const key = `${normalizeText(title)}|${startDate}`;
          if (seen.has(key)) continue;
          seen.add(key);
          out.push({
            sourceType: 'html_keyword_date',
            sourceUrl: pageUrl,
            externalId: key,
            title,
            startDate,
            endDate: startDate,
            locationText: extractLocationFromText(window, cityLabel) || '',
            address: extractLocationFromText(window, cityLabel) || '',
            website: pageUrl,
            description: window.slice(0, 2000),
            timeDisplay: '',
            evidenceSnippet: `html keyword-date on ${pageUrl}; kw=${kw}`,
          });
        }
        idx = lower.indexOf(kw, idx + kw.length);
        guard += 1;
      }
    }
  }

  return out.slice(0, 20);
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

function candidateFromSnippet(hit, cityLabel, query) {
  const blob = `${hit.title}\n${hit.snippet}`;
  const startDate = extractDateFromText(blob);
  if (!startDate) return null;
  const locationText = extractLocationFromText(blob, cityLabel) || '';
  const q = String(query || '').trim();
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
    query: q,
    eventQueries: q ? [q] : [],
    evidenceSnippet: `search snippet; query=${q}; url=${hit.url}`,
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

function uniqIds(values) {
  const out = [];
  for (const v of values || []) {
    const s = String(v || '').trim();
    if (!s || out.includes(s)) continue;
    out.push(s);
  }
  return out;
}

function pageKey(url) {
  return String(url || '').trim();
}

function rememberPage(map, url, extra = {}) {
  const key = pageKey(url);
  if (!key) return;
  const cur = map.get(key) || { queries: [], seedUrl: '' };
  for (const q of [].concat(extra.query || []).concat(extra.queries || [])) {
    const s = String(q || '').trim();
    if (s && !cur.queries.includes(s)) cur.queries.push(s);
  }
  if (extra.seedUrl) cur.seedUrl = extra.seedUrl;
  map.set(key, cur);
}

function copyPageAttr(map, from, to) {
  const src = map.get(pageKey(from));
  if (!src) return;
  rememberPage(map, to, { queries: src.queries, seedUrl: src.seedUrl });
}

function eventQueriesFor(raw, pageAttr, pageUrl) {
  const ids = [];
  if (raw.query) ids.push(String(raw.query).trim());
  if (Array.isArray(raw.eventQueries)) ids.push(...raw.eventQueries);
  for (const key of [pageUrl, raw.sourceUrl, raw.website].map(pageKey).filter(Boolean)) {
    const attr = pageAttr.get(key);
    if (!attr) continue;
    ids.push(...attr.queries);
    if (attr.seedUrl) ids.push(seedId(attr.seedUrl));
  }
  return uniqIds(ids);
}

function bumpYield(map, ids, field) {
  for (const id of ids || []) {
    const row = map.get(id) || { fetched: 0, queued: 0 };
    row[field] += 1;
    map.set(id, row);
  }
}

function mergeEventQueries(payload, ids) {
  const next = uniqIds([...(payload.eventQueries || []), ...(payload.candidate?.eventQueries || []), ...ids]);
  payload.eventQueries = next;
  if (payload.candidate) payload.candidate.eventQueries = next;
}

async function persistEventRun(db, city, summary) {
  const runId = `events_${city}_${Date.now()}`;
  await db.collection('discoveryRuns').doc(runId).set(
    {
      runId,
      cityId: city,
      sourceSet: ['events-agent'],
      startedAt: summary.at,
      finishedAt: summary.at,
      status: summary.status,
      dryRun: summary.dryRun,
      fetchedCount: summary.fetchedCount,
      queuedCount: summary.queuedCount,
      events: summary,
      config: { limit: summary.limit, maxQueries: summary.maxQueries, maxPages: summary.maxPages },
      updatedAt: FieldValue.serverTimestamp(),
      createdAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );
  if (summary.dryRun) return;
  try {
    await db.collection('cities').doc(city).update({
      'discovery.lastEventRun': summary,
      updatedAt: FieldValue.serverTimestamp(),
    });
  } catch (e) {
    console.warn('[discover-events-agent] could not write cities.discovery.lastEventRun', e.message || e);
  }
}

function resolveBlockedDomains(plan) {
  const enabled = (plan.blocks && plan.blocks.enabled ? plan.blocks.enabled : []).map((c) => c.id);
  return [...new Set(enabled.concat(envBlockDomains()))];
}

async function main() {
  const args = parseArgs();
  initAdminApp();
  const db = getFirestore();

  const citySnap = await db.collection('cities').doc(args.city).get();
  const cityDoc = citySnap.exists ? citySnap.data() || {} : {};
  let globalDoc = {};
  try {
    const globalSnap = await db.collection('discoveryConfig').doc('eventDiscovery').get();
    if (globalSnap.exists) globalDoc = globalSnap.data() || {};
  } catch (e) {
    console.warn('[discover-events-agent] could not read discoveryConfig/eventDiscovery', e.message || e);
  }
  const plan = resolveEventDiscoveryPlan(args.city, globalDoc, cityDoc);
  const cityLabel = String(cityDoc.name || args.city);
  const keywords = circularKeywordsFromCity(cityDoc, args.city);
  const queryCap = Math.min(MAX_QUERIES_HARD_CAP, args.maxQueries);
  const queries = plan.queries.enabled.map((c) => c.id).slice(0, queryCap);
  const seedUrls = plan.seeds.enabled.map((c) => c.label).filter((u) => /^https?:\/\//i.test(u));
  const blockedDomains = resolveBlockedDomains(plan);
  const seedUrlSet = new Set(seedUrls);
  const penalties = plan.penalties || {};

  console.log(
    `[discover-events-agent] city=${args.city} dryRun=${args.dryRun} limit=${args.limit} maxPastDays=${args.maxPastDays} queries=${queries.length} seeds=${seedUrls.length} keywords=${keywords.length} blockedDomains=${blockedDomains.length}`
  );

  const reviewedQueueIds = await loadReviewedQueueEventIds(db, args.city);
  const approvedKeys = await loadApprovedEventKeys(db, args.city);
  const memoryLookup = await createEventMemoryLookup(db, args.city);
  const minDate = isoDayOffset(-args.maxPastDays);

  const rawCandidates = [];
  const pageUrls = new Set(seedUrls);
  const pageAttr = new Map();
  const queryYield = new Map();
  let searchHits = 0;
  let pagesFetched = 0;
  let feedsParsed = 0;
  let searchFailures = 0;
  let skippedBlockedDomain = 0;
  let skippedQueryLowConfidence = 0;
  let queryPenalties = 0;

  for (const seedUrl of seedUrls) rememberPage(pageAttr, seedUrl, { seedUrl });

  for (const query of queries) {
    const { engine, results } = await searchWeb(query);
    console.log(`[discover-events-agent] query="${query}" engine=${engine} hits=${results.length}`);
    if (!results.length) searchFailures += 1;
    for (const hit of results) {
      searchHits += 1;
      if (isBlockedHost(hit.url, blockedDomains)) {
        skippedBlockedDomain += 1;
        continue;
      }
      pageUrls.add(hit.url);
      rememberPage(pageAttr, hit.url, { query });
      const fromSnippet = candidateFromSnippet(hit, cityLabel, query);
      if (fromSnippet) {
        bumpYield(queryYield, fromSnippet.eventQueries, 'fetched');
        rawCandidates.push(fromSnippet);
      }
    }
    await sleep(800);
  }

  let pageCount = 0;
  for (const pageUrl of pageUrls) {
    if (pageCount >= args.maxPages) break;
    if (isBlockedHost(pageUrl, blockedDomains)) {
      skippedBlockedDomain += 1;
      continue;
    }
    pageCount += 1;
    const isSeedPage = seedUrlSet.has(pageUrl);
    try {
      const { finalUrl, text } = await fetchText(pageUrl);
      pagesFetched += 1;
      copyPageAttr(pageAttr, pageUrl, finalUrl);
      if (isBlockedHost(finalUrl, blockedDomains)) {
        skippedBlockedDomain += 1;
        continue;
      }
      const tagAndPush = (ev, url) => {
        const eventQueries = eventQueriesFor(ev, pageAttr, url);
        bumpYield(queryYield, eventQueries, 'fetched');
        rawCandidates.push({ ...ev, eventQueries });
      };
      for (const ev of extractJsonLdEvents(text, finalUrl)) tagAndPush(ev, finalUrl);
      for (const ev of extractHeuristicEventsFromHtml(text, finalUrl, cityLabel, keywords)) tagAndPush(ev, finalUrl);

      const host = hostFromUrl(finalUrl);
      const allowFeeds =
        isSeedPage ||
        /(repair|ripara|swap|mercat|loppis|återbruk|aterbruk|circular|usato|baratto)/i.test(host + finalUrl);
      if (allowFeeds) {
        for (const feedUrl of extractFeedLinks(text, finalUrl)) {
          if (isBlockedHost(feedUrl, blockedDomains)) {
            skippedBlockedDomain += 1;
            continue;
          }
          try {
            copyPageAttr(pageAttr, finalUrl, feedUrl);
            const feed = await fetchText(feedUrl, 'text/calendar, application/rss+xml, application/xml, text/xml, */*;q=0.5');
            feedsParsed += 1;
            let parsed = [];
            if (/BEGIN:VCALENDAR|BEGIN:VEVENT/i.test(feed.text)) {
              parsed = parseIcs(feed.text, feedUrl);
            } else if (/<rss[\s>]|<feed[\s>]/i.test(feed.text)) {
              parsed = parseRssOrAtom(feed.text, feedUrl);
            }
            for (const ev of parsed) tagAndPush(ev, feedUrl);
          } catch (e) {
            console.warn(`[discover-events-agent] feed fetch failed ${feedUrl}:`, e.message || e);
          }
        }
      }
    } catch (e) {
      console.warn(`[discover-events-agent] page fetch failed ${pageUrl}:`, e.message || e);
    }
    await sleep(400);
  }

  const byDocId = new Map();
  const byKey = new Map();
  const runSeenKeys = new Set();
  let skippedPast = 0;
  let skippedReviewed = 0;
  let skippedApproved = 0;
  let skippedRunDup = 0;
  let skippedMissingLocation = 0;
  let skippedNotCircular = 0;
  let skippedMemoryHard = 0;
  let skippedMemorySoft = 0;
  let skippedWrongCity = 0;
  let memoryPenalties = 0;

  for (const raw of rawCandidates) {
    if (!raw.title || !raw.startDate) continue;
    if (raw.startDate < minDate) {
      skippedPast += 1;
      continue;
    }

    const evidenceUrl = String(raw.website || raw.sourceUrl || '').trim();
    if (isBlockedHost(evidenceUrl, blockedDomains)) {
      skippedBlockedDomain += 1;
      continue;
    }

    let locationText = String(raw.locationText || raw.address || '').trim();
    if (!locationText) locationText = extractLocationFromText(`${raw.title}\n${raw.description || ''}`, '');

    const geo = matchEventGeography(args.city, {
      title: raw.title,
      description: raw.description,
      locationText,
      address: raw.address,
    });
    if (!geo.ok) {
      skippedWrongCity += 1;
      continue;
    }

    if (!locationText) locationText = cityLabel;

    const circular = isCircularEventCandidate(raw.title, raw.description, keywords);
    if (!circular.ok) {
      skippedNotCircular += 1;
      continue;
    }
    const actionTags = inferActionTags(raw.title, raw.description, circular.matchedActionTags);
    const eventQueries = eventQueriesFor(raw, pageAttr, raw.sourceUrl);

    const key = eventDedupeKey(args.city, raw.title, raw.startDate, locationText);
    if (approvedKeys.has(key)) {
      skippedApproved += 1;
      continue;
    }
    if (runSeenKeys.has(key)) {
      const prev = byKey.get(key);
      if (prev) mergeEventQueries(prev.payload, eventQueries);
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
      website: evidenceUrl,
      description: String(raw.description || '').slice(0, 2000),
      timeDisplay: String(raw.timeDisplay || '').trim(),
      actionTags,
      sectorCategories: [],
      source: 'web_agent',
      sourceHost: hostFromUrl(evidenceUrl),
      eventQueries,
    };

    const memorySignal = await memoryLookup.assess(candidate);
    if (memorySignal.hardDuplicate) {
      skippedMemoryHard += 1;
      continue;
    }

    let confidence = confidenceForEvent(candidate, circular.matchedKeywords.length, memorySignal.boost || 0);
    if (circular.via === 'title') confidence = Math.min(0.95, confidence + 0.06);
    if (memorySignal.penalty > 0) {
      confidence = Math.max(0.05, confidence - memorySignal.penalty);
      memoryPenalties += 1;
      if (confidence < MIN_CONFIDENCE_AFTER_MEMORY) {
        skippedMemorySoft += 1;
        continue;
      }
    }
    const qPenalty = queryPenaltyFor(eventQueries, penalties);
    if (qPenalty > 0) {
      confidence = Math.max(0.05, confidence - qPenalty);
      queryPenalties += 1;
      if (confidence < MIN_CONFIDENCE_AFTER_MEMORY) {
        skippedQueryLowConfidence += 1;
        continue;
      }
    }

    const queryHint = eventQueries.length ? `; query=${eventQueries.join(',')}` : '';
    const row = {
      docId,
      payload: {
        kind: 'event',
        cityId: args.city,
        status: 'needs_review',
        confidence,
        eventQueries,
        candidate,
        evidence: [
          {
            url: candidate.website || raw.sourceUrl,
            snippet: `${String(raw.evidenceSnippet || '').slice(0, 140)}; circular=${circular.matchedKeywords.slice(0, 3).join(',')}; via=${circular.via}; actions=${actionTags.join(',')}${queryHint}${
              memorySignal.reasons.length ? `; memory=${memorySignal.reasons.join(',')}` : ''
            }`,
            capturedAt: new Date().toISOString(),
          },
        ],
        matchCandidates: [],
        updatedAt: FieldValue.serverTimestamp(),
        createdAt: FieldValue.serverTimestamp(),
      },
    };
    byDocId.set(docId, row);
    byKey.set(key, row);
    runSeenKeys.add(key);
  }

  const sorted = [...byDocId.values()]
    .sort((a, b) => Number(b.payload.confidence || 0) - Number(a.payload.confidence || 0))
    .slice(0, args.limit);

  for (const row of sorted) bumpYield(queryYield, row.payload.eventQueries, 'queued');
  for (const [id, row] of queryYield) {
    console.log(`[discover-events-agent] query-yield ${id} fetched=${row.fetched} queued=${row.queued}`);
  }

  console.log(
    `[discover-events-agent] fetched ${rawCandidates.length} raw entries, ${byDocId.size} candidates after filters (` +
      `${skippedPast} past skipped; ${skippedReviewed} reviewed queue skipped; ${skippedApproved} existing approved skipped; ` +
      `${skippedRunDup} run duplicates skipped; ${skippedMissingLocation} missing location skipped; ${skippedNotCircular} non-circular skipped; ` +
      `${skippedBlockedDomain} blocked-domain skipped; ` +
      `${skippedMemoryHard} hard memory skips; ${skippedMemorySoft} soft-memory confidence skips; ${skippedWrongCity} wrong-city skipped; ${memoryPenalties} soft-memory penalties; ` +
      `${queryPenalties} query penalties; ${skippedQueryLowConfidence} query-confidence skips; ` +
      `${searchFailures} queries without hits; pages=${pagesFetched}; feedsParsed=${feedsParsed}; searchHits=${searchHits}); writing ${sorted.length} (limit ${args.limit})`
  );

  const summary = {
    at: new Date().toISOString(),
    status: 'success',
    dryRun: args.dryRun,
    limit: args.limit,
    maxQueries: queryCap,
    maxPages: args.maxPages,
    fetchedCount: rawCandidates.length,
    queuedCount: sorted.length,
    skippedNotCircular,
    skippedPast,
    skippedApproved,
    skippedWrongCity,
    skippedBlockedDomain,
    skippedMemoryHard,
    skippedMemorySoft,
    skippedQueryLowConfidence,
    queryPenalties,
    queryYield: queryYieldToObject(queryYield),
    errorSummary: '',
  };
  console.log(`[discover-events-agent] run-summary ${JSON.stringify(summary)}`);
  if (!args.dryRun) await persistEventRun(db, args.city, summary);

  if (args.dryRun) {
    for (const row of sorted.slice(0, 25)) {
      const c = row.payload.candidate;
      const q = Array.isArray(row.payload.eventQueries) && row.payload.eventQueries.length
        ? ` {${row.payload.eventQueries.join(', ')}}`
        : '';
      console.log(`  [dry-run] ${row.docId} ${c.title} @ ${c.startDate} (${row.payload.confidence.toFixed(2)})${q} ${c.website}`);
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
