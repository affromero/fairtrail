import { SearchBar } from '@/components/SearchBar';
import styles from './page.module.css';

export const dynamic = 'force-dynamic';

export default function AdminSearchPage() {
  return (
    <div className={styles.root}>
      <div className={styles.header}>
        <h1 className={styles.title}>Search</h1>
        <p className={styles.subtitle}>
          Describe a flight in plain English (or enter details manually). This runs the same
          flow as <code className={styles.code}>fairtrail</code> on the command line: parse,
          preview Google Flights results, pick flights, start tracking.
        </p>
      </div>

      <div className={styles.searchWrapper}>
        <SearchBar surface="admin" />
      </div>
    </div>
  );
}
