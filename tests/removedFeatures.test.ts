import { strict as assert } from "assert";
import type { CloudSyncPluginSettings } from "../src/baseTypes";
import {
  getUnsupportedSyncSettingsReason,
  migrateRemovedFeatureSettings,
} from "../src/removedFeatures";

const make = (x: Record<string, unknown>) =>
  ({
    serviceType: "s3",
    conflictAction: "keep_newer",
    syncDirection: "bidirectional",
    onlyAllowPaths: [],
    syncBookmarks: false,
    ...x,
  }) as unknown as CloudSyncPluginSettings;

describe("Removed PRO features", () => {
  it("should leave supported settings alone", () => {
    const s = make({});
    assert.deepEqual(migrateRemovedFeatureSettings(s), []);
    assert.equal(getUnsupportedSyncSettingsReason(s), undefined);
    for (const serviceType of [
      "s3",
      "webdav",
      "dropbox",
      "onedrive",
      "webdis",
    ]) {
      assert.deepEqual(
        migrateRemovedFeatureSettings(make({ serviceType })),
        []
      );
    }
  });

  it("should migrate smart conflict, PRO services and bookmarks-only sync", () => {
    const s = make({
      conflictAction: "smart_conflict",
      serviceType: "googledrive",
      syncBookmarks: true,
    }) as any;
    const messages = migrateRemovedFeatureSettings(s);
    assert.equal(messages.length, 3);
    assert.equal(s.conflictAction, "keep_newer");
    assert.equal(s.serviceType, "s3");
    assert.equal(s.syncBookmarks, false);
  });

  it("should refuse to sync with an allow list", () => {
    const reason = getUnsupportedSyncSettingsReason(
      make({ onlyAllowPaths: ["^notes/"] })
    );
    assert.ok(reason?.includes("Allow list"));
  });

  it("should refuse to sync with push/pull-and-delete directions", () => {
    for (const syncDirection of [
      "incremental_push_and_delete_only",
      "incremental_pull_and_delete_only",
    ]) {
      assert.ok(getUnsupportedSyncSettingsReason(make({ syncDirection })));
    }
    for (const syncDirection of [
      "bidirectional",
      "incremental_push_only",
      "incremental_pull_only",
    ]) {
      assert.equal(
        getUnsupportedSyncSettingsReason(make({ syncDirection })),
        undefined
      );
    }
  });
});
