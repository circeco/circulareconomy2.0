/* eslint-disable no-console */
/**
 * Process admin-queued discovery jobs from Firestore `discoveryJobs`.
 *
 * Usage:
 *   node tools/process-discovery-jobs.js
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
    console.error('[discovery-jobs] No credentials. Add secrets/firebase-adminsdk.json or set GOOGLE_APPLICATION_CREDENTIALS.');
    process.exit(1);
  }
  const sa = JSON.parse(readFileSync(credPath, 'utf8'));
  initializeApp({ credential: cert(sa), projectId: sa.project_id || PROJECT_ID });
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

async function runPlaces(cityId, radiusM) {
  const args = [`--city=${cityId}`, '--limit=100'];
  if (Number.isFinite(radiusM) && radiusM >= 1000) args.push(`--radius=${Math.trunc(radiusM)}`);
  return runNodeScript('discover-osm-places.js', args);
}

async function runEvents(cityId) {
  const shared = [`--city=${cityId}`, '--limit=40', '--max-past-days=0'];
  const [agentRes, feedRes] = await Promise.all([
    runNodeScript('discover-events-agent.js', [...shared, '--max-queries=20', '--max-pages=28']),
    runNodeScript('discover-event-feeds.js', shared),
  ]);
  return {
    exitCode: Number(agentRes.exitCode || 0) !== 0 || Number(feedRes.exitCode || 0) !== 0 ? 1 : 0,
    stdout: `${agentRes.stdout || ''}\n${feedRes.stdout || ''}`,
    stderr: `${agentRes.stderr || ''}\n${feedRes.stderr || ''}`,
  };
}

async function main() {
  initAdminApp();
  const db = getFirestore();
  const snap = await db.collection('discoveryJobs').where('status', '==', 'queued').get();
  if (snap.empty) {
    console.log('[discovery-jobs] no queued jobs');
    return;
  }
  const jobs = snap.docs.slice().sort((a, b) => {
    const aAt = a.data()?.requestedAt?.toMillis?.() || 0;
    const bAt = b.data()?.requestedAt?.toMillis?.() || 0;
    return aAt - bAt;
  });
  console.log(`[discovery-jobs] queued=${jobs.length}`);
  for (const d of jobs) {
    const data = d.data() || {};
    const cityId = String(data.cityId || '').trim().toLowerCase();
    const source = data.source === 'events' ? 'events' : data.source === 'places' ? 'places' : '';
    if (!cityId || !source) {
      await d.ref.update({
        status: 'failed',
        errorSummary: 'Missing cityId or source',
        updatedAt: FieldValue.serverTimestamp(),
      });
      continue;
    }
    await d.ref.update({
      status: 'running',
      errorSummary: '',
      startedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    console.log(`[discovery-jobs] start city=${cityId} source=${source}`);
    const radiusM = Number(data.radiusM || 0);
    const result = source === 'events' ? await runEvents(cityId) : await runPlaces(cityId, radiusM);
    const ok = Number(result.exitCode || 0) === 0;
    await d.ref.update({
      status: ok ? 'done' : 'failed',
      errorSummary: ok ? '' : String(result.stderr || result.stdout || 'Discovery failed').slice(0, 800),
      finishedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    console.log(`[discovery-jobs] ${ok ? 'done' : 'failed'} city=${cityId} source=${source}`);
  }
}

main().catch((err) => {
  console.error('[discovery-jobs] failed', err);
  process.exitCode = 1;
});
