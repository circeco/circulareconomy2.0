/* eslint-disable no-console */
/**
 * Shared helpers for event discovery + event review memory.
 */

const REJECT_ONLY_RETENTION_DAYS = Math.max(30, parseInt(process.env.EVENT_REVIEW_MEMORY_REJECT_TTL_DAYS || '180', 10) || 180);

/** Prefer multi-word / specific phrases; avoid ultra-broad tokens like bare "used". */
const DEFAULT_CIRCULAR_KEYWORDS = [
  'second hand',
  'second-hand',
  'pre-loved',
  'preloved',
  'swap',
  'swapping',
  'swap party',
  'baratto',
  'reuse',
  'riuso',
  'kilo sale',
  'kilo sales',
  'vintage',
  'mercatino',
  'mercatino dell usato',
  "mercatino dell'usato",
  'flea market',
  'loppis',
  'repair cafe',
  'repair café',
  'repaircafé',
  'fixit',
  'fixit clinic',
  'riparazione',
  'caffè riparazione',
  'laboratorio di riparazione',
  'aggiusta',
  'refurb',
  'ricondizionato',
  'recycle',
  'riciclo',
  'zero waste',
  'circular economy',
  'economia circolare',
  'upcycle',
  'upcycling',
  'scambio vestiti',
  'clothes swap',
];

/** Extra city lexicon: Milan IT+EN, Stockholm SV+EN. */
const CITY_EXTRA_KEYWORDS = {
  milan: [
    'ripara',
    'riparali',
    'non buttare',
    'usato',
    'usati',
    'scambio',
    'baratto',
    'antiquariato',
    'modernariato',
    'mercatone',
    'navigli',
    'vintage market',
    'east market',
    'pulci',
    'brocantage',
  ],
  stockholm: [
    'återbruk',
    'aterbruk',
    'återbruka',
    'aterbruka',
    'loppis',
    'bakluckeloppis',
    'lappa',
    'laga',
    'lagning',
    'reparera',
    'reparation',
    'cirkulär',
    'cirkular',
    'cirkulära',
    'byt',
    'bytfest',
    'second hand',
    'återvinning',
    'atervinning',
  ],
  turin: ['ripara', 'usato', 'usati', 'scambio', 'baratto', 'antiquariato'],
  uppsala: ['återbruk', 'aterbruk', 'loppis', 'laga', 'reparera', 'bytfest'],
};

/** Domains that flooded the Milan queue with non-circular listings. */
const DEFAULT_BLOCKED_EVENT_DOMAINS = [
  'milanopocket.it',
  'ticketone.it',
  'ticketmaster.it',
  'ticketmaster.se',
  'ticketmaster.com',
  'eventbrite.com',
  'eventbrite.it',
  'eventbrite.se',
  'yelp.com',
  'tripadvisor.com',
  'tripadvisor.it',
  'facebook.com',
  'instagram.com',
  'meetup.com',
];

function hashString(input) {
  // FNV-1a 32-bit — must match admin-review / OSM place discovery fingerprints.
  let h = 0x811c9dc5;
  const s = String(input || '');
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = (h >>> 0) * 0x01000193;
  }
  return (h >>> 0).toString(16).padStart(8, '0');
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

function eventFingerprint(cityId, title, startDate, locationNorm) {
  return hashString(`${cityId}|${normalizeText(title)}|${String(startDate || '').trim()}|${locationNorm || ''}`);
}

function eventMemoryDocId(cityId, title, startDate, locationText) {
  const locationNorm = normalizeText(locationText || '');
  return `${cityId}_${eventFingerprint(cityId, title, startDate, locationNorm)}`;
}

/** Series-level memory (no concrete date) — used so weekly/monthly approvals cover future scrapes. */
function eventSeriesMemoryDocId(cityId, title, locationText) {
  return eventMemoryDocId(cityId, title, 'series', locationText);
}

function eventSourceMemoryDocId(cityId, hostOrUrl) {
  const host = hostFromUrl(hostOrUrl) || String(hostOrUrl || '')
    .toLowerCase()
    .replace(/^www\./, '')
    .trim();
  if (!host) return '';
  return `${cityId}_source_${hashString(host)}`;
}

function eventTitleIndexDocId(cityId, titleNorm) {
  return `${cityId}_${hashString(`eventtitle|${titleNorm}`)}`;
}

function eventDedupeKey(cityId, title, startDate, locationText) {
  return `${cityId}|${normalizeText(title)}|${String(startDate || '').trim()}|${normalizeText(locationText || '')}`;
}

