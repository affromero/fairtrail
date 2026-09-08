import { prisma } from '@/lib/prisma';
import { createVpnProvider, type VpnProvider, type VpnProviderType } from '../scraper/vpn';
import { lockTravelLease, type TravelLeaseToken } from './admission';
import { TravelCleanupError } from './execution';
import { TravelJobError } from './errors';

/** Captures one provider instance and never mutates a network after losing authority. */
export class TravelVpnSession implements VpnProvider {
  readonly type: VpnProviderType;
  private readonly provider: VpnProvider;
  private uncertain = false;
  private touched = false;
  constructor(private readonly lease: TravelLeaseToken, type: VpnProviderType) {
    this.type = type;
    this.provider = createVpnProvider(type);
  }
  private async authority(): Promise<void> {
    await prisma.$transaction(tx => lockTravelLease(tx, this.lease));
  }
  async getStatus() { await this.authority(); return this.provider.getStatus(); }
  async listLocations() { await this.authority(); return this.provider.listLocations(); }
  isSystemWide() { return this.provider.isSystemWide(); }
  getProxyUrl() { return this.provider.getProxyUrl?.(); }
  private async mutate(work: () => Promise<void>): Promise<void> {
    await this.authority();
    if (this.uncertain) throw new TravelJobError('VPN state is uncertain; administrator recovery is required', 503);
    this.touched = true;
    this.uncertain = true;
    await work();
    await this.authority();
    this.uncertain = false;
  }
  async connect(country: string): Promise<boolean> {
    await this.mutate(async () => {
      if (!(await this.provider.connect(country))) throw new TravelJobError('Configured VPN country is unavailable', 503);
    });
    return true;
  }
  async disconnect(): Promise<void> {
    await this.mutate(() => this.provider.disconnect());
  }
  async prepare(): Promise<void> {
    if (this.type === 'none' || this.lease.id === 'browser') return;
    // A local pass starts from a verified disconnected network, including restart.
    await this.disconnect();
  }
  async dispose(): Promise<void> {
    if (this.uncertain) throw new TravelCleanupError([], 'VPN command completion is uncertain; automatic cleanup is unsafe');
    if (!this.touched) return;
    await this.disconnect();
    this.touched = false;
  }
}
