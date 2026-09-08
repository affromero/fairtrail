import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '@/lib/prisma';
import { launchBrowser } from '../scraper/browser';
import type { Browser } from 'playwright';
import { executeTravelJob, pumpTravelJobs } from './coordinator';
import { expireQueuedPreviews, withPreviewTravelAdmission } from './preview';
import { acquireTravelLease, getTravelAdmission, recoverTravelAdmission, releaseTravelLease } from './admission';
import { cancelTravelJob, enqueueTravelJob } from './jobs';
import { travelDelay } from './execution';

describe.skipIf(process.env.TRAVEL_COORDINATOR_INTEGRATION_TESTS !== '1')('shared coordinator over PostgreSQL and headless Chromium', () => {
  let previous: { vpnProvider: string | null } | null;
  const browsers: Browser[] = [];
  beforeAll(async () => {
    const url = new URL(process.env.DATABASE_URL ?? 'http://invalid');
    if (url.hostname !== '127.0.0.1' || url.port !== '55440' || url.pathname !== '/car_test') throw new Error('Coordinator tests require disposable localhost:55440/car_test');
    previous = await prisma.extractionConfig.findUnique({ where: { id: 'singleton' }, select: { vpnProvider: true } });
  });
  beforeEach(async () => {
    await prisma.travelJob.deleteMany(); await prisma.travelLease.deleteMany(); await prisma.travelAdmission.deleteMany();
    await prisma.extractionConfig.upsert({ where: { id: 'singleton' }, create: { vpnProvider: 'none' }, update: { vpnProvider: 'none' } });
  });
  afterEach(async () => {
    vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.unstubAllGlobals();
    for (const browser of browsers.splice(0)) if (browser.isConnected()) await browser.close();
    await prisma.travelJob.deleteMany(); await prisma.travelLease.deleteMany(); await prisma.travelAdmission.deleteMany();
  });
  afterAll(async () => {
    if (previous) await prisma.extractionConfig.update({ where: { id: 'singleton' }, data: previous });
    else await prisma.extractionConfig.delete({ where: { id: 'singleton' } });
    await prisma.$disconnect();
  });
  async function browser() { const value = await launchBrowser(); browsers.push(value); return value; }
  const batch = () => enqueueTravelJob({ kind: 'flight_batch', userId: null });

  it('waits for a busy browser lease and returns preview data without persisting sensitive output', async () => {
    const held = await acquireTravelLease('browser');
    const work = withPreviewTravelAdmission(async () => {
      const page = await (await browser()).newPage();
      await page.setContent('<h1>Private preview result</h1>');
      return { text: await page.textContent('h1'), credential: 'memory-only-secret' };
    });
    await new Promise(resolve => setTimeout(resolve, 100));
    expect(browsers).toHaveLength(0);
    await releaseTravelLease(held!);
    expect(await work).toMatchObject({ text: 'Private preview result', credential: 'memory-only-secret' });
    const jobs = await prisma.travelJob.findMany();
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({ kind: 'flight_preview', status: 'succeeded', result: null, request: null });
    expect(JSON.stringify(jobs)).not.toContain('memory-only-secret');
    expect(browsers.every(browser => !browser.isConnected())).toBe(true);
  }, 15_000);

  it('does not let the background worker consume a process-owned preview and only expires abandoned queued work', async () => {
    vi.stubEnv('SELF_HOSTED', 'true');
    const abandoned = await enqueueTravelJob({ kind: 'flight_preview', userId: null });
    const fresh = await enqueueTravelJob({ kind: 'flight_preview', userId: null });
    await prisma.travelJob.update({ where: { id: abandoned.id }, data: { createdAt: new Date(Date.now() - 600_000) } });
    await pumpTravelJobs();
    expect(await prisma.travelJob.findUnique({ where: { id: fresh.id } })).toMatchObject({ status: 'queued', attempts: 0 });
    await expireQueuedPreviews();
    expect(await prisma.travelJob.findUnique({ where: { id: abandoned.id } })).toMatchObject({ status: 'failed', attempts: 0 });
    expect(await prisma.travelJob.findUnique({ where: { id: fresh.id } })).toMatchObject({ status: 'queued', attempts: 0 });
  });

  it.each(['queued', 'running'] as const)('cancels a %s preview without accepting a result or leaving a browser', async state => {
    const held = state === 'queued' ? await acquireTravelLease('browser') : null;
    const controller = new AbortController();
    let started!: () => void;
    const ready = new Promise<void>(resolve => { started = resolve; });
    const work = withPreviewTravelAdmission(async () => {
      await browser(); started(); await travelDelay(30_000); return 'must not be accepted';
    }, { signal: controller.signal });
    const rejected = expect(work).rejects.toThrow(/caller cancelled/);
    if (state === 'running') await ready;
    else await new Promise(resolve => setTimeout(resolve, 100));
    controller.abort(new Error('caller cancelled'));
    await rejected;
    if (held) await releaseTravelLease(held);
    const jobs = await prisma.travelJob.findMany();
    expect(jobs[0]).toMatchObject({ status: state === 'queued' ? 'cancelled' : 'failed', result: null });
    expect(browsers.every(browser => !browser.isConnected())).toBe(true);
    expect((await getTravelAdmission()).quarantinedAt).toBeNull();
  }, 15_000);

  it('preserves a preview callback error and quarantines unverified cleanup', async () => {
    await expect(withPreviewTravelAdmission(async () => {
      const opened = await browser(), close = opened.close.bind(opened);
      vi.spyOn(opened, 'close').mockImplementation(async () => { await close(); throw new Error('cleanup acknowledgement lost'); });
      throw new Error('original preview error');
    })).rejects.toMatchObject({ name: 'TravelCleanupError' });
    expect((await getTravelAdmission()).quarantinedAt).toBeInstanceOf(Date);
    expect((await prisma.travelJob.findFirst())?.result).toBeNull();
  }, 15_000);

  it('persists the result and closes owned browsers before the resource becomes reusable', async () => {
    const job = await batch();
    expect(await executeTravelJob(job.id, async () => {
      const page = await (await browser()).newPage();
      await page.setContent('<title>Verified worker result</title>');
      return { title: await page.title() };
    })).toBe(true);
    expect(await prisma.travelJob.findUnique({ where: { id: job.id } })).toMatchObject({ status: 'succeeded', result: { title: 'Verified worker result' } });
    expect(browsers.every(browser => !browser.isConnected())).toBe(true);
    const replacement = await acquireTravelLease('vpn'); expect(replacement).not.toBeNull();
    await releaseTravelLease(replacement!);
  }, 15_000);

  it('does not execute the same queued job twice across concurrent workers', async () => {
    const job = await batch();
    const outcomes = await Promise.all([0, 1].map(() => executeTravelJob(job.id, async () => {
      const page = await (await browser()).newPage(); await page.setContent('<title>One accepted execution</title>');
      await travelDelay(100); return { title: await page.title() };
    })));
    expect(outcomes.filter(Boolean)).toHaveLength(1);
    expect(browsers).toHaveLength(1);
    expect(await prisma.travelJob.findUnique({ where: { id: job.id } })).toMatchObject({ status: 'succeeded', attempts: 1 });
  }, 15_000);

  it('observes cancellation during browser work and releases only after the browser closes', async () => {
    const job = await batch();
    let started!: () => void;
    const ready = new Promise<void>(resolve => { started = resolve; });
    const work = executeTravelJob(job.id, async () => {
      await browser(); started(); await travelDelay(30_000); return { unaccepted: true };
    });
    const rejected = expect(work).rejects.toThrow(/cancelled/);
    await ready; await cancelTravelJob(job.id, null, true); await rejected;
    expect(await prisma.travelJob.findUnique({ where: { id: job.id } })).toMatchObject({ status: 'cancelled', result: null });
    expect(browsers.every(browser => !browser.isConnected())).toBe(true);
    expect((await getTravelAdmission()).quarantinedAt).toBeNull();
    const next = await acquireTravelLease('vpn'); expect(next).not.toBeNull(); await releaseTravelLease(next!);
  }, 15_000);

  it('closes browsers and persists quarantine after lease expiry instead of taking over automatically', async () => {
    const job = await batch();
    let started!: () => void;
    const ready = new Promise<void>(resolve => { started = resolve; });
    const work = executeTravelJob(job.id, async () => { await browser(); started(); await travelDelay(30_000); });
    const rejected = expect(work).rejects.toThrow();
    await ready;
    await prisma.travelLease.update({ where: { id: 'vpn' }, data: { expiresAt: new Date(0) } });
    await rejected;
    expect(browsers.every(browser => !browser.isConnected())).toBe(true);
    const incident = await getTravelAdmission(); expect(incident.quarantinedAt).toBeInstanceOf(Date);
    await expect(acquireTravelLease('browser')).rejects.toMatchObject({ status: 503 });
    await recoverTravelAdmission({ userId: null, isAdmin: true }, { generation: incident.recoveryGeneration, oldWorkersStopped: true, networkVerified: true });
    expect(await prisma.travelJob.findUnique({ where: { id: job.id } })).toMatchObject({ status: 'failed', result: null });
  }, 15_000);

  it('quarantines cleanup failure and retains the failed cleanup evidence', async () => {
    const job = await batch();
    await expect(executeTravelJob(job.id, async () => {
      const opened = await browser(), close = opened.close.bind(opened);
      vi.spyOn(opened, 'close').mockImplementation(async () => { await close(); throw new Error('Browser transport cleanup acknowledgement lost'); });
      return { unaccepted: true };
    })).rejects.toMatchObject({ name: 'TravelCleanupError' });
    expect((await getTravelAdmission()).quarantinedAt).toBeInstanceOf(Date);
    expect(await prisma.travelJob.findUnique({ where: { id: job.id } })).toMatchObject({ status: 'running', result: null });
    await expect(acquireTravelLease('vpn')).rejects.toMatchObject({ status: 503 });
  }, 15_000);

  it('excludes direct browsers while an admitted job owns the system-wide VPN', async () => {
    await prisma.extractionConfig.update({ where: { id: 'singleton' }, data: { vpnProvider: 'expressvpn' } });
    vi.stubEnv('EXPRESSVPN_API_URL', 'http://vpn.test'); vi.stubEnv('EXPRESSVPN_SOCKS_URL', '');
    const requests: string[] = [];
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      requests.push(url);
      if (init.method !== 'GET' || !url.endsWith('/v1/status')) throw new Error('Unexpected VPN mutation');
      return new Response('Not connected');
    });
    const job = await batch();
    await executeTravelJob(job.id, async () => {
      await browser();
      expect(await acquireTravelLease('browser')).toBeNull();
      expect((await getTravelAdmission()).systemWide).toBe(true);
    });
    expect(requests.every(url => url === 'http://vpn.test/v1/status')).toBe(true);
    expect(browsers.every(browser => !browser.isConnected())).toBe(true);
    const next = await acquireTravelLease('browser'); expect(next?.id).toBe('network'); await releaseTravelLease(next!);
  }, 15_000);
});
