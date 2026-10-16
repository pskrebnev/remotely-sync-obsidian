import type { CipherMethodType } from "./baseTypes";
import {
  MAGIC_ENCRYPTED_PREFIX_BASE32,
  MAGIC_ENCRYPTED_PREFIX_BASE64URL,
} from "./encryptOpenSSL";

/**
 * With encryption on, every remote object should have a name this plugin
 * encrypted. Objects added another way (e.g. uploaded in the storage
 * provider's dashboard) are "foreign".
 *
 * Only names that can NOT be produced by the encryption are classified as
 * foreign, so they can be skipped safely. A name that looks encrypted but
 * does not decrypt may mean a wrong password, a re-encryption in progress on
 * another device, or damage: skipping it could make the sync engine think
 * the file was deleted remotely, so such names still stop the sync.
 */

// rclone "base64" names: unpadded base64url, per path segment
const BASE64URL = /^[A-Za-z0-9_-]+$/;
// openssl names: one encrypted token for the whole path
const BASE32 = /^[A-Z2-7]+$/;

export const isCertainlyForeignName = (
  raw: string,
  method: CipherMethodType
): boolean => {
  const name = raw.endsWith("/") ? raw.slice(0, -1) : raw;
  if (name === "") {
    return false;
  }
  if (method === "rclone-base64") {
    return name.split("/").some((seg) => !BASE64URL.test(seg));
  }
  if (method === "openssl-base64") {
    if (name.startsWith(MAGIC_ENCRYPTED_PREFIX_BASE64URL)) {
      return !BASE64URL.test(name);
    }
    if (name.startsWith(MAGIC_ENCRYPTED_PREFIX_BASE32)) {
      return !BASE32.test(name);
    }
    return true;
  }
  return false;
};

export const partitionForeign = <T extends { keyRaw: string }>(
  entities: T[],
  method: CipherMethodType
) => {
  const ours: T[] = [];
  const foreign: T[] = [];
  for (const e of entities) {
    (isCertainlyForeignName(e.keyRaw, method) ? foreign : ours).push(e);
  }
  return { ours, foreign };
};
