import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { db } from '../db/index.js';
import { config, ROLE_PERMISSIONS } from '../config.js';
import { authenticate, loadAuthUser, markLogin, signToken } from '../lib/auth.js';
import { audit, clientIp } from '../lib/audit.js';
import { nowIso } from '../lib/helpers.js';
import { PRIVACY_POLICY, PRIVACY_VERSION, privacyMeta } from '../lib/privacy.js';
import { getSetting } from '../lib/systemSettings.js';
import { getPasswordPolicy, isPasswordExpired, passwordExpiry, validatePassword } from '../lib/passwordPolicy.js';

const loginSchema = z.object({
  username: z.string().trim().min(1, '请输入用户名'),
  password: z.string().min(1, '请输入密码'),
  privacyConsent: z.boolean().optional().default(false),
});

function attemptKey(request, username) {
  return `${request.ip}:${String(username).toLowerCase()}`;
}

const loginAttempts = new Map();
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_ATTEMPTS = 8;

function ipMatches(ip, patterns) {
  const list = String(patterns || '').split(/[\s,;]+/).map((item) => item.trim()).filter(Boolean);
  if (!list.length) return false;
  return list.some((pattern) => pattern === ip || (pattern.endsWith('*') && ip.startsWith(pattern.slice(0, -1))) || (pattern.endsWith('.') && ip.startsWith(pattern)));
}

async function loginSecurity() {
  try { return { max_failures: LOGIN_MAX_ATTEMPTS, lock_minutes: 15, ip_whitelist: '', ip_blacklist: '', ...JSON.parse(await getSetting('login_security', '{}')) }; }
  catch { return { max_failures: LOGIN_MAX_ATTEMPTS, lock_minutes: 15, ip_whitelist: '', ip_blacklist: '' }; }
}

function checkLoginRate(key, policy) {
  const record = loginAttempts.get(key);
  if (!record) return { locked: false };
  const windowMs = Math.max(1, Number(policy.lock_minutes || 15)) * 60000;
  if (Date.now() - record.firstAt > windowMs) {
    loginAttempts.delete(key);
    return { locked: false };
  }
  return { locked: record.count >= Number(policy.max_failures || 8), remainingMs: windowMs - (Date.now() - record.firstAt) };
}

function recordLoginFailure(key, policy) {
  const record = loginAttempts.get(key);
  const windowMs = Math.max(1, Number(policy.lock_minutes || 15)) * 60000;
  if (!record || Date.now() - record.firstAt > windowMs) {
    loginAttempts.set(key, { count: 1, firstAt: Date.now() });
  } else {
    record.count += 1;
  }
}

