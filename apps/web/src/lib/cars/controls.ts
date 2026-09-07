import type { Locator } from 'playwright';
import { CarError } from './types';

/** A provider can render controls before their browser event handlers are ready. */
export async function openCarControl(trigger: Locator, content: Locator): Promise<void> {
  for (let attempt = 0; attempt < 5; attempt++) {
    if (await content.isVisible()) return;
    await trigger.click();
    try { await content.waitFor({ state: 'visible', timeout: 1000 }); return; }
    catch { /* Retry only while the requested control remains closed. */ }
  }
  throw new CarError('Provider search controls did not become interactive');
}
