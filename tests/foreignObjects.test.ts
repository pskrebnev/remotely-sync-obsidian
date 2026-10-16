import { strict as assert } from "assert";
import {
  isCertainlyForeignName,
  partitionForeign,
} from "../src/foreignObjects";

describe("Foreign remote objects", () => {
  it("should recognize names rclone encryption can't produce", () => {
    for (const name of [
      "report.pdf",
      "My Notes/plan.md",
      "Zm9v/bar baz",
      "über",
      "a/b.c/d",
    ]) {
      assert.ok(isCertainlyForeignName(name, "rclone-base64"), name);
    }
  });

  it("should not treat encrypted-looking rclone names as foreign", () => {
    for (const name of [
      "Zm9vYmFy",
      "Zm9v/YmFy_-Q",
      "Zm9vYmFy/",
      "README", // could be an encrypted name: must still stop the sync
      "notes/", // the same for folders
      "",
    ]) {
      assert.ok(!isCertainlyForeignName(name, "rclone-base64"), name);
    }
  });

  it("should handle openssl names", () => {
    assert.ok(!isCertainlyForeignName("U2FsdGVkX1-abc_DEF", "openssl-base64"));
    assert.ok(!isCertainlyForeignName("KNQWY5DFMRPVABC234", "openssl-base64"));
    assert.ok(isCertainlyForeignName("report.pdf", "openssl-base64"));
    assert.ok(isCertainlyForeignName("U2FsdGVkX1.pdf", "openssl-base64"));
    assert.ok(isCertainlyForeignName("Zm9vYmFy", "openssl-base64"));
  });

  it("should never classify anything without a supported method", () => {
    assert.ok(!isCertainlyForeignName("report.pdf", "unknown"));
  });

  it("should partition a listing", () => {
    const { ours, foreign } = partitionForeign(
      [{ keyRaw: "report.pdf" }, { keyRaw: "Zm9vYmFy" }, { keyRaw: "a b" }],
      "rclone-base64"
    );
    assert.deepEqual(
      ours.map((e) => e.keyRaw),
      ["Zm9vYmFy"]
    );
    assert.deepEqual(
      foreign.map((e) => e.keyRaw),
      ["report.pdf", "a b"]
    );
  });
});
