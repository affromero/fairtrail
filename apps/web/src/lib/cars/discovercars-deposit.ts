import { parseCarMoney } from './money';
import type { CarMoney } from './types';

/** Empty arrays and absent metadata are unknown, not zero-deposit offers. */
export function discoverCarsFixedDeposit(raw: unknown): CarMoney | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const value = raw as Record<string, unknown>;
  if (value.type !== 'fixed' || typeof value.currency !== 'string' || (typeof value.amount !== 'number' && typeof value.amount !== 'string')) return null;
  try { return parseCarMoney(String(value.amount), value.currency); } catch { return null; }
}
