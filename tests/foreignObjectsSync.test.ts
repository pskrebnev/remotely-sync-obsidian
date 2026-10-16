import { strict as assert } from "assert";
import type { S3Config } from "../src/baseTypes";
import { FakeFsEncrypt } from "../src/fsEncrypt";
import { DEFAULT_S3_CONFIG, FakeFsS3 } from "../src/fsS3";
import { startFakeS3 } from "./support/fakeS3Server";

// The real encryption layer (openssl method: no web worker needed) over the
// real S3 client and the in-memory S3 server. A foreign object, uploaded
// directly to the bucket, is listed before the plugin's own objects.
const BUCKET = "temp-obsidian";
const configFor = (endpoint: string) =>
  ({
    ...DEFAULT_S3_CONFIG,
    s3Endpoint: endpoint,
    s3Region: "auto",
    s3AccessKeyID: "key-id",
    s3SecretAccessKey: "secret",
    s3BucketName: BUCKET,
    forcePathStyle: true,
  }) as S3Config;
const bytes = (text: string) =>
  new TextEncoder().encode(text).buffer as ArrayBuffer;

describe("Foreign objects in an encrypted remote (end to end)", function () {
  this.timeout(30000);
  let s3: Awaited<ReturnType<typeof startFakeS3>>;
  let savedWindow: unknown;

  before(() => {
    // encryptOpenSSL uses window.crypto
    savedWindow = (globalThis as any).window;
    (globalThis as any).window = { crypto: globalThis.crypto };
  });
  after(() => {
    (globalThis as any).window = savedWindow;
  });

  beforeEach(async () => {
    s3 = await startFakeS3(BUCKET);
    const remote = new FakeFsS3(configFor(s3.endpoint));
    // uploaded in the dashboard, so listed first
    await remote.writeFile("report.pdf", bytes("%PDF"), Date.now(), Date.now());
    const enc = new FakeFsEncrypt(remote, "right password", "openssl-base64");
    await enc.walk();
    await enc.writeFile("note.md", bytes("# hello"), Date.now(), Date.now());
  });
  afterEach(async () => {
    await s3.close();
  });

  const fsWith = (password: string) =>
    new FakeFsEncrypt(
      new FakeFsS3(configFor(s3.endpoint)),
      password,
      "openssl-base64"
    );

  it("should accept the right password although a foreign object is listed first", async () => {
    assert.equal([...s3.objects.keys()][0], "report.pdf");
    const res = await fsWith("right password").isPasswordOk();
    assert.deepEqual(res, { ok: true, reason: "password_matched" });
  });

  it("should sync the plugin's objects and skip the foreign one", async () => {
    const fs = fsWith("right password");
    const entities = await fs.walk();
    assert.deepEqual(
      entities.map((e) => e.key),
      ["note.md"]
    );
    assert.deepEqual(fs.skippedForeignKeys, ["report.pdf"]);
    // the foreign object is left untouched
    assert.ok(s3.objects.has("report.pdf"));
  });

  it("should still detect a wrong password", async () => {
    const res = await fsWith("wrong password").isPasswordOk();
    assert.equal(res.ok, false);
  });

  it("should stop with a clear message on an encrypted-looking name it can't decrypt", async () => {
    // looks like an openssl name, but isn't one: could mean a wrong password
    // or another device re-encrypting, so it must not be skipped
    const remote = new FakeFsS3(configFor(s3.endpoint));
    await remote.writeFile("U2FsdGVkX1abc", bytes("x"), Date.now(), Date.now());
    await assert.rejects(
      () => fsWith("right password").walk(),
      /Cannot decrypt the name of the remote object "U2FsdGVkX1abc"/
    );
  });
});
