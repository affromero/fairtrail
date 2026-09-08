import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { expect, it } from 'vitest';
import { linkCliCancellation } from './cli-cancellation';

it.skipIf(process.platform === 'win32')('terminates descendants holding pipes after the inference leader exits', async () => {
  const proc = spawn(process.execPath, ['-e', `
    const { spawn } = require('node:child_process');
    const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'inherit' });
    child.unref();
  `], { detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  const controller = new AbortController();
  const unlink = linkCliCancellation(proc, controller.signal);
  const closed = once(proc, 'close');
  try {
    await once(proc, 'exit');
    expect(proc.exitCode).toBe(0);
    controller.abort();
    await closed;
    expect(proc.stdout?.destroyed).toBe(true);
    expect(proc.stderr?.destroyed).toBe(true);
  } finally {
    controller.abort();
    unlink();
  }
});
