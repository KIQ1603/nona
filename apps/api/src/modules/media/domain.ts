export interface ObjectStorage {
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  delete(key: string): Promise<void>;
  /** Reads an object (used for access-controlled streaming of private files). null if missing. */
  get(key: string): Promise<{ body: Buffer; contentType: string } | null>;
  /** Called once at boot; creates the bucket in non-production environments. */
  ensureReady(): Promise<void>;
}
export const OBJECT_STORAGE = Symbol('OBJECT_STORAGE');