/** Compact learning keywords from free text (for approvalSignals). */
function extractLearningKeywords(text, limit = 8) {
  const raw = normalizeText(text || '');
  if (!raw) return [];
  const stop = new Set([
    'the', 'and', 'for', 'with', 'from', 'this', 'that', 'are', 'was', 'were', 'have', 'has',
    'dell', 'della', 'delle', 'degli', 'una', 'uno', 'per', 'con', 'che', 'non', 'come',
    'och', 'att', 'som', 'det', 'den', 'ett', 'med', 'pa', 'av',
  ]);
  const out = [];
  for (const token of raw.split(' ')) {
    if (token.length < 4 || stop.has(token)) continue;
    if (!out.includes(token)) out.push(token);
    if (out.length >= limit) break;
  }
  return out;
}

function circularKeywordsFromCity(city, cityId = '') {
  const keywords = new Set(DEFAULT_CIRCULAR_KEYWORDS.map((x) => x.toLowerCase()));
  const extras = CITY_EXTRA_KEYWORDS[String(cityId || city?.id || '').toLowerCase()] || [];
  for (const k of extras) keywords.add(String(k).toLowerCase());
  for (const k of String(process.env.DISCOVERY_EVENT_KEYWORDS || '')
    .split(',')
    .map((x) => x.trim().toLowerCase())
    .filter(Boolean)) {
    keywords.add(k);
  }
  if (Array.isArray(city?.eventKeywords)) {
    for (const k of city.eventKeywords) keywords.add(String(k || '').trim().toLowerCase());
  }
  if (city?.discovery && Array.isArray(city.discovery.eventKeywords)) {
    for (const k of city.discovery.eventKeywords) keywords.add(String(k || '').trim().toLowerCase());
  }
  return [...keywords].filter(Boolean);
}

function hostFromUrl(url) {
  try {
    return new URL(String(url || '')).hostname.replace(/^www\./i, '').toLowerCase();
  } catch {
    return '';
  }
}

function normalizeDomainList(list) {
  return [...new Set(
    (list || [])
      .map((x) => String(x || '').trim().toLowerCase().replace(/^www\./, ''))
      .filter(Boolean)
  )];
}

function blockedDomainsFromCity(city) {
  const blocked = new Set(DEFAULT_BLOCKED_EVENT_DOMAINS);
  for (const d of normalizeDomainList(city?.eventBlockDomains)) blocked.add(d);
  for (const d of normalizeDomainList(city?.discovery?.eventBlockDomains)) blocked.add(d);
  for (const d of normalizeDomainList(
    String(process.env.DISCOVERY_EVENT_BLOCK_DOMAINS || '')
      .split(',')
      .map((x) => x.trim())
      .filter(Boolean)
  )) {
    blocked.add(d);
  }
  return [...blocked];
}

function isBlockedHost(hostOrUrl, blockedDomains) {
  const host = String(hostOrUrl || '').includes('/') ? hostFromUrl(hostOrUrl) : String(hostOrUrl || '').replace(/^www\./, '').toLowerCase();
  if (!host) return false;
  return (blockedDomains || []).some((d) => host === d || host.endsWith(`.${d}`));
}

function circularSignals(title, description, keywords) {
  const text = `${title || ''} ${description || ''}`.toLowerCase();
  const matchedKeywords = [];
  for (const keyword of keywords) {
    if (keyword && text.includes(keyword) && !matchedKeywords.includes(keyword)) matchedKeywords.push(keyword);
    if (matchedKeywords.length >= 8) break;
  }
  const matchedActionTags = [];
  if (/(repair\s*caf[eé]|fixit|riparazione|ripara\b|aggiusta|refurb|lappa|laga|reparera)/.test(text)) {
    matchedActionTags.push('repair');
  }
  if (
    /(reuse|swap|second[-\s]?hand|usato|usati|vintage|mercatino|mercatone|flea\s*market|loppis|baratto|återbruk|aterbruk|bakluckeloppis)/.test(
      text
    )
  ) {
    matchedActionTags.push('reuse');
  }
  if (/(recycl|ricicl|återvinning|atervinning)/.test(text)) matchedActionTags.push('recycle');
  if (/(reduce|riduz|zero\s*waste|waste\s*less)/.test(text)) matchedActionTags.push('reduce');
  if (/(repurpose|upcycl|riuso creativo)/.test(text)) matchedActionTags.push('repurpose');
  if (/(boycott|refuse|plastic\s*free|senza\s*plastica)/.test(text)) matchedActionTags.push('refuse');
  return { matchedKeywords, matchedActionTags };
}

/**
 * Circular signal may appear in title or description (Italian/Swedish/English).
 * Prefer title matches for confidence scoring, but description is enough to pass.
 */
