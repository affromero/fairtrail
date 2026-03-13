import Redis from 'ioredis';

const REDIS_ENABLED = Boolean(process.env.REDIS_URL);

const globalForRedis = globalThis as unknown as { redis: Redis | null };

function createRedisClient(): Redis | null {
  if (!REDIS_ENABLED) return null;

  return new Redis(process.env.REDIS_URL!, {
    lazyConnect: true,
    maxRetriesPerRequest: 3,
  });
}

export const redis: Redis | null =
  globalForRedis.redis !== undefined
    ? globalForRedis.redis
    : createRedisClient();

if (process.env.NODE_ENV !== 'production') {
  globalForRedis.redis = redis;
}

const CACHE_TTL = 300; // 5 minutes

export async function cached<T>(
  key: string,
  fn: () => Promise<T>,
  ttl = CACHE_TTL
): Promise<T> {
  if (redis) {
    try {
      const hit = await redis.get(key);
      if (hit) return JSON.parse(hit) as T;
    } catch {
      // Redis unavailable — fall through to fn
    }
  }

  const result = await fn();

  if (redis) {
    try {
      await redis.set(key, JSON.stringify(result), 'EX', ttl);
    } catch {
      // Redis unavailable — ignore
    }
  }

  return result;
}
