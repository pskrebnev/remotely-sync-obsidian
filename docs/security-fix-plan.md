# Security Fix Plan

Branch: `security-isues-fixing`
Scope: `src/`, `pro/src/`, build config, `.github/workflows/`.
Status: investigation only, no code changed yet.

Severity: **Critical** = remote attacker can steal data/credentials with little user interaction; **High** = credential leak or integrity loss under realistic conditions; **Medium** = defense-in-depth gap; **Low** = hygiene.

---

## Summary

| # | Severity | Issue | Location |
|---|----------|-------|----------|
| 1 | Critical | `obsidian://remotely-save` link silently overwrites all plugin settings | `src/main.ts:586-602`, `src/importExport.ts:102-145` |
| 2 | High | OAuth tokens and auth codes written to console | `src/main.ts:888,898,959,968,1015,1025,1073,1082,1129,1140` |
| 3 | High | No OAuth `state` check; Pro/Box/etc. callbacks run with no pending flow (login CSRF) | `src/main.ts:615-1150`, `pro/src/account.ts:35` |
| 4 | High | Remote file paths are not checked for `..` / absolute paths (path traversal on download) | `pro/src/sync.ts:248`, `src/misc.ts:21-40`, `src/fsLocal.ts:154-180` |
| 5 | High | With "sync config dir" on, the plugin's own `data.json` (all credentials) is uploaded to the remote, and remote `.obsidian/plugins/*` code is pulled down and executed | `pro/src/sync.ts:208-235` |
| 6 | High | Credentials at rest are only "obfuscated" (reversed base64) | `src/configPersist.ts` |
| 7 | Medium | OpenSSL-compatible encryption: AES-CBC without authentication, PBKDF2 20k iterations, 8-byte salt | `src/encryptOpenSSL.ts` |
| 8 | Medium | OAuth client secrets for Google Drive/Box/pCloud/Yandex/Koofr compiled into the public bundle | `pro/src/baseTypesPro.ts:76-144`, `webpack.config.js`, `esbuild.config.mjs` |
| 9 | Medium | Plain `http://` allowed for S3, WebDAV, Webdis while sending Basic auth / signed requests | `src/fsS3.ts:225`, `src/fsWebdis.ts:78-101`, `src/fsWebdav.ts` |
| 10 | Medium | "Output settings to console" debug button dumps decoded secrets | `src/settings.ts:2793-2802` |
| 11 | Medium | QR/URI export embeds full credentials in a plain URL/QR image | `src/importExport.ts:12-77` |
| 12 | Medium | Lockfiles are git-ignored; CI uses `npm install` with caret ranges (supply chain) | `.gitignore`, `.github/workflows/*.yml` |
| 13 | Medium | `cla.yml` uses `pull_request_target` with a PAT, and actions pinned by tag, not SHA | `.github/workflows/cla.yml` |
| 14 | Low | `stringToFragment` sets `innerHTML` from i18n strings | `src/misc.ts:521-525` |
| 15 | Low | Error notices echo raw provider responses / full URI params (may include tokens or codes) | `src/importExport.ts:113-140`, `src/main.ts:736,820` |
| 16 | Low | Webdis keys built by string concatenation into the command URL | `src/fsWebdis.ts` |

---

## Details and fixes

### 1. Settings injection through `obsidian://remotely-save` (Critical)
**Problem.** Any web page, email, or note can contain `obsidian://remotely-save?func=settings&vault=<name>&data=<json>`. Clicking it runs `Object.assign(this.settings, data)` and saves, with no confirmation. The only check is the vault name, which is easy to guess (often "Obsidian Vault" or visible in screenshots). An attacker can point S3/WebDAV at their own server and switch on auto-sync. On the next sync, the whole vault is uploaded to them. The same `Object.assign` also accepts any key, including `password`, `syncConfigDir`, `serviceType`, and auto-run intervals.

**Fix.**
1. Before applying an import, show a confirmation modal that lists exactly which sections and keys will change, and highlight endpoint or host changes.
2. Validate `data` against an allow-list schema for the selected export type: known keys only, correct types, no `__proto__`/`constructor`.
3. Never let an import turn on auto-sync or change `serviceType` without explicit confirmation.
4. Optionally require a one-time code shown on the exporting device.

**Test.** Unit tests for `importQrCodeUri` with unknown keys and prototype keys. A manual test that a crafted link shows the modal and changes nothing if cancelled.

### 2. Tokens logged to console (High)
**Problem.** `console.debug(inputParams)` logs auth codes and `console.debug(authRes)` logs access and refresh tokens for Pro, Box, pCloud, Yandex Disk, and Koofr. Users are often asked to paste console logs into GitHub issues.

**Fix.** Remove these logs. Add a `redact()` helper that masks `*token*`, `code`, `secret`, `password`, `key` fields, and use it for any remaining debug output. Add a lint rule or grep check in CI that fails on `console.*(authRes|inputParams|rsp)`.

