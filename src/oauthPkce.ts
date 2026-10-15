import { base64url } from "rfc4648";

/**
 * OAuth 2.0 PKCE (RFC 7636) with the browser's WebCrypto,
 * so no Node crypto polyfill is needed in the bundle.
 */

/**
 * code_challenge = BASE64URL(SHA256(ASCII(code_verifier))), method S256
 */
export const pkceChallengeS256 = async (verifier: string) => {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(verifier)
  );
  return base64url.stringify(new Uint8Array(digest), { pad: false });
};

/**
 * A 43-character verifier from 32 random bytes (the RFC's recommendation).
 */
export const generatePkceCodes = async () => {
  const verifier = base64url.stringify(
    crypto.getRandomValues(new Uint8Array(32)),
    { pad: false }
  );
  return { verifier, challenge: await pkceChallengeS256(verifier) };
};
