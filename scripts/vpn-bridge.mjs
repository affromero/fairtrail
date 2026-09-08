#!/usr/bin/env node

/**
 * ExpressVPN daemon bridge. Defaults preserve the existing local deployment.
 * VPN_BRIDGE_PORT and VPN_BRIDGE_SOCKET allow isolated daemon installations.
 * A failed mutation stops further mutations until the daemon is verified and
 * the bridge restarted. A timed-out RPC cannot undo an already submitted command.
 */
import { createServer } from 'node:http';
import { createConnection } from 'node:net';

const PORT = Number(process.env.VPN_BRIDGE_PORT ?? 8000);
const SOCKET_PATH = process.env.VPN_BRIDGE_SOCKET ?? '/Library/Application Support/com.expressvpn.ExpressVPN/expressvpnd.socket';
if (!Number.isInteger(PORT) || PORT < 0 || PORT > 65535 || !SOCKET_PATH) throw new Error('Invalid VPN bridge configuration');

let rpcId = 1;
let mutating = false;
let uncertain = false;

async function deadline(milliseconds, work) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error('VPN operation timed out; daemon state is unconfirmed')), milliseconds);
  try {
    const result = await work(controller);
    controller.signal.throwIfAborted();
    return result;
  } finally { clearTimeout(timer); }
}

function rpcCall(method, signal, params = [null]) {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const id = rpcId++;
    const sock = createConnection(SOCKET_PATH);
    const chunks = [];
    let bytes = 0;
    let settled = false;
    const finish = (error, result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
      sock.destroy();
      if (error) reject(error);
      else resolve(result);
    };
    const abort = () => finish(signal.reason);
    const timer = setTimeout(() => finish(new Error('VPN daemon response timed out')), 10_000);
    signal.addEventListener('abort', abort, { once: true });
    sock.on('data', chunk => {
      bytes += chunk.length;
      if (bytes > 1_048_576) { finish(new Error('VPN daemon response is too large')); return; }
      chunks.push(chunk);
    });
    sock.on('end', () => {
      try {
        const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if (!parsed || parsed.jsonrpc !== '2.0' || parsed.id !== id) throw new Error('Invalid VPN daemon response identity');
        if (parsed.error || !('result' in parsed)) throw new Error('VPN daemon rejected the request');
        finish(null, parsed.result);
      } catch (error) { finish(error); }
    });
    sock.on('error', error => finish(error));
    sock.on('close', () => { if (!settled) finish(new Error('VPN daemon disconnected before acknowledging the request')); });
    sock.end(JSON.stringify({ jsonrpc: '2.0', method, params, id }));
  });
}

async function getStatus(signal) {
  const result = await rpcCall('XVPN.GetStatus', signal);
  const info = result?.info;
  if (!info || typeof info.connected !== 'boolean') throw new Error('Invalid VPN daemon status');
  if (!info.connected) return { connected: false, location: null, countryCode: null, ip: null };
  const location = info.current_location;
  if (!location || typeof location.name !== 'string' || !location.name.trim()
    || typeof location.country_code !== 'string' || !/^[A-Z]{2}$/i.test(location.country_code)) throw new Error('Invalid connected VPN location');
  return {
    connected: true, location: location.name.trim(), countryCode: location.country_code.toUpperCase(),
    ip: typeof info.connection?.ip === 'string' ? info.connection.ip : null,
  };
}

async function getLocations(signal) {
  const result = await rpcCall('XVPN.GetLocations', signal);
  const locations = result?.locations;
  if (!Array.isArray(locations) || locations.length > 10000 || locations.some(location =>
    !location || !(typeof location.id === 'string' ? /^[A-Za-z0-9_-]{1,200}$/.test(location.id) : Number.isSafeInteger(location.id) && location.id >= 0)
    || typeof location.name !== 'string' || !location.name.trim()
    || typeof location.country_code !== 'string' || !/^[A-Z]{2}$/i.test(location.country_code)
  )) throw new Error('Invalid VPN daemon locations');
  if (new Set(locations.map(location => String(location.id))).size !== locations.length) throw new Error('Duplicate VPN daemon location identity');
  return locations;
}

async function pause(signal) {
  signal.throwIfAborted();
  await new Promise((resolve, reject) => {
    const finish = () => { signal.removeEventListener('abort', abort); resolve(); };
    const timer = setTimeout(finish, 1000);
    const abort = () => { clearTimeout(timer); signal.removeEventListener('abort', abort); reject(signal.reason); };
    signal.addEventListener('abort', abort, { once: true });
  });
}

async function disconnect(signal, submitted) {
  submitted.value = true;
  await rpcCall('XVPN.Disconnect', signal);
  while ((await getStatus(signal)).connected) await pause(signal);
}

