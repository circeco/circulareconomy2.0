/* eslint-disable no-console */
/**
 * Seeds Firestore with:
 * - `cities/{cityId}` for Stockholm, Milan, Turin, Uppsala
 * - sample `reviewQueue/*` candidates (place + event)
 *
 * Designed to be:
 * - emulator friendly (set FIRESTORE_EMULATOR_HOST)
 * - idempotent (safe to run multiple times)
 *
 * Usage:
 * - Emulator: FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 npm run seed:firestore
 * - Real project: uses secrets/firebase-adminsdk.json (see secrets/README.md)
 *   or GOOGLE_APPLICATION_CREDENTIALS
 */

const path = require('path');
const { readFileSync, existsSync } = require('fs');
const { initializeApp, cert, getApps } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');

const PROJECT_ID = process.env.FIREBASE_PROJECT_ID || 'circeco-bf511';

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
      '[seed] No credentials for production. Add secrets/firebase-adminsdk.json or set GOOGLE_APPLICATION_CREDENTIALS.'
    );
    process.exit(1);
  }
  const sa = JSON.parse(readFileSync(credPath, 'utf8'));
  initializeApp({ credential: cert(sa), projectId: sa.project_id || PROJECT_ID });
}

function isoNow() {
  return new Date().toISOString();
}

function dayIso(d) {
  // ISO date (YYYY-MM-DD) without timezone surprises
  const dt = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  return dt.toISOString().slice(0, 10);
}

async function main() {
  initAdminApp();
  const db = getFirestore();

  const cities = [
    {
      id: 'stockholm',
      name: 'Stockholm',
      countryCode: 'SE',
      center: { lat: 59.325, lng: 18.072 },
      timezone: 'Europe/Stockholm',
      enabled: true,
    },
    {
      id: 'uppsala',
      name: 'Uppsala',
      countryCode: 'SE',
      center: { lat: 59.8586, lng: 17.6389 },
      timezone: 'Europe/Stockholm',
      enabled: true,
    },
    {
      id: 'milan',
      name: 'Milan',
      countryCode: 'IT',
      center: { lat: 45.4642, lng: 9.19 },
      timezone: 'Europe/Rome',
      enabled: true,
    },
    {
      id: 'turin',
      name: 'Turin',
      countryCode: 'IT',
      center: { lat: 45.0703, lng: 7.6869 },
      timezone: 'Europe/Rome',
      enabled: true,
    },
  ];

  console.log(`[seed] projectId=${PROJECT_ID}`);
  console.log(`[seed] FIRESTORE_EMULATOR_HOST=${process.env.FIRESTORE_EMULATOR_HOST || '(not set)'}`);

  // --- cities ---
  for (const c of cities) {
    await db.collection('cities').doc(c.id).set(
      {
        name: c.name,
        countryCode: c.countryCode,
        center: c.center,
        timezone: c.timezone,
        enabled: c.enabled,
        updatedAt: FieldValue.serverTimestamp(),
        createdAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
  }
  console.log(`[seed] upserted ${cities.length} cities`);

  // --- sample reviewQueue candidates ---
  const today = new Date();
  const in7 = new Date(today.getTime() + 7 * 24 * 60 * 60 * 1000);

  const samples = [];
  for (const c of cities) {
    samples.push({
      id: `place_${c.id}_sample`,
      kind: 'place',
      cityId: c.id,
      status: 'needs_review',
      confidence: 0.35,
      candidate: {
        name: `Sample place (${c.name})`,
        address: `Sample address, ${c.name}`,
        sectorCategories: [],
        actionTags: [],
      },
      evidence: [
        {
          url: 'https://example.com',
          snippet: 'Sample evidence snippet (replace with real source).',
          capturedAt: isoNow(),
        },
      ],
      matchCandidates: [],
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });

    samples.push({
      id: `event_${c.id}_sample`,
      kind: 'event',
      cityId: c.id,
      status: 'needs_review',
      confidence: 0.35,
      candidate: {
        title: `Sample event (${c.name})`,
        startDate: dayIso(in7),
        endDate: dayIso(in7),
        locationText: `Sample venue, ${c.name}`,
        sectorCategories: [],
        actionTags: [],
      },
      evidence: [
        {
          url: 'https://example.com',
          snippet: 'Sample evidence snippet (replace with real source).',
          capturedAt: isoNow(),
        },
      ],
      matchCandidates: [],
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
  }

  const batch = db.batch();
  for (const s of samples) {
    const ref = db.collection('reviewQueue').doc(s.id);
    batch.set(ref, s, { merge: true });
  }
  await batch.commit();
  console.log(`[seed] upserted ${samples.length} reviewQueue samples`);

  console.log('[seed] done');
}

main().catch((err) => {
  console.error('[seed] failed', err);
  process.exitCode = 1;
});

