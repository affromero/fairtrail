import { prisma } from '@/lib/prisma';
import { QueryRow } from './QueryRow';
import styles from './page.module.css';

export const dynamic = 'force-dynamic';

export default async function QueriesPage() {
  const queries = await prisma.query.findMany({
    orderBy: { createdAt: 'desc' },
    include: {
      _count: { select: { snapshots: true, fetchRuns: true } },
    },
  });

  return (
    <div className={styles.root}>
      <h1 className={styles.title}>Tracked Queries</h1>

      {queries.length === 0 ? (
        <p className={styles.empty}>
          No queries yet. Go to the <a href="/">home page</a> to create one.
        </p>
      ) : (
        <div className={styles.list}>
          {queries.map((q) => (
            <QueryRow
              key={q.id}
              query={{
                id: q.id,
                origin: q.origin,
                originName: q.originName,
                destination: q.destination,
                destinationName: q.destinationName,
                dateFrom: q.dateFrom.toISOString(),
                dateTo: q.dateTo.toISOString(),
                active: q.active,
                expiresAt: q.expiresAt.toISOString(),
                scrapeInterval: q.scrapeInterval,
                snapshotCount: q._count.snapshots,
                runCount: q._count.fetchRuns,
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}
