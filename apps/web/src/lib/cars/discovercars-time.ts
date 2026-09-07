import { CarError, type CarLocalTime } from './types';

/** Provider timestamps carry a server offset; visible station-local time is checked independently. */
export function verifyDiscoverCarsLocalTime(visible: string, serialized: unknown, expected: CarLocalTime): void {
  if (typeof serialized !== 'string' || !serialized.startsWith(`${expected.date}T${expected.time}:00`)) throw new CarError('Rendered pickup or return date disagrees with the requested local time');
  const displayed = new Intl.DateTimeFormat('en-US', {
    timeZone: expected.timeZone, weekday: 'long', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true,
  }).format(new Date(expected.instant));
  const normalize = (text: string) => text.replace(/\s+/g, ' ').trim();
  if (!normalize(visible).includes(normalize(displayed))) throw new CarError('Visible pickup or return time does not match the station-local request');
}
