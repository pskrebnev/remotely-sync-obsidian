import { strict as assert } from "assert";
import { HttpRequest } from "@smithy/protocol-http";
import type { S3Config } from "../src/baseTypes";
import { runConnectivityCheck } from "../src/connectivity";
import {
  DEFAULT_S3_CONFIG,
  DEFAULT_S3_REQUEST_TIMEOUT_MS,
  FakeFsS3,
  ObsHttpHandler,
  endpointHasPath,
} from "../src/fsS3";
import { startFakeS3 } from "./support/fakeS3Server";

// The real S3 client, through the Obsidian request handler (stubbed
// requestUrl), against an in-memory S3 server.
const BUCKET = "temp-obsidian";
const configFor = (endpoint: string, extra: Partial<S3Config> = {}) =>
  ({
    ...DEFAULT_S3_CONFIG,
    s3Endpoint: endpoint,
    s3Region: "auto",
    s3AccessKeyID: "key-id",
    s3SecretAccessKey: "secret",
    s3BucketName: BUCKET,
    forcePathStyle: true,
    ...extra,
  }) as S3Config;

describe("S3 connectivity check (end to end)", function () {
  this.timeout(20000);
  let s3: Awaited<ReturnType<typeof startFakeS3>>;
  beforeEach(async () => {
    s3 = await startFakeS3(BUCKET);
  });
  afterEach(async () => {
    await s3.close();
  });

  it("should succeed with valid settings", async () => {
    const res = await runConnectivityCheck(
      () => new FakeFsS3(configFor(s3.endpoint)),
      5000
    );
    assert.deepEqual(res, { ok: true });
    // the check cleans up its test file
    assert.equal(s3.objects.size, 0);
  });

  it("should report a refused request (403) instead of failing silently", async () => {
    s3.state.mode = "forbidden";
    const res = await runConnectivityCheck(
      () => new FakeFsS3(configFor(s3.endpoint)),
      5000
    );
    assert.equal(res.ok, false);
    assert.match((res as any).message, /403/);
  });

  it("should explain an endpoint that contains the bucket name", async () => {
    const res = await runConnectivityCheck(
      () => new FakeFsS3(configFor(`${s3.endpoint}/${BUCKET}`)),
      5000
    );
    assert.equal(res.ok, false);
    assert.match((res as any).message, /must not contain a path/);
  });

  it("should report a wrong bucket name", async () => {
    const res = await runConnectivityCheck(
      () => new FakeFsS3(configFor(s3.endpoint, { s3BucketName: "other" })),
      5000
    );
    assert.equal(res.ok, false);
    assert.match((res as any).message, /404/);
  });

  it("should report a refused plain-http endpoint", async () => {
    const res = await runConnectivityCheck(
      () => new FakeFsS3(configFor("http://example.com")),
      5000
    );
    assert.equal(res.ok, false);
    assert.match((res as any).message, /refusing plain http/);
  });

  it("should give up when the server never answers", async () => {
    s3.state.mode = "hang";
    const res = await runConnectivityCheck(
      () => new FakeFsS3(configFor(s3.endpoint)),
      300
    );
    assert.equal(res.ok, false);
    assert.match((res as any).message, /No answer within/);
  });
});

describe("S3 request handler timeout", function () {
  this.timeout(10000);

  it("should apply a default timeout", () => {
    assert.equal(
      new ObsHttpHandler().requestTimeoutInMs,
      DEFAULT_S3_REQUEST_TIMEOUT_MS
    );
    assert.ok(DEFAULT_S3_REQUEST_TIMEOUT_MS > 0);
  });

  it("should reject a request that never answers", async () => {
    const s3 = await startFakeS3(BUCKET);
    s3.state.mode = "hang";
    try {
      const url = new URL(s3.endpoint);
      const request = new HttpRequest({
        protocol: url.protocol,
        hostname: url.hostname,
        port: Number(url.port),
        method: "GET",
        path: `/${BUCKET}/`,
        headers: {},
      });
      await assert.rejects(
        () => new ObsHttpHandler({ requestTimeout: 200 }).handle(request),
        /did not complete within 200 ms/
      );
    } finally {
      await s3.close();
    }
  });
});

describe("endpointHasPath", () => {
  it("should detect a path after the host", () => {
    for (const e of [
      "https://acc.r2.cloudflarestorage.com/temp-obsidian",
      "acc.r2.cloudflarestorage.com/bucket/",
      "https://s3.eu-central-1.amazonaws.com/my-bucket",
    ]) {
      assert.ok(endpointHasPath(e), e);
    }
    for (const e of [
      "https://acc.r2.cloudflarestorage.com",
      "https://acc.r2.cloudflarestorage.com/",
      "acc.r2.cloudflarestorage.com",
      "http://127.0.0.1:9000",
      "",
      "not a url at all",
    ]) {
      assert.ok(!endpointHasPath(e), e);
    }
  });
});
