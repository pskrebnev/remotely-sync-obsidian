# Cloudflare R2

How to sync an Obsidian vault with **Cloudflare R2** using **Sync It Simply Stupid**, from creating the bucket to syncing a second device.

For installing the plugin, see the [sync guide, section 3](../../obsidian-sync-guide.md#3-install-the-plugin).

## Contents

1. [Before you start](#1-before-you-start)
2. [Create the bucket](#2-create-the-bucket)
3. [Create an API token for this bucket only](#3-create-an-api-token-for-this-bucket-only)
4. [Configure the plugin](#4-configure-the-plugin)
5. [Turn on encryption](#5-turn-on-encryption)
6. [First sync](#6-first-sync)
7. [Add another device](#7-add-another-device)
8. [Optional settings](#8-optional-settings)
9. [Troubleshooting](#9-troubleshooting)

---

## 1. Before you start

- **Cloudflare account** with R2 enabled. Cloudflare may ask for payment details, even though R2 has a free tier.
- **Costs:** R2 charges for storage and operations beyond the free tier, and nothing for downloads (egress). Check the current [R2 pricing](https://developers.cloudflare.com/r2/pricing/).
- **Obsidian 1.11.4 or newer**, so your keys are kept in Obsidian's secret storage instead of a file in the vault.
- **Back up your vault** before the first sync.

## 2. Create the bucket

1. Open the [Cloudflare dashboard](https://dash.cloudflare.com/) → **R2 Object Storage** → **Create bucket**.
2. **Bucket name:** for example `obsidian-vault` (the examples below use `temp-obsidian`). Use one bucket per vault. Several vaults can share a bucket using a remote prefix (see [section 8](#8-optional-settings)), but separate buckets are simpler.
3. **Location:** *Automatic*, or a **location hint** close to you, such as *Eastern Europe (EEUR)*. A location hint only affects where the data is stored, **not** the endpoint or the region you enter in the plugin. A **jurisdiction** (for example *European Union*) is different: it does change the endpoint (see [section 4](#4-configure-the-plugin)).
4. **Default storage class:** *Standard*.

![](./s3_cloudflare_r2_create_bucket.png)

### Check the bucket's settings

Open the bucket → **Settings**. The page lists these sections (left menu). This is what each one should look like for Obsidian sync:

| Section | What to do |
|---|---|
| **General** | Nothing to change. It shows **Name**, **Created**, **Location** and **S3 API**: you need **Name** and **S3 API** in [section 4](#4-configure-the-plugin). |
| **Custom Domains** | Leave empty ("There is no custom domain assigned to this bucket"). A custom domain would make your files publicly reachable. |
| **Public Development URL** | Leave **disabled** ("The public development URL is disabled for this bucket"). Enabling it would expose the bucket on the internet. |
| **Basin Catalog** | Leave disabled. It's for Apache Iceberg tables, not needed. |
| **CORS Policy** | Leave empty ("There is no CORS Policy defined for this bucket"). Not needed with the plugin's *Bypass CORS Issue Locally* (the default). See [section 8](#8-optional-settings) for very old Obsidian versions. |
| **Object Lifecycle Rules** | Don't add rules that **delete or move objects**: they would delete files from your synced vault behind the plugin's back. A rule that only aborts *incomplete multipart uploads* is fine. |
| **Bucket Lock Rules** | Leave empty. A lock prevents deleting or overwriting objects, so syncing deletions and changes would fail. |
| **Event Notifications**, **Data Access Logs** | Not needed. Optional; they don't affect the plugin. |
| **On Demand Migration**, **Local Uploads** | Not needed (they copy data from other storage or speed up uploads for other tools). |
| **Default Storage Class** | Keep **Standard**. *Infrequent Access* adds retrieval fees and a minimum storage duration, which a sync tool that reads and replaces files often would hit constantly. |
| **Empty Bucket**, **Delete Bucket** | Don't use them on a bucket you sync: the plugin would treat the files as deleted remotely. |

## 3. Create an API token for this bucket only

1. Go back to **R2 Object Storage** (the overview, not the bucket) and open **Manage API tokens** → **Create API token**. Use an *Account* token, or a *User* token if you prefer it tied to you.
2. **Permissions:** **Object Read & Write**. Don't choose *Admin*.
3. **Specify bucket(s):** **Apply to specific buckets only**, then select your vault's bucket (e.g. `temp-obsidian`).
4. **TTL:** optional. A token that expires is safer, but you must create a new one in time.
5. Click **Create**, then copy the **Access Key ID** and the **Secret Access Key**. **The secret is shown only once.**

![](./s3_cloudflare_r2_create_api_token.png)

Keep the values in a password manager. If a key ever leaks, delete the token in the dashboard and create a new one.

## 4. Configure the plugin

Open **Settings → Sync It Simply Stupid** and set **Choose A Remote Service** to **S3 or compatible**. Each value comes from a specific place in the Cloudflare dashboard:

| Plugin setting | Where to find it in Cloudflare | Example |
|---|---|---|
| **Endpoint** | Bucket → **Settings → General → S3 API**, **without the bucket name at the end** | S3 API shows `https://<ACCOUNT_ID>.r2.cloudflarestorage.com/temp-obsidian` → enter `https://<ACCOUNT_ID>.r2.cloudflarestorage.com` |
| **Region** | Not in the dashboard: always `auto`. **Don't** enter the location (e.g. `EEUR`). | `auto` |
| **Access Key ID** | The API token from [section 3](#3-create-an-api-token-for-this-bucket-only) | `a1b2c3…` |
| **Secret Access Key** | The API token from [section 3](#3-create-an-api-token-for-this-bucket-only) | `••••••` |
| **Bucket Name** | Bucket → **Settings → General → Name** | `temp-obsidian` |

> **The most common mistake:** pasting the whole **S3 API** value as the endpoint. The dashboard shows it with the bucket name appended (`…r2.cloudflarestorage.com/temp-obsidian`). The plugin adds the bucket name itself, so remove `/temp-obsidian` (everything after `.com`). Otherwise requests go to the wrong address and fail with errors such as `NoSuchBucket`, `AccessDenied` or `SignatureDoesNotMatch`.

For a bucket created with a **jurisdiction**, the S3 API shows a different host, e.g. `https://<ACCOUNT_ID>.eu.r2.cloudflarestorage.com/<bucket>`. Use that host, again without the bucket name.

Leave the other S3 settings at their defaults:

| Setting | Value |
|---|---|
| **S3 URL style** | the default |
| **Bypass CORS Issue Locally** | **Enable** (the default) |
| **Generate Folder Object Or Not** | **Not generate** (the default) |
| **Use Accurate MTime** | **disabled**: it costs an extra request per file |
| **Parts Concurrency** | `20` (the default) |

Notes:
- Always use `https://`. The plugin refuses `http://` endpoints on public hosts, and the *Endpoint* field shows a warning while you type one.
- On Obsidian 1.11.4+, the Access Key ID and Secret Access Key are stored in Obsidian's secret storage, not in the plugin's `data.json`.

Click **Check Connectivity → Check**. "Great! The bucket can be accessed." means you're ready. If it fails, the message names the reason (for example `403`, a path in the endpoint, or no answer within 30 seconds); see [Troubleshooting](#9-troubleshooting).

> **If the check fails but every value is correct:** with *Object Read & Write* tokens, R2 can reject the request the check uses, even though syncing works. Run a dry run (see [section 6](#6-first-sync)) to confirm.

## 5. Turn on encryption

Do this **before the first sync**, while the bucket is still empty:

1. **Basic Settings → Encryption Password:** enter a long, unique password and confirm it.
2. **Encryption Method:** keep **RClone Crypt (recommended)**.

On the first sync, the plugin stores a random per-vault salt in a small file in the bucket, `_sync-it-simply-stupid-encryption.json`. It isn't secret; other devices read it automatically. File contents and names are encrypted before upload, so Cloudflare only sees encrypted data.

**If you lose the password, the files in the bucket can't be decrypted.** Your local copies aren't affected.

## 6. First sync

1. Run **Sync It Simply Stupid: start sync (dry run only)** from the command palette. It lists what would happen without changing anything.
2. Click the **sync icon** in the left ribbon, or run **Sync It Simply Stupid: start sync**. The first sync uploads everything.
3. In the Cloudflare dashboard, open the bucket. You'll see encrypted object names and `_sync-it-simply-stupid-encryption.json`.
4. Optional: in **Basic Settings**, set **Schedule For Auto Run** (e.g. every 5 minutes), **Run Once On Start Up Automatically** and **Sync On Save**.

### Check what's synced

> **With encryption on, add files only through your vault.** Put a file (for example a PDF) into the vault folder or drag it into Obsidian, then sync; the plugin uploads it encrypted. Files uploaded directly in the Cloudflare dashboard are **not** synced: the plugin skips them (it never downloads or deletes them) and shows a notice that names them. Delete them from the bucket, or keep them there if you want.

With encryption on, object names in the dashboard are encrypted, so you can't read them there. To check:

| Where | What it tells you |
|---|---|
| Bucket → **Objects** | One encrypted object per vault file (and per folder), plus `_sync-it-simply-stupid-encryption.json`. If you only see that file, nothing has been uploaded yet: check the sync log. |
| Bucket → **Metrics** | Total stored size and object count over time |
| Command **Sync It Simply Stupid: show sync log** | The result of every sync and connectivity check: OK or failed, the number of file operations, error messages, and skipped objects. No passwords, keys or tokens. |
| Command **Sync It Simply Stupid: start sync (dry run only)** | What a sync *would* upload, download or delete, without doing it |
| Command **export sync plans (latest 1)** | The per-file decisions of the last sync, as a note in the vault's `_debug_sync_it_simply_stupid/` folder |
| **rclone** CLI | The real (decrypted) file names: see below |

**Listing the decrypted names with rclone** (optional). In `rclone config`, create:
1. an **S3** remote for R2 (provider *Cloudflare*, your Access Key ID and Secret Access Key, endpoint `https://<ACCOUNT_ID>.r2.cloudflarestorage.com`), e.g. named `r2`;
2. a **crypt** remote on top of it: remote `r2:<bucket-name>`, filename encryption *standard*, directory name encryption *true*, **filename encoding `base64`** (in the advanced options; rclone's default is base32, the plugin uses base64), **password** = your encryption password, **password2** = the `salt` value from `_sync-it-simply-stupid-encryption.json`, e.g. named `vault`.

Then `rclone ls vault:` lists your files with their real names.

## 7. Add another device

1. Install the plugin on the other device, in a vault with the **same name**.
2. On the first device, open **Import and Export Partial Settings → Export S3 Part** and choose a **passphrase**. You get a QR code and a link, both encrypted.
3. On the new device, scan the QR code, or paste the link into **Import**. Enter the passphrase, review the changes and click **Apply these settings**. Send the passphrase separately from the QR code or link.
4. Enter the same **Encryption Password**.
5. Sync. A notice says the encryption settings were taken over from the remote, and your files download.

## 8. Optional settings

- **Several vaults in one bucket:** set **Change The Remote Prefix (experimental)** to a different folder name for each vault, for example `work` and `personal`.
- **Large files:** **Skip Large Files** keeps syncs fast, especially on mobile.
- **Parts Concurrency:** how many parts of a large file upload in parallel. The default (20) is fine; lower it on a slow connection.
- **CORS:** not needed with *Bypass CORS Issue Locally* enabled. Only very old Obsidian versions need it. In that case, open the bucket's **Settings → CORS policy** and add:

  ```json
  [
    {
      "AllowedOrigins": ["app://obsidian.md", "capacitor://localhost", "http://localhost"],
      "AllowedMethods": ["GET", "PUT", "POST", "DELETE", "HEAD"],
      "AllowedHeaders": ["*"],
      "ExposeHeaders": ["ETag"],
      "MaxAgeSeconds": 3600
    }
  ]
  ```

## 9. Troubleshooting

| Symptom | Cause and fix |
|---|---|
| Sync shows "error while sync" or *Cannot decrypt the name of the remote object …* (older versions showed only the first) | An object in the bucket wasn't written by this plugin with the current password. If its name looks encrypted, another device may be re-encrypting the remote (wait), the password may differ, or the object is damaged. Remove objects you added yourself in the dashboard. |
| Notice: *… object(s) in the remote were not created by this plugin and were skipped* | Files uploaded directly in the dashboard (names like `report.pdf`). They're ignored, never downloaded or deleted. Add files through your vault instead, and delete those objects if you don't need them. |
| `refusing plain http S3 endpoint` | The endpoint starts with `http://`. Use the `https://` endpoint from the dashboard. |
| `403 Forbidden` / `AccessDenied` | The token isn't allowed on this bucket. Check that it has *Object Read & Write* and that the bucket is selected under *Specify bucket(s)*. Also check the **Bucket Name** spelling. |
| `SignatureDoesNotMatch` | Wrong **Secret Access Key** (often a missing character when copying), or a wrong **Region**. Use `auto`. |
| `NoSuchBucket`, or errors right after entering the endpoint | The **Endpoint** still ends with the bucket name (`…cloudflarestorage.com/temp-obsidian`): remove everything after `.com`. Also check the **Bucket Name** spelling, and that the endpoint matches the bucket's jurisdiction (an EU-jurisdiction bucket needs `.eu.` in the host). |
| `RequestTimeTooSkewed` | The device clock is wrong. Turn on automatic date and time. |
| Uploads fail with a checksum error | R2 rejected the checksum headers that newer AWS SDKs send. The fix is a code change (`requestChecksumCalculation: "WHEN_REQUIRED"` in `getS3Client`, `src/fsS3.ts`); see [security-changes.md, Phase 1](../../security-changes.md#manual-test-checklist-obsidian), item 5. |
| *Check Connectivity*: "No answer within 30 seconds" | The endpoint host can't be reached: check the address, your network, VPN or firewall. The check (and every S3 request) now gives up instead of waiting forever. |
| *The remote is encrypted, but no encryption password is set on this device* | Enter the same **Encryption Password** as on your other devices. |
| *Abort the sync …* (modification percentage) | The sync would change many files at once. Check that the bucket and prefix are the right ones before raising the limit. |

More help: [sync guide](../../obsidian-sync-guide.md), [privacy and network access](../../privacy-and-network.md).
