/* eslint-disable no-console */
/**
 * Multi-city scheduled discovery runner.
 *
 * Executes discover-osm-places.js and/or discover-event-feeds.js per city,
 * logs structured run metrics to `discoveryRuns`, and keeps city failures isolated.
 *
 * Usage:
 *   node tools/scheduled-discovery-job.js
 *   node tools/scheduled-discovery-job.js --cities=milan,stockholm --radius=6000 --limit=120
 *   node tools/scheduled-discovery-job.js --sources=events --event-max-past-days=0
 *   node tools/scheduled-discovery-job.js --dry-run
 */
const path = require('path');
const { readFileSync, existsSync } = require('fs');
const { spawn } = require('child_process');
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
    console.error('[scheduled-discovery] No credentials. Add secrets/firebase-adminsdk.json or set GOOGLE_APPLICATION_CREDENTIALS.');
    process.exit(1);
  }
  const sa = JSON.parse(readFileSync(credPath, 'utf8'));
  initializeApp({ credential: cert(sa), projectId: sa.project_id || PROJECT_ID });
}

function parseArgs() {
  const out = {
    cities: [],
    radiusM: 9000,
    limit: 100,
    eventMaxPastDays: 0,
    sources: ['places', 'events'],
    dryRun: false,
    runLabel: '',
  };
  for (const a of process.argv.slice(2)) {
    if (a === '--dry-run') out.dryRun = true;
    else if (a.startsWith('--cities=')) {
      out.cities = a.slice('--cities='.length).split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
    } else if (a.startsWith('--radius=')) out.radiusM = Math.max(1000, parseInt(a.slice('--radius='.length), 10) || 9000);
    else if (a.startsWith('--limit=')) out.limit = Math.max(1, parseInt(a.slice('--limit='.length), 10) || 100);
    else if (a.startsWith('--event-max-past-days=')) out.eventMaxPastDays = Math.max(0, parseInt(a.slice('--event-max-past-days='.length), 10) || 0);
    else if (a.startsWith('--sources=')) {
      const items = a.slice('--sources='.length).split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
      const next = [];
      for (const item of items) {
        if (item === 'place' || item === 'places' || item === 'osm') {
          if (!next.includes('places')) next.push('places');
        } else if (item === 'event' || item === 'events' || item === 'feed' || item === 'feeds') {
          if (!next.includes('events')) next.push('events');
        } else if (item === 'both' || item === 'all') {
          if (!next.includes('places')) next.push('places');
          if (!next.includes('events')) next.push('events');
        }
      }
      if (next.length) out.sources = next;
    } else if (a.startsWith('--run-label=')) out.runLabel = a.slice('--run-label='.length).trim();
  }
  return out;
}

function parsePlaceDiscoverMetrics(outputText) {
  const overpass = outputText.match(/Overpass returned (\d+) elements, (\d+) candidates after filters/) || [];
  const skipped = outputText.match(/(\d+) reviewed queue skipped;\s+(\d+) hard memory skips;\s+(\d+) soft-memory confidence skips;\s+(\d+) soft-memory penalties;\s+(\d+) duplicates vs approved skipped/) || [];
  const write = outputText.match(/writing (\d+) \(limit (\d+)\)/) || [];
  return {
    fetchedCount: Number(overpass[1] || 0),
    candidatesAfterFilters: Number(overpass[2] || 0),
    skippedReviewedQueue: Number(skipped[1] || 0),
    skippedMemoryHard: Number(skipped[2] || 0),
    skippedMemorySoft: Number(skipped[3] || 0),
    memoryPenaltiesApplied: Number(skipped[4] || 0),
    skippedApproved: Number(skipped[5] || 0),
    queuedCount: Number(write[1] || 0),
    configuredLimit: Number(write[2] || 0),
  };
}

function parseEventDiscoverMetrics(outputText) {
  const summary = outputText.match(/fetched (\d+) raw entries, (\d+) candidates after filters/) || [];
  const skipped = outputText.match(/(\d+) past skipped;\s+(\d+) reviewed queue skipped;\s+(\d+) existing approved skipped;\s+(\d+) run duplicates skipped;\s+(\d+) missing location skipped;\s+(\d+) non-circular skipped;\s+(\d+) feeds failed/) || [];
  const write = outputText.match(/writing (\d+) \(limit (\d+)\)/) || [];
  return {
    fetchedCount: Number(summary[1] || 0),
    candidatesAfterFilters: Number(summary[2] || 0),
    skippedPast: Number(skipped[1] || 0),
    skippedReviewedQueue: Number(skipped[2] || 0),
    skippedApproved: Number(skipped[3] || 0),
    skippedRunDuplicates: Number(skipped[4] || 0),
    skippedMissingLocation: Number(skipped[5] || 0),
    skippedNotCircular: Number(skipped[6] || 0),
    failedFeeds: Number(skipped[7] || 0),
    queuedCount: Number(write[1] || 0),
    configuredLimit: Number(write[2] || 0),
  };
}

