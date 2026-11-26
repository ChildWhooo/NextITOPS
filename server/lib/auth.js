import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { db } from '../db/index.js';
import { asArray, nowIso, publicUser } from './helpers.js';

export function signToken(user) {
  return jwt.sign({ sub: String(user.id) }, config.jwtSecret, {
    expiresIn: config.jwtExpiresIn,
    issuer: 'nextitops',
  });
}

export async function loadAuthUser(userId) {
  const row = await db('users')
    .leftJoin('roles', 'users.role_id', 'roles.id')
    .select(
      'users.*',
      'roles.code as role_code',
      'roles.name as role_name',
      'roles.permissions as role_permissions',
    )
    .where('users.id', userId)
    .first();
  if (!row) return null;
  const user = publicUser(row);
  user.role = {
    id: row.role_id,
    code: row.role_code,
    name: row.role_name,
    permissions: asArray(row.role_permissions, []),
  };
  user.permissions = user.role.permissions;
  delete user.role_code;
  delete user.role_name;
  delete user.role_permissions;
  return user;
}

export function hasPermission(user, permission) {
  if (!user) return false;
  if (user.role?.code === 'admin') return true;
  return Array.isArray(user.permissions) && user.permissions.includes(permission);
}

export async function authenticate(request, reply) {
  const header = request.headers.authorization || '';
  let token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token && request.cookies?.token) token = request.cookies.token;

  if (!token) {
    return reply.code(401).send({ message: '登录已过期，请重新登录' });
  }

  try {
    const payload = jwt.verify(token, config.jwtSecret, { issuer: 'nextitops' });
    const user = await loadAuthUser(payload.sub);
    if (!user || user.status !== 'active') {
      return reply.code(401).send({ message: '账号不可用，请联系管理员' });
    }
    request.auth = user;
  } catch {
    return reply.code(401).send({ message: '登录已过期，请重新登录' });
  }
}

export function requirePermission(...permissions) {
  return async function permissionGuard(request, reply) {
    const user = request.auth;
    if (!user) return reply.code(401).send({ message: '请先登录' });
    if (user.role?.code === 'admin') return;
    const allowed = permissions.some((permission) => hasPermission(user, permission));
    if (!allowed) {
      return reply.code(403).send({
        message: '当前角色没有此操作权限',
        details: { required: permissions },
      });
    }
  };
}

export function sanitizeUser(user) {
  if (!user) return null;
  return publicUser(user);
}

export async function markLogin(userId) {
  await db('users').where({ id: userId }).update({ last_login_at: nowIso(), updated_at: nowIso() });
}
