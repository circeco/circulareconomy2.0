# Firebase rules and admin access

Hosting, project id, and how the app uses Firestore: [`ARCHITECTURE.md`](ARCHITECTURE.md). Schema: [`DATA_MODEL_AND_PIPELINE.md`](DATA_MODEL_AND_PIPELINE.md).

## Rules

`firestore.rules` is what is deployed. `firebase.json` points at that file.

| Collection | Read | Write |
|---|---|---|
| `events`, `places` | Anyone if `status == 'approved'`; admins can read all | `admin: true` custom claim |
| `cities` | Public | Admin |
| `reviewQueue` | Admin | Admin |
| `reviewMemory*` | Admin | Admin |
| `eventReviewMemory*` | Admin | Admin |
| `discoveryRuns`, `learningStats`, `discoveryConfig`, `discoveryJobs` | Admin | Admin |
| `users/{uid}/favourites/*` | That user | That user |
| `users/{uid}/eventFavourites/*` | That user | That user |
| Everything else | Denied | Denied |

Public queries must use `where('status','==','approved')`. Firestore rejects a query that could return documents the caller is not allowed to read.

### Deploy rules

Rules are **not** published by the Hosting GitHub Action. From the repo root:

```bash
npx firebase login
npx firebase use circeco-bf511
npx firebase deploy --only firestore:rules
```

Or paste `firestore.rules` into Firebase Console → Firestore → Rules → Publish.

## Grant the `admin` claim

Firebase Console has no “admin” tick box. Set `admin: true` on the Auth user with the Admin SDK.

The service account JSON lives on your machine in gitignored `secrets/firebase-adminsdk.json` (see [`secrets/README.md`](secrets/README.md)). GitHub Actions uses the same key as secret `FIREBASE_SERVICE_ACCOUNT_CIRCECO_BF511`.

```bash
npm run admin:set-claim -- your.email@example.com
npm run admin:set-claim -- your.email@example.com --remove
```

Uses `secrets/firebase-adminsdk.json`, or `GOOGLE_APPLICATION_CREDENTIALS` if set.

After changing claims, **sign out and sign in** so the browser ID token includes `admin`. Then:

- `request.auth.token.admin == true` passes in rules
- `AuthService.isAdmin()` is true (required on production builds by `adminGuard`)

`adminGuard` may skip the claim on **localhost / 127.0.0.1** during `ng serve` only. Hosted builds always require the claim. Firestore never skips it.

## Hosting headers

`firebase.json` sets `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, and `Content-Security-Policy: frame-ancestors 'none'`. There is no full `script-src` / `connect-src` CSP (Mapbox, Firebase, Bootstrap, Font Awesome, Formspree would all need listing).

## Config notes (current)

- Formspree `recaptchaSiteKey` in environments is empty; the contact form posts without reCAPTCHA.
- Mapbox token is a public client token in environments; restrict it by HTTP referrer in the Mapbox account.
- Firebase Auth authorized domains must include `circeco.org` and `localhost`.
