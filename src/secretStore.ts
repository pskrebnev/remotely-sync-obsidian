import type { SyncItSimplyStupidPluginSettings } from "./baseTypes";

/**
 * Credentials are kept in Obsidian's SecretStorage (Obsidian 1.11.4+)
 * instead of the plugin's data.json, which lives inside the vault
 * and can end up in backups, git or synced folders.
 * data.json keeps an empty string for each moved field.
 * Without SecretStorage, everything stays in data.json as before.
 */

export interface SecretBackend {
  getSecret(id: string): string | null;
  setSecret(id: string, secret: string): void;
}

// [section, key] or [key] in the settings object
export const SECRET_FIELDS: readonly (readonly string[])[] = [
  ["s3", "s3AccessKeyID"],
  ["s3", "s3SecretAccessKey"],
  ["password"],
  ["webdav", "password"],
  // may carry an Authorization header
  ["webdav", "customHeaders"],
  ["webdis", "password"],
  ["dropbox", "accessToken"],
  ["dropbox", "refreshToken"],
  ["onedrive", "accessToken"],
  ["onedrive", "refreshToken"],
];

/**
 * SecretStorage only accepts lowercase alphanumeric ids with dashes.
 */
export const secretIdFor = (namespace: string, field: readonly string[]) => {
  const name = field
    .join("-")
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-");
  return `sync-it-simply-stupid-${namespace}-${name}`;
};

export const newSecretNamespace = () => {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
};

const getField = (obj: any, field: readonly string[]): unknown => {
  let cur = obj;
  for (const k of field) {
    if (cur === null || typeof cur !== "object") {
      return undefined;
    }
    cur = cur[k];
  }
  return cur;
};

const setField = (obj: any, field: readonly string[], value: string) => {
  let cur = obj;
  for (const k of field.slice(0, -1)) {
    if (cur[k] === null || typeof cur[k] !== "object") {
      return;
    }
    cur = cur[k];
  }
  cur[field[field.length - 1]] = value;
};

export const getSecretBackend = (app: unknown): SecretBackend | undefined => {
  const s = (app as any)?.secretStorage;
  if (
    s !== undefined &&
    s !== null &&
    typeof s.getSecret === "function" &&
    typeof s.setSecret === "function"
  ) {
    return s as SecretBackend;
  }
  return undefined;
};

/**
 * After loading data.json: fill moved fields (empty on disk) from SecretStorage.
 * Mutates `settings`.
 */
export const fillSecretsFromBackend = (
  settings: SyncItSimplyStupidPluginSettings,
  backend: SecretBackend | undefined
) => {
  const namespace = settings.secretStorageNamespace;
  if (backend === undefined || namespace === undefined || namespace === "") {
    return;
  }
  for (const field of SECRET_FIELDS) {
    if (getField(settings, field) !== "") {
      // still stored on disk (not migrated yet): disk wins
      continue;
    }
    const secret = backend.getSecret(secretIdFor(namespace, field));
    if (secret !== null) {
      setField(settings, field, secret);
    }
  }
};

/**
 * Before saving data.json: move secrets into SecretStorage and return the
 * object to write to disk, with those fields emptied.
 * A field that cannot be stored stays on disk, so no credential is ever lost.
 * Mutates `settings` only to assign a namespace on first use.
 */
export const splitSecretsForDisk = (
  settings: SyncItSimplyStupidPluginSettings,
  backend: SecretBackend | undefined
): SyncItSimplyStupidPluginSettings => {
  if (backend === undefined) {
    return settings;
  }
  if (
    settings.secretStorageNamespace === undefined ||
    settings.secretStorageNamespace === ""
  ) {
    settings.secretStorageNamespace = newSecretNamespace();
  }
  const namespace = settings.secretStorageNamespace;
  const onDisk = JSON.parse(JSON.stringify(settings));
  for (const field of SECRET_FIELDS) {
    const value = getField(settings, field);
    if (typeof value !== "string") {
      continue;
    }
    const id = secretIdFor(namespace, field);
    try {
      if (value === "" && backend.getSecret(id) === null) {
        continue;
      }
      backend.setSecret(id, value);
      setField(onDisk, field, "");
    } catch (e) {
      console.warn(`cannot move ${field.join(".")} to secret storage`);
    }
  }
  return onDisk;
};
