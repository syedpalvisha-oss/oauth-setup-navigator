import { Redis } from '@upstash/redis';

const { UPSTASH_REDIS_REST_URL: url, UPSTASH_REDIS_REST_TOKEN: token } = process.env;

const MAX_MEMORY_ENTRIES = 500; // a small process must not grow without bound
const memory = new Map(); // key -> { value, expiresAt|null }

const memoryCache = {
  backend: 'memory',
  async get(key) {
    const entry = memory.get(key);
    if (!entry) return null;
    if (entry.expiresAt && entry.expiresAt < Date.now()) {
      memory.delete(key);
      return null;
    }
    return entry.value;
  },
  async set(key, value, ttlSeconds) {
    memory.delete(key); // re-insert so the Map's order stays oldest-first
    memory.set(key, { value, expiresAt: ttlSeconds ? Date.now() + ttlSeconds * 1000 : null });
    while (memory.size > MAX_MEMORY_ENTRIES) memory.delete(memory.keys().next().value);
  },
  async del(key) {
    memory.delete(key);
  },
};

/**
 * Redis-backed cache that never takes the app down: if Redis errors (bad credentials, outage), the call is served from the
 * in-memory cache instead and one warning is logged. `backend` reports which one is actually answering.
 */
function createRedisCache(redis) {
  let warned = false;
  const fallback = (op, e) => {
    if (!warned) {
      warned = true;
      console.warn(`Redis cache ${op} failed (${String(e.message).slice(0, 120)}); using the in-memory cache instead.`);
    }
    cache.backend = 'memory (redis unavailable)';
  };
  return {
    backend: 'redis',
    async get(key) {
      try {
        return (await redis.get(key)) ?? (await memoryCache.get(key));
      } catch (e) {
        fallback('get', e);
        return memoryCache.get(key);
      }
    },
    async set(key, value, ttlSeconds) {
      await memoryCache.set(key, value, ttlSeconds);
      try {
        if (ttlSeconds) await redis.set(key, value, { ex: ttlSeconds });
        else await redis.set(key, value);
      } catch (e) {
        fallback('set', e);
      }
    },
    async del(key) {
      await memoryCache.del(key);
      try {
        await redis.del(key);
      } catch (e) {
        fallback('del', e);
      }
    },
  };
}

export const cache = url && token ? createRedisCache(new Redis({ url, token })) : memoryCache;
