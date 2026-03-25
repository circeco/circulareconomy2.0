# Firebase rules (point 1) and admin access (points 2 & 3)

## Point 1 — Are the rules implemented well?

**Yes, for this app’s current shape**, with these intentions:

| Collection | Read | Write |
|------------|------|--------|
| `events` | Anyone can read documents where **`status == 'approved'`** | Only users with **`admin: true` custom claim** |
| `places` | Same pattern (for when the map reads from Firestore) | Admin only |
| `cities` | Public read | Admin only |
| `reviewQueue` | Admin only | Admin only |
| `users/{uid}/favourites/{docId}` | Only that signed-in user | Only that user |
| Everything else | Denied | Denied |

**Why the events query uses `where('status','==','approved')` in the app**

Firestore requires that a **query cannot return documents the user is not allowed to read**.  
If we only allowed `read` when `status == 'approved'` but the client queried **all** events, the query could fail.  
So the frontend queries **only approved** events, which matches the rule.

**Deploy the rules**

Rules live in **`firestore.rules`**; **`firebase.json`** references them.

1. Install CLI if needed: `npm i -g firebase-tools` (or use `npx firebase ...`).
2. Log in: `firebase login`
3. Select project: `firebase use circeco-bf511` (or your project id)
4. Deploy: `firebase deploy --only firestore:rules`

Or copy-paste the contents of **`firestore.rules`** into **Firebase Console → Firestore Database → Rules → Publish**.

---

## Point 2 — Grant the `admin` claim (not in the Console UI)

Firebase **does not** let you tick “admin” in the Console for custom claims.  
You set **`admin: true`** on the **Auth user** with the **Admin SDK** (server-side).

**Why a file “in the repo folder” but not “in git”?**

The key lives **on your computer** next to the project so scripts can find it.  
The **`secrets/`** folder is **git-ignored** (except `secrets/README.md`), so `git push` **never** uploads the JSON.  
GitHub only gets code; your laptop keeps the private key.

**One-time setup**

1. **Download the service account key**  
   Firebase Console → **Project settings** (gear) → **Service accounts** → **Generate new private key**.

2. **Put it in the repo’s ignored secrets folder**  
   Copy/rename the file to:

   **`secrets/firebase-adminsdk.json`**

   (See **`secrets/README.md`** in this repo.)

3. **Run the helper** (from **repo root**):

   ```bash
   npm run admin:set-claim -- your.email@example.com
   ```

   The script uses `secrets/firebase-adminsdk.json` automatically.  
   Optional override: `export GOOGLE_APPLICATION_CREDENTIALS="/other/path.json"`.

To remove admin later:

```bash
npm run admin:set-claim -- your.email@example.com --remove
```

---

## Point 3 — Why sign out / sign in again?

After you change custom claims, the **ID token** the browser already has is **old** and does **not** include `admin` yet.

**Do this:**

1. Open your app (e.g. `http://localhost:4200`).
2. **Sign out** (if you use account / auth UI).
3. **Sign in again** with the **same** email you used in the script.

After that, Firebase Auth issues a **new** ID token that includes `admin: true`, so:

- `request.auth.token.admin == true` passes in **Firestore rules**
- `AuthService.isAdmin()` in the Angular app can return **true** (used on production builds where the route guard checks admin)

**If it still fails**

- Wait a few seconds and sign out/in once more.
- In DevTools → Network, confirm you are not using an old cached session only; a full sign-out clears the old token.

---

## How this fits the review page

- **Firestore** always enforces **`firestore.rules`**.  
  Approve/Reject needs a signed-in user **with** `admin: true`.
- The **localhost-only route bypass** on `/admin/review` only skips the **Angular** `adminGuard`; it does **not** bypass Firestore.  
  So you still need the claim + deploy rules for writes to succeed.
