import { prisma } from '@/lib/prisma';
import type { Prisma } from '@/generated/prisma/client';

/** Outbound delivery must not wait indefinitely for a database lock or statement. */
export async function notificationTransaction<T>(work: (tx: Prisma.TransactionClient) => Promise<T>, signal?: AbortSignal): Promise<T> {
  signal?.throwIfAborted();
  return prisma.$transaction(async tx => {
    await tx.$executeRaw`SET LOCAL statement_timeout = '2000ms'`;
    await tx.$executeRaw`SET LOCAL lock_timeout = '1000ms'`;
    signal?.throwIfAborted();
    const result = await work(tx);
    signal?.throwIfAborted();
    return result;
  }, { maxWait: 1000, timeout: 3000 });
}
