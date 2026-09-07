import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { promisify } from 'node:util';

const image = process.env.CAR_CLI_TEST_IMAGE;
if (!image) throw new Error('Set CAR_CLI_TEST_IMAGE to an already-built Flight Finder image');
const execute = promisify(execFile), volume = `car-cli-test-${randomUUID()}`, containers = new Set();
const jobs = new Map(); let loseAcknowledgement = true, mutations = 0;
async function docker(args) {
  try { return { ...await execute('docker', args, { timeout: 60_000, maxBuffer: 4 * 1024 * 1024 }), code: 0 }; }
  catch (error) {
    if (typeof error.code !== 'number') throw error;
    return { code: error.code, stdout: error.stdout, stderr: error.stderr };
  }
}
const server = createServer(async (request, response) => {
  for await (const chunk of request) void chunk;
  response.setHeader('Content-Type', 'application/json');
  if (request.url === '/api/cars/session') {
    response.end(JSON.stringify({ ok: true, data: { scope: 'user:container-test', isAdmin: false } })); return;
  }
  if (request.url !== '/api/cars/tracker-one/scrape' || request.method !== 'POST') {
    response.writeHead(404); response.end(JSON.stringify({ ok: false, error: 'Unknown fixture route' })); return;
  }
  mutations++;
  const key = request.headers['idempotency-key'];
  if (!jobs.has(key)) jobs.set(key, { id: 'run-one', trackerId: 'tracker-one', status: 'success', refreshKey: key });
  if (loseAcknowledgement) { loseAcknowledgement = false; response.destroy(); return; }
  response.writeHead(202); response.end(JSON.stringify({ ok: true, data: jobs.get(key) }));
});
await new Promise(resolve => server.listen(0, '0.0.0.0', resolve));
const port = server.address().port;
async function invoke(args, mounted = true) {
  const name = `car-cli-run-${randomUUID()}`; containers.add(name);
  return docker(['run', '--rm', '--pull', 'never', '--name', name, '--add-host', 'host.docker.internal:host-gateway',
    '-v', `${resolve('packages/cli/dist')}:/app/packages/cli/dist:ro`, ...(mounted ? ['-v', `${volume}:/app/data`] : []),
    '-e', 'FLIGHT_FINDER_CAR_RECEIPTS=/app/data/car-receipts', '-e', 'FLIGHT_FINDER_CAR_REQUIRE_MOUNT=1',
    '--entrypoint', 'node', image, '/app/packages/cli/dist/index.js', 'cars', '--server', `http://host.docker.internal:${port}`, '--json', ...args]);
}
try {
  const created = await docker(['volume', 'create', volume]); assert.equal(created.code, 0, created.stderr);
  const setup = await docker(['run', '--rm', '--pull', 'never', '--user', '0', '-v', `${volume}:/app/data`, '--entrypoint', 'node', image,
    '-e', "const fs = require('node:fs'); fs.chownSync('/app/data', 1000, 1000); fs.chmodSync('/app/data', 0o700)"]);
  assert.equal(setup.code, 0, setup.stderr);
  const missing = await invoke(['refresh', 'tracker-one', '--revision', '7'], false);
  assert.equal(missing.code, 1, missing.stdout + missing.stderr);
  assert.match(missing.stderr, /not mounted/); assert.equal(mutations, 0);
  const first = await invoke(['refresh', 'tracker-one', '--revision', '7']);
  assert.equal(first.code, 1, first.stdout + first.stderr);
  const prepared = first.stderr.split('\n').filter(line => line.startsWith('{')).map(line => JSON.parse(line)).find(value => value.state === 'prepared');
  assert.match(prepared?.receiptPath ?? '', /^\/app\/data\/car-receipts\/[0-9a-f-]+\.json$/);
  for (let attempt = 0; attempt < 2; attempt++) {
    const replay = await invoke(['retry', prepared.receiptPath]);
    assert.equal(replay.code, 0, replay.stdout + replay.stderr);
    assert.deepEqual(JSON.parse(replay.stdout).result, [...jobs.values()][0]);
  }
  assert.equal(jobs.size, 1);
  console.log('PASS: missing mount refuses mutation; receipt survives container recreation; completed refresh replay reuses the original job.');
} finally {
  server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  for (const name of containers) {
    const state = await docker(['container', 'inspect', '--format', '{{.State.Running}}', name]);
    if (state.code === 0) {
      const removed = await docker(['rm', '-f', name]);
      if (removed.code !== 0) throw new Error(removed.stderr);
    }
  }
  const removed = await docker(['volume', 'rm', volume]);
  if (removed.code !== 0) throw new Error(removed.stderr);
}
