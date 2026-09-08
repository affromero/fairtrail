import type { Page } from 'playwright';

export interface TravelNavigationGuard {
  reset(): void;
  status(): number;
  settle(): Promise<void>;
}

const guards = new WeakMap<Page, { policy: string; guard: TravelNavigationGuard }>();

/** Fetches redirect hops individually so an allowed origin cannot redirect into a private network. */
export async function guardTravelNavigation(page: Page, policy: string, allowed: (url: URL) => boolean): Promise<TravelNavigationGuard> {
  const existing = guards.get(page);
  if (existing) {
    if (existing.policy !== policy) throw new Error('A browser page cannot change its navigation security policy');
    return existing.guard;
  }
  let redirects = 0;
  let finalStatus = 0;
  const guard: TravelNavigationGuard = {
    reset() { redirects = 0; finalStatus = 0; },
    status() { return finalStatus; },
    async settle() {
      await page.waitForFunction(() => !document.documentElement.hasAttribute('data-travel-redirect'), undefined, { timeout: 45_000 });
      if (finalStatus >= 400) throw new Error(`Provider returned HTTP ${finalStatus}`);
    },
  };
  await page.route('**/*', async route => {
    const request = route.request();
    if (!request.isNavigationRequest() || request.frame() !== page.mainFrame()) return route.fallback();
    const destination = new URL(request.url());
    if (!allowed(destination)) return route.abort('blockedbyclient');
    const response = await route.fetch({ maxRedirects: 0, timeout: 45_000 }).catch(() => null);
    if (!response) return route.abort('failed');
    finalStatus = response.status();
    const location = response.headers().location;
    if (![301, 302, 303, 307, 308].includes(finalStatus) || !location) return route.fulfill({ response });
    let next: URL;
    try { next = new URL(location, destination); } catch { return route.abort('blockedbyclient'); }
    if (!allowed(next) || ++redirects > 10 || ([307, 308].includes(finalStatus) && request.method() !== 'GET')) return route.abort('blockedbyclient');
    const target = JSON.stringify(next.href).replaceAll('<', '\\u003c');
    return route.fulfill({ status: 200, contentType: 'text/html', body: `<html data-travel-redirect="pending"><script>location.replace(${target})</script></html>` });
  });
  guards.set(page, { policy, guard });
  return guard;
}
