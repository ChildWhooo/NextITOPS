import { db as defaultDb } from '../db/index.js';
import { nowIso } from './helpers.js';

export async function getSetting(key, fallback = '', db = defaultDb) {
  const row = await db('system_settings').where({ setting_key: key }).first();
  return row?.setting_value ?? fallback;
}

export async function getSettings(keys, db = defaultDb) {
  const rows = await db('system_settings').whereIn('setting_key', keys);
  return Object.fromEntries(rows.map((row) => [row.setting_key, row.setting_value]));
}

export async function setSetting(key, value, db = defaultDb) {
  const existing = await db('system_settings').where({ setting_key: key }).first();
  if (existing) {
    await db('system_settings').where({ setting_key: key }).update({ setting_value: value, updated_at: nowIso() });
  } else {
    await db('system_settings').insert({ setting_key: key, setting_value: value, updated_at: nowIso() });
  }
}
