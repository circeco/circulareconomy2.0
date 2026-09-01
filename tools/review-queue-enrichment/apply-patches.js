/* eslint-disable no-console */
/**
 * Apply researched patches to Firestore `reviewQueue/{id}.candidate` only.
 * Never writes the live `places` collection.
 *
 * Usage:
 *   node tools/review-queue-enrichment/apply-patches.js
 *   node tools/review-queue-enrichment/apply-patches.js --dry-run
 *   node tools/review-queue-enrichment/apply-patches.js --apply
 *   node tools/review-queue-enrichment/apply-patches.js --apply --id=osm_milan_node_13974227668
 *
 * Default is --dry-run. Requires credentials like tools/discover-osm-places.js
 * (secrets/firebase-adminsdk.json or GOOGLE_APPLICATION_CREDENTIALS).
 * Project: circeco-bf511
 */

const path = require('path');
const { readFileSync, existsSync } = require('fs');

const PROJECT_ID = process.env.FIREBASE_PROJECT_ID || 'circeco-bf511';
const PATCHES_PATH = path.join(__dirname, 'patches.json');
const CANDIDATE_KEYS = ['description', 'address', 'website', 'actionTags', 'sectorCategories'];

const ACTION_TAGS = ['refuse', 'reuse', 'repair', 'repurpose', 'recycle', 'reduce'];
const SECTOR_CATEGORIES = [
  'apparel',
  'home-garden',
  'cycling-sports',
  'electronics',
  'books-comics-magazines',
  'music',
];

function canonicalizeActionTag(input) {
  const raw = String(input ?? '').trim().toLowerCase();
  if (!raw) return null;
  const normalized =
    raw === 'reporpouse' ? 'repurpose'
    : raw === 'rethink' ? 'refuse'
    : raw === 'refurbish' || raw === 'refurnish' ? 'repair'
    : raw === 'remanufacture' || raw === 'remanifacture' ? 'repurpose'
    : raw === 'share' || raw === 'rental' ? 'reuse'
    : raw;
  return ACTION_TAGS.includes(normalized) ? normalized : null;
}

function canonicalizeActionTags(inputs) {
  if (!Array.isArray(inputs)) return [];
  const out = [];
  for (const v of inputs) {
    for (const part of String(v).split(/[;|,]/)) {
      const tag = canonicalizeActionTag(part);
      if (tag && !out.includes(tag)) out.push(tag);
    }
  }
  return out.slice(0, 2);
}

function canonicalizeSectorCategory(input) {
  const raw = String(input ?? '').trim().toLowerCase();
  if (!raw) return null;
  const normalized = raw
    .replace(/^shop:/, '')
    .replace(/^amenity:/, '')
    .replace(/^craft:/, '')
    .replace(/\s*&\s*/g, '-')
    .replace(/\s+/g, '-');
  if (normalized === 'apparel' || normalized === 'clothing' || normalized === 'accessories') return 'apparel';
  if (normalized === 'home-garden' || normalized === 'home' || normalized === 'furniture' || normalized === 'antiques') {
    return 'home-garden';
  }
  if (normalized === 'cycling-sports' || normalized === 'sport' || normalized === 'sports' || normalized === 'cycling') {
    return 'cycling-sports';
  }
  if (normalized === 'electronics') return 'electronics';
  if (
    normalized === 'books-comics-magazines'
    || normalized === 'books'
    || normalized === 'comics'
    || normalized === 'magazines'
  ) {
    return 'books-comics-magazines';
  }
  if (normalized === 'music') return 'music';
  return null;
}

function canonicalizeSectorCategories(inputs) {
  if (!Array.isArray(inputs)) return [];
  const out = [];
  for (const v of inputs) {
    const item = canonicalizeSectorCategory(v);
    if (item && !out.includes(item)) out.push(item);
  }
  return out;
}

function loadAdmin() {
  const { initializeApp, cert, getApps } = require('firebase-admin/app');
  const { getFirestore, FieldValue } = require('firebase-admin/firestore');
  return { initializeApp, cert, getApps, getFirestore, FieldValue };
}

function initAdminApp(admin) {
  const { initializeApp, cert, getApps } = admin;
  if (getApps().length > 0) return;
  if (process.env.FIRESTORE_EMULATOR_HOST) {
    initializeApp({ projectId: PROJECT_ID });
    return;
  }
  const repoRoot = path.resolve(__dirname, '../..');
  const defaultCredPath = path.join(repoRoot, 'secrets', 'firebase-adminsdk.json');
  const credPath = process.env.GOOGLE_APPLICATION_CREDENTIALS || defaultCredPath;
  if (!existsSync(credPath)) {
    console.error(
      '[apply-patches] No credentials. Add secrets/firebase-adminsdk.json or set GOOGLE_APPLICATION_CREDENTIALS.'
    );
    process.exit(1);
  }
  const sa = JSON.parse(readFileSync(credPath, 'utf8'));
  initializeApp({ credential: cert(sa), projectId: sa.project_id || PROJECT_ID });
}

function parseArgs() {
  const out = { dryRun: true, id: '' };
  for (const a of process.argv.slice(2)) {
    if (a === '--dry-run') out.dryRun = true;
    else if (a === '--apply') out.dryRun = false;
    else if (a.startsWith('--id=')) out.id = a.slice('--id='.length).trim();
  }
  return out;
}

function proposedUpdate(patch) {
  const proposed = patch.proposed || {};
  const update = {};
  for (const key of CANDIDATE_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(proposed, key)) continue;
    let value = proposed[key];
    if (key === 'actionTags') value = canonicalizeActionTags(value);
    if (key === 'sectorCategories') value = canonicalizeSectorCategories(value);
    update[`candidate.${key}`] = value;
  }
  return update;
}

async function main() {
  const args = parseArgs();
  const patches = JSON.parse(readFileSync(PATCHES_PATH, 'utf8'));
  if (!Array.isArray(patches)) {
    console.error('[apply-patches] patches.json must be an array');
    process.exit(1);
  }
  const selected = args.id ? patches.filter((p) => p.id === args.id) : patches;
  if (args.id && !selected.length) {
    console.error(`[apply-patches] no patch for id=${args.id}`);
    process.exit(1);
  }

  console.log(`[apply-patches] project=${PROJECT_ID} dryRun=${args.dryRun} patches=${selected.length}`);
  if (args.dryRun) {
    for (const patch of selected) {
      const update = proposedUpdate(patch);
      console.log(
        JSON.stringify({
          id: patch.id,
          flags: patch.flags || [],
          update,
        })
      );
    }
    console.log('[apply-patches] dry-run complete. Pass --apply to write reviewQueue only.');
    return;
  }

  const admin = loadAdmin();
  initAdminApp(admin);
  const db = admin.getFirestore();
  const { FieldValue } = admin;
  let applied = 0;
  let skipped = 0;
  for (const patch of selected) {
    const update = proposedUpdate(patch);
    if (!Object.keys(update).length) {
      skipped += 1;
      console.log(`[skip] ${patch.id} (no proposed fields)`);
      continue;
    }
    update.updatedAt = FieldValue.serverTimestamp();
    const ref = db.collection('reviewQueue').doc(patch.id);
    const snap = await ref.get();
    if (!snap.exists) {
      skipped += 1;
      console.error(`[missing] reviewQueue/${patch.id}`);
      continue;
    }
    await ref.update(update);
    applied += 1;
    console.log(`[updated] reviewQueue/${patch.id} fields=${Object.keys(update).filter((k) => k !== 'updatedAt').join(',')}`);
  }
  console.log(`[apply-patches] done applied=${applied} skipped=${skipped}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
