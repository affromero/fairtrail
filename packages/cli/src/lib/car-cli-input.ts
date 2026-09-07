import { constants } from 'node:fs';
import { open, readFile, realpath } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { homedir } from 'node:os';

async function inputFile(path: string, signal: AbortSignal) {
  const file = await open(path, constants.O_RDONLY | constants.O_NONBLOCK);
  try {
    if (!(await file.stat()).isFile()) throw new Error('Rental input must be a regular file or stdin');
    return file.createReadStream({ highWaterMark: 16 * 1024, signal });
  } catch (error) { await file.close(); throw error; }
}
export async function readCarInput(path: string, signal?: AbortSignal): Promise<unknown> {
  const deadline = AbortSignal.any([AbortSignal.timeout(30_000), ...(signal ? [signal] : [])]);
  deadline.throwIfAborted();
  const stream = path === '-' ? process.stdin : await inputFile(path, deadline);
  const abort = () => { stream.destroy(new Error('Rental input reading stopped')); };
  deadline.addEventListener('abort', abort, { once: true });
  const chunks: Buffer[] = []; let size = 0;
  try {
    deadline.throwIfAborted();
    for await (const chunk of stream) {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
      size += bytes.length;
      if (size > 64 * 1024) throw new Error('Rental JSON input exceeds 64 KiB');
      chunks.push(bytes);
    }
    try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))); }
    catch { throw new Error('Rental input must be valid UTF-8 JSON'); }
  } finally { deadline.removeEventListener('abort', abort); }
}

/** Installed commands require a real mount, not the container's disposable writable layer. */
export async function carReceiptDirectory(selected?: string): Promise<string> {
  const directory = resolve(selected ?? process.env.FLIGHT_FINDER_CAR_RECEIPTS ?? join(homedir(), '.flight-finder-car-receipts'));
  if (process.env.FLIGHT_FINDER_CAR_REQUIRE_MOUNT === '1') {
    const root = '/app/data', parent = await realpath(dirname(directory));
    if (parent !== root && !parent.startsWith(`${root}${sep}`)) throw new Error('Installed car receipts must remain in the persistent /app/data mount');
    const mounts = await readFile('/proc/self/mountinfo', 'utf8');
    if (!mounts.split('\n').some(line => line.split(' ')[4] === root)) throw new Error('Persistent /app/data storage is not mounted; car mutation refused');
  }
  return directory;
}
