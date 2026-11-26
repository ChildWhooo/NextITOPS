import crypto from 'node:crypto';
import { config } from '../config.js';

const key = crypto.createHash('sha256').update(process.env.PHONE_ENCRYPTION_KEY || config.jwtSecret).digest();
const legacyKey = crypto.createHash('sha256').update(config.jwtSecret).digest();

export function maskPhone(value) {
  const phone = decryptPhone(value).replace(/\s+/g, '');
  return phone.length >= 7 ? `${phone.slice(0, 3)}****${phone.slice(-4)}` : phone;
}

export function encryptPhone(value) {
  const phone = String(value || '').trim();
  if (!phone) return '';
  if (phone.startsWith('enc:v1:')) return phone;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(phone, 'utf8'), cipher.final()]);
  return `enc:v1:${iv.toString('base64')}:${cipher.getAuthTag().toString('base64')}:${encrypted.toString('base64')}`;
}

export function decryptPhone(value) {
  const stored = String(value || '');
  if (!stored.startsWith('enc:v1:')) return stored;
  const attempt = (candidateKey) => {
    try {
      const [, , iv, tag, body] = stored.split(':');
      const decipher = crypto.createDecipheriv('aes-256-gcm', candidateKey, Buffer.from(iv, 'base64'));
      decipher.setAuthTag(Buffer.from(tag, 'base64'));
      return Buffer.concat([decipher.update(Buffer.from(body, 'base64')), decipher.final()]).toString('utf8');
    } catch {
      return null;
    }
  };
  const current = attempt(key);
  if (current !== null) return current;
  // Compatibility for phone values encrypted before PHONE_ENCRYPTION_KEY was introduced.
  return attempt(legacyKey) ?? '';
}