function runNodeScript(scriptFile, scriptArgs) {
  const repoRoot = path.resolve(__dirname, '..');
  const cmdArgs = [path.join('tools', scriptFile), ...scriptArgs];
  return new Promise((resolve) => {
    const child = spawn('node', cmdArgs, { cwd: repoRoot, env: process.env });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => {
      const s = String(d);
      stdout += s;
      process.stdout.write(s);
    });
    child.stderr.on('data', (d) => {
      const s = String(d);
      stderr += s;
      process.stderr.write(s);
    });
    child.on('close', (code) => resolve({ exitCode: Number(code || 0), stdout, stderr }));
  });
}

function runCityPlaceDiscovery(cityId, args) {
  const cmdArgs = [`--city=${cityId}`, `--radius=${args.radiusM}`, `--limit=${args.limit}`];
  if (args.dryRun) cmdArgs.push('--dry-run');
  return runNodeScript('discover-osm-places.js', cmdArgs);
}

function runCityEventDiscovery(cityId, args) {
  const cmdArgs = [`--city=${cityId}`, `--limit=${args.limit}`, `--max-past-days=${args.eventMaxPastDays}`];
  if (args.dryRun) cmdArgs.push('--dry-run');
  return runNodeScript('discover-event-feeds.js', cmdArgs);
}

async function resolveCities(db, explicit) {
  if (explicit.length) return explicit;
  const snap = await db.collection('cities').get();
  const ids = [];
  for (const d of snap.docs) {
    const city = d.data() || {};
    if (city.enabled === false) continue;
    ids.push(d.id);
  }
  return ids.sort();
}

async function logRunDoc(db, docId, payload) {
  await db.collection('discoveryRuns').doc(docId).set(payload, { merge: true });
}

async function main() {
  const args = parseArgs();
  initAdminApp();
  const db = getFirestore();
  const cities = await resolveCities(db, args.cities);
  if (!cities.length) {
    console.error('[scheduled-discovery] No cities resolved.');
    process.exitCode = 1;
    return;
  }
  const jobStartedAt = new Date().toISOString();
  const runPrefix = args.runLabel || `monthly_${jobStartedAt.slice(0, 7)}`;
  console.log(`[scheduled-discovery] start label=${runPrefix} cities=${cities.join(',')} sources=${args.sources.join(',')} radius=${args.radiusM} limit=${args.limit} eventMaxPastDays=${args.eventMaxPastDays} dryRun=${args.dryRun}`);

  let ok = 0;
  let failed = 0;
  for (const cityId of cities) {
    const startedAt = Date.now();
    const runId = `${runPrefix}_${cityId}_${startedAt}`;
    const baseDoc = {
      runId,
      cityId,
      sourceSet: [
        ...(args.sources.includes('places') ? ['osm'] : []),
        ...(args.sources.includes('events') ? ['event_feeds'] : []),
      ],
      startedAt: new Date(startedAt).toISOString(),
      status: 'running',
      dryRun: args.dryRun,
      config: {
        sources: args.sources,
        radiusM: args.radiusM,
        limit: args.limit,
        eventMaxPastDays: args.eventMaxPastDays,
      },
      updatedAt: FieldValue.serverTimestamp(),
      createdAt: FieldValue.serverTimestamp(),
    };
    await logRunDoc(db, runId, baseDoc);
    console.log(`[scheduled-discovery] city=${cityId} runId=${runId}`);

    const placeEnabled = args.sources.includes('places');
    const eventEnabled = args.sources.includes('events');
    const placeRes = placeEnabled ? await runCityPlaceDiscovery(cityId, args) : { exitCode: 0, stdout: '', stderr: '' };
    const eventRes = eventEnabled ? await runCityEventDiscovery(cityId, args) : { exitCode: 0, stdout: '', stderr: '' };

    const elapsedMs = Date.now() - startedAt;
    const placeMetrics = parsePlaceDiscoverMetrics(`${placeRes.stdout}\n${placeRes.stderr}`);
    const eventMetrics = parseEventDiscoverMetrics(`${eventRes.stdout}\n${eventRes.stderr}`);
    const status = placeRes.exitCode === 0 && eventRes.exitCode === 0 ? 'success' : 'failed';

    const payload = {
      ...baseDoc,
      status,
      finishedAt: new Date().toISOString(),
      elapsedMs,
      fetchedCount: placeMetrics.fetchedCount + eventMetrics.fetchedCount,
      queuedCount: placeMetrics.queuedCount + eventMetrics.queuedCount,
      places: placeMetrics,
      events: eventMetrics,
      candidatesAfterFilters: placeMetrics.candidatesAfterFilters,
      skippedReviewedQueue: placeMetrics.skippedReviewedQueue,
      skippedApproved: placeMetrics.skippedApproved,
      skippedMemoryHard: placeMetrics.skippedMemoryHard,
      skippedMemorySoft: placeMetrics.skippedMemorySoft,
      memoryPenaltiesApplied: placeMetrics.memoryPenaltiesApplied,
      errorSummary: status === 'success' ? '' : `${String(placeRes.stderr || '').slice(0, 1000)}\n${String(eventRes.stderr || '').slice(0, 1000)}`.trim(),
      updatedAt: FieldValue.serverTimestamp(),
    };
    await logRunDoc(db, runId, payload);
    if (status === 'success') ok++;
    else failed++;
  }

  console.log(`[scheduled-discovery] complete startedAt=${jobStartedAt} ok=${ok} failed=${failed}`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error('[scheduled-discovery] failed', err);
  process.exitCode = 1;
});

