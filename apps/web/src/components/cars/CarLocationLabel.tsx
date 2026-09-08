'use client';
import { useTranslations } from 'next-intl';
import type { CarLocation, CarSource } from '@/lib/cars/types';
import { carProviderLocationLabels } from '@/lib/cars/location-labels';
import { CAR_PROVIDER_LABELS } from '@/lib/cars/preferences';
import styles from './Cars.module.css';

export function CarLocationLabel({ location, sources }: { location: CarLocation; sources: readonly CarSource[] }) {
  const t = useTranslations('Cars');
  return <>{location.name}{carProviderLocationLabels(location, sources).map(({ source, name }) =>
    <span key={source} className={styles.providerLocation}>{t('providerLocation', { provider: CAR_PROVIDER_LABELS[source], name })}</span>)}</>;
}
