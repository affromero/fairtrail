import type { VpnProvider, VpnStatus } from './types';

export class NoopVpnProvider implements VpnProvider {
  readonly type = 'none' as const;

  async getStatus(): Promise<VpnStatus> {
    return { connected: false, currentLocation: null, currentCountry: null };
  }

  async connect(): Promise<boolean> {
    return true;
  }

  async disconnect(): Promise<void> {}

  async listLocations(): Promise<string[]> {
    return [];
  }

  isSystemWide(): boolean {
    return false;
  }
}
