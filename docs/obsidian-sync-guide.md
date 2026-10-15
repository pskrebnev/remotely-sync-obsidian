# Syncing Obsidian with this plugin

A step-by-step guide to syncing an Obsidian vault across devices with Sync Sync Sync. It focuses on **Cloudflare R2** and **AWS S3**; WebDAV, Webdis, Dropbox and OneDrive work in a similar way.

**Back up your vault before you start.** Sync tools move and delete files; a backup is your safety net.

## Contents

1. [How it works](#1-how-it-works)
2. [What you need](#2-what-you-need)
3. [Install the plugin](#3-install-the-plugin)
4. [Create the storage](#4-create-the-storage)
5. [Connect the plugin](#5-connect-the-plugin)
6. [Turn on encryption](#6-turn-on-encryption)
7. [First sync](#7-first-sync)
8. [Add another device](#8-add-another-device)
9. [Everyday use](#9-everyday-use)
10. [Upgrade an existing encrypted bucket](#10-upgrade-an-existing-encrypted-bucket)
11. [Troubleshooting](#11-troubleshooting)

---

## 1. How it works

Each device keeps its own full copy of the vault. The bucket in the cloud is the meeting point. When you sync:

1. The plugin compares the files on this device, the files in the bucket, and what it remembers from the last sync.
2. It uploads what changed here, downloads what changed elsewhere, and applies deletions.
3. If the same file changed on both sides, it keeps the **newer** or the **larger** version (your choice in the settings).

Sync only runs while Obsidian is open: when you click the sync button, on a schedule, when Obsidian starts, or shortly after you save. Obsidian can't sync in the background.

With **end-to-end encryption**, files and file names are encrypted on your device before upload. The storage provider only ever sees encrypted data.

## 2. What you need

- **Obsidian 1.11.4 or newer** on every device. Older versions work, but then your keys are kept in the plugin's settings file instead of Obsidian's secure secret storage.
- **A Cloudflare or AWS account.** Storage costs money beyond the free tiers. R2 doesn't charge for downloads; AWS S3 does.
- **The same vault name on every device.** By default the vault name is part of the sync setup.
- **For a fresh setup: an empty bucket.**

## 3. Install the plugin

The plugin ID is `sync-sync-sync`, so it is installed in `<vault>/.obsidian/plugins/sync-sync-sync/`. Don't run another sync plugin on the same vault at the same time.

### Option A: from a GitHub release (desktop and mobile)

The repository's *Release* workflow builds and publishes the plugin when a version tag is pushed:

1. In this repository, update the version in `manifest.json`, `package.json` and `versions.json` (for example `0.5.26`).
2. Commit, then push a tag with that version: `git tag 0.5.26 && git push mine 0.5.26`.
3. The workflow creates a GitHub release containing `main.js`, `manifest.json` and `styles.css`.

On each device:

1. Install the **[BRAT](https://github.com/TfTHacker/obsidian42-brat)** plugin from Obsidian's community plugins.
2. In BRAT, choose *Add beta plugin* and enter `pskrebnev/remotely-sync-obsidian`.
3. Enable **Sync Sync Sync** under *Settings → Community plugins*.

BRAT also keeps the plugin updated when you publish new releases. This is the easiest way to install on phones and tablets.

### Option B: build it yourself (desktop)

```bash
git clone https://github.com/pskrebnev/remotely-sync-obsidian.git
cd remotely-sync-obsidian
npm ci
npm run build
```

Then copy `main.js`, `manifest.json` and `styles.css` into
`<your vault>/.obsidian/plugins/sync-sync-sync/` (create the folder if needed), restart Obsidian, and enable **Sync Sync Sync** under *Settings → Community plugins*. *Restricted mode* must be off.

## 4. Create the storage

### Cloudflare R2

1. In the Cloudflare dashboard, open **R2** and **create a bucket**, for example `obsidian-vault`. Use one bucket per vault, or one bucket with a prefix per vault (see [section 5](#5-connect-the-plugin)).
2. Go to **R2 → Manage API tokens → Create API token**:
   - **Permissions:** *Object Read & Write*.
   - **Specify bucket:** only the vault's bucket. Don't use an account-wide or admin token.
3. Save the **Access Key ID** and **Secret Access Key** shown after creation. The secret is shown only once.
4. Note your **endpoint**: `https://<ACCOUNT_ID>.r2.cloudflarestorage.com`. It's shown on the token page and in the bucket settings.

More screenshots: [docs/remote_services/s3_cloudflare_r2](./remote_services/s3_cloudflare_r2/README.md).

### AWS S3

1. In the AWS console, **create an S3 bucket** in your preferred region. Keep *Block all public access* **on**.
2. Create an **IAM user** with access to that bucket only. A ready-made policy is in [s3_user_policy.md](./remote_services/s3_general/s3_user_policy.md).
3. Create an **access key** for that user, and save the **Access Key ID** and **Secret Access Key**.
4. Your **endpoint** is `https://s3.<region>.amazonaws.com`, for example `https://s3.eu-central-1.amazonaws.com`.

### CORS (usually not needed)

The plugin's *Bypass CORS Issue Locally* setting (on by default) uses Obsidian's own request API, so no CORS configuration is needed on current Obsidian versions. Only very old Obsidian versions need a bucket CORS rule allowing the origins `app://obsidian.md`, `capacitor://localhost` and `http://localhost`. See [s3_cors_configure.md](./remote_services/s3_general/s3_cors_configure.md).

## 5. Connect the plugin

Open *Settings → Sync Sync Sync*:

1. **Choose A Remote Service:** `S3 or compatible`.
2. Fill in:

   | Setting | Cloudflare R2 | AWS S3 |
   |---|---|---|
   | Endpoint | `https://<ACCOUNT_ID>.r2.cloudflarestorage.com` | `https://s3.<region>.amazonaws.com` |
   | Region | `auto` (or `us-east-1`) | your bucket's region, e.g. `eu-central-1` |
   | Access Key ID | from the API token | from the IAM access key |
   | Secret Access Key | from the API token | from the IAM access key |
   | Bucket Name | your bucket | your bucket |

   Always use `https://`. The plugin refuses plain `http://` endpoints, except for `localhost` and private network addresses such as a local MinIO server. The *Endpoint* field warns while you type an insecure address.
3. Optional: to keep several vaults in one bucket, set **Change The Remote Prefix** to a folder name per vault. Otherwise use an empty bucket per vault.
4. Click **Check Connectivity → Check**. On R2, the check can fail with an *Object Read & Write* token even though sync works. If all values are correct, try a dry run (see [section 7](#7-first-sync)).

On Obsidian 1.11.4+, the access key and secret are stored in **Obsidian's secret storage**, not in the vault. The plugin's `data.json` keeps empty fields.

## 6. Turn on encryption

Do this **before the first sync**, while the bucket is still empty:

1. Under **Basic Settings → Encryption Password**, enter a long, unique password and confirm it.
2. Keep **Encryption Method** at `RClone Crypt (recommended)`, the default.

On the first sync, the plugin generates a random **per-vault salt** and stores it in a small unencrypted file in the bucket, `_sync-sync-sync-encryption.json`. A salt isn't a secret; other devices read it automatically. Your files and file names are encrypted on the device, in the rclone format, so the bucket can even be read with the `rclone` command-line tool (`password` = your password, `password2` = the salt).

**If you lose the password, the data in the bucket can't be decrypted.** Store it in a password manager. Your local copies are not affected.

## 7. First sync

1. Optional but recommended: run the command **"Sync Sync Sync: start sync (dry run only)"** from the command palette. It shows what *would* happen without changing anything.
2. Click the **sync icon** in the left ribbon, or run **"Sync Sync Sync: start sync"**. The first sync uploads everything, so be patient.
3. Optional: under **Basic Settings**, set up **Schedule For Auto Run** (for example every 5 minutes), **Run Once On Start Up Automatically**, and **Sync On Save**.

## 8. Add another device

1. Install the plugin on the new device ([section 3](#3-install-the-plugin)), in a vault with the **same name**.
2. Transfer the settings. Either:
   - **Export and import (recommended):** on the first device, open *Import and Export Partial Settings*, click **Export S3 Part** and choose a **passphrase** (at least 8 characters). You get a QR code and a link, both encrypted with that passphrase. On the new device, scan the QR code or paste the link into **Import**, enter the passphrase, then review the list of changes and click **Apply these settings**. Send the passphrase separately from the QR code or link, never in the same message.
   - **Or enter the values manually**, as in [section 5](#5-connect-the-plugin).
3. Enter the **same Encryption Password**. Exports don't contain the encryption password unless you use *Export Basic And Advanced Part*.
4. Sync. A notice says that the encryption settings were taken over from the remote. Files download, and from now on both devices stay in sync.

The plugin's own settings file is **never** synced, even with config-folder sync on, so set up each device as described here.

## 9. Everyday use

- **Conflicts:** *Advanced Settings → Action For Conflict* chooses between keeping the **newer** and the **larger** version when a file changed on two devices between syncs. Sync often to keep conflicts rare.
- **Ignore files:** *Regex Of Paths To Ignore*, one regular expression per line (for example `^Private/`).
- **Large files:** *Skip Large Files* avoids slow syncs, especially on mobile (files of 50 MB or more are slow there).
- **Hidden items:** files and folders starting with `.` or `_` aren't synced by default. Enable *Sync _ Files Or Folders* for the `_` ones.
- **Config folder (`.obsidian`):** *Sync Config Dir (experimental)* syncs themes, snippets and other plugins' settings and code. Only enable it if nobody else can write to your bucket, because plugin code from the bucket runs on every device. Keep encryption on.
- **Safety net:** *Abort Sync If Modification Above Percentage* (default 50%) stops a sync that would delete or change more than that share of your files, which protects you from mistakes such as pointing two vaults at the same bucket.
- **Sync direction:** two-way (default), or *incremental push only* / *incremental pull only* for one-way setups such as a backup device.
- **Not supported:** allow lists (use ignore paths instead), the push/pull directions *with delete*, and syncing only the bookmarks file.

## 10. Upgrade an existing encrypted bucket

Buckets encrypted by an older version (without `_sync-sync-sync-encryption.json`) keep working, but they use rclone's built-in salt, or the weaker openssl method. To upgrade:

1. Make sure every device is synced and no device is offline with unsynced changes.
2. On one device, open **Basic Settings → Re-encrypt remote** and click **Re-encrypt**, then **Start re-encryption**.
3. The plugin syncs, publishes the new salt, re-uploads every file in the new format, checks that everything arrived, and only then deletes the old files. Keep Obsidian open until it finishes. If it's interrupted, run it again to resume.
4. While it runs, other devices stop syncing with a decryption error. Afterwards they continue on their own.

The same button **rotates the salt** on an already upgraded bucket.

## 11. Troubleshooting

| Message or symptom | Cause and fix |
|---|---|
| *refusing plain http S3 endpoint …* | The endpoint uses `http://` on a public host. Use `https://`. |
| *Sync is paused: "Allow list" paths are set …* | An old configuration uses an allow list, which Sync Sync Sync doesn't support. Clear the list (shown in the settings while it has entries) and use *Regex Of Paths To Ignore* instead. |
| *Sync is paused: the sync direction … is not supported* | An old configuration uses a push/pull direction *with delete*. Choose another direction under *Sync Direction*. |
| *The remote is encrypted, but no encryption password is set on this device* | Enter the same Encryption Password as on your other devices. |
| *Re-encrypting the remote is unfinished on this device* | Run *Re-encrypt remote* again to finish it. |
| A decryption or password error on one device | Different password or method than the other devices, or a re-encryption is still running on another device. Wait for it, or check the password. |
| *Check Connectivity* fails on R2, but values are correct | R2 tokens with *Object Read & Write* don't allow the check's request. Try a dry run; sync usually works. |
| Uploads fail with a checksum error (S3-compatible services) | Newer AWS SDKs send checksum headers that some services reject. See the note in [security-changes.md](./security-changes.md#manual-test-checklist-obsidian) (Phase 1, item 5). |
| *Abort the sync …* (modification percentage) | Sync would change many files at once. Check that the bucket, prefix and vault are the right ones; if the change is intended, raise the percentage temporarily. |
| Sync seems slow | Enable *Skip Large Files*, and see [browser_env.md](./browser_env.md) for limits of the Obsidian environment. |

More background:
- what the plugin protects against, and how: [security-changes.md](./security-changes.md);
- encryption formats: [encryption](./encryption/README.md);
- the sync algorithm: [sync_algorithm/v3/intro.md](./sync_algorithm/v3/intro.md).
