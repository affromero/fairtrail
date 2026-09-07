import type { ChannelMessage } from '../notifications/channels/types';
import { formatCarMoney, validateCarMoney } from './money';
import { carProviderUrl } from './offer-validation';
import type { CarMoney, CarOffer } from './types';

export interface CarAlertState { targetArmed: boolean; historicalLowMinor: number | null }
export interface CarAlertOutcome { target: boolean; low: boolean; state: CarAlertState }

export function evaluateCarAlerts(state: CarAlertState, target: CarMoney | null, notifyLows: boolean, price: CarMoney | null, complete: boolean): CarAlertOutcome {
  if (price === null) return { target: false, low: false, state };
  validateCarMoney(price);
  if (target) validateCarMoney(target, price.currency);
  if (state.historicalLowMinor !== null) validateCarMoney({ currency: price.currency, minor: state.historicalLowMinor });
  if (price.minor === 0) return { target: false, low: false, state };
  const reached = target !== null && price.minor <= target.minor && state.targetArmed;
  const low = notifyLows && state.historicalLowMinor !== null && price.minor < state.historicalLowMinor;
  return {
    target: reached, low,
    state: { targetArmed: reached ? false : complete && target !== null && price.minor > target.minor ? true : state.targetArmed, historicalLowMinor: state.historicalLowMinor === null ? price.minor : Math.min(state.historicalLowMinor, price.minor) },
  };
}

export function carAlertMessage(tracker: { id: string; label: string; revision: number; userId: string | null }, offer: CarOffer, price: CarMoney, outcome: CarAlertOutcome): ChannelMessage {
  const title = outcome.target && outcome.low ? 'Car target reached and new low' : outcome.target ? 'Car target reached' : 'New car low';
  return {
    title: `${title}: ${tracker.label}`,
    body: `${offer.supplier}: ${formatCarMoney(price)} total including verified taxes and selected extras. ${offer.contract.pickupAt.date} ${offer.contract.pickupAt.time} to ${offer.contract.dropoffAt.date} ${offer.contract.dropoffAt.time}, station-local times. Lowest verified matching price among checked offers, not the entire market. Review supplier requirements before booking.`,
    url: carProviderUrl(offer.bookingUrl, offer.contract.source),
    data: { trackerId: tracker.id, trackerRevision: tracker.revision, userId: tracker.userId, source: offer.contract.source, totalMinor: price.minor, currency: price.currency, target: outcome.target, newLow: outcome.low },
  };
}
