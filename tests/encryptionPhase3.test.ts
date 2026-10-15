import { strict as assert } from "assert";
import type { Entity } from "../src/baseTypes";
import {
  decideEncryptionSalt,
  newEncryptionSalt,
  parseEncryptionParams,
  serializeEncryptionParams,
} from "../src/encryptionParams";
import {
  EXPORT_PBKDF2_ITERATIONS,
  decryptExportPayload,
  encryptExportPayload,
} from "../src/exportCrypto";
import {
  type Codec,
  type RebuildIO,
  rebuildRemoteEncryption,
} from "../src/reencrypt";

describe("Encryption params", () => {
  it("should round-trip and validate the params file", () => {
    const salt = newEncryptionSalt();
    assert.match(salt, /^[A-Za-z0-9_-]{32}$/);
    const text = serializeEncryptionParams({
      version: 1,
      method: "rclone-base64",
      salt,
    });
    assert.deepEqual(parseEncryptionParams(text), {
      version: 1,
      method: "rclone-base64",
      salt,
    });
    for (const bad of [
      "not json",
      "{}",
      JSON.stringify({ version: 2, method: "rclone-base64", salt }),
      JSON.stringify({ version: 1, method: "openssl-base64", salt }),
      JSON.stringify({ version: 1, method: "rclone-base64", salt: "short" }),
      JSON.stringify({
        version: 1,
        method: "rclone-base64",
        salt: "bad salt!".repeat(3),
      }),
    ]) {
      assert.equal(parseEncryptionParams(bad), undefined, bad);
    }
  });

  const base = {
    password: "pw",
    method: "rclone-base64" as const,
    localSalt: "",
    remoteParams: undefined,
    remoteIsEmpty: false,
    newSalt: () => "N".repeat(32),
  };
  const params = (salt: string) =>
    ({ version: 1, method: "rclone-base64", salt }) as const;

  it("should keep legacy vaults on the built-in salt", () => {
    assert.deepEqual(decideEncryptionSalt(base), { action: "use", salt: "" });
  });

  it("should create a salt for an empty encrypted remote", () => {
    assert.deepEqual(decideEncryptionSalt({ ...base, remoteIsEmpty: true }), {
      action: "create",
      salt: "N".repeat(32),
    });
    assert.deepEqual(
      decideEncryptionSalt({
        ...base,
        remoteIsEmpty: true,
        localSalt: "L".repeat(32),
      }),
      { action: "create", salt: "L".repeat(32) }
    );
  });

  it("should not create a salt without rclone encryption", () => {
    for (const x of [
      { ...base, password: "", remoteIsEmpty: true },
      { ...base, method: "openssl-base64" as const, remoteIsEmpty: true },
    ]) {
      assert.deepEqual(decideEncryptionSalt(x), { action: "use", salt: "" });
    }
  });

  it("should follow the remote params", () => {
    const remoteParams = params("R".repeat(32));
    assert.deepEqual(
      decideEncryptionSalt({
        ...base,
        remoteParams,
        localSalt: "R".repeat(32),
      }),
      { action: "use", salt: "R".repeat(32) }
    );
    assert.deepEqual(decideEncryptionSalt({ ...base, remoteParams }), {
      action: "adopt",
      salt: "R".repeat(32),
      method: "rclone-base64",
    });
    assert.deepEqual(
      decideEncryptionSalt({
        ...base,
        method: "openssl-base64",
        localSalt: "R".repeat(32),
        remoteParams,
      }),
      { action: "adopt", salt: "R".repeat(32), method: "rclone-base64" }
    );
  });

  it("should refuse to sync plain files into an encrypted remote", () => {
    assert.deepEqual(
      decideEncryptionSalt({
        ...base,
        password: "",
        remoteParams: params("R".repeat(32)),
      }),
      { action: "error", reason: "remote_encrypted_local_no_password" }
    );
  });
});

