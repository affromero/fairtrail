import { cookies } from 'next/headers';
import { createHmac, timingSafeEqual } from 'crypto';

const INVITE_COOKIE = 'ft-invite';
const INVITE_MAX_AGE = 60 * 60 * 24 * 90; // 90 days

function getSecret(): string {
  const secret = process.env.ADMIN_SESSION_SECRET;
  if (!secret) throw new Error('ADMIN_SESSION_SECRET is not set');
  return secret;
}

export function createInviteToken(code: string): string {
  const payload = `invite:${code}:${Date.now()}`;
  const sig = createHmac('sha256', getSecret()).update(payload).digest('hex');
  return `${payload}.${sig}`;
}

export function verifyInviteToken(token: string): boolean {
  const lastDot = token.lastIndexOf('.');
  if (lastDot === -1) return false;

  const payload = token.slice(0, lastDot);
  const sig = token.slice(lastDot + 1);

  const expected = createHmac('sha256', getSecret()).update(payload).digest('hex');

  try {
    return timingSafeEqual(Buffer.from(sig, 'hex'), Buffer.from(expected, 'hex'));
  } catch {
    return false;
  }
}

export async function setInviteCookie(token: string): Promise<void> {
  const jar = await cookies();
  jar.set(INVITE_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: INVITE_MAX_AGE,
    path: '/',
  });
}

export async function getInviteCookie(): Promise<string | undefined> {
  const jar = await cookies();
  return jar.get(INVITE_COOKIE)?.value;
}

export async function hasValidInvite(): Promise<boolean> {
  const token = await getInviteCookie();
  if (!token) return false;
  return verifyInviteToken(token);
}
