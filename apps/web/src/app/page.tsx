import Link from 'next/link';
import styles from './page.module.css';
import { SearchBar } from '@/components/SearchBar';
import { ThemeToggle } from '@/components/ThemeToggle';
import { SavedTrackers } from '@/components/SavedTrackers';
import { getSessionToken, verifySessionToken } from '@/lib/admin-auth';

export default async function HomePage() {
  const token = await getSessionToken();
  const isAdmin = token ? verifySessionToken(token) : false;

  return (
    <main className={styles.root}>
      <div className={styles.topBar}>
        {isAdmin && (
          <Link href="/admin" className={styles.adminLink} title="Admin Panel">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path
                d="M8 1.5a1.25 1.25 0 0 1 1.177.824l.963 2.681 2.825.213a1.25 1.25 0 0 1 .712 2.19l-2.142 1.818.658 2.77a1.25 1.25 0 0 1-1.863 1.354L8 11.885 5.67 13.35a1.25 1.25 0 0 1-1.863-1.354l.658-2.77-2.142-1.818a1.25 1.25 0 0 1 .712-2.19l2.825-.213.963-2.681A1.25 1.25 0 0 1 8 1.5Z"
                fill="currentColor"
              />
            </svg>
          </Link>
        )}
        <ThemeToggle />
      </div>
      <div className={styles.hero}>
        <h1 className={styles.title}>Fairtrail</h1>
        <p className={styles.tagline}>
          The price trail airlines don&apos;t show you
        </p>
        <SearchBar />
        <SavedTrackers />
      </div>

      <section className={styles.why}>
        <h2 className={styles.whyTitle}>Why can&apos;t you see this data anywhere else?</h2>
        <div className={styles.reasons}>
          <div className={styles.reason}>
            <span className={styles.reasonNumber}>1</span>
            <div>
              <h3 className={styles.reasonTitle}>Aggregators want you inside their app</h3>
              <p className={styles.reasonText}>
                Google Flights, Hopper, and Kayak track price history internally &mdash;
                but lock the charts behind your account. A shareable link sends users
                to a page that isn&apos;t theirs.
              </p>
            </div>
          </div>
          <div className={styles.reason}>
            <span className={styles.reasonNumber}>2</span>
            <div>
              <h3 className={styles.reasonTitle}>&ldquo;Buy or Wait&rdquo; is more profitable than transparency</h3>
              <p className={styles.reasonText}>
                A black-box prediction keeps you dependent on their platform.
                Giving you a chart with direct airline links means they earn nothing.
              </p>
            </div>
          </div>
          <div className={styles.reason}>
            <span className={styles.reasonNumber}>3</span>
            <div>
              <h3 className={styles.reasonTitle}>Airlines don&apos;t want price transparency</h3>
              <p className={styles.reasonText}>
                If you can see that a route always dips 3 weeks before departure,
                that undermines dynamic pricing. That&apos;s why there&apos;s no public API.
              </p>
            </div>
          </div>
        </div>
      </section>

      <footer className={styles.footer}>
        <p>Fairtrail &mdash; your data, not theirs</p>
      </footer>
    </main>
  );
}
