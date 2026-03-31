import type { VpnProvider, VpnProviderType } from './types';
import { NoopVpnProvider } from './noop-provider';
import { ExpressVpnProvider } from './expressvpn-provider';

export function createVpnProvider(type: VpnProviderType): VpnProvider {
  switch (type) {
    case 'expressvpn':
      return new ExpressVpnProvider();
    case 'none':
    default:
      return new NoopVpnProvider();
  }
}

export type { VpnProvider, VpnProviderType, VpnStatus } from './types';
