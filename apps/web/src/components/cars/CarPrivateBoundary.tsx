'use client';
import Link from 'next/link';
import { useEffect, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { TRAVEL_ACCESS_LOST_EVENT } from '../travel/client';
import styles from './Cars.module.css';

/** Only a fresh server-authorized key may remount and reveal private children. */
export function CarPrivateBoundary({ children }: { children: ReactNode }) {
  const [hidden, setHidden] = useState(false), router = useRouter(), t = useTranslations('Cars');
  useEffect(() => {
    const hide = () => setHidden(true);
    window.addEventListener(TRAVEL_ACCESS_LOST_EVENT, hide);
    return () => window.removeEventListener(TRAVEL_ACCESS_LOST_EVENT, hide);
  }, []);
  if (!hidden) return children;
  return <div role="alert" className={styles.error}><p>{t('accessLost')}</p><div className={styles.actions}><Link className={styles.secondary} href="/login?next=%2Fcars">{t('signIn')}</Link><button className={styles.secondary} type="button" onClick={() => router.refresh()}>{t('retryStatus')}</button></div></div>;
}
