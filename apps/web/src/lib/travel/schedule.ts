import { prisma } from '@/lib/prisma';
import { refreshCarTracker } from '../cars/store';
import { reconcileHotelJobs, scheduleDueHotels } from '../hotels/runner';
import { deliverHotelAlerts } from '../hotels/alerts';
import { pumpTravelJobs } from './coordinator';
import { expireQueuedPreviews } from './preview';

const runtime = globalThis as typeof globalThis & { travelTimer?: ReturnType<typeof setTimeout>; travelPump?: Promise<void> };

async function scheduleDueCars(): Promise<void> {
  const due = await prisma.carTracker.findMany({ where: { active: true, nextCheckAt: { lte: new Date() } }, orderBy: { nextCheckAt: 'asc' }, take: 20 });
  for (const tracker of due) {
    try { await refreshCarTracker(tracker.id, { userId: tracker.userId, isAdmin: true }, true); }
    catch (error) {
      console.error('[cars] Scheduled check could not be queued:', error);
      await prisma.carTracker.updateMany({ where: { id: tracker.id, revision: tracker.revision }, data: { lastError: 'Scheduled check could not start; review rental dates and settings.', nextCheckAt: new Date(Date.now() + 3_600_000) } });
    }
  }
}

async function pump(): Promise<void> {
  await expireQueuedPreviews();
  const config = await prisma.extractionConfig.findUnique({ where: { id: 'singleton' }, select: { enabled: true } });
  if (config?.enabled === false) return;
  if (process.env.SELF_HOSTED === 'true') {
    await reconcileHotelJobs();
    await scheduleDueHotels();
    await scheduleDueCars();
  }
  await pumpTravelJobs();
  if (process.env.SELF_HOSTED === 'true') await deliverHotelAlerts();
}
export async function runTravelJobsSafely(): Promise<void> {
  if (runtime.travelPump) return runtime.travelPump;
  runtime.travelPump = pump().catch(error => { console.error('[travel] Scheduled worker failed:', error); }).finally(() => { runtime.travelPump = undefined; });
  return runtime.travelPump;
}
export function startTravelScheduler(): void {
  if (process.env.CRON_ENABLED === 'false' || runtime.travelTimer) return;
  const tick = async () => {
    await runTravelJobsSafely();
    runtime.travelTimer = setTimeout(() => { void tick(); }, 60_000);
    runtime.travelTimer.unref();
  };
  runtime.travelTimer = setTimeout(() => { void tick(); }, 1000);
  runtime.travelTimer.unref();
}
