import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { db, insertReturningId } from '../db/index.js';
import { ROLE_PERMISSIONS } from '../config.js';
import { authenticate, requirePermission } from '../lib/auth.js';
import { audit, enrichAuditRows } from '../lib/audit.js';
import { asArray, nowIso, publicUser } from '../lib/helpers.js';
import { encryptPhone } from '../lib/phone.js';
import { generatePassword, getPasswordPolicy, savePasswordPolicy, validatePassword } from '../lib/passwordPolicy.js';
import { notifyPassword } from '../services/notifications.js';
import { AVATAR_DIR, ensureAvatarDir, removeAvatarFile } from '../lib/avatars.js';

const userSelect = [
  'users.id',
  'users.username',
  'users.name',
  'users.email',
  'users.phone',
  'users.department',
  'users.title',
  'users.role_id',
  'users.status',
  'users.avatar_color',
  'users.avatar_url',
  'users.feishu_open_id',
  'users.wecom_userid',
  'users.last_login_at',
  'users.password_changed_at',
  'users.allowed_ips',
  'users.bound_mac',
  'users.created_at',
  'users.updated_at',
  'roles.name as role_name',
  'roles.code as role_code',
];

const permissionCodes = new Set(ROLE_PERMISSIONS.map((permission) => permission.code));

function parsePermissions(value) {
  return asArray(value, []).filter((code) => permissionCodes.has(code));
}

const AVATAR_MAX_BYTES = 1024 * 1024;

function avatarExtension(buffer) {
  if (!buffer || buffer.length < 12) return null;
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'jpg';
  if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP') return 'webp';
  if (buffer.subarray(0, 3).toString('ascii') === 'GIF') return 'gif';
  return null;
}

