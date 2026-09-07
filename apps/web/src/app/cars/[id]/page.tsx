import { notFound, redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { carActor } from '@/lib/cars/access';
import { getCarDetail } from '@/lib/cars/views';
import { CarError } from '@/lib/cars/types';
import { CarTrackerStatus } from '@/components/cars/CarTrackerStatus';
import { ThemeToggle } from '@/components/ThemeToggle';
import styles from '@/components/cars/Cars.module.css';

export const dynamic = 'force-dynamic';
export const metadata = { robots: { index: false, follow: false } };
export default async function CarTrackerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const data = await (async () => {
    try {
      const actor = await carActor();
      return { actor, detail: await getCarDetail(id, actor) };
    } catch (error) {
      if (error instanceof CarError && error.status === 401) redirect(`/login?next=${encodeURIComponent(`/cars/${id}`)}`);
      if (error instanceof CarError && error.status === 404) notFound();
      throw error;
    }
  })();
  const t = await getTranslations('Cars');
  return <main className={styles.page}><ThemeToggle /><header className={styles.pageHeader}><p className={styles.eyebrow}>Flight Finder</p><h1>{t('trackerTitle')}</h1></header><CarTrackerStatus key={`${data.actor.userId ?? 'single'}:${id}`} initial={data.detail} actorScope={data.actor.userId ?? 'single'} /></main>;
}
