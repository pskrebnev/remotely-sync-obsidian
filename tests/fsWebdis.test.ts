import { strict as assert } from "assert";
import { escapeRedisGlob, getOrigPath } from "../src/fsWebdis";

describe("Webdis operations tests", () => {
  it("should get orig keys correctly", () => {
    const input = "rs:fs:v1:库名字/something dev.md:meta";
    const output = getOrigPath(input, "库名字");
    const expected = "something dev.md";

    assert.equal(output, expected);
  });
});

describe("Webdis: SCAN pattern escaping", () => {
  it("should make glob characters in the vault folder literal", () => {
    assert.equal(escapeRedisGlob("my vault"), "my vault");
    assert.equal(escapeRedisGlob("a*b?c[d]e\\f"), "a\\*b\\?c\\[d\\]e\\\\f");
  });
});
