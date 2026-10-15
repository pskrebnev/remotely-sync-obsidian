# Security Fix Plan

Scope: `src/`, `pro/src/`, build config, `.github/workflows/`.
Status: plan; parts of #12 and #13 are done (PR #1). Each phase below gets its own branch off `master` and its own PR.

## Fork context (updated)

These facts about this fork change the priorities:

- **Only S3 (including Cloudflare R2), WebDAV and Webdis can work in this fork's builds.** The repo has no GitHub secrets, so the build injects empty OAuth client IDs. That leaves Dropbox, OneDrive, OneDrive Full, Google Drive, Box, pCloud, Yandex Disk and Koofr unable to log in. PRO features also need upstream's paid server (`REMOTELYSAVE_WEBSITE`), which is empty too.
- **The unusable backends are still attack surface.** All 10 `obsidian://` protocol handlers are registered, including the OAuth callbacks for those services (#3), and their token-handling code still ships.
- **Target backend is Cloudflare R2**, through the S3 code path (`src/fsS3.ts`).

So the cheapest big win is to **stop registering what can't work** (Phase 0) before hardening what's left.

## Progress

Phases 1–5 are implemented with Cloudflare R2 and AWS S3 in mind. Full details: [security-changes.md](./security-changes.md). All changes are in Apache-licensed `src/`, and `pro/` is untouched.

| # | Status | What was done |
|---|--------|---------------|
| 1 | Done | `src/importValidate.ts` accepts only known settings keys with the expected types, rejects `__proto__`/`constructor`/`prototype`, never imports `vaultRandomID` or `pro`, and checks `serviceType`. `src/importConfirmModal.ts` lists every change before saving, marks endpoint/bucket/key/sync-behaviour changes with ⚠, and masks secrets. Both the `obsidian://` link and the manual import box use it. Sections are merged key by key, so tokens of other services are kept. |
| 2 | Done (`src/`) | Removed `console.debug(inputParams)` / `console.debug(authRes)` from all OAuth callbacks. |
| 4 | Partial | `src/fsLocal.ts` refuses `..` segments (with `/` or `\`), absolute paths, drive letters and control characters for stat, read, write, mkdir, rename and delete. The fix inside the sync engine is still blocked by #17. |
| 9 | Done (S3, WebDAV, Webdis) | The S3 client refuses `http://` endpoints unless the host is loopback or private (RFC 1918, `.local`, `::1`, `fc00::/7`), so local MinIO still works. The settings field shows a warning while typing. WebDAV and Webdis followed in Phase 5. |
| 5 | Done (workaround) | Phase 2: this plugin's `data.json` is never listed locally, is hidden from remote walks, and can't be written, renamed or deleted by sync. The config-sync dialog warns about plugin code and missing encryption. The sync engine itself is unchanged (#17). |
| 6 | Done (S3, E2E password, WebDAV, Webdis, Dropbox, OneDrive) | Phase 2: on Obsidian 1.11.4+, the S3 access key, secret key and encryption password are stored in `app.secretStorage`, and `data.json` keeps empty strings. They migrate automatically and fall back to `data.json` if storage is unavailable. Phase 5 added WebDAV/Webdis passwords, WebDAV custom headers and Dropbox/OneDrive tokens. |
| 7 | Done (rclone + salt) | Phase 3: per-vault random rclone salt published in `_remotely-save-encryption.json`; other devices adopt it; "Re-encrypt remote" converts legacy rclone and openssl vaults (publish salt → copy → verify → delete; resumable). Sync refuses to put plain files into an encrypted remote. rclone's scrypt cost is unchanged, to stay rclone-compatible. |
| 10 | Done | "Output settings to console" now prints a redacted copy. |
| 15 | Done (`src/`) | Import errors no longer echo the raw link. OAuth error notices and errors pass through `redactSecrets`. |
| 17 | Done (option C) | `pro/` removed entirely; the sync engine was restored from the Apache-licensed v0.4.25; the repository is Apache 2.0 only. Features that existed only in PolyForm code were removed or are refused safely. See [security-changes.md](./security-changes.md#removal-of-pro-code). Git history still contains `pro/`. |
| 3 | Done | Phase 5: OAuth callbacks are only registered when the service has a client ID (none in this fork's builds) and only act while a login started from the settings is in progress; the PRO `"verifier"` fallback is removed. |
| 8 | Not applicable (documented) | This fork ships no OAuth client IDs/secrets. If own apps are added: PKCE public clients, secrets in a protected environment, rotate exposed ones. |
| 14 | Done | Phase 5: `stringToFragment` keeps only the tags the translations use and `https://`/`#` links. |
| 16 | Done | Phase 5: glob characters in the vault folder are escaped in Webdis `SCAN MATCH`. |
| 12 | Done | Phase 4: `uuid` override, unused `aws-crt`/`@aws-sdk/signature-v4-crt` removed, `rimraf` moved to dev; CI audit gate with a reviewed allow-list (the two remaining high advisories are Node-only code of the Box/pCloud SDKs, not in the bundle); Dependabot weekly. |
| 13 | Done | Phase 4: all actions pinned to commit SHAs; Dependabot updates them. |
| 11 | Done | Phase 3: exports are encrypted with a passphrase (AES-256-GCM, PBKDF2-SHA256 600k), and the import asks for it before validation and confirmation. |

Tests: `tests/importValidate.test.ts` and `tests/securityHelpers.test.ts` (12 new tests, 84 in total).

**Before merging:** test manually in Obsidian against a throw-away Cloudflare R2 bucket and an AWS S3 bucket: sync, the http refusal, and settings import from a QR link (apply and cancel).

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
| 12 | Medium | Supply chain: no `npm audit` gate, 15 known vulnerable runtime deps (**partly done**: lockfile committed, CI uses `npm ci`) | `package.json`, `.github/workflows/*.yml` |
| 13 | Medium | Actions pinned by tag, not SHA (**partly done**: `cla.yml` removed, explicit token permissions added) | `.github/workflows/*.yml` |
| 14 | Low | `stringToFragment` sets `innerHTML` from i18n strings | `src/misc.ts:525-529` |
| 15 | Low | Error notices echo raw provider responses / full URI params (may include tokens or codes) | `src/importExport.ts:113-140`, `src/main.ts:736,820` |
| 16 | Low | Webdis keys built by string concatenation into the command URL | `src/fsWebdis.ts` |
| 17 | High (blocker) | The sync engine is under PolyForm Strict (no changes allowed), so fixes #4 and #5 can't legally be applied to it | `pro/` (`pro/LICENSE`, `pro/src/sync.ts`) |

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
**Done (PR #1).** `package-lock.json` is committed and CI uses `npm ci`.

**Remaining.**
- Add `npm audit --omit=dev --audit-level=high` to CI, plus Dependabot for npm and GitHub Actions.
- Reduce the 15 runtime audit findings (4 low, 2 moderate, 9 high). Most come from the Box, pCloud and Azure SDKs (`proxy-agent`, `basic-ftp`, `@babel/cli`, `chokidar`), `crypto-browserify` (`elliptic`) and `@azure/msal-node` (`uuid`). If Phase 0 removes the backends this fork can't use, most of these packages disappear with them.
- Review the remaining deps: `aws-crt` (native and unused in the browser) and `rimraf` (listed under runtime deps).

### 13. GitHub Actions hardening (Medium)
**Done (PR #1 and follow-ups).**
- `cla.yml` (`pull_request_target` with a PAT) was removed.
- Workflows declare `contents: read` (build) and `contents: write` (release).

**Remaining.**
- Pin `actions/*` and `softprops/action-gh-release` to commit SHAs. Dependabot (#12) keeps the pins updated.
- If OAuth secrets are ever added to this repo, keep them in the `env-for-buildci` environment with required reviewers, so PRs from forks can't read them.

### 14. `innerHTML` helper (Low)
**Fix.** The i18n JSON is trusted today. Still, either sanitize (allow-list `<a>`, `<b>`, `<br>`, `<code>`) or build these fragments with DOM APIs, so a future translation PR can't inject script.

### 15. Sensitive data in notices and errors (Low)
**Fix.** Don't include `JSON.stringify(inputParams)` or `rsp` in Notices or thrown errors. Show a short message and put redacted details in the debug log.

### 17. PolyForm-licensed sync engine (High, blocker)
**Problem.** `LICENSE` puts everything under `pro/` under **PolyForm Strict 1.0.0**. That license allows noncommercial use and distributing unmodified copies, but **no changes or new works**. `pro/` includes not only the paid features but also the sync engine every backend uses: `pro/src/sync.ts` (2,094 lines), `localdb.ts`, `conflictLogic.ts` and `account.ts`, which `sync.ts` imports. Upstream moved the engine there from `src/` on 2024-06-12 (commit `9f67d41`).

The fixes for #4 (path validation in `checkIsSkipItemOrNotByName` / sync planning) and #5 (excluding this plugin's own `data.json`) belong in `pro/src/sync.ts`, so they can't be applied while the engine stays under PolyForm. The type-only edits made in PR #1 to `pro/src/fsOnedriveFull.ts` and `pro/src/fsAzureBlobStorage.ts` are also, strictly read, changes the license doesn't permit. This is not legal advice.

**Options** (decision deferred, see Phase 0):
- **Full removal with the Apache engine:** delete `pro/`, restore the last Apache-licensed `src/sync.ts` (from `9f67d41^`, 1,718 lines) and port it to the current code. Everything becomes Apache 2.0. Cost: the 18 later upstream sync commits are lost or must be reimplemented, including push/pull with delete, config/bookmarks rules, allow-list mode, file-name validation and Smart Conflict refinements.
- **Partial removal:** delete only the PRO features and leave the engine files unmodified. A smaller change, but #4 and #5 stay blocked.
- **Workaround without touching `pro/`:** validate paths and exclude `data.json` in Apache-licensed code before it reaches the engine: in the `FakeFs` wrappers (`src/fsLocal.ts`, `src/fsEncrypt.ts`) and in the walk results. That's weaker than fixing the engine, but it partially closes #4 and #5.

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

## Execution order (updated)

Each phase is finished and tested on **Cloudflare R2 first**, then extended to the remaining storages in the rollout order above.

0. **Phase 0, PRO removal and attack surface (decision deferred):** PRO features are unusable in this fork (no account, no client IDs), and the owner wants them gone. How depends on #17:
   - *Full removal with the Apache engine*, *partial removal*, or the *workaround* (see #17).
   - Independently, Dropbox and OneDrive (free backends without client IDs) should register their OAuth handlers only when a client ID was set at build time. This closes #3 for them.

   Removing the PRO backends also removes their SDKs (Box, pCloud, Azure, Google), which closes #8 and most of #12's audit findings.
1. **Phase 1, R2 critical path (one PR):**
   - #1: confirmation modal and schema validation for settings imports, highlighting S3 endpoint, bucket and key changes;
   - #4: path validation, with tests against R2/MinIO listings;
   - #2, #10, #15: remove or redact logged secrets;
   - #9: require `https://` for S3 endpoints.
2. **Phase 2, credentials and config sync:** #5 (always exclude this plugin's `data.json` from sync, with warnings) and #6 (secret storage for S3 keys and other credentials).
3. **Phase 3, encryption (needs a migration design):** #7 (authenticated encryption, stronger key derivation, E2E on by default for new R2 setups) and #11 (encrypted QR/URI export).
4. **Phase 4, CI and dependencies:** the rest of #12 and #13 (audit gate, Dependabot, SHA pinning).
5. **Phase 5, remaining backends and low-severity items:**
   - #3 and #8 for any OAuth backend kept by Phase 0 option A and later enabled (needs its own app registration);
   - #9 for WebDAV and Webdis;
   - #14 and #16.

For each phase: add unit tests under `tests/` or `pro/tests/`, run `npm test` and `npm run build`, and test manually in a scratch vault, first against a throw-away Cloudflare R2 bucket (plus local MinIO), then against the other storages.

## Notes / to verify before fixing
- Check for #4 how the mobile `CapacitorAdapter` handles `..`. It may differ from desktop, and both need the guard.
- Check for #6 which minimum Obsidian version is targeted in `manifest.json`, and whether the secret storage API is available there.
- Run `npm audit` after generating a lockfile, to list concrete CVEs in the current dependency tree.
