import { strict as assert } from "assert";
import type { SyncItSimplyStupidPluginSettings } from "../src/baseTypes";
import {
  type SecretBackend,
  fillSecretsFromBackend,
  getSecretBackend,
  secretIdFor,
  splitSecretsForDisk,
} from "../src/secretStore";

class MemoryBackend implements SecretBackend {
  store = new Map<string, string>();
  getSecret(id: string) {
    return this.store.has(id) ? this.store.get(id)! : null;
  }
  setSecret(id: string, secret: string) {
    if (!/^[a-z0-9-]+$/.test(id)) {
      throw Error(`invalid id ${id}`);
    }
    this.store.set(id, secret);
  }
}

class BrokenBackend implements SecretBackend {
  getSecret(id: string) {
    return null;
  }
  setSecret(id: string, secret: string) {
    throw Error("storage unavailable");
  }
}

const makeSettings = () =>
  ({
    s3: {
      s3Endpoint: "https://acc.r2.cloudflarestorage.com",
      s3AccessKeyID: "AKIA-ID",
      s3SecretAccessKey: "very-secret",
      s3BucketName: "vault",
    },
    password: "e2e-pass",
    serviceType: "s3",
  }) as unknown as SyncItSimplyStupidPluginSettings;

describe("Secret storage", () => {
  it("should build valid SecretStorage ids", () => {
    assert.equal(
      secretIdFor("abc123", ["s3", "s3SecretAccessKey"]),
      "sync-it-simply-stupid-abc123-s3-s3-secret-access-key"
    );
    assert.equal(
      secretIdFor("abc123", ["password"]),
      "sync-it-simply-stupid-abc123-password"
    );
  });

  it("should move secrets out of data.json and restore them on load", () => {
    const backend = new MemoryBackend();
    const settings = makeSettings();

    const onDisk = splitSecretsForDisk(settings, backend);
    assert.equal(onDisk.s3.s3AccessKeyID, "");
    assert.equal(onDisk.s3.s3SecretAccessKey, "");
    assert.equal(onDisk.password, "");
    assert.equal(onDisk.s3.s3Endpoint, "https://acc.r2.cloudflarestorage.com");
    assert.ok(onDisk.secretStorageNamespace);
    assert.match(onDisk.secretStorageNamespace!, /^[a-z0-9]{12}$/);
    // in-memory settings keep working values
    assert.equal(settings.s3.s3SecretAccessKey, "very-secret");

    const reloaded = JSON.parse(JSON.stringify(onDisk));
    fillSecretsFromBackend(reloaded, backend);
    assert.equal(reloaded.s3.s3AccessKeyID, "AKIA-ID");
    assert.equal(reloaded.s3.s3SecretAccessKey, "very-secret");
    assert.equal(reloaded.password, "e2e-pass");
  });

  it("should keep the same namespace across saves", () => {
    const backend = new MemoryBackend();
    const settings = makeSettings();
    const first = splitSecretsForDisk(settings, backend);
    settings.s3.s3SecretAccessKey = "rotated";
    const second = splitSecretsForDisk(settings, backend);
    assert.equal(first.secretStorageNamespace, second.secretStorageNamespace);
    const reloaded = JSON.parse(JSON.stringify(second));
    fillSecretsFromBackend(reloaded, backend);
    assert.equal(reloaded.s3.s3SecretAccessKey, "rotated");
  });

  it("should prefer a value still on disk (not migrated yet)", () => {
    const backend = new MemoryBackend();
    const settings = makeSettings();
    settings.secretStorageNamespace = "ns0000000000";
    backend.setSecret(
      secretIdFor("ns0000000000", ["s3", "s3SecretAccessKey"]),
      "old"
    );
    fillSecretsFromBackend(settings, backend);
    assert.equal(settings.s3.s3SecretAccessKey, "very-secret");
  });

  it("should allow clearing a stored secret", () => {
    const backend = new MemoryBackend();
    const settings = makeSettings();
    splitSecretsForDisk(settings, backend);
    settings.password = "";
    const onDisk = splitSecretsForDisk(settings, backend);
    const reloaded = JSON.parse(JSON.stringify(onDisk));
    fillSecretsFromBackend(reloaded, backend);
    assert.equal(reloaded.password, "");
  });

  it("should keep secrets on disk when storage fails or is missing", () => {
    const broken = splitSecretsForDisk(makeSettings(), new BrokenBackend());
    assert.equal(broken.s3.s3SecretAccessKey, "very-secret");
    assert.equal(broken.password, "e2e-pass");

    const settings = makeSettings();
    const none = splitSecretsForDisk(settings, undefined);
    assert.equal(none.s3.s3SecretAccessKey, "very-secret");
    assert.equal(none.secretStorageNamespace, undefined);
  });

  it("should detect SecretStorage only when the API exists", () => {
    assert.equal(getSecretBackend({}), undefined);
    assert.equal(getSecretBackend(undefined), undefined);
    assert.equal(getSecretBackend({ secretStorage: {} }), undefined);
    const backend = new MemoryBackend();
    assert.equal(getSecretBackend({ secretStorage: backend }), backend);
  });

  it("should also move WebDAV, Webdis and OAuth credentials", () => {
    const backend = new MemoryBackend();
    const settings = {
      ...makeSettings(),
      webdav: {
        address: "https://dav",
        password: "dav-pw",
        customHeaders: "Authorization: Bearer x",
      },
      webdis: { address: "https://webdis", password: "webdis-pw" },
      dropbox: {
        accessToken: "dbx-at",
        refreshToken: "dbx-rt",
        clientID: "cid",
      },
      onedrive: {
        accessToken: "od-at",
        refreshToken: "od-rt",
        clientID: "cid",
      },
    } as unknown as SyncItSimplyStupidPluginSettings;
    const onDisk = splitSecretsForDisk(settings, backend) as any;
    for (const [section, key] of [
      ["webdav", "password"],
      ["webdav", "customHeaders"],
      ["webdis", "password"],
      ["dropbox", "accessToken"],
      ["dropbox", "refreshToken"],
      ["onedrive", "accessToken"],
      ["onedrive", "refreshToken"],
    ]) {
      assert.equal(onDisk[section][key], "", `${section}.${key}`);
    }
    assert.equal(onDisk.dropbox.clientID, "cid");
    assert.equal(onDisk.webdav.address, "https://dav");
    const reloaded = JSON.parse(JSON.stringify(onDisk));
    fillSecretsFromBackend(reloaded, backend);
    assert.equal(reloaded.dropbox.refreshToken, "dbx-rt");
    assert.equal(reloaded.webdav.customHeaders, "Authorization: Bearer x");
  });
});
