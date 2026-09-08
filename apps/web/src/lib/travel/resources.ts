export type TravelNetworkResource = 'network' | 'vpn' | 'browser';
export interface TravelNetworkTopology { vpnEnabled: boolean; systemWide: boolean }

/** Capture once at admission; callers must not recalculate during execution. */
export function travelNetworkResource(topology: TravelNetworkTopology, usesTunnel: boolean): TravelNetworkResource {
  if (topology.vpnEnabled && topology.systemWide) return 'network';
  return usesTunnel ? 'vpn' : 'browser';
}
