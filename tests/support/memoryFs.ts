import type { Entity } from "../../src/baseTypes";
import { FakeFs } from "../../src/fsAll";

/**
 * An in-memory vault for engine tests: files and folders ("a/") with
 * modification times, implementing the same interface as the real vault.
 */
export class MemoryFs extends FakeFs {
  kind = "memory";
  files = new Map<string, { content: Uint8Array; mtime: number }>();
  folders = new Map<string, number>();

  put(key: string, text: string, mtime: number = Date.now()) {
    this.files.set(key, { content: new TextEncoder().encode(text), mtime });
    const parts = key.split("/");
    for (let i = 1; i < parts.length; i++) {
      const folder = `${parts.slice(0, i).join("/")}/`;
      if (!this.folders.has(folder)) {
        this.folders.set(folder, mtime);
      }
    }
  }

  text(key: string) {
    const f = this.files.get(key);
    return f === undefined ? undefined : new TextDecoder().decode(f.content);
  }

  _entity(key: string): Entity {
    if (key.endsWith("/")) {
      return { key, keyRaw: key, size: 0, sizeRaw: 0 };
    }
    const f = this.files.get(key)!;
    return {
      key,
      keyRaw: key,
      mtimeCli: f.mtime,
      mtimeSvr: f.mtime,
      size: f.content.byteLength,
      sizeRaw: f.content.byteLength,
    };
  }

  async walk(): Promise<Entity[]> {
    return [...this.folders.keys(), ...this.files.keys()].map((k) =>
      this._entity(k)
    );
  }
  async walkPartial(): Promise<Entity[]> {
    return await this.walk();
  }
  async stat(key: string): Promise<Entity> {
    if (!this.files.has(key) && !this.folders.has(key)) {
      throw Error(`${key} does not exist`);
    }
    return this._entity(key);
  }
  async mkdir(key: string, mtime?: number): Promise<Entity> {
    this.folders.set(key, mtime ?? Date.now());
    return this._entity(key);
  }
  async writeFile(
    key: string,
    content: ArrayBuffer,
    mtime: number
  ): Promise<Entity> {
    this.files.set(key, { content: new Uint8Array(content.slice(0)), mtime });
    return this._entity(key);
  }
  async readFile(key: string): Promise<ArrayBuffer> {
    const f = this.files.get(key);
    if (f === undefined) {
      throw Error(`${key} does not exist`);
    }
    return f.content.slice().buffer as ArrayBuffer;
  }
  async rename(key1: string, key2: string): Promise<void> {
    const f = this.files.get(key1);
    if (f !== undefined) {
      this.files.set(key2, f);
      this.files.delete(key1);
    }
  }
  async rm(key: string): Promise<void> {
    this.files.delete(key);
    this.folders.delete(key);
  }
  async checkConnect(): Promise<boolean> {
    return true;
  }
  async getUserDisplayName(): Promise<string> {
    return "memory";
  }
  async revokeAuth(): Promise<any> {}
  allowEmptyFile(): boolean {
    return true;
  }
}

/**
 * The sync engine's tables (prev sync records, sync plans) in memory.
 */
export const memoryDb = () => {
  const table = () => {
    const m = new Map<string, unknown>();
    return {
      m,
      getItems: async () => Object.fromEntries(m),
      getItem: async (k: string) => m.get(k) ?? null,
      setItem: async (k: string, v: unknown) => {
        m.set(k, v);
        return v;
      },
      removeItem: async (k: string) => {
        m.delete(k);
      },
    };
  };
  return { prevSyncRecordsTbl: table(), syncPlansTbl: table() };
};
