export class TravelJobError extends Error {
  constructor(message: string, public readonly status = 409) { super(message); this.name = 'TravelJobError'; }
}
