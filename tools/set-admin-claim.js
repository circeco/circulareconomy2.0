/* eslint-disable no-console */
/**
 * Grant Firestore "admin" custom claim to a Firebase Auth user (by email).
 * firestore.rules: request.auth.token.admin == true
 *
 * Credentials (first match wins):
 *   1) GOOGLE_APPLICATION_CREDENTIALS env var (absolute path to JSON)
 *   2) secrets/firebase-adminsdk.json (repo root; see secrets/README.md)
 *
 * Usage:
 *   npm run admin:set-claim -- your.email@example.com
 *
 * Remove admin:
 *   npm run admin:set-claim -- your.email@example.com --remove
 */
const path = require('path');
const { readFileSync, existsSync } = require('fs');
const { initializeApp, cert } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');

const email = process.argv[2];
const remove = process.argv.includes('--remove');

if (!email || email.startsWith('--')) {
  console.error('Usage: node tools/set-admin-claim.js <email> [--remove]');
  process.exit(1);
}

const repoRoot = path.resolve(__dirname, '..');
const defaultCredPath = path.join(repoRoot, 'secrets', 'firebase-adminsdk.json');
const credPath = process.env.GOOGLE_APPLICATION_CREDENTIALS || defaultCredPath;

if (!existsSync(credPath)) {
  console.error(
    'No service account JSON found.\n\n' +
      'Option A — recommended:\n' +
      `  Copy your Firebase private key to:\n  ${defaultCredPath}\n` +
      '  (see secrets/README.md)\n\n' +
      'Option B:\n' +
      '  export GOOGLE_APPLICATION_CREDENTIALS="/absolute/path/to/key.json"'
  );
  process.exit(1);
}

try {
  const sa = JSON.parse(readFileSync(credPath, 'utf8'));
  initializeApp({ credential: cert(sa), projectId: sa.project_id });
} catch (e) {
  console.error('Failed to load service account JSON:', credPath, e.message);
  process.exit(1);
}

async function main() {
  const auth = getAuth();
  const user = await auth.getUserByEmail(email);
  const claims = remove ? { admin: false } : { admin: true };
  await auth.setCustomUserClaims(user.uid, claims);
  console.log(
    remove
      ? `[ok] Removed admin claim for ${email} (uid ${user.uid})`
      : `[ok] Set admin claim for ${email} (uid ${user.uid})`
  );
  console.log('Next: in the web app, sign OUT and sign IN again so the new token includes the claim.');
}

main().catch((err) => {
  console.error('[error]', err.message || err);
  process.exitCode = 1;
});
