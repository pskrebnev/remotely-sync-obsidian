# Security Changes

This file records every security change made in this fork, phase by phase. It explains what changed, why, and what users will notice. The plan with all findings and the reasoning behind the order is in [security-fix-plan.md](./security-fix-plan.md). Finding numbers such as `#1` refer to that plan.

Each phase is developed on its own branch (`security-update-phaseN`) and merged into `security-plan-update`.

| Phase | Focus | Status |
|-------|-------|--------|
| [Phase 1](#phase-1-cloudflare-r2--aws-s3-critical-path) | Cloudflare R2 / AWS S3 critical path: settings import, https-only S3, no secrets in logs, vault path guard | Done |
| Phase 2 | This plugin's `data.json` and credential storage | Not started |
| Phase 3 | Encryption upgrades | Not started |
| Phase 4 | CI and dependencies | Not started |
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
