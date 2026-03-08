import { describe, it, expect } from 'vitest';
import { hashPassword, verifyHashedPassword } from './password';

describe('hashPassword', () => {
  it('produces salt:hex format', async () => {
    const hash = await hashPassword('test-password');
    // 16-byte salt = 32 hex chars, 64-byte key = 128 hex chars
    expect(hash).toMatch(/^[0-9a-f]{32}:[0-9a-f]{128}$/);
  });

  it('produces unique salts per call', async () => {
    const hash1 = await hashPassword('same-password');
    const hash2 = await hashPassword('same-password');
    const salt1 = hash1.split(':')[0];
    const salt2 = hash2.split(':')[0];
    expect(salt1).not.toBe(salt2);
  });
});

describe('verifyHashedPassword', () => {
  it('accepts correct password', async () => {
    const hash = await hashPassword('correct-horse');
    expect(await verifyHashedPassword('correct-horse', hash)).toBe(true);
  });

  it('rejects wrong password', async () => {
    const hash = await hashPassword('correct-horse');
    expect(await verifyHashedPassword('wrong-horse', hash)).toBe(false);
  });

  it('rejects malformed hash without colon', async () => {
    expect(await verifyHashedPassword('anything', 'nocolon')).toBe(false);
  });

  it('rejects empty hash', async () => {
    expect(await verifyHashedPassword('anything', '')).toBe(false);
  });

  it('rejects hash with wrong-length key', async () => {
    // timingSafeEqual throws on length mismatch, caught → false
    expect(await verifyHashedPassword('anything', 'ab:cd')).toBe(false);
  });
});
