import crypto from 'node:crypto';
import { maskPhone } from './phone.js';

export const nowIso = () => new Date().toISOString();
export const today = () => nowIso().slice(0, 10);

export function parseJson(value, fallback = null) {
  if (value === null || value === undefined || value === '') return fallback;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

export function toBool(value) {
  if (value === true || value === 1) return true;
  if (value === false || value === 0) return false;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
}

export function paginate(query) {
  const page = Math.max(1, Number(query.page || 1));
  const pageSize = Math.min(200, Math.max(1, Number(query.pageSize || 20)));
  return { page, pageSize, limit: pageSize, offset: (page - 1) * pageSize };
}

export function slugify(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

export function randomToken(bytes = 24) {
  return crypto.randomBytes(bytes).toString('hex');
}

export function addHours(date, hours) {
  return new Date(new Date(date).getTime() + Number(hours || 0) * 3600 * 1000).toISOString();
}

export function publicUser(user) {
  if (!user) return null;
  const { password_hash, ...rest } = user;
  return { ...rest, phone: maskPhone(rest.phone) };
}

export function normalizeTags(tags) {
  if (!tags) return [];
  if (Array.isArray(tags)) {
    return tags.map((tag) =>
      typeof tag === 'string' ? { tag, value: '' } : { tag: tag.tag || tag.name || '', value: tag.value || '' },
    );
  }
  if (typeof tags === 'object') {
    return Object.entries(tags).map(([tag, value]) => ({ tag, value: String(value) }));
  }
  return [];
}

export function compactObject(object) {
  return Object.fromEntries(
    Object.entries(object || {}).filter(([, value]) => value !== undefined && value !== null),
  );
}

export function asArray(value, fallback = []) {
  if (Array.isArray(value)) return value;
  const parsed = parseJson(value, fallback);
  return Array.isArray(parsed) ? parsed : fallback;
}

export function httpError(statusCode, message, details) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.details = details;
  return error;
}

export function percent(part, total) {
  if (!total) return 0;
  return Math.round((Number(part) / Number(total)) * 1000) / 10;
}
