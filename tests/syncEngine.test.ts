import { strict as assert } from "assert";
import type {
  S3Config,
  SyncItSimplyStupidPluginSettings,
} from "../src/baseTypes";
import { FakeFsEncrypt } from "../src/fsEncrypt";
import { DEFAULT_S3_CONFIG, FakeFsS3 } from "../src/fsS3";
import type { InternalDBs } from "../src/localdb";
import { syncer } from "../src/sync";
import { startFakeS3 } from "./support/fakeS3Server";
import { MemoryFs, memoryDb } from "./support/memoryFs";

// The real sync engine (src/sync.ts): in-memory vault, real S3 client,
// in-memory S3 server, in-memory sync records. No encryption password
// (the rclone worker can't run under Node).
const BUCKET = "temp-obsidian";

const settings = {
  serviceType: "s3",
  password: "",
  concurrency: 2,
  conflictAction: "keep_newer",
  howToCleanEmptyFolder: "clean_both",
  ignorePaths: [],
  protectModifyPercentage: 100,
  skipSizeLargerThan: -1,
  syncConfigDir: false,
  syncDirection: "bidirectional",
  syncUnderscoreItems: false,
} as unknown as SyncItSimplyStupidPluginSettings;

describe("Sync engine (end to end)", function () {
  this.timeout(30000);
  let s3: Awaited<ReturnType<typeof startFakeS3>>;
  let local: MemoryFs;
  let db: ReturnType<typeof memoryDb>;
  let savedWindow: unknown;

  before(() => {
    // Obsidian provides window.moment; the engine only formats times with it
    savedWindow = (globalThis as any).window;
    (globalThis as any).window = {
      crypto: globalThis.crypto,
      moment: (t: number) => ({
        format: () => new Date(t).toISOString(),
        toISOString: () => new Date(t).toISOString(),
      }),
    };
  });
  after(() => {
    (globalThis as any).window = savedWindow;
  });

  beforeEach(async () => {
    s3 = await startFakeS3(BUCKET);
    local = new MemoryFs();
    db = memoryDb();
  });
  afterEach(async () => {
    await s3.close();
  });

  const runSync = async () => {
    const remote = new FakeFsS3({
      ...DEFAULT_S3_CONFIG,
      s3Endpoint: s3.endpoint,
      s3Region: "auto",
      s3AccessKeyID: "key-id",
      s3SecretAccessKey: "secret",
      s3BucketName: BUCKET,
      forcePathStyle: true,
    } as S3Config);
    const enc = new FakeFsEncrypt(remote, "", "rclone-base64");
    const errors: Error[] = [];
    const progress: unknown[][] = [];
    await syncer(
      local,
      remote,
      enc,
      undefined,
      db as unknown as InternalDBs,
      "manual",
      "test-profile",
      "test-vault",
      ".obsidian",
      settings,
      (p, n, all) => `protect ${p} ${n} ${all}`,
      () => {},
      async () => {},
      async (_s, e) => {
        errors.push(e);
      },
      async () => {},
      async () => {},
      async (...args) => {
        progress.push(args);
      }
    );
    return { errors, progress };
  };

  it("should upload a new vault, reporting progress with the engine's arguments", async () => {
    local.put("MyFiles/README", "readme");
    local.put("note.md", "# note");

    const { errors, progress } = await runSync();

    assert.deepEqual(errors, []);
    assert.ok(s3.objects.has("MyFiles/README"));
    assert.ok(s3.objects.has("note.md"));
    assert.equal(s3.objects.get("note.md")!.toString(), "# note");
    // (realCounter, realTotalCount, pathName, decision): the counter, not a
    // trigger source, comes first ("no translate for 0" in 0.8.4)
    assert.ok(progress.length > 0);
    for (const [counter, total, pathName, decision] of progress) {
      assert.equal(typeof counter, "number");
      assert.equal(typeof total, "number");
      assert.equal(typeof pathName, "string");
      assert.ok(decision === undefined || typeof decision === "string");
    }
  });

  it("should do nothing on a second sync without changes", async () => {
    local.put("note.md", "# note");
    assert.deepEqual((await runSync()).errors, []);
    const requestsBefore = s3.state.requests.filter((r) =>
      r.startsWith("PUT")
    ).length;

    const { errors } = await runSync();

    assert.deepEqual(errors, []);
    const putsAfter = s3.state.requests.filter((r) =>
      r.startsWith("PUT")
    ).length;
    assert.equal(putsAfter, requestsBefore);
  });

  it("should download a file that only exists remotely", async () => {
    local.put("note.md", "# note");
    await runSync();
    const remote = new FakeFsS3({
      ...DEFAULT_S3_CONFIG,
      s3Endpoint: s3.endpoint,
      s3Region: "auto",
      s3AccessKeyID: "key-id",
      s3SecretAccessKey: "secret",
      s3BucketName: BUCKET,
      forcePathStyle: true,
    } as S3Config);
    await remote.writeFile(
      "from-other-device.md",
      new TextEncoder().encode("hi").buffer as ArrayBuffer,
      Date.now(),
      Date.now()
    );

    const { errors } = await runSync();

    assert.deepEqual(errors, []);
    assert.equal(local.text("from-other-device.md"), "hi");
  });

  it("should delete remotely what was deleted locally", async () => {
    local.put("keep.md", "keep");
    local.put("gone.md", "gone");
    await runSync();
    assert.ok(s3.objects.has("gone.md"));

    await local.rm("gone.md");
    const { errors } = await runSync();

    assert.deepEqual(errors, []);
    assert.ok(!s3.objects.has("gone.md"));
    assert.ok(s3.objects.has("keep.md"));
  });
});