### 3. OAuth callback CSRF (High)
**Problem.** Callback handlers accept any `code` without a `state` parameter. The Pro callback even falls back to verifier `"verifier"` when no flow is pending (`src/main.ts:890`). The Box, pCloud, Yandex, and Koofr callbacks don't require a pending flow at all. An attacker can make a victim's plugin link to the attacker's cloud account (login CSRF). The victim's vault then syncs into the attacker's storage.

**Fix.**
- Generate a random `state` per authorization (alongside the PKCE verifier), send it in every auth URL, and reject callbacks whose `state` doesn't match.
- Reject any callback when no auth flow is pending (`oauth2Info.verifier` empty) or the flow is more than ~10 minutes old.
- Remove the `"verifier"` fallback.
- Use PKCE for every provider that supports it.

### 4. Path traversal from remote (High)
**Problem.** Remote keys come from a server, which may be compromised, or from `_remotely-save-metadata-on-remote` content. `isHiddenPath` skips `..` segments, so `../../x` and `/abs/path` are neither hidden nor rejected. They then reach `vault.adapter.writeBinary`, `rename`, and `rm`. The desktop `FileSystemAdapter` joins this with the vault base path, so a crafted name can write or delete outside the vault, for example in `~/.ssh` or another vault's `.obsidian/plugins`.

