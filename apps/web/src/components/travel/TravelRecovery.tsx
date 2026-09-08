'use client';
import { useTranslations } from 'next-intl';
import { useTravelRecovery } from './useTravelRecovery';
import styles from './TravelRecovery.module.css';

export function TravelRecovery() {
  const t = useTranslations('AdminTravel'), recovery = useTravelRecovery();
  const { data, phase } = recovery, busy = phase === 'loading' || phase === 'saving';
  return <section className={styles.root} aria-label={t('title')}>
    <header className={styles.header}><div><p className={styles.eyebrow}>{t('eyebrow')}</p><h2>{t('title')}</h2></div>
      <button className={styles.secondary} type="button" disabled={busy} onClick={() => void recovery.reload()}>{t('reload')}</button></header>
    <p>{t('scope')}</p>
    {busy && <p role="status">{t(phase)}</p>}
    {['failed', 'uncertain', 'changed', 'inaccessible'].includes(phase) && <p role="alert" className={styles.warning}>{t(phase)}</p>}
    {phase === 'ready' && recovery.notice && <p role="status">{t(recovery.notice)}</p>}
    {data && <>
      <h3>{t(data.quarantinedAt ? 'paused' : 'ready')}</h3>
      {data.reason && <p className={styles.reason}>{data.reason}</p>}
      <dl className={styles.facts}><div><dt>{t('generation')}</dt><dd>{data.recoveryGeneration}</dd></div><div><dt>{t('topology')}</dt><dd>{data.topologyVersion}</dd></div>
        <div><dt>{t('network')}</dt><dd>{t(data.systemWide ? 'systemWide' : data.vpnEnabled ? 'proxy' : 'direct')}</dd></div></dl>
      {data.quarantinedAt && <p>{t('pausedAt')} <time dateTime={data.quarantinedAt}>{data.quarantinedAt.replace('T', ' ').replace('Z', ' UTC')}</time></p>}
      <details><summary>{t('resources')}</summary><ul className={styles.resources}>{data.leases.map(lease => <li key={lease.id}>
        <strong>{lease.id}</strong> · {t(lease.state)} · {t('generation')} {lease.generation}<br />{t('expires')} <time dateTime={lease.expiresAt}>{lease.expiresAt.replace('T', ' ').replace('Z', ' UTC')}</time>
      </li>)}</ul>{!data.leases.length && <p>{t('noResources')}</p>}</details>
      {data.quarantinedAt && <div className={styles.confirmation}><p>{t('consequences')}</p>
        <label><input type="checkbox" checked={recovery.stopped} disabled={phase !== 'ready'} onChange={event => recovery.confirm('stopped', event.target.checked)} />{t('stopped')}</label>
        <label><input type="checkbox" checked={recovery.network} disabled={phase !== 'ready'} onChange={event => recovery.confirm('network', event.target.checked)} />{t('verified')}</label>
        <p className={styles.hint}>{t('manual')}</p>
        <button className={styles.button} type="button" disabled={phase !== 'ready' || !recovery.stopped || !recovery.network} onClick={() => void recovery.recover()}>{t('recover')}</button>
      </div>}
    </>}
  </section>;
}
