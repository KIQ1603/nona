import type { ObjectStorage } from '../domain';

/** In-process storage for tests and for running the API without MinIO. */
export class MemoryStorage implements ObjectStorage {
  readonly objects = new Map<string, { body: Buffer; contentType: string }>();
  async put(key: string, body: Buffer, contentType: string) {
    this.objects.set(key, { body, contentType });
  }
  async delete(key: string) {
    this.objects.delete(key);
  }
  async get(key: string) {
    return this.objects.get(key) ?? null;
  }
  async ensureReady() {}
}
