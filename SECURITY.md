# SECURITY ADVISORY — Action Required by Project Owner

> **This file is temporary.** Delete it once all actions below have been completed and verified.

## Incident Summary

The file `firebase-applet-config.json` was publicly committed to this GitHub repository and
contained live credentials for a Firebase/Google Cloud project. These credentials must be
considered **fully compromised** and rotated immediately.

---

## Credentials That Were Exposed

| Credential | Value (now revoked — listed for tracking only) |
|---|---|
| Firebase API Key | `AIzaSyCcBmf1t5DHUn3B2_dSyJ22KiB_JwLmwQM` |
| GCP Project ID | `gen-lang-client-0498620172` |
| Firebase App ID | `1:724140506263:web:978ca70bd852259d253dd2` |
| OAuth Client ID | `724140506263-qsuml0fsrhk8i32isl08kl094vl8cpd0.apps.googleusercontent.com` |
| Auth Domain | `gen-lang-client-0498620172.firebaseapp.com` |
| Firestore DB ID | `ai-studio-b2378726-10a5-47f7-a406-f2f742741520` |
| Storage Bucket | `gen-lang-client-0498620172.firebasestorage.app` |

---

## Required Actions (out-of-band — cannot be done by this codebase)

### 1. Revoke & Regenerate the Firebase/GCP API Key
- Go to: https://console.cloud.google.com/apis/credentials?project=gen-lang-client-0498620172
- Find the key `AIzaSyCcBmf1t5DHUn3B2_dSyJ22KiB_JwLmwQM` and **delete** it.
- If any server infrastructure still uses Firebase, generate a new restricted key
  (HTTP referrer or IP restricted, not unrestricted).

### 2. Rotate the OAuth 2.0 Client
- In the same Credentials page, locate the OAuth client ID
  `724140506263-qsuml0fsrhk8i32isl08kl094vl8cpd0.apps.googleusercontent.com`
- Delete it and create a new client with proper authorized redirect URIs.

### 3. Audit the Firestore Database
- The Firestore security rules at the time of exposure were:
  ```
  allow read, write: if true;
  ```
  This means **any data ever stored in that Firestore database should be treated as fully
  public and compromised.** Review what data was stored and notify affected parties
  if any PII/financial data was written there.

### 4. Check for Unauthorized Firebase Usage
- In Google Cloud Console → Billing, check for unexpected charges since the key
  was first committed to the public repository.
- In Firebase Console → Authentication, check for any unknown user accounts created.
- In Firestore → Data, review any documents created by unauthorized access.

### 5. Review for Additional Exposure
- Check if the key was crawled by credential scanning services
  (e.g., GitGuardian, TruffleHog, or GitHub's secret scanning alerts).

---

## What Was Fixed in Code

- `firebase-applet-config.json` has been deleted from the working tree.
- The file has been scrubbed from git history using `git filter-repo`.
- `firestore.rules` has been deleted (no longer relevant after migration to Supabase).
- `.gitignore` now blocks all `*-config.json`, `*-credentials.json`, and `*-service-account.json`.
- The project is migrating to Supabase; Firebase dependencies are being fully removed.

---

## After Completing All Actions Above

Delete this file:
```bash
rm SECURITY.md
git commit -m "chore: remove SECURITY.md (all actions completed)"
```
