import { spawn } from 'node:child_process';
import { readFile, mkdir, mkdtemp, realpath, symlink, rename, unlink, rm } from 'node:fs/promises';
import { dirname, isAbsolute, join } from 'node:path';

const versionsPath = new URL('../cli-versions.json', import.meta.url);
const deployedVersionsPath = new URL('./cli-versions.json', import.meta.url);
const definitions = JSON.parse(await readFile(versionsPath, 'utf8').catch(() => readFile(deployedVersionsPath, 'utf8')));
const provider = process.argv[2];
const supervised = process.argv[3] === '--supervised';
if (!Object.hasOwn(definitions, provider)) throw new Error('Choose codex or claude-code');
const definition = definitions[provider];
const version = process.env[definition.override] || definition.version;
if (!/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/.test(version)) throw new Error('CLI version must be an exact release, not a range or URL');
const prefix = process.env.NPM_CONFIG_PREFIX;
if (!prefix || !isAbsolute(prefix) || prefix === '/') throw new Error('A dedicated absolute NPM_CONFIG_PREFIX is required');
const env = Object.fromEntries(['PATH', 'HOME', 'TMPDIR', 'HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY', 'http_proxy', 'https_proxy', 'no_proxy', 'NODE_EXTRA_CA_CERTS', 'SSL_CERT_FILE'].flatMap(key => process.env[key] ? [[key, process.env[key]]] : []));
env.NODE_OPTIONS = '--max-old-space-size=256';
function run(command, args, timeout = 180_000) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { env, stdio: ['ignore', 'pipe', 'pipe'], detached: !supervised && process.platform !== 'win32' });
    let output = '', size = 0;
    const stop = () => {
      try { if (!supervised && child.pid && process.platform !== 'win32') process.kill(-child.pid, 'SIGKILL'); else child.kill('SIGKILL'); }
      catch (error) { if (error.code !== 'ESRCH') reject(error); }
    };
    const timer = setTimeout(stop, timeout);
    const collect = chunk => { size += chunk.length; if (size > 512_000) stop(); else output += chunk.toString(); };
    child.stdout.on('data', collect); child.stderr.on('data', collect);
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('close', (code, signal) => { clearTimeout(timer); if (code !== 0 || signal) reject(new Error('CLI installation or version verification failed; the previous CLI remains available')); else resolve(output); });
  });
}
const binary = join(prefix, 'bin', definition.binary);
const installed = await run(binary, ['--version'], 8000).catch(() => '');
if (installed.match(/\b\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?\b/)?.[0] === version) {
  console.log(JSON.stringify({ provider, version, changed: false }));
} else {
  const root = join(prefix, 'flight-finder-versions');
  await mkdir(root, { recursive: true, mode: 0o700 });
  const installation = await mkdtemp(join(root, `${definition.binary}-${version}-`));
  let activated = false;
  try {
  await run('npm', ['install', '--prefix', installation, '--no-save', '--ignore-scripts', '--no-audit', '--no-fund', `${definition.package}@${version}`]);
  if (provider === 'claude-code') {
    const packageDirectory = join(installation, 'node_modules', '@anthropic-ai', 'claude-code');
    const metadata = JSON.parse(await readFile(join(packageDirectory, 'package.json'), 'utf8'));
    // The official pinned installer replaces its executable placeholder with
    // the platform binary. Do not enable arbitrary dependency lifecycle scripts.
    if (metadata.scripts?.postinstall === 'node install.cjs') await run(process.execPath, [join(packageDirectory, 'install.cjs')], 8000);
  }
  const target = await realpath(join(installation, 'node_modules', '.bin', definition.binary));
  const observed = await run(target, ['--version'], 8000);
  if (observed.match(/\b\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?\b/)?.[0] !== version) throw new Error('Installed CLI version did not match the requested release');
  await mkdir(dirname(binary), { recursive: true });
  const temporaryLink = `${binary}.${process.pid}.${Date.now()}`;
  try { await symlink(target, temporaryLink); await rename(temporaryLink, binary); activated = true; }
  finally { await unlink(temporaryLink).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
  console.log(JSON.stringify({ provider, version, changed: true }));
  } finally {
    // Only this attempt's staging directory is disposable. Never remove an active or previous installation.
    if (!activated) await rm(installation, { recursive: true, force: true });
  }
}