async function connect(locationName, country, signal, submitted) {
  const locations = await getLocations(signal);
  const candidates = locations.filter(location => country ? location.country_code.toUpperCase() === country : location.name.toLowerCase() === locationName.toLowerCase());
  const exact = candidates.filter(location => location.name.toLowerCase() === locationName.toLowerCase());
  const nearby = candidates.filter(location => location.name.toLowerCase().startsWith(locationName.toLowerCase() + ' '));
  const matches = exact.length ? exact : nearby.length ? nearby : candidates;
  if (!matches.length || (!country && matches.length !== 1)) throw new Error('Choose an unambiguous supported VPN location');
  // Preferences specify countries, not cities. Prefer the existing named region,
  // then choose a stable daemon location within that verified country.
  const selected = [...matches].sort((left, right) => left.name.localeCompare(right.name, 'en') || String(left.id).localeCompare(String(right.id), 'en'))[0];
  if ((await getStatus(signal)).connected) await disconnect(signal, submitted);
  submitted.value = true;
  const result = await rpcCall('XVPN.Connect', signal, [{ id: selected.id, name: selected.name }]);
  if (result?.success !== true) throw new Error('VPN daemon did not acknowledge connection');
  while (true) {
    const status = await getStatus(signal);
    if (status.connected) {
      if (status.location !== selected.name || status.countryCode !== selected.country_code.toUpperCase()) throw new Error('VPN connected to a different location');
      return;
    }
    await pause(signal);
  }
}

const ALIASES = {
  usny: 'USA - New York', uklo: 'UK - London', defra1: 'Germany - Frankfurt',
  frpa2: 'France - Paris', esma: 'Spain - Madrid', itco: 'Italy - Cosenza',
  nlam: 'Netherlands - Amsterdam', ie: 'Ireland', jpto: 'Japan - Tokyo',
  kr2: 'South Korea', inuk: 'India', ausy: 'Australia - Sydney',
  cato: 'Canada - Toronto', mx: 'Mexico', br: 'Brazil', ar: 'Argentina',
  co: 'Colombia', th: 'Thailand', sgcb: 'Singapore', hk2: 'Hong Kong',
};
const COUNTRIES = {
  usny: 'US', uklo: 'GB', defra1: 'DE', frpa2: 'FR', esma: 'ES', itco: 'IT', nlam: 'NL',
  ie: 'IE', jpto: 'JP', kr2: 'KR', inuk: 'IN', ausy: 'AU', cato: 'CA', mx: 'MX', br: 'BR',
  ar: 'AR', co: 'CO', th: 'TH', sgcb: 'SG', hk2: 'HK',
};

const server = createServer(async (req, res) => {
  res.setHeader('Content-Type', 'text/plain');
  res.setHeader('Cache-Control', 'no-store');
  try {
    const path = new URL(req.url, 'http://localhost').pathname;
    const mutation = path.startsWith('/v1/connect/') || path === '/v1/disconnect';
    if (req.method !== (mutation ? 'POST' : 'GET')) {
      res.setHeader('Allow', mutation ? 'POST' : 'GET');
      res.writeHead(405).end('Method not allowed'); return;
    }
    if (mutation) {
      if (uncertain) { res.writeHead(503).end('VPN command outcome unconfirmed; verify the daemon before restarting the bridge'); return; }
      if (mutating) { res.writeHead(409).end('VPN operation already in progress'); return; }
      mutating = true;
      const submitted = { value: false };
      try {
        await deadline(40_000, async controller => {
          const close = () => { if (!res.writableFinished) controller.abort(new Error('VPN caller disconnected; command outcome is unconfirmed')); };
          res.once('close', close);
          try {
            if (path === '/v1/disconnect') await disconnect(controller.signal, submitted);
            else {
              const alias = decodeURIComponent(path.slice('/v1/connect/'.length));
              if (!alias || alias.length > 200) throw new Error('Invalid VPN location');
              await connect(Object.hasOwn(ALIASES, alias) ? ALIASES[alias] : alias,
                Object.hasOwn(COUNTRIES, alias) ? COUNTRIES[alias] : null, controller.signal, submitted);
            }
          } finally { res.removeListener('close', close); }
        });
        res.end(path === '/v1/disconnect' ? 'Disconnected' : 'Connected');
      } catch (error) { if (submitted.value) uncertain = true; throw error; }
      finally { mutating = false; }
      return;
    }
    await deadline(10_000, async controller => {
      if (path === '/v1/status') {
        const status = await getStatus(controller.signal);
        res.end(status.connected ? 'Connected to ' + status.location : 'Not connected');
      } else if (path === '/v1/publicip/ip') {
        const status = await getStatus(controller.signal);
        res.end(status.ip ?? 'unknown');
      } else if (path === '/v1/locations') {
        const locations = await getLocations(controller.signal);
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify(locations.map(location => ({ id: location.id, name: location.name, country: location.country_code }))));
      } else { res.writeHead(404).end('Not found'); }
    });
  } catch (error) {
    if (!res.writableEnded) res.writeHead(502).end(error instanceof Error ? error.message : 'VPN operation failed');
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log('[vpn-bridge] Listening on port ' + server.address().port);
});
