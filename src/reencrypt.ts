import type { Entity } from "./baseTypes";
import { ENCRYPTION_PARAMS_FILE } from "./encryptionParams";

/**
 * "Re-encrypt remote": rebuilds every remote object in the new format
 * (rclone with a per-vault salt), then deletes the old objects.
 *
 * Content comes from this device when it has the file, otherwise from the
 * old remote object, so remote-only files are kept.
 * Works on the raw remote listing, so an interrupted run can be resumed
 * (old objects are copied again: idempotent, and always from the right source).
 * Nothing is deleted before every object exists in the new format.
 */

export interface Codec {
  // throws if the raw name was not produced by this codec
  decryptName(raw: string): Promise<string>;
  // throws if the content was not produced by this codec (authenticated)
  decryptContent(content: ArrayBuffer): Promise<ArrayBuffer>;
}

export interface ClassifiedEntry {
  raw: string;
  key: string;
  entity: Entity;
}

export interface Classification {
  toMigrate: ClassifiedEntry[];
  migrated: ClassifiedEntry[];
  // folders whose name decrypts with both keys (cannot tell, left untouched)
  ambiguousFolders: string[];
  unknown: string[];
}

const tryDecryptName = async (codec: Codec, raw: string) => {
  try {
    return await codec.decryptName(raw);
  } catch {
    return undefined;
  }
};

const decryptsWith = async (codec: Codec, content: ArrayBuffer) => {
  try {
    await codec.decryptContent(content);
    return true;
  } catch {
    return false;
  }
};

export const classifyRemoteEntries = async (
  rawEntities: Entity[],
  oldCodec: Codec,
  newCodec: Codec,
  readRaw: (raw: string) => Promise<ArrayBuffer>
): Promise<Classification> => {
  const res: Classification = {
    toMigrate: [],
    migrated: [],
    ambiguousFolders: [],
    unknown: [],
  };
  for (const entity of rawEntities) {
    const raw = entity.keyRaw;
    if (raw === ENCRYPTION_PARAMS_FILE) {
      continue;
    }
    const asNew = await tryDecryptName(newCodec, raw);
    const asOld = await tryDecryptName(oldCodec, raw);
    if (asNew !== undefined && asOld === undefined) {
      res.migrated.push({ raw, key: asNew, entity });
    } else if (asOld !== undefined && asNew === undefined) {
      res.toMigrate.push({ raw, key: asOld, entity });
    } else if (asOld !== undefined && asNew !== undefined) {
      // a name can (rarely) decrypt under both keys;
      // file content is authenticated, so it decides
      if (raw.endsWith("/")) {
        res.ambiguousFolders.push(raw);
        continue;
      }
      const content = await readRaw(raw);
      if (await decryptsWith(newCodec, content)) {
        res.migrated.push({ raw, key: asNew, entity });
      } else if (await decryptsWith(oldCodec, content)) {
        res.toMigrate.push({ raw, key: asOld, entity });
      } else {
        res.unknown.push(raw);
      }
    } else {
      res.unknown.push(raw);
    }
  }
  return res;
};

export interface RebuildIO {
  listRaw(): Promise<Entity[]>;
  readRaw(raw: string): Promise<ArrayBuffer>;
  deleteRaw(raw: string): Promise<void>;
  // this device's copy, or undefined if it has none
  readLocal(
    key: string
  ): Promise<
    { content: ArrayBuffer; mtime: number; ctime: number } | undefined
  >;
  writeNew(
    key: string,
    content: ArrayBuffer,
    mtime: number,
    ctime: number
  ): Promise<void>;
  mkdirNew(key: string, mtime?: number): Promise<void>;
  publishParams(): Promise<void>;
  onProgress?(done: number, total: number, key: string): void;
}

export interface RebuildResult {
  migratedCount: number;
  fromLocal: number;
  fromRemote: number;
  deletedCount: number;
  ambiguousFolders: string[];
}

const depth = (key: string) => key.replace(/\/$/, "").split("/").length;

/**
 * @param dropKeys decrypted keys that must not be carried over (e.g. this
 * plugin's own data.json uploaded by an older version): their old objects
 * are deleted without writing a new copy
 */
export const rebuildRemoteEncryption = async (
  io: RebuildIO,
  oldCodec: Codec,
  newCodec: Codec,
  dropKeys: Set<string> = new Set()
): Promise<RebuildResult> => {
  const before = await classifyRemoteEntries(
    await io.listRaw(),
    oldCodec,
    newCodec,
    io.readRaw
  );
  if (before.unknown.length > 0) {
    throw Error(
      `re-encryption stopped before changing anything: ${before.unknown.length} remote object(s) can be decrypted with neither the old nor the new key, e.g. ${before.unknown[0]}`
    );
  }

  // Publish the new salt first: other devices switch to the new key at once,
  // and their syncs stop on not-yet-migrated names instead of writing
  // old-format objects that would be deleted at the end.
  await io.publishParams();

  // folders first (shallow to deep), then files
  const todo = before.toMigrate
    .filter((e) => !dropKeys.has(e.key))
    .sort((a, b) => {
      const fa = a.key.endsWith("/") ? 0 : 1;
      const fb = b.key.endsWith("/") ? 0 : 1;
      return fa !== fb ? fa - fb : depth(a.key) - depth(b.key);
    });

  let fromLocal = 0;
  let fromRemote = 0;
  let done = 0;
  for (const item of todo) {
    if (item.key.endsWith("/")) {
      await io.mkdirNew(item.key, item.entity.mtimeCli);
    } else {
      const local = await io.readLocal(item.key);
      if (local !== undefined) {
        await io.writeNew(item.key, local.content, local.mtime, local.ctime);
        fromLocal += 1;
      } else {
        const content = await oldCodec.decryptContent(
          await io.readRaw(item.raw)
        );
        const mtime =
          item.entity.mtimeCli ?? item.entity.mtimeSvr ?? Date.now();
        await io.writeNew(item.key, content, mtime, mtime);
        fromRemote += 1;
      }
    }
    done += 1;
    io.onProgress?.(done, todo.length, item.key);
  }

  // verify: every old object now exists in the new format
  const after = await classifyRemoteEntries(
    await io.listRaw(),
    oldCodec,
    newCodec,
    io.readRaw
  );
  const migratedKeys = new Set(after.migrated.map((e) => e.key));
  const missing = todo.filter((e) => !migratedKeys.has(e.key));
  if (missing.length > 0) {
    throw Error(
      `re-encryption stopped before deleting anything: ${missing.length} object(s) are missing in the new format, e.g. ${missing[0].key}. Run it again to resume.`
    );
  }

  // delete old objects: files first, then folders from deep to shallow
  const toDelete = [...after.toMigrate].sort((a, b) => {
    const fa = a.raw.endsWith("/") ? 1 : 0;
    const fb = b.raw.endsWith("/") ? 1 : 0;
    return fa !== fb ? fa - fb : depth(b.raw) - depth(a.raw);
  });
  for (const item of toDelete) {
    await io.deleteRaw(item.raw);
  }

  return {
    migratedCount: todo.length,
    fromLocal,
    fromRemote,
    deletedCount: toDelete.length,
    ambiguousFolders: before.ambiguousFolders,
  };
};
