import { Redis } from '@upstash/redis';

const { UPSTASH_REDIS_REST_URL: url, UPSTASH_REDIS_REST_TOKEN: token } = process.env;

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
    memory.set(key, { value, expiresAt: ttlSeconds ? Date.now() + ttlSeconds * 1000 : null });
  },
  async del(key) {
    memory.delete(key);
  },
};

function createRedisCache(redis) {
  return {
    backend: 'redis',
    async get(key) {
      return (await redis.get(key)) ?? null;
    },
    async set(key, value, ttlSeconds) {
      if (ttlSeconds) await redis.set(key, value, { ex: ttlSeconds });
      else await redis.set(key, value);
    },
    async del(key) {
      await redis.del(key);
    },
  };
}

export const cache = url && token ? createRedisCache(new Redis({ url, token })) : memoryCache;
