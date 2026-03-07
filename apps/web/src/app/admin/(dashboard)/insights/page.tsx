import { computeInsights } from '@/lib/stats/airline-reliability';
import styles from './page.module.css';

export const dynamic = 'force-dynamic';

const TREND_ARROWS: Record<string, string> = {
  rising: '↑',
  falling: '↓',
  stable: '→',
};

function stabilityLabel(cov: number): string {
  if (cov < 0.05) return 'Very Stable';
  if (cov < 0.15) return 'Stable';
  if (cov < 0.3) return 'Moderate';
  return 'Volatile';
}

function stabilityClass(cov: number): string {
  if (cov < 0.05) return styles.stabilityGood ?? '';
  if (cov < 0.15) return styles.stabilityOk ?? '';
  if (cov < 0.3) return styles.stabilityWarn ?? '';
  return styles.stabilityBad ?? '';
}

export default async function InsightsPage() {
  const data = await computeInsights(30);

  return (
    <div className={styles.root}>
      <h1 className={styles.title}>Airline Insights</h1>
      <p className={styles.description}>
        Pricing reliability metrics computed from seed route data (last 30 days).
      </p>

      <div className={styles.stats}>
        <div className={styles.stat}>
          <span className={styles.statValue}>{data.totalSeedRoutes}</span>
          <span className={styles.statLabel}>Seed Routes</span>
        </div>
        <div className={styles.stat}>
          <span className={styles.statValue}>{data.totalSnapshots}</span>
          <span className={styles.statLabel}>Price Points</span>
        </div>
        <div className={styles.stat}>
          <span className={styles.statValue}>{data.totalAirlines}</span>
          <span className={styles.statLabel}>Airlines Tracked</span>
        </div>
      </div>

      {data.routes.length === 0 ? (
        <p className={styles.empty}>
          No seed routes configured yet. <a href="/admin/seed-routes">Add seed routes</a> to start collecting data.
        </p>
      ) : (
        data.routes.map((route) => (
          <div key={route.route} className={styles.routeCard}>
            <div className={styles.routeHeader}>
              <div className={styles.routeCodes}>
                <span className={styles.routeCode}>{route.origin}</span>
                <span className={styles.routeArrow}>→</span>
                <span className={styles.routeCode}>{route.destination}</span>
              </div>
              <span className={styles.routeNames}>
                {route.originName} → {route.destinationName}
              </span>
            </div>

            {route.airlines.length === 0 ? (
              <p className={styles.noData}>No price data yet. Waiting for first scrape.</p>
            ) : (
              <>
                <div className={styles.routeSummary}>
                  <span>Cheapest: <strong>{route.cheapestAirline}</strong></span>
                  <span className={styles.rowSep}>·</span>
                  <span>Most stable: <strong>{route.mostStableAirline}</strong></span>
                  <span className={styles.rowSep}>·</span>
                  <span>{route.totalSnapshots} data points</span>
                </div>

                <div className={styles.tableWrapper}>
                  <table className={styles.table}>
                    <thead>
                      <tr>
                        <th>Rank</th>
                        <th>Airline</th>
                        <th>Avg Price</th>
                        <th>Min</th>
                        <th>Max</th>
                        <th>Stability</th>
                        <th>Trend</th>
                        <th>Samples</th>
                      </tr>
                    </thead>
                    <tbody>
                      {route.airlines.map((a) => (
                        <tr key={a.airline}>
                          <td className={styles.mono}>#{a.competitiveRank}</td>
                          <td className={styles.airlineName}>{a.airline}</td>
                          <td className={styles.mono}>${a.avgPrice}</td>
                          <td className={styles.mono}>${a.minPrice}</td>
                          <td className={styles.mono}>${a.maxPrice}</td>
                          <td>
                            <span className={stabilityClass(a.stability)}>
                              {stabilityLabel(a.stability)}
                            </span>
                          </td>
                          <td className={`${styles.mono} ${a.trend === 'rising' ? styles.trendUp : a.trend === 'falling' ? styles.trendDown : styles.trendFlat}`}>
                            {TREND_ARROWS[a.trend]} {a.trend}
                          </td>
                          <td className={styles.mono}>{a.snapshotCount}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>
        ))
      )}
    </div>
  );
}
