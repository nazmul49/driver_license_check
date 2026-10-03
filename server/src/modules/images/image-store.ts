import { mkdir, readFile, rm, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';

/**
 * Storage for encrypted image blobs (SPEC 12). Implementations store opaque bytes; encryption
 * happens before put. The production backing store is an open question (SPEC 15.3) and must
 * not be a public bucket.
 */
export interface ImageStore {
  put(key: string, data: Buffer): Promise<void>;
  get(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
}

const SAFE_KEY = /^[A-Za-z0-9_/.-]+$/;

export class FsImageStore implements ImageStore {
  constructor(private readonly root: string) {}

  private resolve(key: string): string {
    if (!SAFE_KEY.test(key) || key.includes('..')) throw new Error('Invalid storage key');
    return path.join(this.root, key);
  }

  async put(key: string, data: Buffer): Promise<void> {
    const file = this.resolve(key);
    await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
    const tmp = `${file}.tmp-${process.pid}`;
    await writeFile(tmp, data, { mode: 0o600 });
    await rename(tmp, file);
  }

  get(key: string): Promise<Buffer> {
    return readFile(this.resolve(key));
  }

  async delete(key: string): Promise<void> {
    await rm(this.resolve(key), { force: true });
  }
}

export class MemoryImageStore implements ImageStore {
  readonly blobs = new Map<string, Buffer>();
  async put(key: string, data: Buffer) {
    this.blobs.set(key, Buffer.from(data));
  }
  async get(key: string) {
    const b = this.blobs.get(key);
    if (!b) throw new Error('Not found');
    return b;
  }
  async delete(key: string) {
    this.blobs.delete(key);
  }
}
