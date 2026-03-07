'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ThemeToggle } from '@/components/ThemeToggle';
import styles from './layout.module.css';

const NAV_ITEMS = [
  { href: '/admin', label: 'Dashboard' },
  { href: '/admin/queries', label: 'Queries' },
  { href: '/admin/seed-routes', label: 'Seed Routes' },
  { href: '/admin/insights', label: 'Insights' },
  { href: '/admin/analytics', label: 'Analytics' },
  { href: '/admin/config', label: 'Config' },
];

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  const handleLogout = async () => {
    await fetch('/api/admin/auth/logout', { method: 'POST' });
    window.location.href = '/admin/login';
  };

  return (
    <div className={styles.root}>
      <nav className={styles.nav}>
        <Link href="/" className={styles.brand}>Fairtrail</Link>
        <div className={styles.links}>
          {NAV_ITEMS.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={`${styles.link} ${pathname === item.href ? styles.active : ''}`}
            >
              {item.label}
            </Link>
          ))}
        </div>
        <ThemeToggle />
        <button className={styles.logout} onClick={handleLogout}>
          Logout
        </button>
      </nav>
      <main className={styles.main}>{children}</main>
    </div>
  );
}
