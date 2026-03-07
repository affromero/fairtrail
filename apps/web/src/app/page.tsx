import styles from './page.module.css';
import { SearchBar } from '@/components/SearchBar';

export default function HomePage() {
  return (
    <main className={styles.root}>
      <div className={styles.hero}>
        <h1 className={styles.title}>Fairtrail</h1>
        <p className={styles.tagline}>
          The price trail airlines don&apos;t show you
        </p>
        <SearchBar />
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
