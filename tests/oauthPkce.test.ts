import { strict as assert } from "assert";
import { generatePkceCodes, pkceChallengeS256 } from "../src/oauthPkce";

describe("OAuth PKCE", () => {
  it("should match the RFC 7636 example (appendix B)", async () => {
    assert.equal(
      await pkceChallengeS256("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"),
      "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"
    );
  });

  it("should generate a valid, random verifier and its challenge", async () => {
    const a = await generatePkceCodes();
    const b = await generatePkceCodes();
    // 43-128 characters from the unreserved set
    assert.match(a.verifier, /^[A-Za-z0-9\-._~]{43,128}$/);
    assert.equal(a.challenge, await pkceChallengeS256(a.verifier));
    assert.notEqual(a.verifier, b.verifier);
  });
});
