import { CronJob } from 'cron';

let cronJob: CronJob | null = null;

export function startCron() {
  if (process.env.CRON_ENABLED === 'false') {
    console.log('[cron] Disabled via CRON_ENABLED=false');
    return;
  }

  const intervalHours = Math.max(1, parseInt(process.env.CRON_INTERVAL_HOURS ?? '3', 10));
  const cronExpression = `0 */${intervalHours} * * *`;

  cronJob = new CronJob(cronExpression, async () => {
    console.log(`[cron] Starting scheduled scrape...`);
    try {
      // Dynamic import to avoid circular dependencies at startup
      const { runScrapeAll, cleanupUnvisitedQueries } = await import('./scraper/run-scrape');

      await cleanupUnvisitedQueries();
      const results = await runScrapeAll();

      const successful = results.filter((r) => r.status === 'success').length;
      const failed = results.filter((r) => r.status === 'failed').length;
      const snapshots = results.reduce((sum, r) => sum + r.snapshotsCount, 0);
      console.log(`[cron] Scrape complete: ${successful} ok, ${failed} failed, ${snapshots} snapshots`);
    } catch (err) {
      console.error('[cron] Scrape failed:', err instanceof Error ? err.message : err);
    }
  });

  cronJob.start();
  console.log(`[cron] Scheduled every ${intervalHours}h (${cronExpression}), next: ${cronJob.nextDate().toISO()}`);
}

export function stopCron() {
  if (cronJob) {
    cronJob.stop();
    cronJob = null;
    console.log('[cron] Stopped');
  }
}
