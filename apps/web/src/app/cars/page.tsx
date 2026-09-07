import { notFound, redirect } from 'next/navigation';
import { randomUUID } from 'node:crypto';
import { getLocale, getTranslations } from 'next-intl/server';
import { carActor } from '@/lib/cars/access';
import { CarError } from '@/lib/cars/types';
import { CarTrackers } from '@/components/cars/CarTrackers';
import { CarSearchForm } from '@/components/cars/CarSearchForm';
import { prisma } from '@/lib/prisma';
import { effectiveCarProviders } from '@/lib/cars/preferences';
import { carFormOptions } from '@/lib/cars/form-options';
import { CarRecentSearches } from '@/components/cars/CarRecentSearches';
import { CarPrivateBoundary } from '@/components/cars/CarPrivateBoundary';
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
  const [user, config] = await Promise.all([
    actor.userId ? prisma.user.findUniqueOrThrow({ where: { id: actor.userId }, select: { defaultCurrency: true, preferredCarProviders: true } }) : null,
    prisma.extractionConfig.findUnique({ where: { id: 'singleton' }, select: { defaultCurrency: true } }),
  ]);
  const scope = actor.userId ?? 'single';
  const options = carFormOptions(await getLocale());
  return <main className={styles.page}><ThemeToggle /><TravelNav active="cars" /><header className={styles.pageHeader}><p className={styles.eyebrow}>Flight Finder</p><h1>{t('carsTitle')}</h1></header><CarPrivateBoundary key={randomUUID()}><CarSearchForm actorScope={scope} defaultCurrency={user?.defaultCurrency ?? config?.defaultCurrency ?? 'USD'} defaultSources={effectiveCarProviders(user?.preferredCarProviders ?? [])} options={options} /><CarRecentSearches /><CarTrackers /></CarPrivateBoundary></main>;
}
