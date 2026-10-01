/** Bounded LRU cache that shares concurrent loads and never caches failures. */
export class AsyncTtlCache<T> {
  private readonly entries = new Map<string, { value: T; expiresAt: number }>();
  private readonly pending = new Map<string, Promise<T>>();

  constructor(private readonly capacity: number) {
    if (!Number.isSafeInteger(capacity) || capacity < 1) {
      throw new RangeError("Cache capacity must be a positive integer.");
    }
  }

  clear(): void {
    this.entries.clear();
    // Detached loads may finish for their original callers, but cannot repopulate the cache.
    this.pending.clear();
  }

  async getOrLoad(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
    if (!Number.isFinite(ttlMs) || ttlMs <= 0) return load();
    const cached = this.entries.get(key);
    if (cached) {
      this.entries.delete(key);
      if (cached.expiresAt > Date.now()) {
        this.entries.set(key, cached);
        return cached.value;
      }
    }
    const existing = this.pending.get(key);
    if (existing) return existing;

    const request = Promise.resolve().then(load);
    this.pending.set(key, request);
    try {
      const value = await request;
      if (this.pending.get(key) === request) {
        this.entries.set(key, { value, expiresAt: Date.now() + ttlMs });
        while (this.entries.size > this.capacity) {
          this.entries.delete(this.entries.keys().next().value!);
        }
      }
      return value;
    } finally {
      if (this.pending.get(key) === request) this.pending.delete(key);
    }
  }
}