function isCircularEventCandidate(title, description, keywords) {
  const titleHit = circularSignals(title, '', keywords);
  if (titleHit.matchedKeywords.length > 0 || titleHit.matchedActionTags.length > 0) {
    return { ok: true, matchedKeywords: titleHit.matchedKeywords, matchedActionTags: titleHit.matchedActionTags, via: 'title' };
  }
  const descHit = circularSignals('', description, keywords);
  if (descHit.matchedKeywords.length > 0 || descHit.matchedActionTags.length > 0) {
    return { ok: true, matchedKeywords: descHit.matchedKeywords, matchedActionTags: descHit.matchedActionTags, via: 'description' };
  }
  return { ok: false, matchedKeywords: [], matchedActionTags: [], via: '' };
}

function inferActionTags(title, description, matchedActionHints = []) {
  const set = new Set((matchedActionHints || []).map((x) => String(x || '').trim().toLowerCase()).filter(Boolean));
  const text = `${title || ''} ${description || ''}`.toLowerCase();
  if (/(repair\s*caf[eé]|fixit|riparazione|ripara\b|aggiusta|refurb|lappa|laga|reparera)/.test(text)) set.add('repair');
  if (/(reuse|swap|second[-\s]?hand|usato|usati|vintage|mercatino|mercatone|loppis|baratto|återbruk|aterbruk)/.test(text)) {
    set.add('reuse');
  }
  if (/(recycl|ricicl|återvinning|atervinning)/.test(text)) set.add('recycle');
  if (/(reduce|riduz|zero\s*waste|waste\s*less)/.test(text)) set.add('reduce');
  if (/(repurpose|upcycl|riuso creativo)/.test(text)) set.add('repurpose');
  if (/(boycott|refuse|plastic\s*free|senza\s*plastica)/.test(text)) set.add('refuse');
  const allowed = ['refuse', 'reuse', 'repair', 'repurpose', 'recycle', 'reduce'];
  return [...set].filter((x) => allowed.includes(x)).slice(0, 3);
}

function confidenceForEvent(candidate, matchedKeywordCount, boost = 0) {
  let score = 0.45;
  if (candidate.website) score += 0.12;
  if (candidate.locationText || candidate.address) score += 0.12;
  if (candidate.description && candidate.description.length > 40) score += 0.08;
  if ((candidate.actionTags || []).length) score += 0.1;
  score += Math.min(0.12, matchedKeywordCount * 0.04);
  score += Math.min(0.15, Number(boost) || 0);
  return Math.max(0.05, Math.min(0.95, Number(score.toFixed(3))));
}

function hasRejectBias(docData) {
  if (!docData) return false;
  const approved = Number(docData.approvedCount || 0);
  const rejected = Number(docData.rejectedCount || 0);
  if (docData.lastDecision === 'rejected') return true;
  return rejected > approved;
}

function hasApproveBias(docData) {
  if (!docData) return false;
  const approved = Number(docData.approvedCount || 0);
  const rejected = Number(docData.rejectedCount || 0);
  if (docData.lastDecision === 'approved' && approved > 0) return true;
  return approved > rejected && approved > 0;
}

