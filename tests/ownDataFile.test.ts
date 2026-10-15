import { strict as assert } from "assert";
import { filterOutKeys, getOwnPluginDataFilePath } from "../src/misc";

describe("Own plugin data.json is never synced", () => {
  const dataFile = getOwnPluginDataFilePath(".obsidian", "sync-sync-sync");

  it("should build the plugin data.json path", () => {
    assert.equal(dataFile, ".obsidian/plugins/sync-sync-sync/data.json");
  });

  it("should filter it out of walk results, keeping everything else", () => {
    const entities = [
      "note.md",
      ".obsidian/",
      ".obsidian/plugins/sync-sync-sync/",
      dataFile,
      ".obsidian/plugins/sync-sync-sync/main.js",
      ".obsidian/plugins/other/data.json",
    ].map((key) => ({ key }));
    entities.push({ key: undefined as unknown as string });

    const keys = filterOutKeys(entities, new Set([dataFile])).map((e) => e.key);
    assert.ok(!keys.includes(dataFile));
    assert.ok(keys.includes(".obsidian/plugins/sync-sync-sync/main.js"));
    assert.ok(keys.includes(".obsidian/plugins/other/data.json"));
    assert.equal(keys.length, 6);
  });

  it("should return the same list when nothing is hidden", () => {
    const entities = [{ key: "a.md" }];
    assert.equal(filterOutKeys(entities, new Set()), entities);
  });
});
