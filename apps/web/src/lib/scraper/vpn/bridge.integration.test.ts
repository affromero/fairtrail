import { spawn, type ChildProcess } from 'node:child_process';
import { createServer, type Server, type Socket } from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

interface RpcRequest { jsonrpc: string; id: number; method: string; params: unknown[] }
let directory: string;
let daemon: Server;
let bridge: ChildProcess;
let base: string;
let connected: boolean;
let location: string;
let malformed: boolean;
let wrongIdentity: boolean;
let connectedAfterDisconnect: boolean;
let releaseConnect: (() => void) | null;
let holdConnect: boolean;
let locations: { id: number; name: string; country_code: string }[];
let country: string;
const requests: RpcRequest[] = [];
const sockets = new Set<Socket>();

beforeEach(async () => {
  directory = await mkdtemp('/tmp/ff-vpn-bridge-');
  connected = false; location = 'UK - London'; malformed = false; wrongIdentity = false;
  connectedAfterDisconnect = false; releaseConnect = null; holdConnect = false; requests.length = 0;
  country = 'GB'; locations = [{ id: 1, name: 'UK - London', country_code: 'GB' }];
  daemon = createServer({ allowHalfOpen: true }, socket => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    socket.on('error', () => undefined);
    let input = '';
    socket.on('data', chunk => { input += chunk.toString(); });
    socket.on('end', () => {
      void (async () => {
        const request = JSON.parse(input) as RpcRequest;
        requests.push(request);
        let result: unknown;
        if (request.method === 'XVPN.GetStatus') result = malformed ? { info: { connected: 'false' } } : {
          info: { connected, current_location: { id: 1, name: location, country_code: country }, connection: { ip: '203.0.113.8' } },
        };
        else if (request.method === 'XVPN.GetLocations') result = { locations };
        else if (request.method === 'XVPN.Connect') {
          if (holdConnect) await new Promise<void>(resolve => { releaseConnect = resolve; });
          connected = true; result = { success: true };
        } else if (request.method === 'XVPN.Disconnect') { connected = connectedAfterDisconnect; result = { success: true }; }
        else throw new Error('Unexpected daemon method: ' + request.method);
        if (!socket.destroyed) socket.end(JSON.stringify({ jsonrpc: '2.0', id: wrongIdentity ? request.id + 1 : request.id, result }));
      })().catch(error => socket.destroy(error));
    });
  });
  await new Promise<void>((resolve, reject) => {
    daemon.once('error', reject);
    daemon.listen(join(directory, 'daemon.sock'), resolve);
  });
  bridge = spawn(process.execPath, [fileURLToPath(new URL('../../../../../../scripts/vpn-bridge.mjs', import.meta.url))], {
    env: { ...process.env, VPN_BRIDGE_PORT: '0', VPN_BRIDGE_SOCKET: join(directory, 'daemon.sock') }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  base = await new Promise<string>((resolve, reject) => {
    let output = '';
    const timeout = setTimeout(() => reject(new Error('Bridge startup timed out: ' + output)), 5000);
    bridge.stderr?.on('data', chunk => { output += chunk.toString(); });
    bridge.stdout?.on('data', chunk => {
      output += chunk.toString();
      const match = /Listening on port (\d+)/.exec(output);
      if (match) { clearTimeout(timeout); resolve('http://127.0.0.1:' + match[1]); }
    });
    bridge.once('exit', code => { clearTimeout(timeout); reject(new Error('Bridge exited ' + code + ': ' + output)); });
    bridge.once('error', error => { clearTimeout(timeout); reject(error); });
  });
});

afterEach(async () => {
  releaseConnect?.();
  if (bridge && bridge.exitCode === null && bridge.signalCode === null) {
    await new Promise<void>(resolve => { bridge.once('exit', () => resolve()); bridge.kill('SIGTERM'); });
  }
  for (const socket of sockets) socket.destroy();
  sockets.clear();
  if (daemon?.listening) await new Promise<void>((resolve, reject) => daemon.close(error => error ? reject(error) : resolve()));
  if (directory) await rm(directory, { recursive: true, force: true });
});

const request = (path: string, method = 'GET', signal = AbortSignal.timeout(5000)) => fetch(base + path, { method, signal });
const mutations = () => requests.filter(value => ['XVPN.Connect', 'XVPN.Disconnect'].includes(value.method));

describe('VPN bridge real HTTP and daemon transport', () => {
  it('reports the daemon connection state without changing it', async () => {
    const response = await request('/v1/status');
    expect(response.status).toBe(200);
    expect(await response.text()).toMatch(/^Not connected$/);
    expect(mutations()).toEqual([]);
  });
  it('returns an error when daemon status is malformed', async () => {
    malformed = true;
    const response = await request('/v1/status');
    expect(response.status).toBe(502);
    expect(await response.text()).toMatch(/Invalid/);
  });
  it('rejects a daemon response belonging to another RPC', async () => {
    wrongIdentity = true;
    const response = await request('/v1/status');
    expect(response.status).toBe(502);
    expect(await response.text()).toMatch(/identity/);
  });
  it.each(['/v1/connect/uklo', '/v1/disconnect'])('does not mutate through GET %s', async path => {
    const response = await request(path);
    expect(response.status).toBe(405);
    expect(response.headers.get('allow')).toBe('POST');
    expect(mutations()).toEqual([]);
  });
  it('connects only after observing the selected location in daemon status', async () => {
    const response = await request('/v1/connect/uklo', 'POST');
    expect(response.status).toBe(200);
    expect(await response.text()).toMatch(/^Connected$/);
    expect(connected).toBe(true);
    expect(mutations()).toMatchObject([{ method: 'XVPN.Connect', params: [{ id: 1, name: 'UK - London' }] }]);
  });
  it('does not claim success after the daemon connects to a different country', async () => {
    location = 'USA - New York'; country = 'US';
    const response = await request('/v1/connect/uklo', 'POST');
    expect(response.status).toBe(502);
    expect(await response.text()).toMatch(/different location/);
    const next = await request('/v1/disconnect', 'POST');
    expect(next.status).toBe(503);
    expect(mutations()).toHaveLength(1);
  });
  it('preserves country preferences when daemon locations include city suffixes', async () => {
    locations = [{ id: 8, name: 'South Korea - Seoul', country_code: 'KR' }];
    country = 'KR'; location = 'South Korea - Seoul';
    const response = await request('/v1/connect/kr2', 'POST');
    expect(response.status).toBe(200);
    expect(mutations()).toMatchObject([{ method: 'XVPN.Connect', params: [{ id: 8, name: 'South Korea - Seoul' }] }]);
  });
  it('chooses a stable same-country location independently of daemon list ordering', async () => {
    locations = [
      { id: 9, name: 'South Korea - Seoul', country_code: 'KR' },
      { id: 8, name: 'South Korea - Busan', country_code: 'KR' },
      { id: 7, name: 'South Korea', country_code: 'US' },
    ];
    country = 'KR'; location = 'South Korea - Busan';
    expect((await request('/v1/connect/kr2', 'POST')).status).toBe(200);
    expect(mutations()).toMatchObject([{ method: 'XVPN.Connect', params: [{ id: 8, name: 'South Korea - Busan' }] }]);
  });
  it('rejects unknown locations without disabling later valid requests', async () => {
    const invalid = await request('/v1/connect/unknown-place', 'POST');
    expect(invalid.status).toBe(502);
    expect(mutations()).toEqual([]);
    expect((await request('/v1/connect/uklo', 'POST')).status).toBe(200);
    expect(mutations()).toHaveLength(1);
  });
  it('rejects conflicting daemon location identities before submitting a mutation', async () => {
    locations.push({ id: 1, name: 'USA - New York', country_code: 'US' });
    expect((await request('/v1/connect/uklo', 'POST')).status).toBe(502);
    expect(mutations()).toEqual([]);
  });
  it('verifies disconnection instead of trusting the daemon acknowledgement', async () => {
    connected = true;
    const response = await request('/v1/disconnect', 'POST');
    expect(response.status).toBe(200);
    expect(await response.text()).toMatch(/^Disconnected$/);
    expect(connected).toBe(false);
  });
  it('rejects overlapping mutations while allowing status reads', async () => {
    holdConnect = true;
    const connecting = request('/v1/connect/uklo', 'POST');
    await expect.poll(() => mutations().length).toBe(1);
    const overlap = await request('/v1/disconnect', 'POST');
    expect(overlap.status).toBe(409);
    const status = await request('/v1/status');
    expect(status.status).toBe(200);
    expect(await status.text()).toMatch(/Not connected/);
    releaseConnect?.();
    expect((await connecting).status).toBe(200);
    expect(mutations()).toHaveLength(1);
  });
  it('does not accept further mutations after a caller abandons a submitted command', async () => {
    holdConnect = true;
    const controller = new AbortController();
    const connecting = request('/v1/connect/uklo', 'POST', controller.signal).catch(error => error);
    await expect.poll(() => mutations().length).toBe(1);
    controller.abort();
    expect(await connecting).toBeInstanceOf(Error);
    await expect.poll(async () => (await request('/v1/disconnect', 'POST')).status).toBe(503);
    releaseConnect?.();
    expect(mutations()).toHaveLength(1);
  });
  it('reports a timed-out daemon command as uncertain and rejects a replacement command', async () => {
    holdConnect = true;
    const response = await request('/v1/connect/uklo', 'POST', AbortSignal.timeout(15_000));
    expect(response.status).toBe(502);
    expect(await response.text()).toMatch(/timed out/);
    expect((await request('/v1/disconnect', 'POST')).status).toBe(503);
    releaseConnect?.();
    expect(mutations()).toHaveLength(1);
  }, 20_000);
  it('does not connect a new location before disconnection has been verified', async () => {
    connected = true; connectedAfterDisconnect = true;
    const controller = new AbortController();
    const connecting = request('/v1/connect/uklo', 'POST', controller.signal).catch(error => error);
    await expect.poll(() => mutations().length).toBe(1);
    expect(mutations()).toMatchObject([{ method: 'XVPN.Disconnect' }]);
    controller.abort();
    await connecting;
    await expect.poll(async () => (await request('/v1/connect/uklo', 'POST')).status).toBe(503);
    expect(mutations()).toMatchObject([{ method: 'XVPN.Disconnect' }]);
  });
});
