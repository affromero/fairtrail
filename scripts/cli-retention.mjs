import { lstat, readdir, readFile, realpath, rm } from 'node:fs/promises';
import { basename, join, sep } from 'node:path';

/** Refuse maintenance while any CLI could still need its installation's files. */
export async function assertManagedClisIdle(prefix, procRoot = '/proc') {
  const processes = await readdir(procRoot);
  for (const pid of processes.filter(value => /^\d+$/.test(value) && Number(value) !== process.pid)) {
    let command;
    try { command = await readFile(join(procRoot, pid, 'cmdline'), 'utf8'); }
    catch (error) { if (error.code === 'ENOENT' || error.code === 'ESRCH') continue; throw error; }
    if (command.split('\0').some(value => value.includes(`${prefix}${sep}`) || ['codex', 'claude'].includes(basename(value)))) {
      throw new Error('CLI retention refused while a managed CLI process is running');
    }
  }
  // Startup is sequential: only init and the waiting entrypoint may precede us.
  // The prefix must also be exclusive to this container (deployment verifies it).
  const ancestors = new Set([String(process.pid)]);
  let pid = String(process.pid);
  let entrypoint = false;
  while (pid !== '1') {
    const status = await readFile(join(procRoot, pid, 'status'), 'utf8');
    const parent = status.match(/^PPid:\s+(\d+)$/m)?.[1];
    if (!parent || parent === '0' || ancestors.has(parent)) throw new Error('CLI retention requires container startup ancestry');
    const command = (await readFile(join(procRoot, parent, 'cmdline'), 'utf8')).split('\0').filter(Boolean);
    const shell = ['sh', 'bash', 'ash'].includes(basename(command[0] ?? ''));
    const startup = shell && command.some(argument => basename(argument) === 'docker-entrypoint.sh');
    const init = parent === '1' && ['tini', 'docker-init'].includes(basename(command[0] ?? ''));
    if (!startup && !init) throw new Error('CLI retention requires container startup ancestry');
    entrypoint ||= startup;
    ancestors.add(parent);
    pid = parent;
  }
  if (!entrypoint || processes.some(value => /^\d+$/.test(value) && !ancestors.has(value))) {
    throw new Error('CLI retention requires quiescent container startup');
  }
}

/** Caller holds the installation lock. Unknown entries and recent versions stay. */
export async function retainCliVersions(prefix, { procRoot = '/proc', now = Date.now() } = {}) {
  await assertManagedClisIdle(prefix, procRoot);
  const root = join(prefix, 'flight-finder-versions');
  const active = new Set();
  for (const binary of ['codex', 'claude']) {
    try { active.add(await realpath(join(prefix, 'bin', binary))); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  const known = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || !/^(codex|claude)-\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?-[a-zA-Z0-9]{6}$/.test(entry.name)) continue;
    const directory = join(root, entry.name);
    let marker;
    try {
      if (!(await lstat(join(directory, 'activation.json'))).isFile()) continue;
      marker = JSON.parse(await readFile(join(directory, 'activation.json'), 'utf8'));
    }
    catch { continue; }
    if (!['codex', 'claude'].includes(marker.binary) || typeof marker.version !== 'string' || !entry.name.startsWith(`${marker.binary}-${marker.version}-`) || !Number.isFinite(marker.activatedAt)) continue;
    const information = await lstat(directory);
    if (!information.isDirectory() || information.isSymbolicLink()) continue;
    known.push({ directory, binary: marker.binary, activatedAt: marker.activatedAt });
  }
  const removed = [];
  for (const binary of ['codex', 'claude']) {
    const entries = known.filter(entry => entry.binary === binary).sort((a, b) => b.activatedAt - a.activatedAt);
    for (const entry of entries.slice(2)) {
      if (now - entry.activatedAt < 24 * 60 * 60_000 || [...active].some(file => file.startsWith(`${entry.directory}${sep}`))) continue;
      await rm(entry.directory, { recursive: true });
      removed.push(entry.directory);
    }
  }
  return removed;
}
