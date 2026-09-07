import { notFound, redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { carActor } from '@/lib/cars/access';
import { CarError } from '@/lib/cars/types';
import { CarTrackers } from '@/components/cars/CarTrackers';
import { TravelNav } from '@/components/hotels/TravelNav';
import { ThemeToggle } from '@/components/ThemeToggle';
import styles from '@/components/cars/Cars.module.css';

export const dynamic = 'force-dynamic';
export const metadata = { robots: { index: false, follow: false } };
export default async function CarsPage() {
  const actor = await (async () => {
    try { return await carActor(); }
    catch (error) {
      if (error instanceof CarError && error.status === 401) redirect('/login?next=/cars');
      if (error instanceof CarError && error.status === 404) notFound();
      throw error;
    }
  })();
  const t = await getTranslations('Cars');
  return <main className={styles.page}><ThemeToggle /><TravelNav active="cars" /><header className={styles.pageHeader}><p className={styles.eyebrow}>Flight Finder</p><h1>{t('carsTitle')}</h1></header><CarTrackers key={actor.userId ?? 'single'} /></main>;
}
