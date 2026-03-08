'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ThemeToggle } from '@/components/ThemeToggle';
import styles from './layout.module.css';

const ALL_NAV_ITEMS = [
  { href: '/admin', label: 'Dashboard', selfHosted: true },
  { href: '/admin/queries', label: 'Queries', selfHosted: true },
  { href: '/admin/seed-routes', label: 'Seed Routes', selfHosted: false },
  { href: '/admin/insights', label: 'Insights', selfHosted: true },
  { href: '/admin/analytics', label: 'Analytics', selfHosted: false },
  { href: '/admin/config', label: 'Config', selfHosted: true },
];

export function DashboardNav({
  isSelfHosted,
  children,
}: {
  isSelfHosted: boolean;
  children: React.ReactNode;
}) {
  const pathname = usePathname();

  const navItems = isSelfHosted
    ? ALL_NAV_ITEMS.filter((item) => item.selfHosted)
    : ALL_NAV_ITEMS;

  const handleLogout = async () => {
    await fetch('/api/admin/auth/logout', { method: 'POST' });
    window.location.href = '/admin/login';
  };

  return (
    <div className={styles.root}>
      <nav className={styles.nav}>
        <Link href="/" className={styles.brand}>Fairtrail</Link>
        <div className={styles.links}>
          {navItems.map((item) => (
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
        {!isSelfHosted && (
          <button className={styles.logout} onClick={handleLogout}>
            Logout
          </button>
        )}
      </nav>
      <main className={styles.main}>{children}</main>
    </div>
  );
}
