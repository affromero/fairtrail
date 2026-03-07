import { scrypt, randomBytes, timingSafeEqual } from 'crypto';

const SALT_LENGTH = 16;
const KEY_LENGTH = 64;

export function hashPassword(password: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const salt = randomBytes(SALT_LENGTH).toString('hex');
    scrypt(password, salt, KEY_LENGTH, (err, derived) => {
      if (err) return reject(err);
      resolve(`${salt}:${derived.toString('hex')}`);
    });
  });
}

export function verifyHashedPassword(
  password: string,
  hash: string
): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const [salt, key] = hash.split(':');
    if (!salt || !key) return resolve(false);
    scrypt(password, salt, KEY_LENGTH, (err, derived) => {
      if (err) return reject(err);
      try {
        resolve(timingSafeEqual(Buffer.from(key, 'hex'), derived));
      } catch {
        resolve(false);
      }
    });
  });
}
