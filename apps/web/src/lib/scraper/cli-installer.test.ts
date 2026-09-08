import { afterEach, beforeEach, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, writeFile, readFile, readdir, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const exec = promisify(execFile);
let root: string;
let prefix: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'ff-cli-installer-test-'));
  prefix = join(root, 'managed');
  await mkdir(join(root, 'commands'));
});
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

async function npmFixture(fail = false, observed = '0.153.4') {
  await writeFile(join(root, 'commands', 'npm'), `#!${process.execPath}
const fs = require('node:fs');
const path = require('node:path');
const installation = process.argv[process.argv.indexOf('--prefix') + 1];
fs.mkdirSync(path.join(installation, 'node_modules', '.bin'), { recursive: true });
fs.writeFileSync(path.join(installation, 'partial-download'), 'downloaded data');
if (${fail}) process.exit(1);
fs.writeFileSync(path.join(installation, 'node_modules', '.bin', 'codex'), ${JSON.stringify(`#!${process.execPath}\nconsole.log('codex-cli ${observed}');\n`)}, { mode: 0o755 });
`, { mode: 0o755 });
}
function install(version = '0.153.4') {
  return exec(process.execPath, [resolve(process.cwd(), '../../scripts/update-cli.mjs'), 'codex'], {
    env: { ...process.env, PATH: `${join(root, 'commands')}:${process.env.PATH}`, NPM_CONFIG_PREFIX: prefix, CODEX_VERSION: version },
  });
}

it('installs a verified executable and skips an already matching version', async () => {
  await npmFixture();
  expect(JSON.parse((await install()).stdout)).toMatchObject({ changed: true, version: '0.153.4' });
  await npmFixture(true);
  expect(JSON.parse((await install()).stdout)).toMatchObject({ changed: false });
  expect((await exec(join(prefix, 'bin', 'codex'), ['--version'])).stdout).toContain('0.153.4');
});

it('preserves the previous executable and removes a failed download', async () => {
  await npmFixture(false, '0.137.0');
  await install('0.137.0');
  const before = await readdir(join(prefix, 'flight-finder-versions'));
  await npmFixture(true);
  await expect(install()).rejects.toThrow(/previous CLI remains available/);
  expect(await readdir(join(prefix, 'flight-finder-versions'))).toEqual(before);
  expect((await exec(join(prefix, 'bin', 'codex'), ['--version'])).stdout).toContain('0.137.0');
});

it('rejects an incorrect downloaded version without replacing the old CLI or authentication', async () => {
  await npmFixture(false, '0.137.0');
  await install('0.137.0');
  const authentication = join(prefix, 'auth.json');
  await writeFile(authentication, 'private auth sentinel', { mode: 0o600 });
  await expect(install()).rejects.toThrow(/did not match/);
  expect((await exec(join(prefix, 'bin', 'codex'), ['--version'])).stdout).toContain('0.137.0');
  expect(await readFile(authentication, 'utf8')).toBe('private auth sentinel');
  expect(await readdir(join(prefix, 'flight-finder-versions'))).toHaveLength(1);
});

it('activates a verified upgrade while leaving the previous executable runnable', async () => {
  await npmFixture(false, '0.137.0');
  await install('0.137.0');
  const previous = await realpath(join(prefix, 'bin', 'codex'));
  await npmFixture();
  expect(JSON.parse((await install()).stdout)).toMatchObject({ changed: true, version: '0.153.4' });
  expect((await exec(join(prefix, 'bin', 'codex'), ['--version'])).stdout).toContain('0.153.4');
  expect((await exec(previous, ['--version'])).stdout).toContain('0.137.0');
});

it('cleans an unactivated installation when the executable destination cannot be replaced', async () => {
  await mkdir(join(prefix, 'bin', 'codex'), { recursive: true });
  await writeFile(join(prefix, 'bin', 'codex', 'keep'), 'existing destination');
  await npmFixture();
  await expect(install()).rejects.toThrow();
  expect(await readFile(join(prefix, 'bin', 'codex', 'keep'), 'utf8')).toBe('existing destination');
  expect(await readdir(join(prefix, 'flight-finder-versions'))).toEqual([]);
  expect(await readdir(join(prefix, 'bin'))).toEqual(['codex']);
});
