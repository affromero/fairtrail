import { notFound, redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { carActor } from '@/lib/cars/access';
import { getCarRunView } from '@/lib/cars/views';
import { CarError } from '@/lib/cars/types';
import { CarSearchStatus } from '@/components/cars/CarSearchStatus';
import { ThemeToggle } from '@/components/ThemeToggle';
import styles from '@/components/cars/Cars.module.css';

export const dynamic = 'force-dynamic';
export const metadata = { robots: { index: false, follow: false } };
export default async function CarSearchPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const data = await (async () => {
    try {
      const actor = await carActor(), run = await getCarRunView(id, actor);
      if (run.trackerId !== null) notFound();
      return { actor, run };
    } catch (error) {
      if (error instanceof CarError && error.status === 401) redirect(`/login?next=${encodeURIComponent(`/cars/search/${id}`)}`);
      if (error instanceof CarError && error.status === 404) notFound();
      throw error;
    }
  })();
  const t = await getTranslations('Cars');
  return <main className={styles.page}><ThemeToggle /><header className={styles.pageHeader}><p className={styles.eyebrow}>Flight Finder</p><h1>{t('searchTitle')}</h1></header><CarSearchStatus key={`${data.actor.userId ?? 'single'}:${id}`} initial={data.run} actorScope={data.actor.userId ?? 'single'} /></main>;
}
