'use client';

import { useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';

export function ClientBeacon() {
  const pathname = usePathname();
  const startTimeRef = useRef(Date.now());
  const maxScrollRef = useRef(0);

  useEffect(() => {
    startTimeRef.current = Date.now();
    maxScrollRef.current = 0;

    function handleScroll() {
      const scrollHeight = document.documentElement.scrollHeight - window.innerHeight;
      if (scrollHeight > 0) {
        const depth = window.scrollY / scrollHeight;
        maxScrollRef.current = Math.max(maxScrollRef.current, Math.min(depth, 1));
      }
    }

    function sendBeacon() {
      if (document.visibilityState === 'hidden') {
        const duration = Date.now() - startTimeRef.current;
        const scrollDepth = Math.round(maxScrollRef.current * 100) / 100;

        navigator.sendBeacon(
          '/api/analytics/event',
          JSON.stringify({ path: pathname, duration, scrollDepth }),
        );
      }
    }

    window.addEventListener('scroll', handleScroll, { passive: true });
    document.addEventListener('visibilitychange', sendBeacon);

    return () => {
      window.removeEventListener('scroll', handleScroll);
      document.removeEventListener('visibilitychange', sendBeacon);
    };
  }, [pathname]);

  return null;
}
