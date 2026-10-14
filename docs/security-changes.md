# Security Changes

This file records every security change made in this fork, phase by phase. It explains what changed, why, and what users will notice. The plan with all findings and the reasoning behind the order is in [security-fix-plan.md](./security-fix-plan.md). Finding numbers such as `#1` refer to that plan.

Each phase is developed on its own branch (`security-update-phaseN`) and merged into `security-plan-update`.

| Phase | Focus | Status |
|-------|-------|--------|
| [Phase 1](#phase-1-cloudflare-r2--aws-s3-critical-path) | Cloudflare R2 / AWS S3 critical path: settings import, https-only S3, no secrets in logs, vault path guard | Done |
| [Phase 2](#phase-2-plugin-settings-file-and-credential-storage) | This plugin's `data.json` is never synced; R2/S3 keys and the encryption password move to Obsidian's secret storage | Done |
| [Phase 3](#phase-3-encryption-per-vault-salt-re-encryption-encrypted-exports) | Per-vault encryption salt, "Re-encrypt remote" migration, passphrase-encrypted settings exports | Done |
| [Phase 4](#phase-4-ci-and-dependencies) | CI audit gate, Dependabot, SHA-pinned actions, fewer vulnerable dependencies | Done |
| Phase 5 | Other backends and low-severity items | Not started |

---

## Phase 1: Cloudflare R2 / AWS S3 critical path

Branch: `security-update-phase1`. Fixes #1, #2, #9 (S3), #10 and #15, and partly fixes #4. Everything is in the Apache-licensed `src/` folder. Nothing under `pro/` changed (see #17 in the plan for why).

### 1. Settings import links are validated and confirmed (#1, Critical)

**Before.** Opening an `obsidian://remotely-save?func=settings&...` link, or pasting one into *Import*, immediately overwrote the plugin settings with whatever JSON the link contained. The only check was the vault name, which is easy to guess. Someone could send you a link that points sync at *their* R2/S3 bucket and turns on auto sync, and your vault would then upload to them.

**Now.**
- **Validation** (`src/importValidate.ts`, `sanitizeImportedSettings`):
  - Only settings that exist in the plugin's defaults are accepted, and each must have the expected type (object, string, number, boolean, or list of strings).
  - `__proto__`, `constructor` and `prototype` anywhere in the data reject the whole import (prototype pollution).
  - `vaultRandomID` and `pro` are never imported. Unknown keys are dropped and listed.
  - `serviceType` must name a real storage backend.
- **Confirmation dialog** (`src/importConfirmModal.ts`): nothing is saved until you click *Apply these settings*. The dialog lists every setting that would change, with its old and new value:
  - Secrets (keys, passwords, tokens) are shown as `••••••`.
  - Changes that decide where or how your vault syncs are marked **⚠**: endpoint, bucket, region, prefix, access keys, password, service type, auto sync timers, config-folder sync, sync direction, and any plain `http://` URL.
  - If the link changes nothing, you get a notice instead of a dialog.
- **Merging** (`applyImportedSettings`): imported sections are merged key by key, so importing S3 settings no longer wipes the saved logins of other services.
- **One code path:** both the `obsidian://` link handler (`src/main.ts`, `importSettingsWithConfirmation`) and the *Import* box in settings (`src/settings.ts`) use it.

### 2. S3 endpoints must use https (#9, Medium)

**Before.** `http://` S3 endpoints were accepted, so access keys (via request signatures) and file contents could travel unencrypted.

**Now.**
- The S3 client (`src/fsS3.ts`, `getS3Client`) refuses a plain `http://` endpoint with a clear error, *unless* the host is local or private:
  - `localhost`, `*.localhost`, `*.local`;
  - `127.0.0.0/8`, `::1`;
  - `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `fc00::/7`.

  So a local MinIO for testing keeps working.
- Endpoints without a scheme still default to `https://`. Cloudflare R2 (`https://<account-id>.r2.cloudflarestorage.com`) and AWS (`https://s3.<region>.amazonaws.com`) are unaffected.
- The *Endpoint* field in settings shows a warning while you type an insecure URL.
- The reverse-proxy option only replaces the host, so the endpoint's scheme also applies to it.
- Helper: `isInsecureRemoteUrl` in `src/misc.ts`.

### 3. No secrets in logs and notices (#2, #10, #15)

**Before.** Several OAuth callbacks printed the authorization code and the full token response (access and refresh tokens) to the developer console. Error notices showed raw callback parameters and provider responses. The *Output settings to console* debug button printed every credential in clear text. Users are often asked to paste console output into bug reports.

**Now.**
- The `console.debug(inputParams)` and `console.debug(authRes)` calls are removed from all OAuth callbacks in `src/main.ts`.
- Callback parameters and OAuth error responses still appear in notices and errors, for debugging, but pass through `redactSecrets` first (`src/misc.ts`). It masks fields whose names look secret: `token`, `secret`, `password`, `passphrase`, `verifier`, `credential`, `apikey`, `accessKeyID` and `code`.
- Import errors no longer repeat the link, which contains the settings and secrets.
- *Output settings to console* prints a redacted copy.

### 4. Local file operations stay inside the vault (#4, partial)

**Before.** File names come from the remote bucket, which may be compromised or shared. A name like `../../.ssh/authorized_keys` was not rejected and could reach the local write, rename or delete calls. On desktop, that could touch files outside the vault.

**Now.** Every local `stat`, `readFile`, `writeFile`, `mkdir`, `rename` and `rm` in `src/fsLocal.ts` first calls `assertSafeVaultPath` (`src/misc.ts`). It refuses:
- a `..` segment, with `/` or `\` as separator;
- absolute paths (`/…`, `\…`);
- Windows drive letters (`C:`);
- NUL and other control characters.

Names that merely *contain* dots (`a..b.md`, `..notes.md`) or a backslash inside a file name are still allowed. A refused path makes that sync step fail with a clear error instead of escaping the vault.

*Partial* because the same check also belongs in the sync engine (`pro/src/sync.ts`), which can't be changed under its PolyForm license (#17).

### Tests

- `tests/importValidate.test.ts`: risky changes are flagged and secrets masked, plain-http values are flagged, prototype-pollution keys and wrong types are rejected, unknown service types are rejected, unknown and never-imported keys are ignored, and merging keeps other services' settings.
- `tests/securityHelpers.test.ts`: `assertSafeVaultPath` (allowed and rejected paths), `isInsecureRemoteUrl` (public http vs https and local/private), and `redactSecrets` (deep masking without changing the input).
- Result: 84 tests pass (12 new). Typecheck, lint and production build are clean.

### Manual test checklist (Obsidian)

These haven't been run yet. Use throw-away buckets.

1. **Cloudflare R2:**
   - endpoint `https://<account-id>.r2.cloudflarestorage.com`, region `auto`;
   - an API token limited to *Object Read & Write* on the one bucket;
   - run a first sync and a second sync, and check that files appear in the bucket.
2. **AWS S3:**
   - endpoint `https://s3.<region>.amazonaws.com` and the matching region;
   - an IAM user limited to the bucket (see [s3_user_policy.md](./remote_services/s3_general/s3_user_policy.md));
   - same sync checks.
3. **http refusal:** set the endpoint to `http://example.com`. The field shows the warning, and *Check connectivity* or sync fails with the "refusing plain http" error. `http://localhost:9000` (MinIO) still works.
4. **Settings import:** export the S3 settings as a QR code or link. Import it in another vault with the same name: the dialog lists the changes. *Cancel* changes nothing; *Apply* saves.
5. **Upload checksums (compatibility, not security):** the S3 SDK in the lockfile (3.1150) adds CRC32 checksum headers to uploads by default, unlike the 3.620 SDK upstream used. If R2 or another S3-compatible service rejects uploads with a checksum error, set `requestChecksumCalculation: "WHEN_REQUIRED"` and `responseChecksumValidation: "WHEN_REQUIRED"` in `getS3Client`.

### Files

| File | Change |
|------|--------|
| `src/importValidate.ts` | New: validation, change list, merging for imported settings |
| `src/importConfirmModal.ts` | New: confirmation dialog |
| `src/main.ts` | Import handler uses validation and the dialog; OAuth logs removed; notices redacted |
| `src/settings.ts` | *Import* box uses the same flow; endpoint warning; redacted debug dump |
| `src/importExport.ts` | Errors no longer echo the link |
| `src/fsS3.ts` | Refuses insecure http endpoints |
| `src/fsLocal.ts` | Path guard on every local file operation |
| `src/misc.ts` | `assertSafeVaultPath`, `isInsecureRemoteUrl`, `redactSecrets` |
| `src/langs/en.json` | Strings for the dialog and warnings (other languages fall back to English) |
| `tests/importValidate.test.ts`, `tests/securityHelpers.test.ts` | New tests |

---

## Phase 2: plugin settings file and credential storage

Branch: `security-update-phase2`. Fixes #6 for the S3 (R2/AWS) keys and the end-to-end encryption password, and fixes #5 without changing the PolyForm-licensed sync engine (the "workaround" option from #17). Nothing under `pro/` changed.

### 1. This plugin's `data.json` is never synced, in either direction (#5, High)

**Before.** With *Sync config dir* on, `.obsidian/plugins/remotely-save/data.json` was explicitly included in sync (`isLikelyPluginSubFiles` in `src/obsFolderLister.ts`). That file holds every credential: S3 keys, the encryption password and OAuth tokens. It was uploaded to the bucket, in plain text when end-to-end encryption was off. In the other direction, a `data.json` planted in the bucket would be downloaded over your local settings, silently pointing sync at someone else's storage.

**Now.** Three independent layers, all keyed on `getOwnPluginDataFilePath(configDir, pluginId)` (`src/misc.ts`):
- **Local listing:** `listFilesInObsFolder` (`src/obsFolderLister.ts`) no longer lists the file, so it's never uploaded.
- **Remote listing:** `FakeFsEncrypt.hideKeys` (`src/fsEncrypt.ts`, set up in `src/main.ts`) drops remote entries with that (decrypted) path from every walk, so a remote copy is never downloaded or compared. The filter is the pure `filterOutKeys` helper in `src/misc.ts`.
- **Last line of defence:** `FakeFsLocal` (`src/fsLocal.ts`) refuses `writeFile`, `rename` and `rm` on that path during sync.

Other plugins' `data.json` files are still synced as before. Users who enable config sync usually want that.

**Config-folder sync warning.** The *Sync config dir* confirmation dialog now says:
- this plugin's settings are never synced;
- other plugins' settings and code *are* synced, and downloaded plugin code runs on every device, so only enable it if nobody else can write to the bucket;
- if end-to-end encryption is off, a bold ⚠ explains that other plugins' settings (possibly with their API keys) will be stored unencrypted.

**What users notice.**
- This plugin's settings no longer travel between devices through config sync. Set up each device yourself, or use *Export / Import settings* (QR code), which now goes through the Phase 1 confirmation dialog.
- A `data.json` that an earlier version uploaded **stays in the bucket** (it's just ignored now). Delete `.obsidian/plugins/remotely-save/data.json` from the bucket. With end-to-end encryption on, its remote name is encrypted, so remove it from a device that still has the old version, or rotate the keys it contained.

### 2. R2/S3 keys and the encryption password move to Obsidian's secret storage (#6, High)

**Before.** All credentials were stored in `data.json` inside the vault. The *obfuscate settings file* option only base64-encoded and reversed the JSON, so anything that could read the vault folder (backups, git, cloud-synced folders, other plugins) could read the keys.

**Now** (`src/secretStore.ts`, hooked into `loadSettings`/`saveSettings` in `src/main.ts`):
- **Where secrets go:** on Obsidian **1.11.4 or newer**, which provides `app.secretStorage`, these fields are stored in Obsidian's secret storage instead of `data.json`:
  - `s3.s3AccessKeyID` and `s3.s3SecretAccessKey`;
  - `password` (the end-to-end encryption password).
- **What stays in `data.json`:** an empty string in place of each moved field, plus `secretStorageNamespace`. That's a random 12-character id prefixing this vault's entries (for example `remotely-save-<ns>-s3-s3-secret-access-key`) so vaults don't collide. It isn't a secret.
- **Migration is automatic.** The plugin already saves settings at the end of loading, so keys already in `data.json` move on the first start after updating. While a value is still on disk, the disk value wins.
- **No credential can be lost.**
  - If secret storage is missing (older Obsidian) or a write fails, the value stays in `data.json` exactly as before.
  - In memory, settings always hold the real values, so sync, *Check connectivity* and QR export work unchanged.
  - Clearing a field in settings clears the stored secret too.
- **Not moved yet:** WebDAV, Webdis and OAuth tokens (Dropbox, OneDrive). That's Phase 5. The same mechanism applies; they just need adding to `SECRET_FIELDS`.

**What users notice.** Nothing, on Obsidian 1.11.4+. Opening `data.json` shows empty S3 key and password fields. **Downgrading** to an older plugin version after migrating would show empty keys, so you'd need to re-enter them.

Obsidian keeps secret storage on the device, outside the vault. It isn't encryption against other plugins running in the same Obsidian, but it keeps keys out of every copy of the vault folder.

### Tests

- `tests/secretStore.test.ts`:
  - valid storage ids;
  - secrets move out of `data.json` and come back on load;
  - the namespace stays stable and rotated keys take effect;
  - a value still on disk wins;
  - a secret can be cleared;
  - values stay on disk when storage fails or is missing;
  - storage is only used when the API exists.
- `tests/ownDataFile.test.ts`: the plugin's `data.json` path, and filtering it from walk results while keeping other plugins' files.
- Result: 94 tests pass (10 new). Typecheck, lint and production build are clean.

### Manual test checklist (Obsidian)

These haven't been run yet. Use a throw-away vault and bucket.

1. **Migration:** with an R2 or AWS configuration in `data.json`, start Obsidian 1.11.4+ with this build. Sync still works, and `data.json` shows `"s3AccessKeyID": ""`, `"s3SecretAccessKey": ""` and a `secretStorageNamespace`. If obfuscation is on, check with *Output settings to console*. Restart, and sync still works.
2. **Config sync:**
   - turn on *Sync config dir* without a password, and the ⚠ warning appears;
   - sync, and `.obsidian/plugins/remotely-save/data.json` is **not** uploaded;
   - upload a fake `data.json` to that path in the bucket and sync, and local settings are unchanged.
3. **Older Obsidian (if available):** keys stay in `data.json` and sync works.

### Files

| File | Change |
|------|--------|
| `src/secretStore.ts` | New: moves credentials between settings and Obsidian's secret storage |
| `src/main.ts` | Load/save go through secret storage; remote walks hide this plugin's `data.json` |
| `src/baseTypes.ts` | New optional setting `secretStorageNamespace` |
| `src/obsFolderLister.ts` | Never lists this plugin's `data.json` |
| `src/fsEncrypt.ts` | `hideKeys`: leaves given keys out of remote walks |
| `src/fsLocal.ts` | Refuses to write, rename or delete this plugin's `data.json` during sync |
| `src/misc.ts` | `getOwnPluginDataFilePath`, `filterOutKeys` |
| `src/settings.ts`, `src/langs/en.json` | Security warnings in the config-folder sync dialog |
| `tests/secretStore.test.ts`, `tests/ownDataFile.test.ts` | New tests |

---

## Phase 3: encryption (per-vault salt, re-encryption, encrypted exports)

Branch: `security-update-phase3`. Fixes #7 (with the choices below) and #11. Nothing under `pro/` changed.

Decisions taken for this phase:
- **Format:** keep the authenticated **rclone** format (XSalsa20-Poly1305, scrypt) and add a random **per-vault salt**. No new custom crypto format.
- **Migration:** a **"Re-encrypt remote"** action that rebuilds the remote from this device.
- **Exports:** **passphrase-encrypted**.

### 1. Per-vault salt for rclone encryption (#7)

**Before.** `rclone-base64` derived its keys with scrypt from the password and rclone's **built-in, fixed salt**. Every vault in the world used the same salt, so an attacker could precompute password guesses once and try them against every bucket. The older `openssl-base64` method is worse: AES-CBC without authentication, so a malicious bucket can tamper with files, and only 20,000 PBKDF2 iterations.

**Now.**
- **How the salt works:**
  - `CipherRclone` and `FakeFsEncrypt` take a salt (`src/encryptRClone.ts`, `src/fsEncrypt.ts`).
  - The salt is a random 24-byte value, base64url-encoded (`newEncryptionSalt`).
  - It is exactly rclone's `password2`, so a salted bucket can still be read with the rclone CLI (set `password2` to the salt).
- **Where it lives:** a small **plain** file in the remote root, `_remotely-save-encryption.json` (`src/encryptionParams.ts`), and in the setting `encryptionSalt`. A salt isn't secret; without the password it's useless. The file is never treated as a vault file: `FakeFsEncrypt` skips it in every walk.
- **Which salt a sync uses** (`decideEncryptionSalt`, called by `resolveEncryptionSalt` in `src/main.ts` before every sync):
  - **New encrypted setups** (password set, rclone, empty remote) create a salt and publish the file before the first upload.
  - **Other devices** read the file and **adopt** the salt (and the method, if it was converted from openssl) automatically, with a notice.
  - **Existing vaults** without the file keep using the built-in salt until they are re-encrypted, so nothing breaks on update.
  - **Safety:** if the remote has the file but this device has **no password**, sync refuses to run instead of uploading plain files into an encrypted bucket. Upstream couldn't detect this for rclone buckets.
- **Not changed:** rclone's scrypt cost (N=2¹⁴) stays as it is, so rclone compatibility is kept. The per-vault salt is the main gain: no shared precomputation.

### 2. "Re-encrypt remote" (#7 migration)

*Settings → Basic → Re-encrypt remote*, shown when a password is set. The setting's description says whether the vault uses the old setup, already has a per-vault salt (re-encrypting again rotates it), or has an unfinished run. Implemented in `src/reencrypt.ts` and `reencryptRemote` in `src/main.ts`:

1. **Sync this device.** If that sync doesn't succeed, nothing is changed. A new salt is generated and remembered in `encryptionMigration`, so an interrupted run resumes with the same salt. Sync on this device stays paused until the run finishes.
2. **Classify every raw remote object** by trying to decrypt its name with the old and the new key.
   - Names that decrypt with neither key **stop the run before anything changes**.
   - A name can (rarely) decrypt under both keys. File contents are authenticated, so for files the content decides. Such folders are left alone.
3. **Publish the new salt** (`_remotely-save-encryption.json`). From this moment other devices switch to the new key, and their syncs stop with a decryption error instead of writing old-format files that would be lost. They continue on their own once the run finishes.
4. **Write every object in the new format** (folders first). The content comes from **this device** when it has the file, otherwise from the **old remote object**, so files that exist only in the bucket are kept.
5. **Verify** that every object now exists in the new format. **Only then delete** the old objects (files first, then folders from deep to shallow).
6. Switch this device's settings to rclone + new salt.

Other details:
- **Old vault formats:** it also converts **openssl-base64** vaults to rclone.
- **Resuming:** an interrupted run (network error, closed app) is resumed by running it again. Objects not yet deleted are copied again; that's idempotent and always uses the right source.
- **Old `data.json` copies:** if an older version uploaded this plugin's own `data.json` (Phase 2), its old copy is **deleted, not carried over**. The local file holds live credentials.

### 3. Settings exports are passphrase-encrypted (#11)

**Before.** *Export settings* produced an `obsidian://remotely-save?...&data=<JSON>` link and QR code with every key and password in clear text. Anyone who saw a screenshot or chat message had full access to the bucket.

**Now** (`src/exportCrypto.ts`, `src/importExport.ts`):
- **Exporting:** the dialog asks for a passphrase of at least 8 characters before showing anything. The payload is encrypted with **AES-256-GCM** (random 16-byte salt and 12-byte IV), with the key from **PBKDF2-SHA256 at 600,000 iterations** (OWASP 2023). The link carries `enc=1`.
- **Importing:** an encrypted link first asks for the passphrase (`ImportPassphraseModal`). A wrong passphrase or a modified link is rejected, because GCM is authenticated. The decrypted settings then go through the Phase 1 validation and confirmation dialog.
- **Device-local fields** (`secretStorageNamespace`, `encryptionMigration`) are never exported or imported. `encryptionSalt` is flagged ⚠ in the import dialog, since changing it changes the key.
- Older plain links are still accepted for compatibility, with the Phase 1 validation and confirmation.

### Tests

`tests/encryptionPhase3.test.ts` (25 new tests):
- **Params file:** round-trip, and rejection of invalid versions, methods and salts.
- **Salt decisions:** legacy, create, no rclone, adopt (including from openssl), and the refusal when there is no password.
- **Exports:** the iteration count, round-trip, wrong passphrase, tampering, a fresh salt and IV on every export, and short passphrases.
- **Re-encryption** (with fake old and new codecs):
  - a full run, preferring local copies and keeping remote-only files;
  - delete order;
  - nothing changes on undecryptable objects;
  - an interrupted run deletes nothing and can be resumed;
  - a name decrypting under both keys is resolved by authenticated content;
  - this plugin's `data.json` is dropped.

Result: 109 tests pass. Typecheck, lint and production build are clean.

### Manual test checklist (Obsidian)

These haven't been run yet. Use a throw-away vault and an R2 or S3 bucket.

1. **New setup:** with an empty bucket, set a password (rclone) and sync. `_remotely-save-encryption.json` appears with a salt. Check that `rclone ls` with `password2` = that salt lists the files.
2. **Second device:** same password, sync. A notice says the encryption settings were adopted, and files sync.
3. **Legacy vault:** with a bucket encrypted by the previous version (no params file), sync still works. Run *Re-encrypt remote*:
   - the progress counter runs;
   - the summary shows how many objects came from this device and from the remote;
   - afterwards the bucket has only new names plus the params file;
   - the other device continues after its next sync.
4. **Interruption:** start a re-encryption on a larger vault and close Obsidian midway. Syncs on both devices stop with a clear message. Run it again: it finishes, and both devices sync again.
5. **openssl vault:** re-encrypt converts it to rclone.
6. **Export/import:** export S3 settings with a passphrase. Importing asks for it; a wrong passphrase is rejected; the right one opens the confirmation dialog.

### Files

| File | Change |
|------|--------|
| `src/encryptionParams.ts` | New: the remote params file and the salt decision |
| `src/reencrypt.ts` | New: classification and rebuild for "Re-encrypt remote" |
| `src/exportCrypto.ts` | New: AES-GCM/PBKDF2 encryption of exported settings |
| `src/encryptRClone.ts`, `src/fsEncrypt.ts` | Salt support; params file skipped in walks; `useEmptyCacheMap` |
| `src/main.ts` | Salt resolution before each sync; `reencryptRemote`; passphrase step on import |
| `src/settings.ts` | *Re-encrypt remote* setting and dialog; passphrase step in the export dialog |
| `src/importExport.ts` | Exports are always encrypted (`enc=1`); device-local fields removed |
| `src/importConfirmModal.ts` | `ImportPassphraseModal` |
| `src/importValidate.ts` | Never imports `encryptionMigration`/`secretStorageNamespace`; salt changes flagged |
| `src/baseTypes.ts` | Settings `encryptionSalt`, `encryptionMigration`; `enc` link parameter |
| `src/langs/en.json` | New strings |
| `tests/encryptionPhase3.test.ts` | New tests |

---

## Phase 4: CI and dependencies

Branch: `security-update-phase4`. Finishes #12 and #13. PR #1 had already committed the lockfile, switched CI to `npm ci`, set explicit token permissions and removed the CLA workflow.

### 1. Fewer vulnerable dependencies (#12)

`npm audit --omit=dev` went from **15 to 13** findings (9 high, 4 low). Everything that could be fixed without breaking or removing features is fixed. What's left was checked against the real bundle.

| Change | Why |
|--------|-----|
| `overrides.uuid: ^11.1.1` | Fixes GHSA-w5hq-g745-h8pq (moderate; it also cleared the `@azure/msal-node` finding). `uuid` *is* bundled (OneDrive and Box code), but both users only call `v4()`, which uuid 11 still provides. |
| Removed `aws-crt` and `@aws-sdk/signature-v4-crt` | Nothing imports them. They are native Node modules for SigV4a (multi-region access points) and can't run in Obsidian. Removing them drops 18 packages and their install scripts. |
| Moved `rimraf` to `devDependencies` | Only used by the `clean` script. |

**What remains**, verified with webpack's module list (`webpack --json`):

| Advisory | Severity | In the plugin bundle? | Status |
|----------|----------|-----------------------|--------|
| `basic-ftp` GHSA-c475-qrg2-pj4r (via Box SDK → `proxy-agent` → `get-uri`) | high | **No.** Node-only FTP code, never bundled | Accepted in the allow-list; no fixed version exists |
| `braces` GHSA-vfj7-8cjw-p6xm (via pCloud SDK → `@babel/cli` → `chokidar`) | high | **No.** The pCloud SDK wrongly lists a build tool as a runtime dependency | Accepted in the allow-list; no fixed version exists |
| `elliptic` GHSA-848j-6mx2-7j84 (via `crypto-browserify`, webpack's `crypto` polyfill) | low | **Yes**, through the polyfill used by `@azure/msal-node`, `jsonwebtoken` and `jwa` | Accepted (not blocking). The advisory concerns ECDSA signing, which the plugin never does. Replacing the polyfill would risk breaking OneDrive login |

The 9 "high" entries `npm audit` prints are these two root advisories plus the packages that depend on them. Both chains belong to the PRO backends (Box, pCloud) and would disappear if those are removed (#17).

### 2. Audit gate in CI (#12)

`scripts/check-audit.mjs` (run in CI right after `npm ci`, and locally with `npm run audit:check`):
- runs `npm audit --omit=dev --json`;
- **fails the build** on any high or critical advisory in runtime dependencies that isn't reviewed in `scripts/audit-allowlist.json`;
- prints low and moderate advisories without failing;
- notes allow-list entries that are no longer reported, so they can be removed.

Every allow-list entry has a reason and a review date. Adding an entry is a deliberate, reviewable change. It uses no third-party tool, so it adds no supply-chain risk. A test run with an empty allow-list fails as expected.

### 3. GitHub Actions pinned to commits, plus Dependabot (#13)

- All actions in `auto-build.yml` and `release.yml` are pinned to the **commit SHA** of their current release, with the version as a comment. A moved or compromised tag can no longer change what runs in CI or in the release job.

  | Action | Version |
  |--------|---------|
  | `actions/checkout` | v7.0.1 |
  | `actions/cache` | v6.1.0 |
  | `actions/setup-node` | v7.1.0 |
  | `actions/upload-artifact` | v7.0.2 |
  | `softprops/action-gh-release` | v3.0.3 |

- `.github/dependabot.yml` checks npm and GitHub Actions **weekly**:
  - npm minor and patch updates come grouped in one PR;
  - major updates come one PR each;
  - Actions updates bump both the SHA and the version comment.

  Every Dependabot PR runs the tests, the build and the audit gate.
- **If OAuth client secrets are ever added** to this repo, keep them in the `env-for-buildci` environment with required reviewers, so workflows started by pull requests from forks can't read them. That's a repository setting, not code.

### Files

| File | Change |
|------|--------|
| `package.json`, `package-lock.json` | `uuid` override; `aws-crt` and `@aws-sdk/signature-v4-crt` removed; `rimraf` moved to devDependencies; `audit:check` script |
| `scripts/check-audit.mjs` | New: CI audit gate |
| `scripts/audit-allowlist.json` | New: reviewed advisories with reasons |
| `.github/workflows/auto-build.yml`, `.github/workflows/release.yml` | Actions pinned to SHAs; audit step |
| `.github/dependabot.yml` | New: weekly npm and Actions updates |
