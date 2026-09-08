import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import versions from '../../../../../cli-versions.json';
import { redis } from '../redis';
import { cliEnvironment } from './cli-environment';

export function cliUpdateInfo(provider: string) {
  const definition = versions[provider as keyof typeof versions];
  if (!definition) throw new Error('Choose a supported CLI provider');
  const targetVersion = process.env[definition.override] || definition.version;
  return { targetVersion, managedUpdate: process.env.INSTALL_CLI_PROVIDERS === 'true' && Boolean(process.env.NPM_CONFIG_PREFIX) && existsSync('/app/update-cli.mjs') };
}
export async function updateManagedCli(provider: string) {
  if (provider !== 'codex' && provider !== 'claude-code') throw new Error('Choose a supported CLI provider');
  const info = cliUpdateInfo(provider);
  if (!info.managedUpdate) throw new Error('This installation does not manage CLI updates; update the CLI on its host');
  if (!redis) throw new Error('CLI updates require Redis admission control');
  const owner = randomUUID();
  const accepted = await redis.set('cli-managed-update', owner, 'EX', 240, 'NX').catch(() => { throw new Error('CLI update admission control is unavailable'); });
  if (!accepted) throw new Error('A CLI update was recently started. Recheck the installed version before trying again.');
  try { return await new Promise<{ provider: string; version: string; changed: boolean }>((resolve, reject) => {
    const definition = versions[provider];
    const child = spawn(process.execPath, ['/app/update-cli.mjs', provider, '--supervised'], { stdio: ['ignore', 'pipe', 'pipe'], detached: process.platform !== 'win32',
      env: { ...cliEnvironment(provider), NPM_CONFIG_PREFIX: process.env.NPM_CONFIG_PREFIX, [definition.override]: info.targetVersion } });
    let output = '', bytes = 0, timedOut = false;
    const deadline = setTimeout(() => {
      timedOut = true;
      // Supervised npm children share this group, including their descendants.
      // Keep admission until close confirms that the updater has stopped.
      try {
        if (child.pid && process.platform !== 'win32') process.kill(-child.pid, 'SIGKILL');
        else child.kill('SIGKILL');
      } catch {
        child.kill('SIGKILL');
      }
    }, 210_000);
    child.stderr.resume();
    // The installer owns a bounded npm subprocess. Do not interrupt an atomic update when an HTTP client disconnects.
    child.stdout.on('data', (chunk: Buffer) => { bytes += chunk.length; if (bytes <= 16_000) output += chunk.toString(); });
    child.on('error', () => { clearTimeout(deadline); reject(new Error('CLI updater could not start')); });
    child.on('close', code => {
      clearTimeout(deadline);
      if (timedOut) { reject(new Error('CLI update timed out. Its activation status is uncertain; recheck the installed version before retrying.')); return; }
      if (code !== 0 || bytes > 16_000) { reject(new Error('CLI update failed. The previous installation is retained; recheck its version.')); return; }
      try {
        const result = JSON.parse(output.trim()) as { provider?: unknown; version?: unknown; changed?: unknown };
        if (result.provider !== provider || result.version !== info.targetVersion || typeof result.changed !== 'boolean') throw new Error('Invalid update receipt');
        resolve({ provider, version: info.targetVersion, changed: result.changed });
      } catch { reject(new Error('CLI update acknowledgement was incomplete. Recheck the installed version.')); }
    });
  }); } finally {
    await redis.eval("if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end", 1, 'cli-managed-update', owner).catch(() => undefined);
  }
}
