import { db as defaultDb, insertReturningId } from '../db/index.js';
import { nowIso } from './helpers.js';

function parseIds(value) {
  try {
    const list = JSON.parse(value || '[]');
    return Array.isArray(list) ? list.map(Number).filter((id) => Number.isInteger(id) && id > 0) : [];
  } catch {
    return [];
  }
}

export async function ensureDeletionPolicy(db = defaultDb) {
  let policy = await db('deletion_policies').orderBy('id').first();
  if (policy) return policy;
  const approver = await db('roles').where({ code: 'approver' }).first();
  const id = await insertReturningId(db('deletion_policies'), {
    approver_role_ids: JSON.stringify(approver ? [approver.id] : []),
    updated_by: null,
    updated_at: nowIso(),
  });
  return db('deletion_policies').where({ id }).first();
}

export async function getDeletionPolicy(db = defaultDb) {
  const policy = await ensureDeletionPolicy(db);
  const roleIds = parseIds(policy.approver_role_ids);
  const roles = roleIds.length
    ? await db('roles').whereIn('id', roleIds).select('id', 'code', 'name')
    : [];
  return {
    id: policy.id,
    approver_role_ids: roleIds,
    approver_roles: roles,
    updated_at: policy.updated_at,
  };
}

export async function canApproveDeletion(auth, db = defaultDb) {
  if (!auth) return false;
  if (auth.role?.code === 'admin') return true;
  const policy = await ensureDeletionPolicy(db);
  return parseIds(policy.approver_role_ids).includes(Number(auth.role?.id));
}
