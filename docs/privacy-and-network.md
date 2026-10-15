# Privacy and network access

This document lists **every** network destination of the plugin. It's based on a review of the source code (`src/`) and of the compiled plugin (`main.js`).

**Result: no tracking, analytics, telemetry, update checks or hidden endpoints.** The plugin only talks to the storage service you configure. Nothing else is contacted in the background.

## What the plugin connects to

| When | Destination | What is sent |
|---|---|---|
| S3 / Cloudflare R2 / AWS is selected and you sync or check connectivity | **Your configured endpoint** (e.g. `https://<account>.r2.cloudflarestorage.com`, `https://s3.<region>.amazonaws.com`), through the AWS SDK (`src/fsS3.ts`) | Signed S3 requests: list, read, write and delete objects in your bucket. Files and names are encrypted first if a password is set. |
| WebDAV is selected | **Your configured WebDAV address** (`src/fsWebdav.ts`) | WebDAV requests with your credentials |
| Webdis is selected | **Your configured Webdis address** (`src/fsWebdis.ts`) | Redis commands over HTTP |
| Dropbox is selected and connected | `api.dropboxapi.com`, `content.dropboxapi.com` (`src/fsDropbox.ts`, Dropbox SDK) | Login token exchange and file operations in the app folder |
| OneDrive is selected and connected | `login.microsoftonline.com` (your configured authority), `graph.microsoft.com` (`src/fsOnedrive.ts`) | Login token exchange and file operations in the app folder |

Notes:
- Plain `http://` is refused for every service unless the host is `localhost` or a private network address (security changes, Phases 1 and 5).
- Dropbox and OneDrive need your own app registration (client ID) at build time. Without one, they can't connect, and their login callbacks aren't even registered.
- With *Bypass CORS Issue Locally* on (the default), requests go through Obsidian's own request API rather than the browser's `fetch`. The destination is the same.

## What is only text (never contacted automatically)

These addresses appear in the plugin but are only **shown** as links or help text. They open in your browser only if you click them:

| Address | Where |
|---|---|
| `github.com/pskrebnev/remotely-sync-obsidian/...` | Links to this repository's documentation in the settings texts |
| `www.dropbox.com/account/connected_apps`, `microsoft.com/consent`, `account.live.com/consent/Manage` | "How to revoke access" hints in the Dropbox and OneDrive settings |
| `obsidian.md`, `docs.aws.amazon.com` | Help texts |

Everything else in `main.js` comes from the bundled libraries, as license headers, comments, error messages or XML namespace identifiers: `github.com/aws`, `github.com/babel`, `lodash.com`, `feross.org`, `apache.org`, `www.w3.org`, `s3.amazonaws.com/doc/2006-03-01/`, `mozilla.github.io/localForage`, and so on. None of these is requested.

## What was checked

- **Every network call in the plugin's own code.** `fetch`, `requestUrl`, `request`, `XMLHttpRequest`, `WebSocket`, `EventSource`, `navigator.sendBeacon`, `window.open` and dynamic `import()` are used only in the storage backends listed above, with URLs built from your settings or the fixed Dropbox/Microsoft API hosts.
- **Every URL in the compiled `main.js`.** Each host was classified as above.
- **Tracking libraries.** No analytics, telemetry or crash-reporting code (Sentry, Google Analytics, Mixpanel, Segment, PostHog, Amplitude, Datadog, Bugsnag and similar) is in the bundle. The only keyword match, `gtag`, came from the word `toStringTag`.
- **Loading code at runtime.**
  - No `eval`, `importScripts` or remote scripts.
  - The two `createElement("script")` uses are localforage's promise polyfill. It never sets a `src`, so it loads nothing.
  - `new Function("return this")` is webpack's fixed helper for finding the global object.
  - The encryption web workers are built from code inside the bundle.
- **Clipboard.** It's written only when you click a "copy" button (auth links and settings export).

## What stays on your device

- **Settings:** `.obsidian/plugins/sync-it-simply-stupid/data.json`. Credentials are kept in Obsidian's secret storage on Obsidian 1.11.4+, not in this file.
- **Sync history and logs:** Obsidian's local IndexedDB (database `syncitsimplystupiddb`).
- **Settings exports (QR code or link):** created locally and encrypted with your passphrase. The QR image is generated on the device; no QR service is used.

## How to re-check after changes

```bash
npm run build
# every host referenced by the bundle
grep -oE "https?://[a-zA-Z0-9.-]+" main.js | sort | uniq -c | sort -rn
# every network call site in the plugin's own code
grep -nE "\bfetch\(|requestUrl\(|\brequest\(|XMLHttpRequest|sendBeacon|WebSocket|EventSource" src/*.ts
```
