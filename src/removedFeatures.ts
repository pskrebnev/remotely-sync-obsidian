import type { CloudSyncPluginSettings } from "./baseTypes";

/**
 * Settings this plugin's sync engine does not support. They can still reach
 * the settings through an imported settings link.
 */

const SUPPORTED_SERVICES = new Set([
  "s3",
  "webdav",
  "dropbox",
  "onedrive",
  "webdis",
]);

const SUPPORTED_CONFLICT_ACTIONS = new Set(["keep_newer", "keep_larger"]);

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
  settings: CloudSyncPluginSettings
): string[] => {
  const messages: string[] = [];
  const s = settings as any;
  if (
    s.conflictAction !== undefined &&
    !SUPPORTED_CONFLICT_ACTIONS.has(s.conflictAction)
  ) {
    messages.push(
      `Conflict handling "${s.conflictAction}" is not supported; it is now "keep newer".`
    );
    s.conflictAction = "keep_newer";
  }
  if (!SUPPORTED_SERVICES.has(s.serviceType)) {
    messages.push(
      `The remote service "${s.serviceType}" is not supported; the service is now S3. Check your settings before syncing.`
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
  settings: CloudSyncPluginSettings
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
