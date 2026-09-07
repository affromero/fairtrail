import { createHash } from 'node:crypto';
import { CarClient, CarScopeError } from './car-client.js';
import { validateCarRunView } from '../../../../apps/web/src/lib/cars/run-view.js';
import { assessCarPrice } from '../../../../apps/web/src/lib/cars/pricing.js';
import { assertCarProtectionRecheck } from '../../../../apps/web/src/lib/cars/protection-recheck.js';

/** Review identities acknowledge exact observed content; the server still authorizes every mutation. */
export async function readCarOfferReview(client: CarClient, searchId: string, offerId: string, signal?: AbortSignal) {
  if (!/^[A-Za-z0-9_-]{1,200}$/.test(searchId)) throw new Error('Choose a valid rental search identity');
  const before = await client.getSession(signal);
  const run = validateCarRunView(await client.request(`/api/cars/search/${searchId}`, { signal }), searchId, true);
  const after = await client.getSession(signal);
  if (before.scope !== after.scope) throw new CarScopeError();
  signal?.throwIfAborted();
  const offer = run.result?.offers.find(offer => offer.id === offerId);
  if (!offer) throw new Error('Choose an offer returned by this rental search');
  const complete = ['success', 'partial'].includes(run.status), protectedQuote = Boolean(run.search.protectionRecheck);
  if (protectedQuote) assertCarProtectionRecheck(offer, run.search);
  const assessment = assessCarPrice(offer, run.search);
  const canTrack = complete && !run.trackingClosed && assessment.eligible;
  const canRecheck = complete && !run.trackingClosed && !protectedQuote && !run.search.extras.protection.length
    && assessCarPrice(offer, run.search, new Date(run.completedAt!)).eligible;
  const hash = (kind: string, content: unknown) => createHash('sha256').update(JSON.stringify({
    kind, origin: client.origin, scope: before.scope, searchId, offerId, search: run.search, offer, content,
  })).digest('hex');
  const discovery = run.result?.protection?.find(entry => entry.offerId === offerId);
  return {
    scope: before.scope, origin: client.origin, searchId, offerId, status: run.status, trackingClosed: run.trackingClosed,
    search: run.search, offer, assessment, canTrack, canRecheck, protectedQuote,
    discovery: discovery ? { ...discovery, choices: discovery.choices.map(choice => ({ ...choice,
      review: canRecheck && discovery.status === 'complete' ? hash('car-protection-choice-v1', choice) : null,
    })) } : null,
    trackingReview: protectedQuote && canTrack ? hash('car-protection-track-v1', null) : null,
  };
}

export function requireCarReview(expected: string | null | undefined, supplied: string | undefined) {
  if (!expected || supplied !== expected) throw new Error('Review the current terms and total with cars protection, then supply its exact review identity');
}
