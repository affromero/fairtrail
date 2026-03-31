export type VpnProviderType = 'none' | 'expressvpn';

export interface VpnStatus {
  connected: boolean;
  currentLocation: string | null;
  currentCountry: string | null;
}

export interface VpnProvider {
  readonly type: VpnProviderType;

  /** Get current connection status */
  getStatus(): Promise<VpnStatus>;

  /** Connect to a specific country. Returns true if successful. */
  connect(countryCode: string): Promise<boolean>;

  /** Disconnect from VPN entirely */
  disconnect(): Promise<void>;

  /** List available location names this provider supports */
  listLocations(): Promise<string[]>;

  /** Whether this is a system-wide VPN (sequential only) vs per-context proxy */
  isSystemWide(): boolean;

  /** Get the SOCKS5/HTTP proxy URL for Playwright (only for non-system-wide providers) */
  getProxyUrl?(): string | undefined;
}
