import { prisma } from '@/lib/prisma';
import styles from './page.module.css';

export const dynamic = 'force-dynamic';

export default async function AdminDashboard() {
  const [activeQueries, totalRuns, recentRuns, costData] = await Promise.all([
    prisma.query.count({ where: { active: true, expiresAt: { gt: new Date() } } }),
    prisma.fetchRun.count(),
    prisma.fetchRun.findMany({
      orderBy: { startedAt: 'desc' },
      take: 10,
      include: { query: { select: { origin: true, destination: true } } },
    }),
    prisma.apiUsageLog.aggregate({
      _sum: { costUsd: true },
      where: { createdAt: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) } },
    }),
  ]);

  const monthlyCost = costData._sum.costUsd ?? 0;

  return (
    <div className={styles.root}>
      <h1 className={styles.title}>Dashboard</h1>

      <div className={styles.stats}>
        <div className={styles.stat}>
          <span className={styles.statValue}>{activeQueries}</span>
          <span className={styles.statLabel}>Active Queries</span>
        </div>
        <div className={styles.stat}>
          <span className={styles.statValue}>{totalRuns}</span>
          <span className={styles.statLabel}>Total Scrapes</span>
        </div>
        <div className={styles.stat}>
          <span className={styles.statValue}>${monthlyCost.toFixed(2)}</span>
          <span className={styles.statLabel}>LLM Cost (30d)</span>
        </div>
      </div>

      <h2 className={styles.sectionTitle}>Recent Runs</h2>
      {recentRuns.length === 0 ? (
        <p className={styles.empty}>No scrape runs yet</p>
      ) : (
        <div className={styles.tableWrapper}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Time</th>
                <th>Route</th>
                <th>Status</th>
                <th>Snapshots</th>
                <th>Cost</th>
              </tr>
            </thead>
            <tbody>
              {recentRuns.map((run) => (
                <tr key={run.id}>
                  <td className={styles.mono}>
                    {run.startedAt.toLocaleDateString('en-US', {
                      month: 'short',
                      day: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </td>
                  <td>{run.query.origin} → {run.query.destination}</td>
                  <td>
                    <span className={run.status === 'success' ? styles.statusOk : run.status === 'failed' ? styles.statusFail : styles.statusWarn}>
                      {run.status}
                    </span>
                  </td>
                  <td className={styles.mono}>{run.snapshotsCount}</td>
                  <td className={styles.mono}>${(run.extractionCost ?? 0).toFixed(4)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
