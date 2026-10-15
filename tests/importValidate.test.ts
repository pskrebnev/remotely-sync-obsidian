import { strict as assert } from "assert";
import type { CloudSyncPluginSettings } from "../src/baseTypes";
import {
  applyImportedSettings,
  sanitizeImportedSettings,
} from "../src/importValidate";

const makeDefaults = () =>
  ({
    s3: {
      s3Endpoint: "",
      s3Region: "",
      s3AccessKeyID: "",
      s3SecretAccessKey: "",
      s3BucketName: "",
      partsConcurrency: 20,
      forcePathStyle: false,
      remotePrefix: "",
    },
    webdav: { address: "", username: "", password: "" },
    dropbox: { accessToken: "", refreshToken: "", clientID: "" },
    profiler: { enable: false },
    pro: { email: "" },
    password: "",
    serviceType: "s3",
    concurrency: 5,
    lang: "auto",
    syncConfigDir: false,
    ignorePaths: [],
  }) as unknown as CloudSyncPluginSettings;

const makeCurrent = () => {
  const c = makeDefaults() as any;
  c.s3.s3Endpoint = "https://mine.r2.cloudflarestorage.com";
  c.s3.s3BucketName = "my-vault";
  c.s3.s3SecretAccessKey = "my-secret";
  c.dropbox.refreshToken = "keep-me";
  return c as CloudSyncPluginSettings;
};

describe("Import settings: sanitizeImportedSettings", () => {
  it("should list changes and flag risky ones", () => {
    const raw = {
      s3: {
        s3Endpoint: "https://attacker.r2.cloudflarestorage.com",
        s3SecretAccessKey: "attacker-secret",
        partsConcurrency: 10,
      },
      concurrency: 3,
    };
    const res = sanitizeImportedSettings(raw, makeDefaults(), makeCurrent());
    assert.equal(res.status, "ok");
    if (res.status !== "ok") return;
    const byPath = Object.fromEntries(res.changes.map((c) => [c.path, c]));
    assert.ok(byPath["s3.s3Endpoint"].risky);
    assert.ok(byPath["s3.s3SecretAccessKey"].risky);
    assert.equal(byPath["s3.s3SecretAccessKey"].after, "••••••");
    assert.equal(byPath["s3.s3SecretAccessKey"].before, "••••••");
    assert.ok(!byPath["s3.partsConcurrency"].risky);
    assert.ok(!byPath.concurrency.risky);
  });

  it("should flag plain http endpoints as risky", () => {
    const res = sanitizeImportedSettings(
      { lang: "http://evil.example", concurrency: 4 },
      makeDefaults(),
      makeCurrent()
    );
    assert.equal(res.status, "ok");
    if (res.status !== "ok") return;
    const byPath = Object.fromEntries(res.changes.map((c) => [c.path, c]));
    assert.ok(byPath.lang.risky);
    assert.ok(!byPath.concurrency.risky);
  });

  it("should reject prototype pollution keys", () => {
    for (const raw of [
      JSON.parse('{"__proto__": {"polluted": true}}'),
      JSON.parse('{"s3": {"constructor": {"x": 1}}}'),
      JSON.parse('{"s3": {"prototype": 1}}'),
    ]) {
      const res = sanitizeImportedSettings(raw, makeDefaults(), makeCurrent());
      assert.equal(res.status, "error");
    }
    assert.equal(({} as any).polluted, undefined);
  });

  it("should reject wrong types", () => {
    for (const raw of [
      "not an object",
      [],
      { s3: "string instead of object" },
      { concurrency: "5" },
      { syncConfigDir: "true" },
      { ignorePaths: [1, 2] },
      { s3: { s3Endpoint: { nested: true } } },
    ]) {
      const res = sanitizeImportedSettings(raw, makeDefaults(), makeCurrent());
      assert.equal(res.status, "error", JSON.stringify(raw));
    }
  });

  it("should reject unknown service types", () => {
    for (const serviceType of ["profiler", "pro", "nope"]) {
      const res = sanitizeImportedSettings(
        { serviceType },
        makeDefaults(),
        makeCurrent()
      );
      assert.equal(res.status, "error", serviceType);
    }
    const ok = sanitizeImportedSettings(
      { serviceType: "webdav" },
      makeDefaults(),
      makeCurrent()
    );
    assert.equal(ok.status, "ok");
  });

  it("should ignore unknown and never-imported keys", () => {
    const res = sanitizeImportedSettings(
      {
        unknownTop: 1,
        vaultRandomID: "x",
        pro: { email: "a@b.c" },
        s3: { unknownNested: 1 },
      },
      makeDefaults(),
      makeCurrent()
    );
    assert.equal(res.status, "ok");
    if (res.status !== "ok") return;
    assert.deepEqual(res.settings, { s3: {} });
    assert.deepEqual(res.ignoredKeys.sort(), [
      "pro",
      "s3.unknownNested",
      "unknownTop",
      "vaultRandomID",
    ]);
    assert.equal(res.changes.length, 0);
  });
});

describe("Import settings: applyImportedSettings", () => {
  it("should merge sections and keep sections that were not imported", () => {
    const current = makeCurrent();
    const res = applyImportedSettings(current, {
      s3: { s3BucketName: "other" } as any,
      concurrency: 2,
    });
    assert.equal(res.s3.s3BucketName, "other");
    assert.equal(res.s3.s3Endpoint, "https://mine.r2.cloudflarestorage.com");
    assert.equal(res.dropbox.refreshToken, "keep-me");
    assert.equal(res.concurrency, 2);
    assert.equal(current.s3.s3BucketName, "my-vault");
  });
});
