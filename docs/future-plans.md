# Plans for future

Investigations that ended with a plan but no implementation yet, kept so the work can be picked up later. Each entry records what was found, the options, an estimate and a plan.

| # | Topic | Status | Estimate |
|---|-------|--------|----------|
| 1 | [Status bar: red icon and a plugin status icon](#1-status-bar-red-icon-and-a-plugin-status-icon) | Investigated, not implemented | 2–3 hours |
| 2 | [Faster tooling: Bun, Vite+, esbuild](#2-faster-tooling-bun-vite-esbuild) | Investigated, not recommended now | 2 hours to 4 days |
| 3 | [Endpoint with the bucket name: fix it automatically](#3-endpoint-with-the-bucket-name-fix-it-automatically) | Idea | 1 hour |
| 4 | [Import files uploaded directly to the bucket](#4-import-files-uploaded-directly-to-the-bucket) | Idea, not recommended | 1 day |
| 5 | [Path checks inside the sync engine](#5-path-checks-inside-the-sync-engine) | Possible since the PRO removal | half a day |
| 6 | [S3 upload checksums (compatibility)](#6-s3-upload-checksums-compatibility) | Only if uploads fail | 1 hour |
| 7 | [Remove `pro/` from the git history](#7-remove-pro-from-the-git-history) | Decision needed | 1 hour |
| 8 | [Publish a release for BRAT](#8-publish-a-release-for-brat) | Ready to do | 15 minutes |

---

## 1. Status bar: red icon and a plugin status icon

*Investigated on 2026-10-16.*

**Observation.** In the bottom-right status bar, a **red, crossed circular-arrows icon** appeared next to this plugin's text "Successfully synced 10 minutes ago". The request was to show "Success" in green instead.

**Finding: the red icon is not from this plugin.**
- Sync It Simply Stupid adds only **text** to the status bar: `src/main.ts` creates a plain `<span>` with `addStatusBarItem()` and only ever sets its text. It never adds an icon.
- The red icon is almost certainly from **Obsidian's built-in "Sync" core plugin** (the paid Obsidian Sync service). That core plugin was enabled in the vault's *Core plugins* and isn't connected to an Obsidian Sync account, so it shows a red "not connected" state.
- To confirm, hover over the icon: the tooltip comes from Obsidian.

**Options**

| Option | Result | Effort |
|---|---|---|
| **A. Turn off the core Sync plugin** (*Settings → Core plugins → Sync* → off) | The red icon disappears. Sync It Simply Stupid doesn't use Obsidian Sync. | 1 minute, no code |
| **B. Give this plugin its own status icon** next to its text | Green ✓ after a successful sync, red ⚠ after a failure, spinning while syncing, grey before the first sync | **2–3 hours**, including tests and docs |
| Recolour Obsidian's Sync icon | Not recommended: it reports Obsidian Sync's real state, and colouring it green would hide a genuine warning | — |

**Recommendation:** A now (a user setting, no code), then B if a visible success or failure signal for this plugin is wanted. B alone would leave the red Obsidian Sync icon in place.

**Plan for B**
1. **Icon element:** add an icon next to the existing status text, in the same status bar item, using Obsidian's built-in icons (`setIcon`):
   - `check-circle`: last sync succeeded;
   - `alert-circle`: last sync failed;
   - `refresh-cw` (spinning): syncing;
   - `circle-dashed`: never synced.
2. **Colours:** classes in `styles.css` using Obsidian's theme variables (`--color-green`, `--color-red`, `--text-muted`), so light, dark and custom themes work.
3. **One state source:** a small pure function maps the state (never synced, syncing, last sync OK, last sync failed) to icon, colour class and tooltip. It's called wherever the status text is updated today: sync start and progress (`setCurrSyncMsg`) and the final "Successfully synced… / Failed to sync…" (`updateLastSyncMsg`).
4. **After a restart:** derive the state from the existing last-success and last-failure records (`getLastSuccessSyncTimeByVault` / `getLastFailedSyncTimeByVault`), so a failure stays red until a sync succeeds.
5. **Mobile:** the same icon in the mobile status bar when *Enable mobile status bar* is on.
6. **Setting:** *Show status icon*, on by default.
7. **Tests:** unit tests for the state → icon/colour/tooltip mapping and the after-restart logic. Manual visual check in Obsidian (desktop and mobile, light and dark themes).
8. **Docs:** README and the [sync guide](./obsidian-sync-guide.md).

---

## 2. Faster tooling: Bun, Vite+, esbuild

*Investigated on 2026-10-16.*

Bun or Vite+ would only be **development tools** here: Obsidian runs the built `main.js` in its own app (Electron, or the system WebView on mobile), never in Bun or Node. The current setup is already fast: build ~9 s, tests under 1 s, `npm ci` 3–5 s.

| Option | Effort | Notes |
|---|---|---|
| Bun as package manager | ~2 hours | `bun.lock`, `setup-bun` in CI; Dependabot supports Bun |
| + Bun as test runner | +2–4 hours | Replace mocha + tsx with `bun test`; adapt mocha-specific parts (`this.timeout`); move the audit gate to `bun audit` |
| + Bun as bundler | 2–4 days, plus device testing | Needs a custom plugin for the **inline encryption web workers** and a way to provide the Node APIs the libraries expect (`Buffer`, `process`, `path`, `stream`, `url`); Bun's browser target handles Node built-ins differently. Risky for the AWS/Dropbox/WebDAV libraries. |
| Vite+ (VoidZero) | 2–4 days | All-in-one toolchain (Vite/Rolldown, Vitest, Oxlint/Oxfmt). Beta since July 2026 under MIT; a commercial tier was announced as an intention, without pricing. Vite's dev server and hot reload can't be used for Obsidian plugins. It can inline workers natively (`?worker&inline`). Overlaps with Bun: pick one at most. |
| **esbuild as the main build** | ~half a day, plus a real sync test | Already in the repo (`npm run build2`, fixed in #15); roughly the speed of Bun's bundler with no new toolchain |

**Recommendation:** none of these is needed. If a faster build is wanted, make the existing esbuild build the main one. Bun as package manager and test runner is a low-risk experiment because it doesn't change `main.js`.

---

## 3. Endpoint with the bucket name: fix it automatically

The Cloudflare R2 dashboard shows the **S3 API** address with the bucket name appended (`https://<ACCOUNT_ID>.r2.cloudflarestorage.com/<bucket>`). Pasting it as is is a common mistake. Since #22, *Check Connectivity* explains it, and the [R2 guide](./remote_services/s3_cloudflare_r2/README.md#4-configure-the-plugin) warns about it.

**Plan:** when the endpoint's path equals `/<bucket name>`, strip it automatically on save, with a notice that says so, and add a test. `endpointHasPath` in `src/fsS3.ts` already detects it. **~1 hour.**

---

## 4. Import files uploaded directly to the bucket

Since #23, objects uploaded directly to an encrypted bucket (e.g. `report.pdf`) are **skipped and reported**, never downloaded or deleted.

**Possible addition:** download such an object, save it in the vault, re-upload it encrypted, and delete the plain copy. **~1 day.** Not recommended: it deletes from the bucket automatically, and adding files through the vault already works.

---

## 5. Path checks inside the sync engine

The guards against paths escaping the vault (#4) and against syncing the plugin's own `data.json` (#5) live **around** the sync engine (`src/fsLocal.ts`, `src/fsEncrypt.ts`, `src/obsFolderLister.ts`), because the engine used to be PolyForm-licensed. Since the [removal of PRO code](./security-changes.md#removal-of-pro-code), `src/sync.ts` is Apache-licensed and can be changed.

**Plan:** also enforce both checks in the engine's planning step, with tests in `tests/syncEngine.test.ts`. **~half a day.**

---

## 6. S3 upload checksums (compatibility)

Newer AWS SDKs send CRC32 checksum headers on uploads. Some S3-compatible services have rejected them. Uploads to R2 haven't been reported as failing.

**Plan, only if uploads fail with a checksum error:** set `requestChecksumCalculation: "WHEN_REQUIRED"` and `responseChecksumValidation: "WHEN_REQUIRED"` in `getS3Client` (`src/fsS3.ts`), with a test. **~1 hour.**

---

## 7. Remove `pro/` from the git history

The `pro/` folder (PolyForm Strict) was deleted from the code, but **earlier commits on GitHub still contain it**. To stop distributing it completely, either:
- rewrite the history to remove `pro/` from every commit and force-push; this changes every commit hash, and copies others already cloned are unaffected; or
- make the repository private.

**~1 hour; it's the owner's decision.** See [security-changes.md](./security-changes.md#removal-of-pro-code).

---

## 8. Publish a release for BRAT

BRAT (installing on phones and tablets) needs a GitHub release, and none has been published yet. The *Release* workflow builds it when a version tag is pushed: set the version (currently `0.9.8`) in the manifests, `package.json` and `versions.json`, then `git tag 0.9.8 && git push mine 0.9.8`. **~15 minutes.** See the [sync guide, section 3](./obsidian-sync-guide.md#3-install-the-plugin).