async function createEventMemoryLookup(db, cityId) {
  const memoryById = new Map();
  const titleById = new Map();
  const sourceById = new Map();
  let reads = 0;

  async function getCached(map, ref) {
    const id = ref.id;
    if (map.has(id)) return map.get(id);
    reads += 1;
    const snap = await ref.get();
    const data = snap.exists ? snap.data() || {} : null;
    map.set(id, data);
    return data;
  }

  function decisionHardSkip(mem, reasonPrefix) {
    if (!mem) return null;
    if (mem.lastDecision === 'rejected' || Number(mem.rejectedCount || 0) > Number(mem.approvedCount || 0)) {
      return { hardDuplicate: true, penalty: 0, boost: 0, reasons: [`${reasonPrefix}:rejected`] };
    }
    if (mem.lastDecision === 'approved' || Number(mem.approvedCount || 0) > 0) {
      return { hardDuplicate: true, penalty: 0, boost: 0, reasons: [`${reasonPrefix}:approved`] };
    }
    return null;
  }

  return {
    async assess(candidate) {
      const titleNorm = normalizeText(candidate.title || '');
      if (!titleNorm) return { hardDuplicate: false, penalty: 0, boost: 0, reasons: [] };
      const startDate = String(candidate.startDate || '').trim();
      const locationNorm = normalizeText(candidate.locationText || candidate.address || '');
      const host = hostFromUrl(candidate.website || candidate.sourceUrl || '') || String(candidate.sourceHost || '').trim();

      // 1) Exact occurrence fingerprint
      const memRef = db.collection('eventReviewMemory').doc(eventMemoryDocId(cityId, candidate.title, startDate, locationNorm));
      const mem = await getCached(memoryById, memRef);
      const exact = decisionHardSkip(mem, 'memory:event_fingerprint');
      if (exact) return exact;

      // 2) Series fingerprint (covers future dates of an approved/rejected series)
      const seriesRef = db.collection('eventReviewMemory').doc(eventSeriesMemoryDocId(cityId, candidate.title, locationNorm));
      const seriesMem = await getCached(memoryById, seriesRef);
      const seriesHit = decisionHardSkip(seriesMem, 'memory:event_series');
      if (seriesHit) return seriesHit;

      let penalty = 0;
      let boost = 0;
      const reasons = [];

      // 3) Title soft/hard learning
      const titleRef = db.collection('eventReviewMemoryTitleIndex').doc(eventTitleIndexDocId(cityId, titleNorm));
      const byTitle = await getCached(titleById, titleRef);
      if (byTitle && hasRejectBias(byTitle)) {
        const rejected = Number(byTitle.rejectedCount || 0);
        const approved = Number(byTitle.approvedCount || 0);
        if (byTitle.lastDecision === 'rejected' && rejected >= 1 && approved === 0) {
          return { hardDuplicate: true, penalty: 0, boost: 0, reasons: ['memory:event_title:hard_reject'] };
        }
        penalty += rejected >= 2 ? 0.22 : 0.14;
        reasons.push('memory:event_title');
      } else if (byTitle && hasApproveBias(byTitle)) {
        boost += 0.06;
        reasons.push('memory:event_title:approve');
        const signals = byTitle.approvalSignals || {};
        const learnedKw = Array.isArray(signals.keywords) ? signals.keywords : [];
        const learnedTags = Array.isArray(signals.actionTags) ? signals.actionTags : [];
        const text = `${candidate.title || ''} ${candidate.description || ''}`.toLowerCase();
        const overlap = learnedKw.filter((k) => k && text.includes(String(k).toLowerCase())).length;
        if (overlap > 0) {
          boost += Math.min(0.08, overlap * 0.03);
          reasons.push('memory:event_title:keywords');
        }
        const candTags = new Set((candidate.actionTags || []).map((t) => String(t).toLowerCase()));
        const tagOverlap = learnedTags.filter((t) => candTags.has(String(t).toLowerCase())).length;
        if (tagOverlap > 0) {
          boost += Math.min(0.06, tagOverlap * 0.03);
          reasons.push('memory:event_title:tags');
        }
      }

      // 4) Source host learning
      if (host) {
        const sourceId = eventSourceMemoryDocId(cityId, host);
        if (sourceId) {
          const sourceRef = db.collection('eventReviewMemory').doc(sourceId);
          const bySource = await getCached(sourceById, sourceRef);
          if (bySource && hasRejectBias(bySource) && Number(bySource.rejectedCount || 0) >= 2) {
            return { hardDuplicate: true, penalty: 0, boost: 0, reasons: ['memory:event_source:hard_reject'] };
          }
          if (bySource && hasRejectBias(bySource)) {
            penalty += 0.16;
            reasons.push('memory:event_source:reject');
          } else if (bySource && hasApproveBias(bySource)) {
            boost += 0.08;
            reasons.push('memory:event_source:approve');
          }
        }
      }

      return {
        hardDuplicate: false,
        penalty: Math.min(0.35, penalty),
        boost: Math.min(0.18, boost),
        reasons,
      };
    },
    stats() {
      return {
        reads,
        memoryCacheSize: memoryById.size,
        titleCacheSize: titleById.size,
        sourceCacheSize: sourceById.size,
      };
    },
  };
}

module.exports = {
  REJECT_ONLY_RETENTION_DAYS,
  DEFAULT_CIRCULAR_KEYWORDS,
  CITY_EXTRA_KEYWORDS,
  DEFAULT_BLOCKED_EVENT_DOMAINS,
  hashString,
  normalizeText,
  hostFromUrl,
  blockedDomainsFromCity,
  isBlockedHost,
  eventFingerprint,
  eventMemoryDocId,
  eventSeriesMemoryDocId,
  eventSourceMemoryDocId,
  eventTitleIndexDocId,
  eventDedupeKey,
  extractLearningKeywords,
  circularKeywordsFromCity,
  circularSignals,
  isCircularEventCandidate,
  inferActionTags,
  confidenceForEvent,
  createEventMemoryLookup,
};
