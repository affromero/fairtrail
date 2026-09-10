/** Exact marker emitted by the old preview-only sum of two one-way fares. */
const LEGACY_SPLIT_FARE_SUFFIX = ' (approx OW+OW)';

export function isLegacySplitFare(airline: unknown): boolean {
  return typeof airline === 'string' && airline.endsWith(LEGACY_SPLIT_FARE_SUFFIX);
}

/** Apply before database aggregation or pagination of actual flight fares. */
export const ACTUAL_FLIGHT_FARE_WHERE = {
  NOT: { airline: { endsWith: LEGACY_SPLIT_FARE_SUFFIX } },
};

export const LEGACY_SPLIT_PREVIEW_ERROR =
  'This preview contains separate one-way estimates. Search again for round-trip fares.';
