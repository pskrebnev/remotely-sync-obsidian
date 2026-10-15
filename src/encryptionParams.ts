import { base64url } from "rfc4648";
import type { CipherMethodType } from "./baseTypes";
import type { FakeFs } from "./fsAll";

/**
 * A small plain-text file in the remote root that describes how the vault
 * is encrypted, so every device derives the same key.
 * The salt is not secret: without the password it is useless.
 * It is rclone's "password2", so the bucket stays readable by rclone.
 */
export const ENCRYPTION_PARAMS_FILE = "_cloud-sync-encryption.json";

export interface EncryptionParams {
  version: 1;
  method: "rclone-base64";
  salt: string;
}

const SALT_REGEX = /^[A-Za-z0-9_-]{16,128}$/;

export const newEncryptionSalt = () =>
  base64url.stringify(crypto.getRandomValues(new Uint8Array(24)), {
    pad: false,
  });

export const parseEncryptionParams = (
  text: string
): EncryptionParams | undefined => {
  let x: any;
  try {
    x = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (
    x === null ||
    typeof x !== "object" ||
    x.version !== 1 ||
    x.method !== "rclone-base64" ||
    typeof x.salt !== "string" ||
    !SALT_REGEX.test(x.salt)
  ) {
    return undefined;
  }
  return { version: 1, method: "rclone-base64", salt: x.salt };
};

export const serializeEncryptionParams = (p: EncryptionParams) =>
  JSON.stringify(
    {
      version: p.version,
      method: p.method,
      salt: p.salt,
      note: "Encryption parameters for Cloud Sync (not secret). The salt is rclone's password2.",
    },
    null,
    2
  );

export const readRemoteEncryptionParams = async (
  fsRemote: FakeFs
): Promise<EncryptionParams | undefined> => {
  try {
    await fsRemote.stat(ENCRYPTION_PARAMS_FILE);
  } catch {
    return undefined;
  }
  const content = await fsRemote.readFile(ENCRYPTION_PARAMS_FILE);
  const params = parseEncryptionParams(new TextDecoder().decode(content));
  if (params === undefined) {
    throw Error(`invalid ${ENCRYPTION_PARAMS_FILE} in remote`);
  }
  return params;
};

export const writeRemoteEncryptionParams = async (
  fsRemote: FakeFs,
  params: EncryptionParams
) => {
  const now = Date.now();
  const content = new TextEncoder().encode(serializeEncryptionParams(params));
  await fsRemote.writeFile(
    ENCRYPTION_PARAMS_FILE,
    content.buffer as ArrayBuffer,
    now,
    now
  );
};

export type SaltDecision =
  // keep local settings as they are
  | { action: "use"; salt: string }
  // another device set (or changed) the encryption: follow it
  | { action: "adopt"; salt: string; method: "rclone-base64" }
  // empty encrypted remote: publish the salt before the first upload
  | { action: "create"; salt: string }
  | { action: "error"; reason: "remote_encrypted_local_no_password" };

/**
 * Decides which salt a sync uses. Pure, so it can be tested.
 */
export const decideEncryptionSalt = (x: {
  password: string;
  method: CipherMethodType;
  localSalt: string;
  remoteParams: EncryptionParams | undefined;
  remoteIsEmpty: boolean;
  newSalt: () => string;
}): SaltDecision => {
  if (x.remoteParams !== undefined) {
    if (x.password === "") {
      return { action: "error", reason: "remote_encrypted_local_no_password" };
    }
    if (
      x.remoteParams.salt === x.localSalt &&
      x.method === x.remoteParams.method
    ) {
      return { action: "use", salt: x.localSalt };
    }
    return {
      action: "adopt",
      salt: x.remoteParams.salt,
      method: x.remoteParams.method,
    };
  }
  if (x.password === "" || x.method !== "rclone-base64") {
    return { action: "use", salt: "" };
  }
  if (x.remoteIsEmpty) {
    return {
      action: "create",
      salt: x.localSalt !== "" ? x.localSalt : x.newSalt(),
    };
  }
  // existing remote without params: a vault from before per-vault salts
  return { action: "use", salt: x.localSalt };
};
