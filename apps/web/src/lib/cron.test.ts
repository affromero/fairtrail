import { describe, it, expect, vi, afterEach } from 'vitest';

const { mockFindFirst } = vi.hoisted(() => ({
  mockFindFirst: vi.fn(),
}));

vi.mock('./prisma', () => ({
  prisma: {
    extractionConfig: {
      findFirst: (...args: unknown[]) => mockFindFirst(...args),
    },
  },
}));

import { startCron, stopCron, getCronInfo, updateCronInterval } from './cron';

afterEach(() => {
  stopCron();
  vi.useRealTimers();
  mockFindFirst.mockReset();
  delete process.env.CRON_INTERVAL_HOURS;
  delete process.env.CRON_ENABLED;
});

describe('cron scheduler reads DB interval', () => {
  it('uses database scrapeInterval on startup instead of env var default', async () => {
    mockFindFirst.mockImplementation(() => Promise.resolve({ id: 'singleton', scrapeInterval: 1 }));

    await startCron();
    const info = getCronInfo();

    expect(info.intervalHours).toBe(1);
    expect(mockFindFirst).toHaveBeenCalledWith({ where: { id: 'singleton' } });
  });

  it('falls back to env var when DB has no config row', async () => {
    process.env.CRON_INTERVAL_HOURS = '6';
    mockFindFirst.mockImplementation(() => Promise.resolve(null));

    await startCron();

    expect(getCronInfo().intervalHours).toBe(6);
  });

  it('falls back to env var when DB query fails', async () => {
    process.env.CRON_INTERVAL_HOURS = '4';
    mockFindFirst.mockImplementation(() => Promise.reject(new Error('connection refused')));

    await startCron();

    expect(getCronInfo().intervalHours).toBe(4);
  });

  it('defaults to 3h when no DB config and no env var', async () => {
    mockFindFirst.mockImplementation(() => Promise.resolve(null));

    await startCron();

    expect(getCronInfo().intervalHours).toBe(3);
  });
});

describe('updateCronInterval', () => {
  it('immediately reschedules with new interval', async () => {
    vi.useFakeTimers();
    mockFindFirst.mockImplementation(() => Promise.resolve({ id: 'singleton', scrapeInterval: 3 }));
    await startCron();
    expect(getCronInfo().intervalHours).toBe(3);

    updateCronInterval(1);

    expect(getCronInfo().intervalHours).toBe(1);
    // Next scrape should be ~1h from now, not ~3h
    const next = new Date(getCronInfo().nextScrape!).getTime();
    const now = Date.now();
    const hoursUntilNext = (next - now) / (1000 * 60 * 60);
    expect(hoursUntilNext).toBeGreaterThan(0.9);
    expect(hoursUntilNext).toBeLessThan(1.1);
  });

  it('clamps interval to 1-24 range', async () => {
    vi.useFakeTimers();
    mockFindFirst.mockImplementation(() => Promise.resolve(null));
    await startCron();

    updateCronInterval(0);
    expect(getCronInfo().intervalHours).toBe(1);

    updateCronInterval(48);
    expect(getCronInfo().intervalHours).toBe(24);
  });
});

describe('CRON_ENABLED', () => {
  it('does not start when CRON_ENABLED=false', async () => {
    process.env.CRON_ENABLED = 'false';
    mockFindFirst.mockImplementation(() => Promise.resolve({ id: 'singleton', scrapeInterval: 1 }));

    await startCron();

    expect(getCronInfo().nextScrape).toBeNull();
    expect(mockFindFirst).not.toHaveBeenCalled();
  });
});
