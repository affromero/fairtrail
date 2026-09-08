export interface TravelAdmissionView {
  actorScope: string;
  quarantinedAt: string | null;
  reason: string | null;
  recoveryGeneration: number;
  topologyVersion: number;
  systemWide: boolean;
  vpnEnabled: boolean;
  leases: { id: string; state: 'idle' | 'held' | 'quarantined'; generation: number; expiresAt: string }[];
}

export function validateTravelAdmissionView(raw: unknown): TravelAdmissionView {
  const invalid = () => { throw new Error('Invalid travel recovery status'); };
  const record = (value: unknown): Record<string, unknown> => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid();
    return value as Record<string, unknown>;
  };
  const integer = (value: unknown) => Number.isSafeInteger(value) && Number(value) >= 0 && Number(value) <= 2147483647;
  const date = (value: unknown): value is string => typeof value === 'string' && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
  const value = record(raw);
  if (Object.keys(value).some(key => !['actorScope', 'quarantinedAt', 'reason', 'recoveryGeneration', 'topologyVersion', 'systemWide', 'vpnEnabled', 'leases'].includes(key))
    || typeof value.actorScope !== 'string' || !/^(?:instance|single|user:[A-Za-z0-9_-]{1,200})$/.test(value.actorScope)
    || !integer(value.recoveryGeneration) || !integer(value.topologyVersion)
    || typeof value.systemWide !== 'boolean' || typeof value.vpnEnabled !== 'boolean' || value.systemWide && !value.vpnEnabled
    || value.quarantinedAt !== null && !date(value.quarantinedAt)
    || (value.quarantinedAt === null ? value.reason !== null : typeof value.reason !== 'string' || !value.reason.trim() || value.reason.length > 1000)
    || !Array.isArray(value.leases) || value.leases.length > 3) return invalid();
  const leases = value.leases.map(raw => {
    const lease = record(raw);
    if (Object.keys(lease).some(key => !['id', 'state', 'generation', 'expiresAt'].includes(key))
      || typeof lease.id !== 'string' || !['browser', 'vpn', 'network'].includes(lease.id)
      || typeof lease.state !== 'string' || !['idle', 'held', 'quarantined'].includes(lease.state)
      || !integer(lease.generation) || !date(lease.expiresAt)) return invalid();
    return { id: String(lease.id), state: lease.state as TravelAdmissionView['leases'][number]['state'], generation: Number(lease.generation), expiresAt: lease.expiresAt };
  });
  if (new Set(leases.map(lease => lease.id)).size !== leases.length) return invalid();
  return { actorScope: value.actorScope, quarantinedAt: value.quarantinedAt as string | null, reason: value.reason as string | null,
    recoveryGeneration: Number(value.recoveryGeneration), topologyVersion: Number(value.topologyVersion), systemWide: value.systemWide, vpnEnabled: value.vpnEnabled, leases };
}
