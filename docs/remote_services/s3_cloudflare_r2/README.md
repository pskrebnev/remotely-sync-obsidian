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
2. **Name:** for example `obsidian-vault`. Use one bucket per vault. Several vaults can share a bucket using a remote prefix (see [section 8](#8-optional-settings)), but separate buckets are simpler.
3. **Location:** *Automatic* is fine. If you choose a **jurisdiction** (for example *European Union*), note it: the endpoint changes (see [section 4](#4-configure-the-plugin)).
4. **Storage class:** *Standard*.
5. Leave **public access off**. Don't enable the `r2.dev` public URL or a custom domain for this bucket. The plugin doesn't need them, and they would expose your files.

![](./s3_cloudflare_r2_create_bucket.png)

## 3. Create an API token for this bucket only

1. In **R2 Object Storage**, open **Manage API tokens** → **Create API token**. Use an *Account* token, or a *User* token if you prefer it tied to you.
2. **Permissions:** **Object Read & Write**. Don't choose *Admin*.
3. **Specify bucket(s):** **Apply to specific buckets only**, then select your vault's bucket.
4. **TTL:** optional. A token that expires is safer, but you must create a new one in time.
5. Click **Create**, then copy these values. **The secret is shown only once.**
   - **Access Key ID**
   - **Secret Access Key**
   - **S3 endpoint**, which looks like `https://<ACCOUNT_ID>.r2.cloudflarestorage.com`

![](./s3_cloudflare_r2_create_api_token.png)

Keep the values in a password manager. If a key ever leaks, delete the token in the dashboard and create a new one.

## 4. Configure the plugin

Open **Settings → Sync It Simply Stupid** and set **Choose A Remote Service** to **S3 or compatible**. Then fill in:

| Setting | Value |
|---|---|
| **Endpoint** | `https://<ACCOUNT_ID>.r2.cloudflarestorage.com`. For a jurisdiction bucket, use the endpoint shown for it, e.g. `https://<ACCOUNT_ID>.eu.r2.cloudflarestorage.com`. |
| **Region** | `auto` (Cloudflare's recommended value; `us-east-1` also works) |
| **Access Key ID** | from step 3 |
| **Secret Access Key** | from step 3 |
| **Bucket Name** | your bucket, e.g. `obsidian-vault` |
| **S3 URL style** | leave the default |
| **Bypass CORS Issue Locally** | **Enable** (the default) |
| **Generate Folder Object Or Not** | **Not generate** (the default) |
| **Use Accurate MTime** | leave **disabled**: it costs an extra request per file |

Notes:
- Always use `https://`. The plugin refuses `http://` endpoints on public hosts, and the *Endpoint* field shows a warning while you type one.
- On Obsidian 1.11.4+, the Access Key ID and Secret Access Key are stored in Obsidian's secret storage, not in the plugin's `data.json`.

Click **Check Connectivity → Check**. "Great! The bucket can be accessed." means you're ready.

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
| `refusing plain http S3 endpoint` | The endpoint starts with `http://`. Use the `https://` endpoint from the dashboard. |
| `403 Forbidden` / `AccessDenied` | The token isn't allowed on this bucket. Check that it has *Object Read & Write* and that the bucket is selected under *Specify bucket(s)*. Also check the **Bucket Name** spelling. |
| `SignatureDoesNotMatch` | Wrong **Secret Access Key** (often a missing character when copying), or a wrong **Region**. Use `auto`. |
| `NoSuchBucket` | Wrong **Bucket Name**, or the endpoint doesn't match the bucket's jurisdiction (for example an EU bucket needs `.eu.` in the endpoint). |
| `RequestTimeTooSkewed` | The device clock is wrong. Turn on automatic date and time. |
| Uploads fail with a checksum error | R2 rejected the checksum headers that newer AWS SDKs send. The fix is a code change (`requestChecksumCalculation: "WHEN_REQUIRED"` in `getS3Client`, `src/fsS3.ts`); see [security-changes.md, Phase 1](../../security-changes.md#manual-test-checklist-obsidian), item 5. |
| *The remote is encrypted, but no encryption password is set on this device* | Enter the same **Encryption Password** as on your other devices. |
| *Abort the sync …* (modification percentage) | The sync would change many files at once. Check that the bucket and prefix are the right ones before raising the limit. |

More help: [sync guide](../../obsidian-sync-guide.md), [privacy and network access](../../privacy-and-network.md).
