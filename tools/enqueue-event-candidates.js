/* eslint-disable no-console */
/**
 * Manually enqueue curated event candidates into Firestore `reviewQueue`
 * (same document shape as `discover-events-agent.js`).
 *
 * Usage:
 *   node tools/enqueue-event-candidates.js --dry-run
 *   node tools/enqueue-event-candidates.js
 */
const path = require('path');
const { readFileSync, existsSync } = require('fs');
const { initializeApp, cert, getApps } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const {
  hashString,
  hostFromUrl,
  eventDedupeKey,
  isCircularEventCandidate,
  inferActionTags,
  circularKeywordsFromCity,
  confidenceForEvent,
  createEventMemoryLookup,
  matchEventGeography,
} = require('./lib/event-discovery-common');

const PROJECT_ID = process.env.FIREBASE_PROJECT_ID || 'circeco-bf511';

const CANDIDATES = [
  {
    cityId: 'milan',
    title: 'Wunder Mrkt – il mercato nell’ex fabbrica di profumi',
    startDate: '2026-10-04',
    endDate: '2026-10-04',
    locationName: 'Spazio Profumo',
    locationText: 'Spazio Profumo, Via Ambrogio Binda 29, Milano',
    address: 'Via Ambrogio Binda 29, Milano',
    website: 'https://wundermrkt.com/tutti-gli-eventi/',
    timeDisplay: '11:00–20:30',
    description:
      'Domenica 4 ottobre 2026 il market inaugura la nuova casa a Spazio Profumo a Milano. Vintage, design indipendente, artigianato e shopping sostenibile. Da ottobre torna ogni prima domenica del mese.',
    actionTags: ['reuse'],
    recurrence: { frequency: 'monthly_nth', windowMonths: 6 },
    sourceUrl: 'https://wundermrkt.com/tutti-gli-eventi/',
  },
  {
    cityId: 'milan',
    title: 'Remira Market – Santeria',
    startDate: '2026-09-20',
    endDate: '2026-09-20',
    locationName: 'Santeria',
    locationText: 'Santeria, Milano',
    address: 'Santeria, Milano',
    website: 'https://remiramarket.com/events',
    timeDisplay: '',
    description:
      'Remira Market vintage e second hand a Santeria, Milano. Espositori sold out — lista d’attesa sul sito.',
    actionTags: ['reuse'],
    sourceUrl: 'https://remiramarket.com/events',
  },
  {
    cityId: 'milan',
    title: 'Remira Market – Mercato Isola',
    startDate: '2026-10-03',
    endDate: '2026-10-03',
    locationName: 'Mercato Isola',
    locationText: 'Piazzale Lagosta 7, Milano',
    address: 'Piazzale Lagosta 7, Milano',
    website: 'https://remiramarket.com/events',
    timeDisplay: '',
    description:
      'Remira Market al Mercato Isola: vintage, second hand, pezzi unici e food court nel quartiere Isola.',
    actionTags: ['reuse'],
    sourceUrl: 'https://remiramarket.com/events',
  },
  {
    cityId: 'milan',
    title: 'Remira Market – Mercato Isola',
    startDate: '2026-10-04',
    endDate: '2026-10-04',
    locationName: 'Mercato Isola',
    locationText: 'Piazzale Lagosta 7, Milano',
    address: 'Piazzale Lagosta 7, Milano',
    website: 'https://remiramarket.com/events',
    timeDisplay: '',
    description:
      'Remira Market al Mercato Isola: vintage, second hand, pezzi unici e food court nel quartiere Isola.',
    actionTags: ['reuse'],
    sourceUrl: 'https://remiramarket.com/events',
  },
  {
    cityId: 'milan',
    title: 'Remira Market – Teatro Cinema Martinitt',
    startDate: '2026-10-18',
    endDate: '2026-10-18',
    locationName: 'Teatro Cinema Martinitt',
    locationText: 'Via Pitteri 58, Milano',
    address: 'Via Pitteri 58, Milano',
    website: 'https://remiramarket.com/events',
    timeDisplay: '',
    description:
      'Remira Market nel cortile del Teatro Martinitt: vintage, second hand e pezzi unici, con musica e dj set.',
    actionTags: ['reuse'],
    sourceUrl: 'https://remiramarket.com/events',
  },
  // From https://www.vibeevents.it/mercatini-milano/ — skip Remira 20 Sep (already queued).
  ...expandDates(
    {
      cityId: 'milan',
      title: 'Vecchi Libri in Piazza',
      locationName: 'Duomo / Centro Storico',
      locationText: 'Via Mercanti / Duomo, Milano',
      address: 'Via Mercanti, Milano',
      website: 'https://www.vibeevents.it/mercatini-milano/',
      description:
        'Mercatino di libri usati all’aperto in centro a Milano. Ingresso libero.',
      actionTags: ['reuse'],
      sectorCategories: ['books-comics-magazines'],
      sourceUrl: 'https://www.vibeevents.it/mercatini-milano/',
    },
    ['2026-09-13', '2026-10-11', '2026-11-08', '2026-12-13']
  ),
  {
    cityId: 'milan',
    title: 'East Market',
    startDate: '2026-09-20',
    endDate: '2026-09-20',
    locationName: 'East End Studios',
    locationText: 'Via Mecenate 88/A, Milano',
    address: 'Via Mecenate 88/A, Milano',
    website: 'https://eastmarketmilano.com/',
    timeDisplay: '10:00–21:00',
    description:
      'Vintage, second hand, modernariato, vinili e pezzi unici in ex fabbrica aeronautica. Ingresso a pagamento; bambini fino a 12 anni gratis.',
    actionTags: ['reuse'],
    sourceUrl: 'https://www.vibeevents.it/mercatini-milano/',
  },
  ...expandDates(
    {
      cityId: 'milan',
      title: 'Mercatino di Brera',
      locationName: 'Brera',
      locationText: 'Via Fiori Chiari / Brera, Milano',
      address: 'Via Fiori Chiari, Milano',
      website: 'https://www.vibeevents.it/mercatini-milano/',
      description:
        'Mercatino all’aperto in Brera: antiquariato, vintage e modernariato. Ingresso libero.',
      actionTags: ['reuse'],
      sourceUrl: 'https://www.vibeevents.it/mercatini-milano/',
    },
    ['2026-09-20', '2026-10-18', '2026-11-15', '2026-12-20']
  ),
  ...expandDates(
    {
      cityId: 'milan',
      title: 'Mercatone dell’Antiquariato sui Navigli',
      locationName: 'Navigli',
      locationText: 'Alzaia Naviglio Grande, Milano',
      address: 'Alzaia Naviglio Grande, Milano',
      website: 'https://www.milanofree.it/milano/eventi/mercatone-dellantiquariato-sui-navigli-calendario-2026-orari-e-come-arrivare.html',
      description:
        'Mercatone dell’antiquariato e modernariato lungo i Navigli. Ingresso libero.',
      actionTags: ['reuse'],
      sourceUrl: 'https://www.vibeevents.it/mercatini-milano/',
    },
    ['2026-09-27', '2026-10-25', '2026-11-29', '2026-12-20']
  ),
  ...expandDates(
    {
      cityId: 'milan',
      title: 'Fair Priced Vintage',
      locationName: 'Department 184',
      locationText: 'Department 184, Via Varesina 184, Milano',
      address: 'Via Varesina 184, Milano',
      website: 'https://www.dept184.com/events/fair-priced-vintage-2',
      description:
        'Vintage clothing market a prezzi fissi al Department 184 (Certosa). Ingresso libero con registrazione. Riuso e moda circolare.',
      actionTags: ['reuse'],
      sectorCategories: ['apparel'],
      sourceUrl: 'https://www.vibeevents.it/mercatini-milano/',
    },
    ['2026-10-02', '2026-10-03', '2026-10-04']
  ),
  ...expandDates(
    {
      cityId: 'milan',
      title: 'AMART – Antiquariato a Milano',
      locationName: 'Brera / Montenapoleone',
      locationText: 'Brera / Montenapoleone, Milano',
      address: 'Brera, Milano',
      website: 'https://www.vibeevents.it/mercatini-milano/',
      description:
        'Fiera di antiquariato, vintage e modernariato in zona Brera. Ingresso a pagamento.',
      actionTags: ['reuse'],
      sourceUrl: 'https://www.vibeevents.it/mercatini-milano/',
    },
    ['2026-11-05', '2026-11-06', '2026-11-07', '2026-11-08']
  ),
  ...expandDates(
    {
      cityId: 'milan',
      title: 'Cotoletta Vintage Market',
      locationName: 'Department 184',
      locationText: 'Department 184, Via Varesina 184, Milano',
      address: 'Via Varesina 184, Milano',
      website: 'https://www.cotolettavintagemarket.it/',
      timeDisplay: '10:00–20:00',
      description:
        'Market di modernariato, vintage, toys e vinili al Department 184. Oltre 50 espositori, ingresso libero.',
      actionTags: ['reuse'],
      sourceUrl: 'https://www.vibeevents.it/mercatini-milano/',
    },
    ['2026-11-28', '2026-11-29']
  ),
  {
    cityId: 'milan',
    title: 'Fiera di Sinigaglia',
    startDate: '2026-09-12',
    endDate: '2026-09-12',
    locationName: 'Darsena / Navigli',
    locationText: 'Via Valenza, Darsena, Milano',
    address: 'Via Valenza, Milano',
    website: 'https://www.vibeevents.it/mercatini-milano/',
    description:
      'Storico mercatino dell’usato alla Darsena, ogni sabato fino al 26 dicembre 2026. Ingresso libero.',
    actionTags: ['reuse'],
    recurrence: { frequency: 'weekly', until: '2026-12-26', windowMonths: 4 },
    sourceUrl: 'https://www.vibeevents.it/mercatini-milano/',
  },
  {
    cityId: 'milan',
    title: 'Maramao Vintage Market',
    startDate: '2026-09-12',
    endDate: '2026-09-12',
    locationName: 'Tempio del Futuro Perduto',
    locationText: 'Tempio del Futuro Perduto, Via Luigi Nono 9, Milano',
    address: 'Via Luigi Nono 9, Milano',
    website: 'https://www.tempiodelfuturo.art/',
    timeDisplay: '11:00–19:00',
    description:
      'Vintage, second hand, artigianato e vinili ogni sabato al Tempio del Futuro Perduto (Sempione), fino al 19 dicembre 2026. Ingresso libero.',
    actionTags: ['reuse'],
    recurrence: { frequency: 'weekly', until: '2026-12-19', windowMonths: 4 },
    sourceUrl: 'https://www.vibeevents.it/mercatini-milano/',
  },
];

