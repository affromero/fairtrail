import type { VpnProvider, VpnStatus } from './types';

const POLL_INTERVAL_MS = 3000;
const CONNECT_TIMEOUT_MS = 45000;

/** ExpressVPN REST API base URL (sidecar or macOS bridge) */
const DEFAULT_API_URL = 'http://expressvpn:8000';

/** Maps ISO 3166-1 alpha-2 country codes to ExpressVPN server aliases */
const EXPRESSVPN_SERVERS: Record<string, string> = {
  US: 'usny',
  GB: 'uklo',
  DE: 'defra1',
  FR: 'frpa2',
  ES: 'esma',
  IT: 'itco',
  NL: 'nlam',
  IE: 'ie',
  JP: 'jpto',
  KR: 'kr2',
  IN: 'inuk',
  AU: 'ausy',
  CA: 'cato',
  MX: 'mx',
  BR: 'br',
  AR: 'ar',
  CO: 'co',
  TH: 'th',
  SG: 'sgcb',
  HK: 'hk2',
};

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function sidecarApi(path: string, method: 'GET' | 'POST' = 'GET'): Promise<string> {
  const apiUrl = process.env.EXPRESSVPN_API_URL || DEFAULT_API_URL;
  const res = await fetch(`${apiUrl}${path}`, { method, signal: AbortSignal.timeout(10000) });
  return res.text();
}

export class ExpressVpnProvider implements VpnProvider {
  readonly type = 'expressvpn' as const;

  getProxyUrl(): string | undefined {
    // Only return proxy URL if SOCKS5 is explicitly configured (Docker sidecar mode).
    // On macOS bridge mode, the host VPN routes all container traffic -- no proxy needed.
    return process.env.EXPRESSVPN_SOCKS_URL || undefined;
  }

  async getStatus(): Promise<VpnStatus> {
    try {
      const statusText = await sidecarApi('/v1/status');
      const connected = /connected/i.test(statusText);

      let currentLocation: string | null = null;
      if (connected) {
        // Extract location from status response
        const locationMatch = statusText.match(/Connected to (.+)/i);
        currentLocation = locationMatch?.[1]?.trim() ?? null;
      }

      // Reverse-lookup country from server alias
      let currentCountry: string | null = null;
      if (currentLocation) {
        for (const [code, alias] of Object.entries(EXPRESSVPN_SERVERS)) {
          if (currentLocation.toLowerCase().includes(alias.toLowerCase())) {
            currentCountry = code;
            break;
          }
        }
      }

      return { connected, currentLocation, currentCountry };
    } catch (err) {
      console.error('[expressvpn] getStatus failed:', err instanceof Error ? err.message : err);
      return { connected: false, currentLocation: null, currentCountry: null };
    }
  }

  async connect(countryCode: string): Promise<boolean> {
    const server = EXPRESSVPN_SERVERS[countryCode.toUpperCase()];
    if (!server) {
      console.error(`[expressvpn] no server mapped for country: ${countryCode}`);
      return false;
    }

    console.log(`[expressvpn] connecting to ${server} (${countryCode})...`);

    try {
      await sidecarApi(`/v1/connect/${server}`, 'POST');
    } catch (err) {
      console.error(`[expressvpn] connect request failed:`, err instanceof Error ? err.message : err);
      return false;
    }

    // Poll until connected to the correct country, or timeout
    const start = Date.now();
    while (Date.now() - start < CONNECT_TIMEOUT_MS) {
      await sleep(POLL_INTERVAL_MS);
      const status = await this.getStatus();
      if (status.connected) {
        // Verify the exit IP and country match what was requested
        let exitIp: string | null = null;
        let exitCountry: string | null = null;
        try {
          exitIp = (await sidecarApi('/v1/publicip/ip')).trim();
          if (exitIp) {
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            const geoip = require(/* webpackIgnore: true */ 'geoip-lite');
            exitCountry = geoip.lookup(exitIp)?.country ?? null;
          }
        } catch {
          // IP/geo check is best-effort
        }

        const requestedCountry = countryCode.toUpperCase();
        if (exitCountry && exitCountry !== requestedCountry) {
          console.warn(`[expressvpn] country mismatch: requested ${requestedCountry} but exit IP ${exitIp} resolves to ${exitCountry}`);
        }

        console.log(`[expressvpn] connected to ${status.currentLocation} (exit IP: ${exitIp ?? 'unknown'}, country: ${exitCountry ?? 'unknown'}) in ${Date.now() - start}ms`);
        return true;
      }
    }

    console.error(`[expressvpn] connection to ${server} timed out after ${CONNECT_TIMEOUT_MS}ms`);
    return false;
  }

  async disconnect(): Promise<void> {
    try {
      const status = await this.getStatus();
      if (!status.connected) return;

      console.log('[expressvpn] disconnecting...');
      await sidecarApi('/v1/disconnect', 'POST');

      const start = Date.now();
      while (Date.now() - start < CONNECT_TIMEOUT_MS) {
        await sleep(POLL_INTERVAL_MS);
        const s = await this.getStatus();
        if (!s.connected) {
          console.log(`[expressvpn] disconnected in ${Date.now() - start}ms`);
          return;
        }
      }
      console.error('[expressvpn] disconnect timed out');
    } catch (err) {
      console.error('[expressvpn] disconnect failed:', err instanceof Error ? err.message : err);
    }
  }

  async listLocations(): Promise<string[]> {
    return Object.entries(EXPRESSVPN_SERVERS).map(([code, alias]) => `${code}: ${alias}`);
  }

  isSystemWide(): boolean {
    // System-wide when using macOS bridge (no SOCKS5); per-context when using Docker sidecar
    return !process.env.EXPRESSVPN_SOCKS_URL;
  }
}
