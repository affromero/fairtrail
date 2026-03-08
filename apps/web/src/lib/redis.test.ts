import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockGet, mockSet } = vi.hoisted(() => ({
  mockGet: vi.fn(),
  mockSet: vi.fn(),
}));

// We can't mock the `redis` variable that `cached` closes over,
// so we mock ioredis and set REDIS_URL before importing the module.
vi.mock('ioredis', () => {
  return {
    default: class MockRedis {
      get = mockGet;
      set = mockSet;
    },
  };
});

describe('cached', () => {
  describe('when redis is null (no REDIS_URL)', () => {
    beforeEach(() => {
      vi.resetModules();
      delete process.env.REDIS_URL;
    });

    it('calls fallback and returns result', async () => {
      const { cached } = await import('./redis');
      const fn = vi.fn().mockResolvedValue({ flights: 3 });
      const result = await cached('test-key', fn);
      expect(result).toEqual({ flights: 3 });
      expect(fn).toHaveBeenCalledOnce();
    });
  });

  describe('when redis is available', () => {
    beforeEach(() => {
      vi.resetModules();
      mockGet.mockReset();
      mockSet.mockReset();
      process.env.REDIS_URL = 'redis://fake:6379';
      // Clear globalThis cache so module re-creates client
      const g = globalThis as unknown as { redis: unknown };
      delete g.redis;
    });

    afterEach(() => {
      delete process.env.REDIS_URL;
    });

    it('returns cached value on hit', async () => {
      mockGet.mockResolvedValue(JSON.stringify({ cached: true }));
      const { cached } = await import('./redis');
      const fn = vi.fn().mockResolvedValue({ cached: false });

      const result = await cached('hit-key', fn);
      expect(result).toEqual({ cached: true });
      expect(fn).not.toHaveBeenCalled();
    });

    it('calls fn and stores on miss', async () => {
      mockGet.mockResolvedValue(null);
      mockSet.mockResolvedValue('OK');
      const { cached } = await import('./redis');
      const fn = vi.fn().mockResolvedValue({ fresh: true });

      const result = await cached('miss-key', fn, 60);
      expect(result).toEqual({ fresh: true });
      expect(fn).toHaveBeenCalledOnce();
      expect(mockSet).toHaveBeenCalledWith('miss-key', JSON.stringify({ fresh: true }), 'EX', 60);
    });

    it('uses default 300s ttl', async () => {
      mockGet.mockResolvedValue(null);
      mockSet.mockResolvedValue('OK');
      const { cached } = await import('./redis');

      await cached('key', async () => 'val');
      expect(mockSet).toHaveBeenCalledWith('key', '"val"', 'EX', 300);
    });

    it('falls through when redis get throws', async () => {
      mockGet.mockRejectedValue(new Error('redis error'));
      mockSet.mockResolvedValue('OK');
      const { cached } = await import('./redis');
      const fn = vi.fn().mockResolvedValue('fallback');

      const result = await cached('err-key', fn);
      expect(result).toBe('fallback');
      expect(fn).toHaveBeenCalledOnce();
    });

    it('ignores redis set failure', async () => {
      mockGet.mockResolvedValue(null);
      mockSet.mockRejectedValue(new Error('write failed'));
      const { cached } = await import('./redis');
      const fn = vi.fn().mockResolvedValue('value');

      const result = await cached('set-fail-key', fn);
      expect(result).toBe('value');
    });
  });
});
