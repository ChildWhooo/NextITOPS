import crypto from 'node:crypto';
import { getSetting, setSetting } from './systemSettings.js';

export const DEFAULT_PASSWORD_POLICY = {
  min_length: 10,
  require_upper: true,
  require_lower: true,
  require_number: true,
  require_symbol: true,
  expire_days: 90,
  notify_user: true,
};

const SIMPLE_SYMBOLS = '~!@#$%^&*.-_+=';

export async function getPasswordPolicy() {
  try {
    const stored = JSON.parse(await getSetting('password_policy', '{}'));
    return { ...DEFAULT_PASSWORD_POLICY, ...stored };
  } catch {
    return { ...DEFAULT_PASSWORD_POLICY };
  }
}

export async function savePasswordPolicy(policy) {
  await setSetting('password_policy', JSON.stringify(policy));
}

export function validatePassword(password, policy = DEFAULT_PASSWORD_POLICY) {
  const value = String(password || '');
  if (value.length < Number(policy.min_length || 6)) return `密码至少 ${policy.min_length || 6} 位`;
  if (policy.require_upper && !/[A-Z]/.test(value)) return '密码需包含大写字母';
  if (policy.require_lower && !/[a-z]/.test(value)) return '密码需包含小写字母';
  if (policy.require_number && !/[0-9]/.test(value)) return '密码需包含数字';
  if (policy.require_symbol && !/[~!@#$%^&*.\-_+=]/.test(value)) return '密码需包含符号（~!@#$%^&*.-_+=）';
  return '';
}

export function generatePassword(policy = DEFAULT_PASSWORD_POLICY) {
  const length = Math.max(Number(policy.min_length || 10), 8);
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const lower = 'abcdefghijkmnopqrstuvwxyz';
  const digits = '23456789';
  const pick = (chars) => chars[crypto.randomInt(chars.length)];
  const chars = [upper, lower, digits, SIMPLE_SYMBOLS].filter((_, index) => {
    if (index === 0) return policy.require_upper !== false;
    if (index === 1) return policy.require_lower !== false;
    if (index === 2) return policy.require_number !== false;
    return policy.require_symbol !== false;
  });
  const password = chars.map((set) => pick(set));
  const all = chars.join('');
  while (password.length < length) password.push(pick(all));
  for (let index = password.length - 1; index > 0; index -= 1) {
    const swap = crypto.randomInt(index + 1);
    [password[index], password[swap]] = [password[swap], password[index]];
  }
  return password.join('');
}

export function passwordExpiry(changedAt, policy) {
  if (!policy.expire_days || Number(policy.expire_days) <= 0) return null;
  const changed = changedAt ? new Date(changedAt).getTime() : 0;
  if (!changed) return null;
  return new Date(changed + Number(policy.expire_days) * 86400000).toISOString();
}

export function isPasswordExpired(changedAt, policy) {
  const expires = passwordExpiry(changedAt, policy);
  return Boolean(expires && new Date(expires).getTime() < Date.now());
}
