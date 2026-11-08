// Small key-value cache used for the OAuth token and its refresh lock.
// Memory locally and in tests; Redis (Render Key Value) when REDIS_URL is set.
import { randomUUID } from 'node:crypto';
import type { Redis } from 'ioredis';

export interface KvCache {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlMs: number): Promise<void>;
  del(key: string): Promise<void>;
  /** Try to take a lock. Returns a release function, or null if someone else holds it. */
  tryLock(key: string, ttlMs: number): Promise<(() => Promise<void>) | null>;
}

export class MemoryCache implements KvCache {
  private readonly store = new Map<string, { value: string; expiresAt: number }>();

  constructor(private readonly now: () => number = Date.now) {}

  async get(key: string): Promise<string | null> {
    const hit = this.store.get(key);
    if (!hit) return null;
    if (hit.expiresAt <= this.now()) {
      this.store.delete(key);
      return null;
    }
    return hit.value;
  }

  async set(key: string, value: string, ttlMs: number): Promise<void> {
    this.store.set(key, { value, expiresAt: this.now() + ttlMs });
  }

  async del(key: string): Promise<void> {
    this.store.delete(key);
  }

  async tryLock(key: string, ttlMs: number) {
    if ((await this.get(key)) !== null) return null;
    const owner = randomUUID();
    await this.set(key, owner, ttlMs);
    return async () => {
      if ((await this.get(key)) === owner) await this.del(key);
    };
  }
}

// Delete the lock only if we still own it.
const RELEASE_LUA = `if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end`;

export class RedisCache implements KvCache {
  constructor(private readonly redis: Redis) {}

  get(key: string) {
    return this.redis.get(key);
  }

  async set(key: string, value: string, ttlMs: number) {
    await this.redis.set(key, value, 'PX', Math.max(1, Math.floor(ttlMs)));
  }

  async del(key: string) {
    await this.redis.del(key);
  }

  async tryLock(key: string, ttlMs: number) {
    const owner = randomUUID();
    const ok = await this.redis.set(key, owner, 'PX', Math.floor(ttlMs), 'NX');
    if (ok !== 'OK') return null;
    return async () => {
      await this.redis.eval(RELEASE_LUA, 1, key, owner);
    };
  }
}

/** Redis when a URL is given, memory otherwise. */
export async function createCache(redisUrl?: string): Promise<KvCache> {
  if (!redisUrl) return new MemoryCache();
  const { Redis } = await import('ioredis');
  return new RedisCache(new Redis(redisUrl, { lazyConnect: false, maxRetriesPerRequest: 2 }));
}
