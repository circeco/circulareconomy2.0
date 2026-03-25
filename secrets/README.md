# Local secrets (not committed to git)

This folder holds **machine-only** credentials. Everything here except this `README.md` is **ignored by git**, so your Firebase private key never goes to GitHub.

## Firebase Admin SDK key (for `npm run admin:set-claim`)

1. In [Firebase Console](https://console.firebase.google.com/) → **Project settings** → **Service accounts** → **Generate new private key**.
2. Save the downloaded JSON into **this folder** with this **exact name**:

   **`firebase-adminsdk.json`**

   (You can copy/rename your file, e.g. from Downloads.)

3. From the **repository root** run:

   ```bash
   npm run admin:set-claim -- your.email@example.com
   ```

The script looks for credentials in this order:

1. `GOOGLE_APPLICATION_CREDENTIALS` (if you set it), else  
2. `secrets/firebase-adminsdk.json`

**Do not** rename `firebase-adminsdk.json` to something else unless you use `GOOGLE_APPLICATION_CREDENTIALS`.

If this key leaks, revoke it in the Console and generate a new one.
