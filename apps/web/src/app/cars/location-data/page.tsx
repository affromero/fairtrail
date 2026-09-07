import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { carLocationDataPath } from '@/lib/cars/locations';
import styles from '@/components/cars/Cars.module.css';

export default async function CarLocationDataPage() {
  const t = await getTranslations('Cars');
  const attribution = await readFile(join(await carLocationDataPath(), 'ATTRIBUTION.txt'), 'utf8');
  return <main className={styles.page}><Link href="/cars">{t('carsNav')}</Link><h1>{t('Search.locationAttribution')}</h1><p className={styles.evidenceText}>{attribution}</p><a href="/api/cars/location-data">catalog.json.gz</a></main>;
}