export default async function authRoutes(app) {
  app.get('/api/auth/config', async () => ({
    appName: 'NextITOps',
    privacy: privacyMeta(),
  }));

  app.get('/api/privacy', async () => {
    const systemName = (await getSetting('system_name', 'NextITOps')) || 'NextITOps';
    const replace = (value) => String(value || '').replaceAll('NextITOps', systemName);
    let custom = null;
    try { custom = JSON.parse(await getSetting('custom_privacy', '')); } catch { custom = null; }
    if (custom?.title) {
      return {
        ...privacyMeta(),
        title: replace(custom.title),
        summary: replace(custom.summary),
        sections: Array.isArray(custom.sections) ? custom.sections : [],
      };
    }
    return {
      ...PRIVACY_POLICY,
      title: replace(PRIVACY_POLICY.title),
      summary: replace(PRIVACY_POLICY.summary),
      sections: PRIVACY_POLICY.sections.map((section) => ({
        ...section,
        paragraphs: section.paragraphs?.map(replace),
        bullets: section.bullets?.map(replace),
      })),
    };
  });

  app.post('/api/auth/login', async (request, reply) => {
    const { username, password, privacyConsent } = loginSchema.parse(request.body || {});
    const security = await loginSecurity();
    const ip = clientIp(request);
    if (ipMatches(ip, security.ip_blacklist) || (security.ip_whitelist && !ipMatches(ip, security.ip_whitelist))) {
      return reply.code(403).send({ message: '当前 IP 不允许登录，请联系系统管理员' });
    }
    const key = attemptKey(request, username);
    const rate = checkLoginRate(key, security);
    if (rate.locked) {
      return reply.code(429).send({ message: `登录失败次数过多，请 ${Math.ceil((rate.remainingMs || 0) / 60000)} 分钟后再试` });
    }
    const row = await db('users').whereRaw('lower(username) = ?', [username.toLowerCase()]).first();
    if (!row || row.status !== 'active' || !bcrypt.compareSync(password, row.password_hash)) {
      recordLoginFailure(key, security);
      return reply.code(401).send({ message: '用户名或密码不正确' });
    }
    if (row.allowed_ips && !ipMatches(ip, row.allowed_ips)) {
      return reply.code(403).send({ message: '当前 IP 不在该账号的登录白名单中' });
    }
    const clientMac = String(request.headers['x-client-mac'] || request.headers['x-forwarded-client-mac'] || '').toLowerCase();
    if (row.bound_mac && clientMac && clientMac !== String(row.bound_mac).toLowerCase()) {
      return reply.code(403).send({ message: '当前设备 MAC 与账号绑定信息不一致' });
    }
    loginAttempts.delete(key);
    const consentCurrent =
      row.privacy_consent_version === PRIVACY_VERSION && Boolean(row.privacy_consent_at);
    if (!consentCurrent && !privacyConsent) {
      return {
        requiresConsent: true,
        account: { username: row.username, name: row.name },
        privacy: privacyMeta(),
      };
    }
    if (!consentCurrent && privacyConsent) {
      await db('users')
        .where({ id: row.id })
        .update({
          privacy_consent_version: PRIVACY_VERSION,
          privacy_consent_at: nowIso(),
          privacy_consent_ip: clientIp(request),
          updated_at: nowIso(),
        });
      await audit(request, {
        actor: { id: row.id, name: row.name },
        action: 'auth.privacy_consent',
        entityType: 'user',
        entityId: row.id,
        summary: `${row.name} 同意隐私协议 v${PRIVACY_VERSION}`,
        detail: { version: PRIVACY_VERSION },
      });
    }
    await markLogin(row.id);
    const user = await loadAuthUser(row.id);
    const token = signToken(user);
    const policy = await getPasswordPolicy();
    const passwordExpired = isPasswordExpired(row.password_changed_at, policy);
    const expiresAt = passwordExpiry(row.password_changed_at, policy);
    await audit(request, {
      actor: user,
      action: 'auth.login',
      entityType: 'user',
      entityId: user.id,
      summary: `${user.name} 登录平台`,
    });
    return { token, user, expiresIn: config.jwtExpiresIn, password_expired: passwordExpired || Boolean(row.must_change_password), password_expires_at: expiresAt };
  });

  app.get('/api/auth/me', { preHandler: authenticate }, async (request) => ({
    user: request.auth,
  }));

  app.get('/api/auth/password-policy', { preHandler: authenticate }, async () => ({ data: await getPasswordPolicy() }));

  app.post('/api/auth/change-password', { preHandler: authenticate }, async (request, reply) => {
    const schema = z.object({
      currentPassword: z.string().min(1, '请输入当前密码'),
      newPassword: z.string().min(1, '请输入新密码'),
    });
    const body = schema.parse(request.body || {});
    const user = await db('users').where({ id: request.auth.id }).first();
    if (!bcrypt.compareSync(body.currentPassword, user.password_hash)) {
      return reply.code(400).send({ message: '当前密码不正确' });
    }
    const passwordError = validatePassword(body.newPassword, await getPasswordPolicy());
    if (passwordError) return reply.code(400).send({ message: passwordError });
    await db('users')
      .where({ id: user.id })
      .update({ password_hash: bcrypt.hashSync(body.newPassword, 10), password_changed_at: nowIso(), must_change_password: false, updated_at: nowIso() });
    await audit(request, {
      action: 'auth.password',
      entityType: 'user',
      entityId: user.id,
      summary: '修改登录密码',
    });
    return { ok: true };
  });

  app.get('/api/meta', { preHandler: authenticate }, async () => ({
    permissions: ROLE_PERMISSIONS,
    enums: {
      ticketStatus: [
        { value: 'new', label: '待受理', color: 'sky' },
        { value: 'in_progress', label: '处理中', color: 'blue' },
        { value: 'pending_approval', label: '待审批', color: 'amber' },
        { value: 'resolved', label: '已解决', color: 'emerald' },
        { value: 'closed', label: '已关闭', color: 'slate' },
        { value: 'cancelled', label: '已取消', color: 'rose' },
      ],
      ticketTypes: [
        { value: 'incident', label: '事件', prefix: 'INC', color: 'sky' },
        { value: 'problem', label: '问题', prefix: 'PRB', color: 'violet' },
        { value: 'change', label: '变更', prefix: 'CHG', color: 'amber' },
      ],
      priorities: [
        { value: 'critical', label: '紧急', color: 'rose' },
        { value: 'high', label: '高', color: 'orange' },
        { value: 'medium', label: '中', color: 'blue' },
        { value: 'low', label: '低', color: 'slate' },
      ],
      ciStatus: [
        { value: 'in_use', label: '使用中' },
        { value: 'idle', label: '闲置' },
        { value: 'maintenance', label: '维护中' },
        { value: 'retired', label: '已退役' },
        { value: 'planned', label: '规划中' },
      ],
      criticality: [
        { value: 'critical', label: '核心' },
        { value: 'high', label: '重要' },
        { value: 'medium', label: '一般' },
        { value: 'low', label: '低' },
      ],
      environments: [
        { value: 'production', label: '生产环境' },
        { value: 'staging', label: '预发布' },
        { value: 'test', label: '测试环境' },
        { value: 'dr', label: '灾备环境' },
      ],
      relations: [
        { value: 'depends_on', label: '依赖于' },
        { value: 'runs_on', label: '运行于' },
        { value: 'installed_on', label: '安装于' },
        { value: 'connects_to', label: '连接至' },
        { value: 'member_of', label: '归属于' },
        { value: 'hosts', label: '承载' },
      ],
    },
  }));
}