describe("Encrypted settings export", () => {
  it("should use OWASP-level PBKDF2 iterations", () => {
    assert.ok(EXPORT_PBKDF2_ITERATIONS >= 600_000);
  });

  it("should round-trip with the right passphrase only", async function () {
    this.timeout(20_000);
    const plain = JSON.stringify({ s3: { s3SecretAccessKey: "secret" } });
    const enc = await encryptExportPayload(plain, "correct horse");
    assert.ok(!enc.includes("secret"));
    assert.equal(await decryptExportPayload(enc, "correct horse"), plain);
    await assert.rejects(() => decryptExportPayload(enc, "wrong horse"));
    // tampering is detected
    const tampered = `${enc.slice(0, -2)}${enc.endsWith("A") ? "B" : "A"}A`;
    await assert.rejects(() => decryptExportPayload(tampered, "correct horse"));
  });

  it("should use a fresh salt and iv every time", async function () {
    this.timeout(20_000);
    const a = await encryptExportPayload("x", "passphrase");
    const b = await encryptExportPayload("x", "passphrase");
    assert.notEqual(a, b);
  });

  it("should reject short passphrases", async () => {
    await assert.rejects(() => encryptExportPayload("x", "short"));
  });
});

// "old:key" / "new:key" names; content prefixed with the codec tag
const makeCodec = (
  tag: string,
  alsoAccepts?: (raw: string) => string | undefined
): Codec => ({
  decryptName: async (raw) => {
    if (raw.startsWith(`${tag}:`)) return raw.slice(tag.length + 1);
    const other = alsoAccepts?.(raw);
    if (other !== undefined) return other;
    throw Error("bad name");
  },
  decryptContent: async (c) => {
    const text = new TextDecoder().decode(c);
    if (!text.startsWith(`${tag}|`)) throw Error("bad mac");
    return new TextEncoder().encode(text.slice(tag.length + 1))
      .buffer as ArrayBuffer;
  },
});
const encode = (tag: string, text: string) =>
  new TextEncoder().encode(`${tag}|${text}`).buffer as ArrayBuffer;

class MemoryRemote {
  objects = new Map<string, ArrayBuffer>();
  deleted: string[] = [];
  published = false;
  failWritesAfter = Number.POSITIVE_INFINITY;
  writes = 0;
  io(local: Map<string, string>): RebuildIO {
    return {
      listRaw: async () =>
        [...this.objects.keys()].map(
          (k) => ({ keyRaw: k, sizeRaw: 0, mtimeCli: 1 }) as Entity
        ),
      readRaw: async (raw) => this.objects.get(raw)!,
      deleteRaw: async (raw) => {
        this.objects.delete(raw);
        this.deleted.push(raw);
      },
      readLocal: async (key) =>
        local.has(key)
          ? {
              content: new TextEncoder().encode(local.get(key)!)
                .buffer as ArrayBuffer,
              mtime: 5,
              ctime: 5,
            }
          : undefined,
      writeNew: async (key, content) => {
        if (this.writes >= this.failWritesAfter) throw Error("network down");
        this.writes += 1;
        this.objects.set(
          `new:${key}`,
          encode("new", new TextDecoder().decode(content))
        );
      },
      mkdirNew: async (key) => {
        this.objects.set(`new:${key}`, new ArrayBuffer(0));
      },
      publishParams: async () => {
        this.published = true;
      },
    };
  }
}

