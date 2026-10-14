import { base64url } from "rfc4648";

/**
 * Settings exported as a QR code or link contain credentials.
 * They are encrypted with a passphrase the user types on both devices,
 * so a leaked screenshot or chat message is useless on its own.
 *
 * Format (base64url): version(1) | salt(16) | iv(12) | AES-256-GCM ciphertext
 * Key: PBKDF2-SHA256, 600 000 iterations (OWASP 2023).
 */

const VERSION = 1;
const SALT_LEN = 16;
const IV_LEN = 12;
export const EXPORT_PBKDF2_ITERATIONS = 600_000;
export const MIN_EXPORT_PASSPHRASE_LENGTH = 8;

const deriveKey = async (passphrase: string, salt: Uint8Array<ArrayBuffer>) => {
  const material = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(passphrase),
    { name: "PBKDF2" },
    false,
    ["deriveKey"]
  );
  return await crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt,
      iterations: EXPORT_PBKDF2_ITERATIONS,
      hash: "SHA-256",
    },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
};

export const encryptExportPayload = async (
  plain: string,
  passphrase: string
): Promise<string> => {
  if (passphrase.length < MIN_EXPORT_PASSPHRASE_LENGTH) {
    throw Error(
      `passphrase must have at least ${MIN_EXPORT_PASSPHRASE_LENGTH} characters`
    );
  }
  const salt = crypto.getRandomValues(new Uint8Array(SALT_LEN));
  const iv = crypto.getRandomValues(new Uint8Array(IV_LEN));
  const key = await deriveKey(passphrase, salt);
  const ct = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      key,
      new TextEncoder().encode(plain)
    )
  );
  const out = new Uint8Array(1 + SALT_LEN + IV_LEN + ct.length);
  out[0] = VERSION;
  out.set(salt, 1);
  out.set(iv, 1 + SALT_LEN);
  out.set(ct, 1 + SALT_LEN + IV_LEN);
  return base64url.stringify(out, { pad: false });
};

/**
 * Throws if the passphrase is wrong or the data was changed.
 */
export const decryptExportPayload = async (
  data: string,
  passphrase: string
): Promise<string> => {
  const buf = base64url.parse(data, { loose: true });
  if (buf.length < 1 + SALT_LEN + IV_LEN + 16 || buf[0] !== VERSION) {
    throw Error("not an encrypted settings export");
  }
  const salt = new Uint8Array(buf.slice(1, 1 + SALT_LEN));
  const iv = new Uint8Array(buf.slice(1 + SALT_LEN, 1 + SALT_LEN + IV_LEN));
  const ct = new Uint8Array(buf.slice(1 + SALT_LEN + IV_LEN));
  const key = await deriveKey(passphrase, salt);
  let plain: ArrayBuffer;
  try {
    plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ct);
  } catch {
    throw Error("wrong passphrase, or the link was changed");
  }
  return new TextDecoder().decode(plain);
};
