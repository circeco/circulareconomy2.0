/* eslint-disable no-console */
/**
 * Learning V1 monthly signal report generator.
 *
 * Reads moderation outcomes from reviewQueue and writes aggregated stats to `learningStats`.
 *
 * Usage:
 *   node tools/generate-learning-v1-report.js --period=2026-03
 *   node tools/generate-learning-v1-report.js --period=2026-03 --city=milan
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
      '[learning-report] No credentials. Add secrets/firebase-adminsdk.json or set GOOGLE_APPLICATION_CREDENTIALS.'
    );
    process.exit(1);
  }
  const sa = JSON.parse(readFileSync(credPath, 'utf8'));
  initializeApp({ credential: cert(sa), projectId: sa.project_id || PROJECT_ID });
}

function parseArgs() {
  const out = {
    period: '',
    city: '',
  };
  for (const a of process.argv.slice(2)) {
    if (a.startsWith('--period=')) out.period = a.slice('--period='.length).trim();
    else if (a.startsWith('--city=')) out.city = a.slice('--city='.length).trim().toLowerCase();
  }
  if (!/^\d{4}-\d{2}$/.test(out.period)) {
    const d = new Date();
    out.period = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  }
  return out;
}

function toMonthBounds(period) {
  const [y, m] = period.split('-').map((x) => parseInt(x, 10));
  const start = new Date(Date.UTC(y, m - 1, 1, 0, 0, 0, 0));
  const end = new Date(Date.UTC(m === 12 ? y + 1 : y, m === 12 ? 0 : m, 1, 0, 0, 0, 0));
  return { start, end };
}

function toIso(value) {
  if (!value) return '';
  if (typeof value === 'string') return value;
  if (value && typeof value.toDate === 'function') return value.toDate().toISOString();
  try {
    return new Date(value).toISOString();
  } catch {
    return '';
  }
}

function inRange(isoStr, start, end) {
  if (!isoStr) return false;
  const t = Date.parse(isoStr);
  return Number.isFinite(t) && t >= start.getTime() && t < end.getTime();
}

function splitTags(raw) {
  if (!raw) return [];
  return String(raw)
    .split(/[;,]/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

function addCount(map, key, status) {
  const row = map.get(key) || { key, reviewed: 0, approved: 0, rejected: 0 };
  row.reviewed += 1;
  if (status === 'approved') row.approved += 1;
  else if (status === 'rejected') row.rejected += 1;
  map.set(key, row);
}

function sortSignals(map) {
  return [...map.values()]
    .map((row) => ({
      ...row,
      approvalRate: row.reviewed ? Number((row.approved / row.reviewed).toFixed(4)) : 0,
      support: row.reviewed,
    }))
    .sort((a, b) => b.support - a.support || a.key.localeCompare(b.key));
}

function topN(rows, n, predicate) {
  return rows.filter(predicate).slice(0, n);
}

async function resolveCities(db, explicitCity) {
  if (explicitCity) return [explicitCity];
  const snap = await db.collection('cities').get();
  return snap.docs.map((d) => d.id).sort();
}

function extractSignals(docData) {
  const c = docData?.candidate || {};
  const action = splitTags(c.actionTags);
  const sector = splitTags(c.sectorCategories);
  const source = String(c.source || '').toLowerCase().trim();
  const out = [];
  for (const a of action) out.push(`action:${a}`);
  for (const s of sector) out.push(`sector:${s}`);
  if (source) out.push(`source:${source}`);
  return [...new Set(out)];
}

async function buildCityReport(db, cityId, period, start, end) {
  const approvedSnap = await db
    .collection('reviewQueue')
    .where('kind', '==', 'place')
    .where('cityId', '==', cityId)
    .where('status', '==', 'approved')
    .get();
  const rejectedSnap = await db
    .collection('reviewQueue')
    .where('kind', '==', 'place')
    .where('cityId', '==', cityId)
    .where('status', '==', 'rejected')
    .get();

  const docs = [...approvedSnap.docs, ...rejectedSnap.docs];
  const signalMap = new Map();
  let reviewedCount = 0;
  let approvedCount = 0;
  let rejectedCount = 0;

  for (const d of docs) {
    const row = d.data() || {};
    const reviewedAt = toIso(row.review?.reviewedAt || row.updatedAt || row.createdAt);
    if (!inRange(reviewedAt, start, end)) continue;
    const status = row.status === 'approved' ? 'approved' : row.status === 'rejected' ? 'rejected' : '';
    if (!status) continue;
    reviewedCount += 1;
    if (status === 'approved') approvedCount += 1;
    else rejectedCount += 1;
    const signals = extractSignals(row);
    for (const signal of signals) addCount(signalMap, signal, status);
  }

  const allSignals = sortSignals(signalMap);
  const positives = topN(allSignals, 20, (r) => r.support >= 3 && r.approvalRate >= 0.75);
  const negatives = topN(allSignals, 20, (r) => r.support >= 3 && r.approvalRate <= 0.25);

  return {
    cityId,
    period,
    reviewedCount,
    approvedCount,
    rejectedCount,
    overallApprovalRate: reviewedCount ? Number((approvedCount / reviewedCount).toFixed(4)) : 0,
    signalStats: allSignals.slice(0, 300),
    positives,
    negatives,
    generatedAt: new Date().toISOString(),
  };
}

async function main() {
  const args = parseArgs();
  const { start, end } = toMonthBounds(args.period);
  initAdminApp();
  const db = getFirestore();
  const cities = await resolveCities(db, args.city);
  if (!cities.length) {
    console.error('[learning-report] No cities found.');
    process.exitCode = 1;
    return;
  }
  console.log(`[learning-report] period=${args.period} cities=${cities.join(',')}`);
  for (const cityId of cities) {
    const report = await buildCityReport(db, cityId, args.period, start, end);
    const docId = `${cityId}_${args.period}`;
    await db.collection('learningStats').doc(docId).set(
      {
        ...report,
        updatedAt: FieldValue.serverTimestamp(),
        createdAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
    console.log(
      `[learning-report] city=${cityId} reviewed=${report.reviewedCount} approved=${report.approvedCount} rejected=${report.rejectedCount} signals=${report.signalStats.length}`
    );
  }
}

main().catch((err) => {
  console.error('[learning-report] failed', err);
  process.exitCode = 1;
});

