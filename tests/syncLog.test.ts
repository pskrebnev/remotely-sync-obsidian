import { strict as assert } from "assert";
import {
  appendLogLines,
  formatSyncLogEntry,
  sanitizeLogText,
} from "../src/syncLog";

describe("Sync log", () => {
  it("should remove query strings and secret-looking values", () => {
    const text = sanitizeLogText(
      'GET https://acc.r2.cloudflarestorage.com/b/k?X-Amz-Signature=abc123&X-Amz-Credential=AKIAABCDEFGHIJKLMNOP failed; password=hunter2 token: "t0k" Authorization=Bearer-xyz code=4/0Ab key AKIAABCDEFGHIJKLMNOP'
    );
    assert.ok(
      text.includes("https://acc.r2.cloudflarestorage.com/b/k?<query removed>"),
      text
    );
    for (const secret of [
      "abc123",
      "hunter2",
      "t0k",
      "Bearer-xyz",
      "4/0Ab",
      "AKIAABCDEFGHIJKLMNOP",
    ]) {
      assert.ok(!text.includes(secret), `${secret} in: ${text}`);
    }
    assert.ok(text.includes("password=<redacted>"));
  });

  it("should keep ordinary messages readable", () => {
    const msg =
      'Request failed, status 403. Cannot decrypt the name of the remote object "Zm9v".';
    assert.equal(sanitizeLogText(msg), msg);
  });

  it("should format an entry with indented details", () => {
    const lines = formatSyncLogEntry({
      time: new Date(2026, 9, 16, 14, 3, 7),
      event: "manual sync (s3)",
      outcome: "failed",
      details: ["first line\nsecond line", "password=secret"],
    });
    assert.deepEqual(lines, [
      "2026-10-16 14:03:07 [FAILED] manual sync (s3)",
      "    first line",
      "    second line",
      "    password=<redacted>",
    ]);
  });

  it("should keep only the newest lines", () => {
    let log = "";
    for (let i = 1; i <= 5; i++) {
      log = appendLogLines(log, [`line ${i}`], 3);
    }
    assert.equal(log, "line 3\nline 4\nline 5\n");
  });
});
