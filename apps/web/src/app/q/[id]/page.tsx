import { notFound } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import { PriceChart } from '@/components/PriceChart';
import { BestPrice } from '@/components/BestPrice';
import { PriceHistory } from '@/components/PriceHistory';
import { ThemeToggle } from '@/components/ThemeToggle';
import styles from './page.module.css';

interface Props {
  params: Promise<{ id: string }>;
}

function formatDate(d: Date): string {
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function daysUntil(d: Date): number {
  return Math.max(0, Math.ceil((d.getTime() - Date.now()) / (1000 * 60 * 60 * 24)));
}

export default async function ChartPage({ params }: Props) {
  const { id } = await params;

  const query = await prisma.query.findUnique({
    where: { id },
  });

  if (!query) notFound();

  // Mark first view for 24h auto-cleanup
  if (!query.firstViewedAt) {
    await prisma.query.update({
      where: { id },
      data: { firstViewedAt: new Date() },
    });
  }

  const expired = new Date() > query.expiresAt;
  const daysLeft = daysUntil(query.expiresAt);

  const snapshots = await prisma.priceSnapshot.findMany({
    where: { queryId: id },
    orderBy: { scrapedAt: 'asc' },
    select: {
      id: true,
      travelDate: true,
      price: true,
      currency: true,
      airline: true,
      bookingUrl: true,
      stops: true,
      duration: true,
      scrapedAt: true,
    },
  });

  const lastRun = await prisma.fetchRun.findFirst({
    where: { queryId: id },
    orderBy: { startedAt: 'desc' },
    select: { startedAt: true },
  });

  const serialized = snapshots.map((s) => ({
    ...s,
    travelDate: s.travelDate.toISOString(),
    scrapedAt: s.scrapedAt.toISOString(),
  }));

  return (
    <main className={styles.root}>
      <div className={styles.themeToggle}>
        <ThemeToggle />
      </div>
      <header className={styles.header}>
        <div className={styles.route}>
          <span className={styles.code}>{query.origin}</span>
          <span className={styles.arrow}>→</span>
          <span className={styles.code}>{query.destination}</span>
        </div>
        <div className={styles.meta}>
          <span>{query.originName} to {query.destinationName}</span>
          <span className={styles.sep}>·</span>
          <span>{formatDate(query.dateFrom)} — {formatDate(query.dateTo)}</span>
          {query.flexibility > 0 && (
            <>
              <span className={styles.sep}>·</span>
              <span>±{query.flexibility}d</span>
            </>
          )}
        </div>
        <div className={styles.expiry}>
          {expired ? (
            <span className={styles.expiredBadge}>Expired</span>
          ) : (
            <span className={styles.activeBadge}>Expires in {daysLeft}d</span>
          )}
        </div>
      </header>

      {expired ? (
        <div className={styles.expiredNotice}>
          <p>This tracker expired on {formatDate(query.expiresAt)}.</p>
          <p>The data below is a snapshot of prices collected during the tracking period.</p>
        </div>
      ) : null}

      <section className={styles.chart}>
        <PriceChart snapshots={serialized} />
      </section>

      <section className={styles.best}>
        <BestPrice snapshots={serialized} />
      </section>

      <section className={styles.history}>
        <PriceHistory snapshots={serialized} />
      </section>

      <footer className={styles.footer}>
        <p>
          Tracked since {formatDate(query.createdAt)}
          {lastRun && ` · Last checked ${timeAgo(lastRun.startedAt)}`}
        </p>
        <p>
          <a href="/">Fairtrail</a> — your data, not theirs
        </p>
      </footer>
    </main>
  );
}

function timeAgo(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
