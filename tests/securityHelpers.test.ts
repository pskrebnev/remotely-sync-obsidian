import { strict as assert } from "assert";
import {
  assertSafeVaultPath,
  isInsecureRemoteUrl,
  redactSecrets,
  stringToFragment,
} from "../src/misc";

describe("Security helpers: assertSafeVaultPath", () => {
  it("should accept normal vault paths", () => {
    for (const p of [
      "a.md",
      "folder/",
      "folder/sub/note.md",
      ".obsidian/bookmarks.json",
      "_underscore/x.md",
      "dots..in..name.md",
      "..hidden-ish.md",
      "back\\slash.md",
    ]) {
      assert.doesNotThrow(() => assertSafeVaultPath(p), p);
    }
  });

  it("should reject paths escaping the vault", () => {
    for (const p of [
      "",
      "../x.md",
      "a/../../x.md",
      "a/..",
      "..\\x.md",
      "a\\..\\..\\x.md",
      "/etc/passwd",
      "\\\\server\\share",
      "C:\\Users\\x",
      "c:/x",
      "a\u0000b.md",
      "a\nb.md",
    ]) {
      assert.throws(() => assertSafeVaultPath(p), Error, p);
    }
  });
});

describe("Security helpers: isInsecureRemoteUrl", () => {
  it("should flag plain http to public hosts", () => {
    assert.ok(isInsecureRemoteUrl("http://s3.amazonaws.com"));
    assert.ok(
      isInsecureRemoteUrl("http://abc123.r2.cloudflarestorage.com/bucket")
    );
    assert.ok(isInsecureRemoteUrl("http://8.8.8.8:9000"));
    assert.ok(isInsecureRemoteUrl("http://172.32.0.1"));
  });

  it("should allow https and local / private http", () => {
    assert.ok(!isInsecureRemoteUrl("https://s3.us-east-1.amazonaws.com"));
    assert.ok(!isInsecureRemoteUrl("https://abc.r2.cloudflarestorage.com"));
    assert.ok(!isInsecureRemoteUrl("http://localhost:9000"));
    assert.ok(!isInsecureRemoteUrl("http://127.0.0.1:9000"));
    assert.ok(!isInsecureRemoteUrl("http://[::1]:9000"));
    assert.ok(!isInsecureRemoteUrl("http://10.1.2.3"));
    assert.ok(!isInsecureRemoteUrl("http://172.16.0.5"));
    assert.ok(!isInsecureRemoteUrl("http://192.168.1.10:9000"));
    assert.ok(!isInsecureRemoteUrl("http://nas.local"));
    assert.ok(!isInsecureRemoteUrl("not a url"));
  });
});

describe("Security helpers: redactSecrets", () => {
  it("should mask secret-looking fields deeply without mutating input", () => {
    const input = {
      s3: {
        s3Endpoint: "https://x.r2.cloudflarestorage.com",
        s3AccessKeyID: "AKIA123",
        s3SecretAccessKey: "topsecret",
      },
      dropbox: { refreshToken: "rt", accessToken: "", clientID: "cid" },
      password: "pw",
      code: "authcode",
      list: [{ apiKey: "k" }],
    };
    const out = redactSecrets(input);
    assert.equal(out.s3.s3Endpoint, "https://x.r2.cloudflarestorage.com");
    assert.equal(out.s3.s3AccessKeyID, "<redacted>");
    assert.equal(out.s3.s3SecretAccessKey, "<redacted>");
    assert.equal(out.dropbox.refreshToken, "<redacted>");
    assert.equal(out.dropbox.accessToken, "");
    assert.equal(out.dropbox.clientID, "cid");
    assert.equal(out.password, "<redacted>");
    assert.equal(out.code, "<redacted>");
    assert.equal(out.list[0].apiKey, "<redacted>");
    assert.equal(input.s3.s3SecretAccessKey, "topsecret");
  });
});

describe("Security helpers: stringToFragment", () => {
  const { JSDOM } = require("jsdom");
  const doc: Document = new JSDOM("").window.document;
  const render = (html: string) => {
    const div = doc.createElement("div");
    div.appendChild(stringToFragment(html, doc));
    return div.innerHTML;
  };

  it("should keep the markup used by translations", () => {
    assert.equal(
      render(
        'Read <a href="https://example.com/x">this</a> and <a href="#settings-pro">that</a>, <strong>now</strong>:<br><ul><li><code>a</code></li></ul>'
      ),
      'Read <a href="https://example.com/x">this</a> and <a href="#settings-pro">that</a>, <strong>now</strong>:<br><ul><li><code>a</code></li></ul>'
    );
  });

  it("should drop scripts, handlers and dangerous links", () => {
    const out = render(
      '<img src=x onerror="alert(1)"><script>alert(2)</script><a href="javascript:alert(3)" onclick="x()">link</a><p style="x" onmouseover="y()">p</p><iframe src="https://evil"></iframe><!-- c -->'
    );
    assert.ok(
      !/<img|<script|<iframe|onerror|onclick|onmouseover|javascript:|style=/i.test(
        out
      ),
      out
    );
    assert.ok(out.includes("<a>link</a>"), out);
    assert.ok(out.includes("<p>p</p>"), out);
  });

  it("should keep the text of unknown tags", () => {
    assert.equal(render("<stong>bold</stong> <span>x</span>"), "bold x");
  });
});