describe("Re-encrypt remote", () => {
  const oldCodec = makeCodec("old");
  const newCodec = makeCodec("new");

  it("should rewrite everything, preferring local copies, then delete old objects", async () => {
    const remote = new MemoryRemote();
    remote.objects.set("old:folder/", new ArrayBuffer(0));
    remote.objects.set("old:folder/a.md", encode("old", "remote a"));
    remote.objects.set("old:remote-only.md", encode("old", "only in bucket"));
    remote.objects.set("_cloud-sync-encryption.json", new ArrayBuffer(0));
    const local = new Map([["folder/a.md", "local a"]]);

    const res = await rebuildRemoteEncryption(
      remote.io(local),
      oldCodec,
      newCodec
    );

    assert.equal(res.migratedCount, 3);
    assert.equal(res.fromLocal, 1);
    assert.equal(res.fromRemote, 1);
    assert.equal(res.deletedCount, 3);
    assert.ok(remote.published);
    assert.deepEqual([...remote.objects.keys()].sort(), [
      "_cloud-sync-encryption.json",
      "new:folder/",
      "new:folder/a.md",
      "new:remote-only.md",
    ]);
    const text = (raw: string) =>
      new TextDecoder().decode(remote.objects.get(raw)!);
    assert.equal(text("new:folder/a.md"), "new|local a");
    assert.equal(text("new:remote-only.md"), "new|only in bucket");
    // files are deleted before their folders
    assert.ok(
      remote.deleted.indexOf("old:folder/a.md") <
        remote.deleted.indexOf("old:folder/")
    );
  });

  it("should change nothing if some object is not decryptable", async () => {
    const remote = new MemoryRemote();
    remote.objects.set("old:a.md", encode("old", "a"));
    remote.objects.set("garbage", new ArrayBuffer(0));
    await assert.rejects(
      () => rebuildRemoteEncryption(remote.io(new Map()), oldCodec, newCodec),
      /before changing anything/
    );
    assert.deepEqual([...remote.objects.keys()].sort(), [
      "garbage",
      "old:a.md",
    ]);
    assert.equal(remote.published, false);
  });

  it("should not delete anything when interrupted, and resume later", async () => {
    const remote = new MemoryRemote();
    for (const k of ["a.md", "b.md", "c.md"]) {
      remote.objects.set(`old:${k}`, encode("old", k));
    }
    remote.failWritesAfter = 1;
    await assert.rejects(
      () => rebuildRemoteEncryption(remote.io(new Map()), oldCodec, newCodec),
      /network down/
    );
    assert.equal(remote.deleted.length, 0);
    // published before copying, so other devices stop writing the old format
    assert.equal(remote.published, true);
    assert.ok(remote.objects.has("old:a.md"));

    remote.failWritesAfter = Number.POSITIVE_INFINITY;
    const res = await rebuildRemoteEncryption(
      remote.io(new Map()),
      oldCodec,
      newCodec
    );
    // old objects are copied again on resume (idempotent)
    assert.equal(res.migratedCount, 3);
    assert.deepEqual([...remote.objects.keys()].sort(), [
      "new:a.md",
      "new:b.md",
      "new:c.md",
    ]);
  });

  it("should use authenticated content when a name decrypts with both keys", async () => {
    // the old codec also "decrypts" this new-format name to garbage
    const loose = makeCodec("old", (raw) =>
      raw === "new:x.md" ? "garbage" : undefined
    );
    const remote = new MemoryRemote();
    remote.objects.set("new:x.md", encode("new", "already migrated"));
    remote.objects.set("old:y.md", encode("old", "y"));
    const res = await rebuildRemoteEncryption(
      remote.io(new Map()),
      loose,
      newCodec
    );
    assert.equal(res.migratedCount, 1);
    assert.ok(remote.objects.has("new:x.md"));
    assert.ok(!remote.deleted.includes("new:x.md"));
  });

  it("should delete, not carry over, dropped keys", async () => {
    const remote = new MemoryRemote();
    const dataFile = ".obsidian/plugins/cloud-sync/data.json";
    remote.objects.set(`old:${dataFile}`, encode("old", "{old secrets}"));
    remote.objects.set("old:a.md", encode("old", "a"));
    const local = new Map([[dataFile, "{live secrets}"]]);
    await rebuildRemoteEncryption(
      remote.io(local),
      oldCodec,
      newCodec,
      new Set([dataFile])
    );
    assert.deepEqual([...remote.objects.keys()], ["new:a.md"]);
  });
});
