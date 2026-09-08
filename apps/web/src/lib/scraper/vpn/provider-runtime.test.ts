import { afterEach, describe, expect, it, vi } from 'vitest';
import { ExpressVpnProvider } from './expressvpn-provider';

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe('VPN geographic verification with the installed database', () => {
  it('loads the production module and verifies an observed US exit address', async () => {
    const responses = ['Not connected', 'Connected', 'Connected to USA - New York', '8.8.8.8'];
    vi.stubEnv('EXPRESSVPN_API_URL', 'http://vpn.test');
    vi.stubGlobal('fetch', async () => new Response(responses.shift()));
    await expect(new ExpressVpnProvider().connect('US')).resolves.toBe(true);
  });
  it('does not accept a private address as a verified country exit', async () => {
    const responses = ['Not connected', 'Connected', 'Connected to USA - New York', '192.168.1.1'];
    vi.stubEnv('EXPRESSVPN_API_URL', 'http://vpn.test');
    vi.stubGlobal('fetch', async () => new Response(responses.shift()));
    await expect(new ExpressVpnProvider().connect('US')).rejects.toThrow(/unknown/);
  });
});
