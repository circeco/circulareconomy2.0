/* eslint-disable no-console */
/**
 * Shared helpers for event discovery + event review memory.
 */
const crypto = require('crypto');

const REJECT_ONLY_RETENTION_DAYS = Math.max(30, parseInt(process.env.EVENT_REVIEW_MEMORY_REJECT_TTL_DAYS || '180', 10) || 180);

const DEFAULT_CIRCULAR_KEYWORDS = [
  'second hand', 'second-hand', 'used', 'pre-loved', 'preloved', 'swap', 'swapping', 'baratto',
  'reuse', 'riuso', 'kilo sale', 'kilo sales', 'vintage', 'antique', 'antiques', 'mercatino',
  'flea market', 'street market', 'repair', 'repair cafe', 'repair café', 'fixit', 'riparazione',
  'aggiusta', 'refurb', 'ricondizionato', 'recycle', 'riciclo', 'zero waste', 'circular economy',
  'economia circolare', 'upcycle', 'upcycling',
];

function hashString(input) {
  return crypto.createHash('sha1').update(String(input || ''), 'utf8').digest('hex').slice(0, 16);
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

function eventTitleIndexDocId(cityId, titleNorm) {
  return `${cityId}_${hashString(`eventtitle|${titleNorm}`)}`;
}

function eventDedupeKey(cityId, title, startDate, locationText) {
  return `${cityId}|${normalizeText(title)}|${String(startDate || '').trim()}|${normalizeText(locationText || '')}`;
}

function circularKeywordsFromCity(city) {
  const keywords = new Set(DEFAULT_CIRCULAR_KEYWORDS.map((x) => x.toLowerCase()));
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

function circularSignals(title, description, keywords) {
  const text = `${title || ''} ${description || ''}`.toLowerCase();
  const matchedKeywords = [];
  for (const keyword of keywords) {
    if (keyword && text.includes(keyword) && !matchedKeywords.includes(keyword)) matchedKeywords.push(keyword);
    if (matchedKeywords.length >= 8) break;
  }
  const matchedActionTags = [];
  if (/(repair|fix|mend|ripar|aggiusta|refurb)/.test(text)) matchedActionTags.push('repair');
  if (/(reuse|swap|second hand|second-hand|usato|usati|vintage|mercatino|flea)/.test(text)) matchedActionTags.push('reuse');
  if (/(recycl|ricicl)/.test(text)) matchedActionTags.push('recycle');
  if (/(reduce|riduz|zero waste|waste less)/.test(text)) matchedActionTags.push('reduce');
  if (/(repurpose|upcycl|riuso creativo)/.test(text)) matchedActionTags.push('repurpose');
  if (/(boycott|refuse|plastic free|senza plastica)/.test(text)) matchedActionTags.push('refuse');
  return { matchedKeywords, matchedActionTags };
}

function inferActionTags(title, description, matchedActionHints = []) {
  const set = new Set((matchedActionHints || []).map((x) => String(x || '').trim().toLowerCase()).filter(Boolean));
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

function confidenceForEvent(candidate, matchedKeywordCount) {
  let score = 0.45;
  if (candidate.website) score += 0.12;
  if (candidate.locationText || candidate.address) score += 0.12;
  if (candidate.description && candidate.description.length > 40) score += 0.08;
  if ((candidate.actionTags || []).length) score += 0.1;
  score += Math.min(0.12, matchedKeywordCount * 0.04);
  return Math.max(0.05, Math.min(0.95, Number(score.toFixed(3))));
}

function hasRejectBias(docData) {
  if (!docData) return false;
  const approved = Number(docData.approvedCount || 0);
  const rejected = Number(docData.rejectedCount || 0);
  if (docData.lastDecision === 'rejected') return true;
  return rejected > approved;
}

async function createEventMemoryLookup(db, cityId) {
  const memoryById = new Map();
  const titleById = new Map();
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

  return {
    async assess(candidate) {
      const titleNorm = normalizeText(candidate.title || '');
      if (!titleNorm) return { hardDuplicate: false, penalty: 0, reasons: [] };
      const startDate = String(candidate.startDate || '').trim();
      const locationNorm = normalizeText(candidate.locationText || candidate.address || '');
      const memRef = db.collection('eventReviewMemory').doc(eventMemoryDocId(cityId, candidate.title, startDate, locationNorm));
      const mem = await getCached(memoryById, memRef);
      if (mem) {
        if (mem.lastDecision === 'rejected' || Number(mem.rejectedCount || 0) > 0) {
          return { hardDuplicate: true, penalty: 0, reasons: ['memory:event_fingerprint'] };
        }
        if (mem.lastDecision === 'approved' || Number(mem.approvedCount || 0) > 0) {
          return { hardDuplicate: true, penalty: 0, reasons: ['memory:event_approved'] };
        }
      }

      let penalty = 0;
      const reasons = [];
      const titleRef = db.collection('eventReviewMemoryTitleIndex').doc(eventTitleIndexDocId(cityId, titleNorm));
      const byTitle = await getCached(titleById, titleRef);
      if (byTitle && hasRejectBias(byTitle)) {
        penalty += 0.12;
        reasons.push('memory:event_title');
      }
      return { hardDuplicate: false, penalty: Math.min(0.24, penalty), reasons };
    },
    stats() {
      return { reads, memoryCacheSize: memoryById.size, titleCacheSize: titleById.size };
    },
  };
}

module.exports = {
  REJECT_ONLY_RETENTION_DAYS,
  DEFAULT_CIRCULAR_KEYWORDS,
  hashString,
  normalizeText,
  eventFingerprint,
  eventMemoryDocId,
  eventTitleIndexDocId,
  eventDedupeKey,
  circularKeywordsFromCity,
  circularSignals,
  inferActionTags,
  confidenceForEvent,
  createEventMemoryLookup,
};
