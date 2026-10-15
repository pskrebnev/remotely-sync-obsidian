import type { RemotelySavePluginSettings } from "./baseTypes";

/**
 * This fork removed the PRO code (PolyForm Strict licensed) and uses the
 * Apache-licensed sync engine of v0.4.25. Some settings written by newer
 * versions belong to features that engine does not have.
 * See docs/security-changes.md ("Removal of PRO code").
 */

const SUPPORTED_SERVICES = new Set([
  "s3",
  "webdav",
  "dropbox",
  "onedrive",
  "webdis",
]);

const SUPPORTED_SYNC_DIRECTIONS = new Set([
  "bidirectional",
  "incremental_push_only",
  "incremental_pull_only",
]);

/**
 * Settings that can be changed safely: returns a message for each change.
 * Mutates `settings`.
 */
export const migrateRemovedFeatureSettings = (
  settings: RemotelySavePluginSettings
): string[] => {
  const messages: string[] = [];
  const s = settings as any;
  if (s.conflictAction === "smart_conflict") {
    s.conflictAction = "keep_newer";
    messages.push(
      `"Smart conflict" (a PRO feature) was removed; conflict handling is now "keep newer".`
    );
  }
  if (!SUPPORTED_SERVICES.has(s.serviceType)) {
    messages.push(
      `The remote service "${s.serviceType}" (a PRO feature) was removed; the service is now S3. Check your settings before syncing.`
    );
    s.serviceType = "s3";
  }
  if (s.syncBookmarks === true) {
    s.syncBookmarks = false;
    messages.push(
      `Syncing only the bookmarks file is not supported by this version and was turned off.`
    );
  }
  return messages;
};

/**
 * Settings that cannot be changed silently, because syncing differently
 * from what the user configured could upload or delete the wrong files.
 * Sync refuses to run while one of these is set.
 */
export const getUnsupportedSyncSettingsReason = (
  settings: RemotelySavePluginSettings
): string | undefined => {
  const s = settings as any;
  if ((s.onlyAllowPaths ?? []).length > 0) {
    return `Sync is paused: "Allow list" paths are set, but this version does not support allow lists, so it would sync more files than you allowed. Clear the allow list in the settings to sync.`;
  }
  if (
    s.syncDirection !== undefined &&
    !SUPPORTED_SYNC_DIRECTIONS.has(s.syncDirection)
  ) {
    return `Sync is paused: the sync direction "${s.syncDirection}" is not supported by this version. Choose a sync direction in the settings.`;
  }
  return undefined;
};