function expandDates(base, dates) {
  return dates.map((startDate) => ({
    ...base,
    startDate,
    endDate: startDate,
  }));
}

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
    console.error('[enqueue-events] No credentials. Add secrets/firebase-adminsdk.json or set GOOGLE_APPLICATION_CREDENTIALS.');
    process.exit(1);
  }
  const sa = JSON.parse(readFileSync(credPath, 'utf8'));
  initializeApp({ credential: cert(sa), projectId: sa.project_id || PROJECT_ID });
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

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  initAdminApp();
  const db = getFirestore();

  const byCity = new Map();
  for (const raw of CANDIDATES) {
    const list = byCity.get(raw.cityId) || [];
    list.push(raw);
    byCity.set(raw.cityId, list);
  }

  let written = 0;
  let skipped = 0;

  for (const [cityId, rows] of byCity) {
    const citySnap = await db.collection('cities').doc(cityId).get();
    const cityDoc = citySnap.exists ? citySnap.data() || {} : {};
    const keywords = circularKeywordsFromCity(cityDoc, cityId);
    const reviewedQueueIds = await loadReviewedQueueEventIds(db, cityId);
    const approvedKeys = await loadApprovedEventKeys(db, cityId);
    const memoryLookup = await createEventMemoryLookup(db, cityId);
    const runSeenKeys = new Set();

    for (const raw of rows) {
      const geo = matchEventGeography(cityId, raw);
      if (!geo.ok) {
        console.log(`  skip wrong-city ${raw.title} @ ${raw.startDate} (${geo.matched})`);
        skipped += 1;
        continue;
      }

      const circular = isCircularEventCandidate(raw.title, raw.description, keywords);
      if (!circular.ok) {
        console.log(`  skip non-circular ${raw.title} @ ${raw.startDate}`);
        skipped += 1;
        continue;
      }

      const actionTags = inferActionTags(raw.title, raw.description, raw.actionTags || circular.matchedActionTags);
      const key = eventDedupeKey(cityId, raw.title, raw.startDate, raw.locationText);
      if (approvedKeys.has(key) || runSeenKeys.has(key)) {
        console.log(`  skip duplicate ${raw.title} @ ${raw.startDate}`);
        skipped += 1;
        continue;
      }

      const stableKey = `website|${raw.sourceUrl}|${raw.title}|${raw.startDate}|${raw.locationText}`;
      const docId = `event_${cityId}_${hashString(stableKey)}`;
      if (reviewedQueueIds.has(docId)) {
        console.log(`  skip reviewed ${docId}`);
        skipped += 1;
        continue;
      }

      const existing = await db.collection('reviewQueue').doc(docId).get();
      if (existing.exists && String(existing.data()?.status || '') === 'needs_review') {
        console.log(`  skip already queued ${docId} ${raw.title} @ ${raw.startDate}`);
        skipped += 1;
        continue;
      }

      const candidate = {
        title: raw.title,
        startDate: raw.startDate,
        endDate: raw.endDate || raw.startDate,
        locationText: raw.locationText,
        address: raw.address || raw.locationText,
        locationName: raw.locationName || '',
        website: raw.website,
        description: String(raw.description || '').slice(0, 2000),
        timeDisplay: raw.timeDisplay || '',
        actionTags,
        sectorCategories: raw.sectorCategories || [],
        source: 'web_agent',
        sourceHost: hostFromUrl(raw.website || raw.sourceUrl),
      };
      if (raw.recurrence) candidate.recurrence = raw.recurrence;

      const memorySignal = await memoryLookup.assess(candidate);
      if (memorySignal.hardDuplicate) {
        console.log(`  skip memory ${raw.title} @ ${raw.startDate} (${memorySignal.reasons.join(',')})`);
        skipped += 1;
        continue;
      }

      let confidence = confidenceForEvent(candidate, circular.matchedKeywords.length, memorySignal.boost || 0);
      if (circular.via === 'title') confidence = Math.min(0.95, confidence + 0.06);

      const payload = {
        kind: 'event',
        cityId,
        status: 'needs_review',
        confidence,
        candidate,
        evidence: [
          {
            url: raw.sourceUrl || raw.website,
            snippet: `curated seed; circular=${circular.matchedKeywords.slice(0, 3).join(',')}; via=${circular.via}; geo=${geo.reason}${
              geo.matched ? `:${geo.matched}` : ''
            }; actions=${actionTags.join(',')}`,
            capturedAt: new Date().toISOString(),
          },
        ],
        matchCandidates: [],
        updatedAt: FieldValue.serverTimestamp(),
        createdAt: FieldValue.serverTimestamp(),
      };

      console.log(`  ${dryRun ? '[dry-run] ' : ''}${docId} ${candidate.title} @ ${candidate.startDate} (${confidence.toFixed(2)})`);
      if (!dryRun) {
        await db.collection('reviewQueue').doc(docId).set(payload, { merge: true });
        written += 1;
      }
      runSeenKeys.add(key);
    }
  }

  console.log(`[enqueue-events] ${dryRun ? 'dry-run' : 'committed'} written=${written} skipped=${skipped}`);
}

main().catch((err) => {
  console.error('[enqueue-events] failed', err);
  process.exitCode = 1;
});
