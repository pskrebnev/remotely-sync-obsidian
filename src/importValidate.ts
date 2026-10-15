import type { SyncSyncSyncPluginSettings } from "./baseTypes";
import { isInsecureRemoteUrl } from "./misc";

/**
 * Settings can be imported from an `obsidian://sync-sync-sync?...` link,
 * which anyone can craft. Only known keys with the expected types are
 * accepted, and every change is listed so the user can confirm it.
 */

const FORBIDDEN_KEYS = new Set(["__proto__", "constructor", "prototype"]);

// never taken from an import
const NEVER_IMPORT = new Set([
  "vaultRandomID",
  "pro",
  "encryptionMigration",
  "secretStorageNamespace",
]);

// not service sections, even though they are objects
const NON_SERVICE_SECTIONS = new Set(["profiler", "pro"]);

const RISKY_TOP_LEVEL = new Set([
  "serviceType",
  "password",
  "encryptionMethod",
  "syncConfigDir",
  "syncBookmarks",
  "syncDirection",
  "deleteToWhere",
  "autoRunEveryMilliseconds",
  "initRunAfterMilliseconds",
  "syncOnSaveAfterMilliseconds",
]);

const RISKY_KEY_REGEX =
  /endpoint|address|url|bucket|region|prefix|basedir|accesskey|secret|password|token|username|salt/i;

const MASKED_KEY_REGEX = /secret|password|token|accesskeyid/i;

export interface ImportChange {
  path: string;
  before: string;
  after: string;
  risky: boolean;
}

export type SanitizeResult =
  | {
      status: "ok";
      settings: Partial<SyncSyncSyncPluginSettings>;
      changes: ImportChange[];
      ignoredKeys: string[];
    }
  | { status: "error"; message: string };

const isPlainObject = (x: unknown): x is Record<string, unknown> => {
  if (x === null || typeof x !== "object" || Array.isArray(x)) {
    return false;
  }
  const proto = Object.getPrototypeOf(x);
  return proto === Object.prototype || proto === null;
};

class ImportError extends Error {}

const sanitizeValue = (
  value: unknown,
  reference: unknown,
  path: string,
  ignoredKeys: string[]
): unknown => {
  if (isPlainObject(reference)) {
    if (!isPlainObject(value)) {
      throw new ImportError(`${path} should be an object`);
    }
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      const childPath = path === "" ? k : `${path}.${k}`;
      if (FORBIDDEN_KEYS.has(k)) {
        throw new ImportError(`forbidden key ${childPath}`);
      }
      if (
        NEVER_IMPORT.has(k) ||
        !Object.prototype.hasOwnProperty.call(reference, k)
      ) {
        ignoredKeys.push(childPath);
        continue;
      }
      out[k] = sanitizeValue(v, reference[k], childPath, ignoredKeys);
    }
    return out;
  }
  if (Array.isArray(reference)) {
    if (!Array.isArray(value) || value.some((v) => typeof v !== "string")) {
      throw new ImportError(`${path} should be a list of strings`);
    }
    return [...value];
  }
  if (reference === undefined || reference === null) {
    // no default to compare with: accept primitives only
    if (value !== null && typeof value === "object") {
      throw new ImportError(`${path} should not be an object`);
    }
    return value;
  }
  if (typeof value !== typeof reference) {
    throw new ImportError(`${path} should be a ${typeof reference}`);
  }
  return value;
};

const flatten = (
  x: unknown,
  prefix: string,
  out: Map<string, unknown>
): Map<string, unknown> => {
  if (isPlainObject(x)) {
    for (const [k, v] of Object.entries(x)) {
      flatten(v, prefix === "" ? k : `${prefix}.${k}`, out);
    }
  } else {
    out.set(prefix, x);
  }
  return out;
};

const display = (path: string, value: unknown) => {
  if (value === undefined) {
    return "(not set)";
  }
  const leaf = path.split(".").pop() ?? "";
  if (MASKED_KEY_REGEX.test(leaf) && typeof value === "string" && value) {
    return "••••••";
  }
  return JSON.stringify(value);
};

const isRisky = (path: string, after: unknown) => {
  const leaf = path.split(".").pop() ?? "";
  return (
    RISKY_TOP_LEVEL.has(path) ||
    RISKY_KEY_REGEX.test(leaf) ||
    (typeof after === "string" && isInsecureRemoteUrl(after))
  );
};

/**
 * Validates imported settings against the shape of `defaults`,
 * and lists what would change compared to `current`.
 */
export const sanitizeImportedSettings = (
  raw: unknown,
  defaults: SyncSyncSyncPluginSettings,
  current: SyncSyncSyncPluginSettings
): SanitizeResult => {
  const ignoredKeys: string[] = [];
  let settings: Record<string, unknown>;
  try {
    settings = sanitizeValue(raw, defaults, "", ignoredKeys) as Record<
      string,
      unknown
    >;
  } catch (e) {
    if (e instanceof ImportError) {
      return { status: "error", message: e.message };
    }
    throw e;
  }

  if (settings.serviceType !== undefined) {
    const service = settings.serviceType as string;
    if (
      NON_SERVICE_SECTIONS.has(service) ||
      !isPlainObject((defaults as any)[service])
    ) {
      return {
        status: "error",
        message: `serviceType ${JSON.stringify(service)} is not supported`,
      };
    }
  }

  const before = flatten(current, "", new Map());
  const after = flatten(settings, "", new Map());
  const changes: ImportChange[] = [];
  for (const [path, value] of after) {
    const old = before.get(path);
    if (JSON.stringify(old) === JSON.stringify(value)) {
      continue;
    }
    changes.push({
      path,
      before: display(path, old),
      after: display(path, value),
      risky: isRisky(path, value),
    });
  }

  return {
    status: "ok",
    settings: settings as Partial<SyncSyncSyncPluginSettings>,
    changes,
    ignoredKeys,
  };
};

/**
 * Applies sanitized settings: sections are merged key by key,
 * so tokens of sections that were not imported stay untouched.
 */
export const applyImportedSettings = (
  current: SyncSyncSyncPluginSettings,
  imported: Partial<SyncSyncSyncPluginSettings>
): SyncSyncSyncPluginSettings => {
  const res: Record<string, unknown> = { ...current };
  for (const [k, v] of Object.entries(imported)) {
    const old = res[k];
    res[k] = isPlainObject(old) && isPlainObject(v) ? { ...old, ...v } : v;
  }
  return res as unknown as SyncSyncSyncPluginSettings;
};
