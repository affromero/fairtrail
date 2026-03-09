'use client';

import { useEffect, useState } from 'react';
import styles from '@/app/page.module.css';

export function DemoGif() {
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');

  useEffect(() => {
    const el = document.documentElement;
    setTheme((el.getAttribute('data-theme') as 'dark' | 'light') ?? 'dark');

    const observer = new MutationObserver(() => {
      setTheme((el.getAttribute('data-theme') as 'dark' | 'light') ?? 'dark');
    });
    observer.observe(el, { attributes: true, attributeFilter: ['data-theme'] });
    return () => observer.disconnect();
  }, []);

  return (
    <img
      src={theme === 'light' ? '/demo-light.gif' : '/demo-dark.gif'}
      alt="Price evolution charts — JFK to Paris, LAX to Tokyo, Chicago to Rome"
      className={styles.demoImg}
      width={1280}
      height={900}
      loading="eager"
    />
  );
}