**Fix.** Add one `assertSafeVaultPath(key)` function and call it on every key from remote listings, from decrypted names, and from metadata-on-remote, before any local write, rename, or delete. It should reject: any `..` segment, a leading `/`, Windows drive letters or `\`, NUL and control characters, and an empty result after normalization. Log and skip unsafe entries instead of throwing for the whole sync. Add tests with malicious names for each backend's `walk()`.

### 5. Config-dir sync leaks credentials and imports code (High)
**Problem.** With `syncConfigDir`, everything in `.obsidian/` is synced. That includes `.obsidian/plugins/remotely-save/data.json` with all tokens, which is uploaded in plaintext if E2E encryption is off. It also includes other plugins' `main.js`. Anyone with write access to the bucket can push JavaScript that runs in every synced Obsidian instance.

**Fix.**
- Always exclude this plugin's own `data.json` from sync, whatever the settings say.
- Show a clear warning when enabling config-dir sync without E2E encryption.
- Optionally make plugin code sync (`plugins/*/main.js`) a separate opt-in with a warning about code execution.

### 6. Weak at-rest protection of credentials (High)
**Problem.** `normalConfigToMessy` only base64-encodes and reverses the JSON. Any process, backup, or other plugin that can read `data.json` gets every token and password.

**Fix.**
- If Obsidian's secret storage API is available in the minimum supported version, keep tokens and passwords there and leave only references in `data.json`.
- Otherwise, on desktop use Electron `safeStorage` when available, with the current format as a fallback.
- Rename the UI wording from "obfuscate" so it doesn't suggest encryption.
- Migrate existing settings on load.

### 7. Content encryption weaknesses (Medium)
**Problem.** The OpenSSL mode is AES-256-CBC with no MAC, so a malicious remote can tamper with ciphertext (padding oracle and bit-flipping). It uses PBKDF2-SHA256 with 20,000 iterations (OWASP 2023 recommends ≥600,000) and an 8-byte salt. The key and IV both come from the password plus salt, and file names are encrypted the same way.

**Fix.** Keep the format for compatibility, but add a new default method:
- either AES-256-GCM with a per-file random 96-bit nonce and a 16-byte salt;
- or encrypt-then-MAC (HMAC-SHA256) on top of CBC;
- with PBKDF2 at ≥600k iterations, or Argon2id via WASM, and the key derived once per session and cached.

Also add a versioned header so methods can coexist, and a migration path ("re-encrypt remote"). Recommend `rclone-base64` (authenticated NaCl secretbox) in the UI until then.

### 8. Client secrets in the bundle (Medium)
**Problem.** `DEFAULT_*_CLIENT_SECRET` values are injected at build time and ship in `main.js`, which is public. Anyone can extract them and impersonate the app.

**Fix.** Use public-client and PKCE flows where the provider supports them (Google "Desktop app" or "iOS" client types, Box PKCE, Yandex PKCE). Where a secret is unavoidable, do the token exchange through a small backend you control. Rotate any secret that has already shipped. Note: in this fork the secrets come from your own GitHub secrets, so register your own app credentials rather than reusing upstream's.

### 9. Insecure transport allowed (Medium)
**Fix.** Warn strongly, or block unless an "I understand" toggle is set, when an endpoint is `http://` and the host isn't `localhost`, `127.0.0.1`, or a private LAN range. Prefer Digest over Basic for WebDAV when the server supports it.

### 10. Debug dump of secrets (Medium)
**Fix.** Redact the output of "output settings to console" with the `redact()` helper from #2, or remove the button.

### 11. Credentials in QR/URI export (Medium)
**Fix.** Optionally encrypt the export payload with a short passphrase or one-time code entered on the receiving device. Warn the user before showing the QR code. Never write the raw URI to logs.

### 12. Supply chain (Medium)
**Fix.**
- Remove `package-lock.json` from `.gitignore` and commit a lockfile.
- Use `npm ci` in CI.
- Run `npm audit --omit=dev` (and Dependabot or Renovate) in CI.
- Review deprecated or unmaintained deps: `crypto-browserify`, `pcloud-sdk-js`, `aws-crt` (native and unused in the browser), `rimraf` (listed under runtime deps).

### 13. GitHub Actions hardening (Medium)
**Fix.**
- Pin third-party actions to commit SHAs.
- Set minimal top-level `permissions: contents: read` and grant more per job.
- In `cla.yml`, keep `pull_request_target`, but never check out PR code, and scope the PAT to the signatures repo only. If this fork doesn't need the CLA bot, delete the workflow.
- Don't expose OAuth secrets to workflows triggered by PRs from forks.

### 14. `innerHTML` helper (Low)
**Fix.** The i18n JSON is trusted today. Still, either sanitize (allow-list `<a>`, `<b>`, `<br>`, `<code>`) or build these fragments with DOM APIs, so a future translation PR can't inject script.

### 15. Sensitive data in notices and errors (Low)
**Fix.** Don't include `JSON.stringify(inputParams)` or `rsp` in Notices or thrown errors. Show a short message and put redacted details in the debug log.

### 16. Webdis command construction (Low)
**Fix.** Always `encodeURIComponent` each key segment that is placed in the command path (some call sites do already), and add a test with keys containing `/`, `?`, `#`, and `%`.

---

## Target storage priority: Cloudflare R2 first

Fixes are implemented and verified for **Cloudflare R2** first, then rolled out to the other storages. R2 is used through the S3 backend (`src/fsS3.ts`), so S3 is the first code path to harden.

**R2-specific work (done within each phase):**
- **Endpoint validation (#9):** require `https://<account-id>.r2.cloudflarestorage.com` (or an EU or jurisdiction-specific variant), and set the region to `auto`. Reject `http://`.
- **Least-privilege credentials (#6):** document and recommend an R2 API token scoped to *Object Read & Write* on the single vault bucket, never an account-wide admin token. Treat the access key and secret as secrets under #6.
- **Import safety (#1):** in the import confirmation modal, highlight any change to `s3.s3Endpoint`, `s3.s3BucketName`, or the keys. Pointing at a different R2 account is the main exfiltration route.
- **Path traversal (#4):** add tests that walk an R2 or S3 listing containing keys with `..`, a leading `/`, and `\`. Use MinIO locally and a throw-away R2 bucket.
- **Encryption (#7):** turn on E2E encryption by default for new R2 setups, because the bucket is not end-to-end private.
- **CORS:** document a minimal bucket CORS policy for mobile: allow only `app://obsidian.md` and `capacitor://localhost`, and only the required methods.
- **Compatibility:** confirm that R2 accepts the AWS SDK's default checksum headers and multipart upload settings used by `@aws-sdk/lib-storage`. If needed, set `requestChecksumCalculation: "WHEN_REQUIRED"`.

**Rollout after R2 is done:** other S3-compatible services (AWS, MinIO, Backblaze) → WebDAV → Dropbox / OneDrive → Pro backends (Google Drive, Box, pCloud, Yandex, Koofr, Azure) → Webdis. Each backend gets the same path-safety tests and transport checks before its phase is closed.

## Execution order

Each phase is finished and tested on **Cloudflare R2 first**, then extended to the remaining storages in the rollout order above.

1. **Phase 1, quick wins (one PR):** #2, #10, #15 (remove/redact logs), #3 (`state` and pending-flow checks), #1 (confirmation modal and schema validation).
2. **Phase 2, data integrity:** #4 (path validation and tests), #5 (exclude own `data.json`, warnings).
3. **Phase 3, build and CI:** #12, #13, #8 (own OAuth apps, PKCE, rotate secrets).
4. **Phase 4, crypto and storage (needs a migration design):** #6, #7, #11, #9.
5. **Phase 5:** #14, #16.

For each phase: add unit tests under `tests/` or `pro/tests/`, run `npm test` and `npm run build`, and test manually in a scratch vault, first against a throw-away Cloudflare R2 bucket (plus local MinIO), then against the other storages.

## Notes / to verify before fixing
- Check for #4 how the mobile `CapacitorAdapter` handles `..`. It may differ from desktop, and both need the guard.
- Check for #6 which minimum Obsidian version is targeted in `manifest.json`, and whether the secret storage API is available there.
- Run `npm audit` after generating a lockfile, to list concrete CVEs in the current dependency tree.
