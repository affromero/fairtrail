#!/usr/bin/env node

/**
 * VPN Bridge -- controls ExpressVPN via the daemon's Unix socket.
 *
 * Uses JSON-RPC over the expressvpnd Unix socket instead of AppleScript.
 * Exposes the same REST API as the Docker sidecar so containers can
 * switch countries.
 *
 * Usage:
 *   node scripts/vpn-bridge.mjs
 *   # Listens on port 8000
 *
 * Container reaches this via EXPRESSVPN_API_URL=http://host.docker.internal:8000
 */

import { createServer } from 'http';
import { createConnection } from 'net';

const PORT = 8000;
const SOCKET_PATH = '/Library/Application Support/com.expressvpn.ExpressVPN/expressvpnd.socket';

let rpcId = 1;

function rpcCall(method, params = [null]) {
  return new Promise((resolve, reject) => {
    const sock = createConnection(SOCKET_PATH);
    const msg = JSON.stringify({ jsonrpc: '2.0', method, params, id: rpcId++ });

    let data = '';
    sock.on('data', (chunk) => { data += chunk.toString(); });
    sock.on('end', () => {
      try {
        const parsed = JSON.parse(data);
        if (parsed.error) reject(new Error(parsed.error));
        else resolve(parsed.result);
      } catch (e) {
        reject(new Error(`Bad JSON: ${data.slice(0, 200)}`));
      }
    });
    sock.on('error', reject);
    sock.write(msg);
    sock.end();

    setTimeout(() => { sock.destroy(); reject(new Error('timeout')); }, 10000);
  });
}

async function getStatus() {
  try {
    const result = await rpcCall('XVPN.GetStatus');
    const info = result.info;
    return {
      connected: info.connected,
      location: info.current_location?.name ?? null,
      countryCode: info.current_location?.country_code ?? null,
      ip: info.connection?.ip ?? null,
    };
  } catch (err) {
    console.error('[vpn-bridge] getStatus error:', err.message);
    return { connected: false, location: null, countryCode: null, ip: null };
  }
}

async function getLocations() {
  const result = await rpcCall('XVPN.GetLocations');
  return result.locations ?? [];
}

async function connect(locationName) {
  console.log(`[vpn-bridge] connecting to ${locationName}...`);

  // Disconnect first if already connected to a different location
  const currentStatus = await getStatus();
  if (currentStatus.connected) {
    console.log(`[vpn-bridge] disconnecting from ${currentStatus.location} first...`);
    await rpcCall('XVPN.Disconnect');
    // Wait for disconnect
    for (let i = 0; i < 10; i++) {
      await new Promise((r) => setTimeout(r, 1000));
      const s = await getStatus();
      if (!s.connected) break;
    }
  }

  const locations = await getLocations();
  const match = locations.find((l) =>
    l.name.toLowerCase().includes(locationName.toLowerCase()) ||
    l.country_code?.toLowerCase() === locationName.toLowerCase()
  );

  if (!match) {
    console.error(`[vpn-bridge] location not found: ${locationName}`);
    return false;
  }

  const result = await rpcCall('XVPN.Connect', [{ id: match.id, name: match.name }]);
  if (result?.success) {
    // Wait for connection to establish
    for (let i = 0; i < 15; i++) {
      await new Promise((r) => setTimeout(r, 2000));
      const status = await getStatus();
      if (status.connected) {
        console.log(`[vpn-bridge] connected to ${status.location} (IP: ${status.ip}) in ${(i + 1) * 2}s`);
        return true;
      }
    }
  }
  console.error(`[vpn-bridge] connect failed or timed out`);
  return false;
}

async function disconnect() {
  console.log('[vpn-bridge] disconnecting...');
  await rpcCall('XVPN.Disconnect');
  for (let i = 0; i < 10; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    const status = await getStatus();
    if (!status.connected) {
      console.log(`[vpn-bridge] disconnected in ${i + 1}s`);
      return;
    }
  }
}

// Location alias mapping (same as expressvpn-provider.ts)
const ALIASES = {
  usny: 'USA - New York', uklo: 'UK - London', defra1: 'Germany - Frankfurt',
  frpa2: 'France - Paris', esma: 'Spain - Madrid', itco: 'Italy - Cosenza',
  nlam: 'Netherlands - Amsterdam', ie: 'Ireland', jpto: 'Japan - Tokyo',
  kr2: 'South Korea', inuk: 'India', ausy: 'Australia - Sydney',
  cato: 'Canada - Toronto', mx: 'Mexico', br: 'Brazil', ar: 'Argentina',
  co: 'Colombia', th: 'Thailand', sgcb: 'Singapore', hk2: 'Hong Kong',
  smart: 'Smart Location',
};

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const path = url.pathname;
  res.setHeader('Content-Type', 'text/plain');

  try {
    if (path === '/v1/status') {
      const s = await getStatus();
      res.end(s.connected ? `Connected to ${s.location}` : 'Not connected');
    } else if (path.startsWith('/v1/connect/')) {
      const alias = path.split('/v1/connect/')[1];
      const locationName = ALIASES[alias] || alias;
      const ok = await connect(locationName);
      res.statusCode = ok ? 200 : 500;
      res.end(ok ? 'Connected' : 'Failed');
    } else if (path === '/v1/disconnect') {
      await disconnect();
      res.end('Disconnected');
    } else if (path === '/v1/publicip/ip') {
      const s = await getStatus();
      res.end(s.ip || 'unknown');
    } else if (path === '/v1/locations') {
      const locs = await getLocations();
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(locs.map((l) => ({ id: l.id, name: l.name, country: l.country_code }))));
    } else {
      res.statusCode = 404;
      res.end('Not found');
    }
  } catch (err) {
    res.statusCode = 500;
    res.end(err.message);
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[vpn-bridge] ExpressVPN bridge (Unix socket) on http://0.0.0.0:${PORT}`);
  console.log(`[vpn-bridge] Socket: ${SOCKET_PATH}`);
  console.log('[vpn-bridge] Docker: http://host.docker.internal:8000');
});