export default async function userRoutes(app) {
  app.get('/api/system/password-policy', { preHandler: [authenticate, requirePermission('system.user_manage')] }, async () => ({ data: await getPasswordPolicy() }));

  app.put('/api/system/password-policy', { preHandler: [authenticate, requirePermission('system.user_manage')] }, async (request, reply) => {
    const schema = z.object({
      min_length: z.coerce.number().int().min(6).max(64),
      require_upper: z.boolean(),
      require_lower: z.boolean(),
      require_number: z.boolean(),
      require_symbol: z.boolean(),
      expire_days: z.coerce.number().int().min(0).max(3650),
      notify_user: z.boolean(),
    });
    const policy = schema.parse(request.body || {});
    await savePasswordPolicy(policy);
    await audit(request, { action: 'system.password_policy', entityType: 'system', summary: '更新密码复杂度与过期策略' });
    return { data: policy };
  });

  app.get('/api/users/export', { preHandler: [authenticate, requirePermission('system.user_manage')] }, async (request, reply) => {    const users = await db('users').leftJoin('roles', 'users.role_id', 'roles.id').select(
      'users.username', 'users.name', 'users.email', 'users.phone', 'users.department', 'users.title',
      'roles.code as role_code', 'users.status', 'users.feishu_open_id', 'users.wecom_userid',
    ).orderBy('users.id');
    const escape = (value) => `"${String(value ?? '').replace(/"/g, '""')}"`;
    const header = ['用户名', '姓名', '邮箱', '手机号', '部门', '职位', '角色标识', '状态', '飞书open_id', '企业微信userid', '初始密码'];
    const lines = [header.map(escape).join(',')];
    for (const user of users) lines.push([user.username, user.name, user.email, user.phone, user.department, user.title, user.role_code, user.status, user.feishu_open_id, user.wecom_userid, ''].map(escape).join(','));
    reply.header('Content-Type', 'text/csv; charset=utf-8');
    reply.header('Content-Disposition', `attachment; filename="users-${new Date().toISOString().slice(0, 10)}.csv"`);
    return `\uFEFF${lines.join('\r\n')}`;
  });

  app.post('/api/users/import', { preHandler: [authenticate, requirePermission('system.user_manage')] }, async (request, reply) => {
    const schema = z.object({ rows: z.array(z.record(z.any())).min(1).max(500) });
    const { rows } = schema.parse(request.body || {});
    const roles = await db('roles').select('id', 'code', 'name');
    const roleByCode = new Map(roles.map((role) => [role.code, role]));
    const roleByName = new Map(roles.map((role) => [role.name, role]));
    let created = 0;
    let updated = 0;
    const errors = [];
    for (const [index, row] of rows.entries()) {
      const username = String(row['用户名'] || row.username || '').trim();
      const name = String(row['姓名'] || row.name || '').trim();
      const roleValue = String(row['角色标识'] || row.role_code || row['角色'] || row.role_name || '').trim();
      const role = roleByCode.get(roleValue) || roleByName.get(roleValue);
      if (!/^[a-zA-Z0-9_.-]{3,}$/.test(username) || !name || !role) {
        errors.push({ row: index + 2, message: '用户名、姓名或角色无效' });
        continue;
      }
      const email = String(row['邮箱'] || row.email || '').trim();
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        errors.push({ row: index + 2, message: '邮箱格式不正确' });
        continue;
      }
      const status = String(row['状态'] || row.status || 'active') === 'disabled' ? 'disabled' : 'active';
      const profile = {
        name,
        email,
        phone: encryptPhone(String(row['手机号'] || row.phone || '').trim()),
        department: String(row['部门'] || row.department || '').trim(),
        title: String(row['职位'] || row.title || '').trim(),
        role_id: role.id,
        status,
        feishu_open_id: String(row['飞书open_id'] || row.feishu_open_id || '').trim(),
        wecom_userid: String(row['企业微信userid'] || row.wecom_userid || '').trim(),
        avatar_color: row.avatar_color || '#4f6ef7',
        updated_at: nowIso(),
      };
      const existing = await db('users').where({ username }).first();
      if (existing) {
        if (existing.username === 'admin') { errors.push({ row: index + 2, message: '内置管理员账号不允许导入覆盖' }); continue; }
        await db('users').where({ id: existing.id }).update(profile);
        updated += 1;
      } else {
        const password = String(row['初始密码'] || row.password || '').trim() || 'ChangeMe123';
        if (password.length < 6) { errors.push({ row: index + 2, message: '初始密码至少 6 位' }); continue; }
        await insertReturningId(db('users'), { ...profile, username, password_hash: bcrypt.hashSync(password, 10), created_at: nowIso() });
        created += 1;
      }
    }
    await audit(request, { action: 'user.import', entityType: 'user', summary: `导入用户：新建 ${created}，更新 ${updated}` });
    return { ok: true, created, updated, failed: errors.length, errors };
  });

  app.post('/api/users/batch', { preHandler: [authenticate, requirePermission('system.user_manage')] }, async (request, reply) => {
    const schema = z.object({
      ids: z.array(z.coerce.number().int().positive()).min(1),
      action: z.enum(['role', 'status', 'delete']),
      role_id: z.coerce.number().int().positive().optional(),
      status: z.enum(['active', 'disabled']).optional(),
    });
    const body = schema.parse(request.body || {});
    const targets = await db('users').whereIn('id', body.ids);
    const protectedUsers = targets.filter((user) => user.username === 'admin' || user.id === request.auth.id);
    if (body.action === 'delete' && protectedUsers.length) return reply.code(400).send({ message: '不能删除内置管理员或当前登录账号' });
    if (body.action === 'status') {
      if (!body.status) return reply.code(400).send({ message: '请选择状态' });
      const ids = targets.filter((user) => !protectedUsers.some((item) => item.id === user.id)).map((user) => user.id);
      if (ids.length) await db('users').whereIn('id', ids).update({ status: body.status, updated_at: nowIso() });
    } else if (body.action === 'role') {
      if (!body.role_id || !(await db('roles').where({ id: body.role_id }).first())) return reply.code(400).send({ message: '角色不存在' });
      const ids = targets.filter((user) => user.username !== 'admin').map((user) => user.id);
      if (ids.length) await db('users').whereIn('id', ids).update({ role_id: body.role_id, updated_at: nowIso() });
    } else {
      await db('users').whereIn('id', body.ids).del();
    }
    await audit(request, { action: 'user.batch', entityType: 'user', summary: `批量${body.action === 'delete' ? '删除' : body.action === 'role' ? '修改角色' : '修改状态'} ${body.ids.length} 个用户` });
    return { ok: true, affected: body.ids.length };
  });

  app.get('/api/users', { preHandler: authenticate }, async (request) => {
    const { q, status, role_id } = request.query || {};
    const query = db('users').leftJoin('roles', 'users.role_id', 'roles.id').select(userSelect);
    if (q) query.where((builder) => builder.where('users.name', 'like', `%${q}%`).orWhere('users.username', 'like', `%${q}%`).orWhere('users.department', 'like', `%${q}%`));
    if (status) query.where('users.status', status);
    if (role_id) query.where('users.role_id', role_id);
    const sortMap = {
      username: 'users.username', name: 'users.name', role_name: 'roles.name', department: 'users.department',
      status: 'users.status', last_login_at: 'users.last_login_at', created_at: 'users.created_at',
    };
    const sortBy = sortMap[request.query.sortBy] || 'users.username';
    const sortDir = String(request.query.sortDir).toLowerCase() === 'desc' ? 'desc' : 'asc';
    const users = await query.orderBy(sortBy, sortDir);
    return { data: users.map(publicUser) };
  });

  app.get('/api/roles', { preHandler: authenticate }, async () => {
    const roles = await db('roles').select('*').orderBy('id');
    const counts = await db('users').select('role_id').count({ count: '*' }).groupBy('role_id');
    const countMap = Object.fromEntries(counts.map((row) => [row.role_id, Number(row.count)]));
    return {
      data: roles.map((role) => ({
        ...role,
        permissions: parsePermissions(role.permissions),
        user_count: countMap[role.id] || 0,
      })),
    };
  });

  app.get('/api/permissions', { preHandler: authenticate }, async () => ({ data: ROLE_PERMISSIONS }));

  app.post(
    '/api/users',
    { preHandler: [authenticate, requirePermission('system.user_manage')] },
    async (request, reply) => {
      const schema = z.object({
        username: z.string().trim().min(3, '用户名至少 3 位').regex(/^[a-zA-Z0-9_.-]+$/, '用户名只能包含字母、数字、点、横线与下划线'),
        password: z.string().optional().default(''),
        notify_user: z.boolean().optional().default(false),
        name: z.string().trim().min(1, '请输入姓名'),
        email: z.string().email('邮箱格式不正确').or(z.literal('')).optional(),
        phone: z.string().optional(),
        department: z.string().optional(),
        title: z.string().optional(),
        role_id: z.coerce.number().int().positive(),
        status: z.enum(['active', 'disabled']).default('active'),
        avatar_color: z.string().default('#4f6ef7'),
        feishu_open_id: z.string().optional().default(''),
        wecom_userid: z.string().optional().default(''),
        allowed_ips: z.string().max(500).optional().default(''),
        bound_mac: z.string().max(80).optional().default(''),
      });
      const body = schema.parse(request.body || {});
      const exists = await db('users').where({ username: body.username }).first();
      if (exists) return reply.code(409).send({ message: '用户名已存在' });
      const role = await db('roles').where({ id: body.role_id }).first();
      if (!role) return reply.code(400).send({ message: '所选角色不存在' });
      const policy = await getPasswordPolicy();
      const initialPassword = body.password || generatePassword(policy);
      const passwordError = validatePassword(initialPassword, policy);
      if (passwordError) return reply.code(400).send({ message: passwordError });
      const ts = nowIso();
      const { password, notify_user, ...profile } = body;
      const id = await insertReturningId(db('users'), {
        ...profile,
        email: body.email || '',
        phone: encryptPhone(body.phone),
        department: body.department || '',
        title: body.title || '',
        password_hash: bcrypt.hashSync(initialPassword, 10),
        password_changed_at: ts,
        must_change_password: true,
        created_at: ts,
        updated_at: ts,
      });
      const user = await db('users').leftJoin('roles', 'users.role_id', 'roles.id').select(userSelect).where('users.id', id).first();
      if (notify_user) await notifyPassword(user, initialPassword).catch(() => null);
      await audit(request, { action: 'user.create', entityType: 'user', entityId: id, summary: `创建用户 ${body.name}` });
      return reply.code(201).send({ data: user, initial_password: initialPassword, notified: Boolean(notify_user) });
    },
  );

  app.put(
    '/api/users/:id',
    { preHandler: [authenticate, requirePermission('system.user_manage')] },
    async (request, reply) => {
      const id = Number(request.params.id);
      const user = await db('users').where({ id }).first();
      if (!user) return reply.code(404).send({ message: '用户不存在' });
      const schema = z.object({
        name: z.string().trim().min(1).optional(),
        email: z.string().email('邮箱格式不正确').or(z.literal('')).optional(),
        phone: z.string().optional(),
        department: z.string().optional(),
        title: z.string().optional(),
        role_id: z.coerce.number().int().positive().optional(),
        status: z.enum(['active', 'disabled']).optional(),
        avatar_color: z.string().optional(),
        feishu_open_id: z.string().optional(),
        wecom_userid: z.string().optional(),
        allowed_ips: z.string().max(500).optional(),
        bound_mac: z.string().max(80).optional(),
        password: z.string().optional().or(z.literal('')),
      });
      const body = schema.parse(request.body || {});
      if (id === request.auth.id && body.status === 'disabled') {
        return reply.code(400).send({ message: '不能停用当前登录账号' });
      }
      const update = { ...body, updated_at: nowIso() };
      if (body.phone !== undefined) update.phone = String(body.phone).includes('*') ? user.phone : encryptPhone(body.phone);
      delete update.password;
      if (body.password) {
        const passwordError = validatePassword(body.password, await getPasswordPolicy());
        if (passwordError) return reply.code(400).send({ message: passwordError });
        update.password_hash = bcrypt.hashSync(body.password, 10);
        update.password_changed_at = nowIso();
        update.must_change_password = true;
      }
      if (body.role_id) {
        const role = await db('roles').where({ id: body.role_id }).first();
        if (!role) return reply.code(400).send({ message: '所选角色不存在' });
      }
      await db('users').where({ id }).update(update);
      const updated = await db('users').leftJoin('roles', 'users.role_id', 'roles.id').select(userSelect).where('users.id', id).first();
      await audit(request, { action: 'user.update', entityType: 'user', entityId: id, summary: `更新用户 ${updated.name}` });
      return { data: updated };
    },
  );

  app.delete(
    '/api/users/:id',
    { preHandler: [authenticate, requirePermission('system.user_manage')] },
    async (request, reply) => {
      const id = Number(request.params.id);
      if (id === request.auth.id) return reply.code(400).send({ message: '不能删除当前登录账号' });
      const user = await db('users').where({ id }).first();
      if (!user) return reply.code(404).send({ message: '用户不存在' });
      if (user.username === 'admin') return reply.code(400).send({ message: '内置管理员账号不可删除' });
      await db('users').where({ id }).del();
      await audit(request, { action: 'user.delete', entityType: 'user', entityId: id, summary: `删除用户 ${user.name}` });
      return { ok: true };
    },
  );

  app.post(
    '/api/roles',
    { preHandler: [authenticate, requirePermission('system.role_manage')] },
    async (request, reply) => {
      const schema = z.object({
        code: z.string().trim().min(2).regex(/^[a-z][a-z0-9_-]+$/, '角色标识需为小写字母、数字、横线'),
        name: z.string().trim().min(1),
        description: z.string().optional(),
        permissions: z.array(z.string()).default([]),
      });
      const body = schema.parse(request.body || {});
      if (await db('roles').where({ code: body.code }).first()) {
        return reply.code(409).send({ message: '角色标识已存在' });
      }
      const ts = nowIso();
      const id = await insertReturningId(db('roles'), {
        code: body.code,
        name: body.name,
        description: body.description || '',
        permissions: JSON.stringify(parsePermissions(body.permissions)),
        is_system: false,
        created_at: ts,
        updated_at: ts,
      });
      await audit(request, { action: 'role.create', entityType: 'role', entityId: id, summary: `创建角色 ${body.name}` });
      return reply.code(201).send({ data: { id, ...body } });
    },
  );

  app.put(
    '/api/roles/:id',
    { preHandler: [authenticate, requirePermission('system.role_manage')] },
    async (request, reply) => {
      const id = Number(request.params.id);
      const role = await db('roles').where({ id }).first();
      if (!role) return reply.code(404).send({ message: '角色不存在' });
      if (role.code === 'admin') return reply.code(400).send({ message: '系统管理员角色不可修改' });
      const schema = z.object({
        name: z.string().trim().min(1).optional(),
        description: z.string().optional(),
        permissions: z.array(z.string()).optional(),
        is_active: z.boolean().optional(),
      });
      const body = schema.parse(request.body || {});
      await db('roles')
        .where({ id })
        .update({
          ...(body.name !== undefined ? { name: body.name } : {}),
          ...(body.description !== undefined ? { description: body.description } : {}),
          ...(body.permissions !== undefined ? { permissions: JSON.stringify(parsePermissions(body.permissions)) } : {}),
          updated_at: nowIso(),
        });
      await audit(request, { action: 'role.update', entityType: 'role', entityId: id, summary: `更新角色 ${body.name || role.name}` });
      return { ok: true };
    },
  );

  app.delete(
    '/api/roles/:id',
    { preHandler: [authenticate, requirePermission('system.role_manage')] },
    async (request, reply) => {
      const id = Number(request.params.id);
      const role = await db('roles').where({ id }).first();
      if (!role) return reply.code(404).send({ message: '角色不存在' });
      if (role.is_system) return reply.code(400).send({ message: '内置角色不可删除' });
      const used = await db('users').where({ role_id: id }).count({ count: '*' }).first();
      if (Number(used?.count || 0) > 0) return reply.code(409).send({ message: '该角色下仍有用户，无法删除' });
      await db('roles').where({ id }).del();
      await audit(request, { action: 'role.delete', entityType: 'role', entityId: id, summary: `删除角色 ${role.name}` });
      return { ok: true };
    },
  );

  app.get(
    '/api/audit-logs',
    { preHandler: [authenticate] },
    async (request) => {
      const page = Math.max(1, Number(request.query.page || 1));
      const pageSize = Math.min(100, Math.max(1, Number(request.query.pageSize || 20)));
      const query = db('audit_logs');
      if (!['admin', 'auditor'].includes(request.auth.role?.code)) {
        query.where((builder) => {
          builder.where('user_id', request.auth.id)
            .orWhere((inner) => inner.where('entity_type', 'user').where('entity_id', request.auth.id))
            .orWhere((inner) => inner.where('entity_type', 'ticket').whereExists(
              db('tickets').select(1).whereRaw('tickets.id = audit_logs.entity_id').where((ticketQuery) => ticketQuery.where('requester_id', request.auth.id).orWhere('assignee_id', request.auth.id)),
            ))
            .orWhere((inner) => inner.where('entity_type', 'ci').whereExists(
              db('cis').select(1).whereRaw('cis.id = audit_logs.entity_id').where((ciQuery) => ciQuery.where('owner_id', request.auth.id).orWhere('asset_manager_id', request.auth.id).orWhereExists(
                db('ci_acl').select(1).whereRaw('ci_acl.ci_id = cis.id').where('ci_acl.user_id', request.auth.id),
              )),
            ));
        });
      }
      if (request.query.q) {
        query.where((builder) =>
          builder
            .where('summary', 'like', `%${request.query.q}%`)
            .orWhere('actor_name', 'like', `%${request.query.q}%`)
            .orWhere('action', 'like', `%${request.query.q}%`),
        );
      }
      if (request.query.category === 'api') query.where((builder) => builder.where('action', 'like', 'zabbix.%').orWhere('action', 'like', 'webhook.%').orWhere('action', 'like', 'integration.%'));
      else if (request.query.category === 'system') query.where((builder) => builder.where('action', 'like', 'system.%').orWhere('action', 'like', 'maintenance.%').orWhere('action', 'like', 'notification.%').orWhere('action', 'like', 'map.%'));
      else if (request.query.category === 'user') query.where((builder) => builder.where('action', 'not like', 'zabbix.%').where('action', 'not like', 'webhook.%').where('action', 'not like', 'integration.%').where('action', 'not like', 'system.%').where('action', 'not like', 'maintenance.%').where('action', 'not like', 'notification.%').where('action', 'not like', 'map.%'));
      if (request.query.from) query.where('created_at', '>=', String(request.query.from));
      if (request.query.to) query.where('created_at', '<=', String(request.query.to));
      if (request.query.actor) query.where('actor_name', 'like', `%${request.query.actor}%`);
      if (request.query.action) query.where('action', 'like', `%${request.query.action}%`);
      if (request.query.entity_type) query.where('entity_type', request.query.entity_type);
      const totalRow = await query.clone().count({ count: '*' }).first();
      const rows = await query
        .select('*')
        .orderBy('created_at', 'desc')
        .limit(pageSize)
        .offset((page - 1) * pageSize);
      const categoryOf = (action) => {
        if (['zabbix', 'webhook', 'integration'].some((prefix) => String(action).startsWith(`${prefix}.`))) return 'api';
        if (['system', 'maintenance', 'notification', 'map'].some((prefix) => String(action).startsWith(`${prefix}.`))) return 'system';
        return 'user';
      };
      return {
        data: (await enrichAuditRows(rows)).map((row) => ({ ...row, category: categoryOf(row.action) })),
        pagination: { page, pageSize, total: Number(totalRow?.count || 0) },
      };
    },
  );

  app.post('/api/profile/avatar', { preHandler: authenticate }, async (request, reply) => {
    let upload;
    try {
      upload = await request.file({ limits: { fileSize: AVATAR_MAX_BYTES, files: 1 } });
    } catch (error) {
      if (error?.statusCode === 413 || error?.code === 'FST_REQ_FILE_TOO_LARGE') {
        return reply.code(413).send({ message: '头像图片不能超过 1MB' });
      }
      return reply.code(400).send({ message: '请上传头像图片' });
    }
    if (!upload) return reply.code(400).send({ message: '请选择头像图片' });

    let buffer;
    try {
      buffer = await upload.toBuffer();
    } catch {
      return reply.code(413).send({ message: '头像图片不能超过 1MB' });
    }
    if (upload.truncated || buffer.length > AVATAR_MAX_BYTES) {
      return reply.code(413).send({ message: '头像图片不能超过 1MB' });
    }
    const extension = avatarExtension(buffer);
    if (!extension) return reply.code(400).send({ message: '头像仅支持 JPG、PNG、WebP 或 GIF 图片' });

    await ensureAvatarDir();
    const filename = `${crypto.randomUUID()}.${extension}`;
    await fs.writeFile(path.join(AVATAR_DIR, filename), buffer, { mode: 0o644 });
    const current = await db('users').where({ id: request.auth.id }).first('avatar_url');
    const avatarUrl = `/api/avatars/${filename}`;
    await db('users').where({ id: request.auth.id }).update({ avatar_url: avatarUrl, updated_at: nowIso() });
    await removeAvatarFile(current?.avatar_url);
    return { data: { avatar_url: avatarUrl } };
  });

  app.delete('/api/profile/avatar', { preHandler: authenticate }, async (request) => {
    const current = await db('users').where({ id: request.auth.id }).first('avatar_url');
    await db('users').where({ id: request.auth.id }).update({ avatar_url: '', updated_at: nowIso() });
    await removeAvatarFile(current?.avatar_url);
    return { data: { avatar_url: '' } };
  });

  app.get('/api/profile', { preHandler: authenticate }, async (request) => {
    const user = await db('users').leftJoin('roles', 'users.role_id', 'roles.id').select(userSelect).where('users.id', request.auth.id).first();
    return { data: publicUser(user) };
  });

  app.put('/api/profile', { preHandler: authenticate }, async (request) => {
    const schema = z.object({
      name: z.string().trim().min(1).optional(),
      email: z.string().email().or(z.literal('')).optional(),
      phone: z.string().optional(),
      title: z.string().optional(),
      feishu_open_id: z.string().optional(),
      wecom_userid: z.string().optional(),
    });
    const body = schema.parse(request.body || {});
    const current = await db('users').where({ id: request.auth.id }).first();
    const update = { ...body, updated_at: nowIso() };
    if (body.phone !== undefined) update.phone = String(body.phone).includes('*') ? current.phone : encryptPhone(body.phone);
    await db('users').where({ id: request.auth.id }).update(update);
    const user = await db('users').leftJoin('roles', 'users.role_id', 'roles.id').select(userSelect).where('users.id', request.auth.id).first();
    return { data: publicUser(user) };
  });
}
