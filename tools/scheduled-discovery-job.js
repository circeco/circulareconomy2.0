/* eslint-disable no-console */
/**
 * Multi-city scheduled discovery runner.
 *
 * Executes discover-osm-places.js per city, logs structured run metrics to `discoveryRuns`,
 * and keeps city failures isolated.
 *
 * Usage:
 *   node tools/scheduled-discovery-job.js
 *   node tools/scheduled-discovery-job.js --cities=milan,stockholm --radius=6000 --limit=120
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
    console.error(
      '[scheduled-discovery] No credentials. Add secrets/firebase-adminsdk.json or set GOOGLE_APPLICATION_CREDENTIALS.'
    );
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
    dryRun: false,
    runLabel: '',
  };
  for (const a of process.argv.slice(2)) {
    if (a === '--dry-run') out.dryRun = true;
    else if (a.startsWith('--cities=')) {
      out.cities = a
        .slice('--cities='.length)
        .split(',')
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean);
    } else if (a.startsWith('--radius=')) out.radiusM = Math.max(1000, parseInt(a.slice('--radius='.length), 10) || 9000);
    else if (a.startsWith('--limit=')) out.limit = Math.max(1, parseInt(a.slice('--limit='.length), 10) || 100);
    else if (a.startsWith('--run-label=')) out.runLabel = a.slice('--run-label='.length).trim();
  }
  return out;
}

function parseDiscoverMetrics(outputText) {
  const overpass =
    outputText.match(/Overpass returned (\d+) elements, (\d+) candidates after filters/) || [];
  const skipped = outputText.match(
    /(\d+) reviewed queue skipped;\s+(\d+) hard memory skips;\s+(\d+) soft-memory confidence skips;\s+(\d+) soft-memory penalties;\s+(\d+) duplicates vs approved skipped/
  ) || [];
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

function runCityDiscovery(cityId, args) {
  const repoRoot = path.resolve(__dirname, '..');
  const cmdArgs = [
    path.join('tools', 'discover-osm-places.js'),
    `--city=${cityId}`,
    `--radius=${args.radiusM}`,
    `--limit=${args.limit}`,
  ];
  if (args.dryRun) cmdArgs.push('--dry-run');
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
  console.log(
    `[scheduled-discovery] start label=${runPrefix} cities=${cities.join(',')} radius=${args.radiusM} limit=${args.limit} dryRun=${args.dryRun}`
  );

  let ok = 0;
  let failed = 0;
  for (const cityId of cities) {
    const startedAt = Date.now();
    const runId = `${runPrefix}_${cityId}_${startedAt}`;
    const baseDoc = {
      runId,
      cityId,
      sourceSet: ['osm'],
      startedAt: new Date(startedAt).toISOString(),
      status: 'running',
      dryRun: args.dryRun,
      config: {
        radiusM: args.radiusM,
        limit: args.limit,
      },
      updatedAt: FieldValue.serverTimestamp(),
      createdAt: FieldValue.serverTimestamp(),
    };
    await logRunDoc(db, runId, baseDoc);
    console.log(`[scheduled-discovery] city=${cityId} runId=${runId}`);

    const res = await runCityDiscovery(cityId, args);
    const elapsedMs = Date.now() - startedAt;
    const combined = `${res.stdout}\n${res.stderr}`;
    const metrics = parseDiscoverMetrics(combined);
    const payload = {
      ...baseDoc,
      status: res.exitCode === 0 ? 'success' : 'failed',
      finishedAt: new Date().toISOString(),
      elapsedMs,
      ...metrics,
      errorSummary: res.exitCode === 0 ? '' : String(res.stderr || '').slice(0, 2000),
      updatedAt: FieldValue.serverTimestamp(),
    };
    await logRunDoc(db, runId, payload);
    if (res.exitCode === 0) ok++;
    else failed++;
  }

  console.log(
    `[scheduled-discovery] complete startedAt=${jobStartedAt} ok=${ok} failed=${failed}`
  );
  if (failed > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error('[scheduled-discovery] failed', err);
  process.exitCode = 1;
});

