import { strict as assert } from "assert";
import { errorToMessage, runConnectivityCheck } from "../src/connectivity";

describe("Connectivity check: errorToMessage", () => {
  it("should turn anything into readable text", () => {
    assert.equal(errorToMessage("plain"), "plain");
    assert.equal(errorToMessage(new Error("boom")), "boom");
    assert.equal(errorToMessage(undefined), "unknown error");
    assert.equal(errorToMessage(""), "unknown error");
    assert.equal(
      errorToMessage({ errors: [new Error("first"), "second"] }),
      "first\nsecond"
    );
    assert.equal(errorToMessage({ code: 403 }), '{"code":403}');
  });
});

describe("Connectivity check: runConnectivityCheck", () => {
  it("should report success", async () => {
    const res = await runConnectivityCheck(() => ({
      checkConnect: async () => true,
    }));
    assert.deepEqual(res, { ok: true });
  });

  it("should report an error thrown while creating the client", async () => {
    const res = await runConnectivityCheck(() => {
      throw Error("refusing plain http S3 endpoint");
    });
    assert.deepEqual(res, {
      ok: false,
      message: "refusing plain http S3 endpoint",
    });
  });

  it("should report an Error object passed to the callback as text", async () => {
    const res = await runConnectivityCheck(() => ({
      checkConnect: async (cb?: (e: unknown) => void) => {
        cb?.(new Error("AccessDenied"));
        return false;
      },
    }));
    assert.deepEqual(res, { ok: false, message: "AccessDenied" });
  });

  it("should report an error thrown by the check", async () => {
    const res = await runConnectivityCheck(() => ({
      checkConnect: async () => {
        throw Error("x.contains is not a function");
      },
    }));
    assert.deepEqual(res, {
      ok: false,
      message: "x.contains is not a function",
    });
  });

  it("should give up when the check never answers", async () => {
    const res = await runConnectivityCheck(
      () => ({ checkConnect: () => new Promise<boolean>(() => {}) }),
      50
    );
    assert.equal(res.ok, false);
    assert.match((res as any).message, /No answer within/);
  });

  it("should report a failure without a reason", async () => {
    const res = await runConnectivityCheck(() => ({
      checkConnect: async () => false,
    }));
    assert.deepEqual(res, { ok: false, message: "the check failed" });
  });
});
