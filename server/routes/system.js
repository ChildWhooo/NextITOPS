import { z } from 'zod';
import os from 'node:os';
import fs from 'node:fs';
import { db } from '../db/index.js';
import { insertReturningId } from '../db/index.js';
import { authenticate, requirePermission } from '../lib/auth.js';
import { audit } from '../lib/audit.js';
import { nowIso } from '../lib/helpers.js';
import { getSetting, getSettings, setSetting } from '../lib/systemSettings.js';
import { notifyMaintenance } from '../services/notifications.js';
import { DEFAULT_BASE_DATA } from '../lib/baseData.js';
import { testSyslog } from '../lib/syslog.js';

const VERSION = process.env.APP_VERSION || '1.1.40-beta';
let lastCpuSample = null;
let lastProcessCpu = null;

async function readBaseData() {
  let stored = {};
  try { stored = JSON.parse(await getSetting('base_data', '{}')); } catch { stored = {}; }
  return { ...DEFAULT_BASE_DATA, ...(stored || {}) };
}

function readCpuTimes() {
  return os.cpus().reduce((acc, cpu) => {
    const times = cpu.times;
    acc.idle += times.idle;
    acc.total += times.user + times.nice + times.sys + times.irq + times.idle;
    return acc;
  }, { idle: 0, total: 0 });
}

function cpuUsagePercent() {
  const current = readCpuTimes();
  const previous = lastCpuSample;
  lastCpuSample = current;
  if (previous && current.total > previous.total) {
    return Math.max(0, Math.min(100, Math.round((1 - (current.idle - previous.idle) / (current.total - previous.total)) * 100)));
  }
  return current.total > 0 ? Math.max(0, Math.min(100, Math.round((1 - current.idle / current.total) * 100))) : 0;
}

function isAdmin(auth) {
  return auth?.role?.code === 'admin';
}

async function branding() {
  const settings = await getSettings(['system_name', 'system_logo', 'system_description', 'system_subtitle', 'login_headline', 'login_background', 'login_gradient', 'login_copyright', 'login_status_text', 'default_sidebar_theme', 'nav_labels']);
  let navLabels = {};
  try { navLabels = JSON.parse(settings.nav_labels || '{}'); } catch { navLabels = {}; }
  return {
    system_name: settings.system_name || 'NextITOps',
    system_logo: settings.system_logo || '',
    system_description: settings.system_description || '让配置、告警与服务流程在一个清晰的工作台里协同运转。',
    system_subtitle: settings.system_subtitle || 'SERVICE INTELLIGENCE',
    login_headline: settings.login_headline || '让每一次变更，都有据可依。',
    login_background: settings.login_background || '',
    login_gradient: settings.login_gradient || 'aurora',
    login_copyright: settings.login_copyright || '',
    login_status_text: settings.login_status_text || '',
    default_sidebar_theme: settings.default_sidebar_theme || 'ink',
    nav_labels: navLabels,
    version: VERSION,
  };
}

async function mapAsset() {
  const custom = await getSetting('custom_map_svg', '');
  return {
    map_url: custom ? `data:image/svg+xml;base64,${Buffer.from(custom, 'utf8').toString('base64')}` : '/china-provinces.svg',
    custom: Boolean(custom),
    default_url: '/china-provinces.svg',
  };
}

async function maintenanceRows(where) {
  const query = db('maintenance_notices').leftJoin('users', 'maintenance_notices.created_by', 'users.id').select('maintenance_notices.*', 'users.name as creator_name').orderBy('maintenance_notices.start_at', 'asc');
  if (where) query.where(where);
  const rows = await query;
  const now = Date.now();
  return rows.map((row) => {
    const start = new Date(row.start_at).getTime();
    const end = new Date(row.end_at).getTime();
    const phase = row.status === 'cancelled' ? 'cancelled' : row.status === 'completed' || end < now ? 'completed' : start > now ? 'planned' : 'active';
    return { ...row, phase };
  });
}

export default async function systemRoutes(app) {
  app.get('/api/system/branding', async () => ({ data: await branding() }));

  app.put('/api/system/branding', { preHandler: authenticate }, async (request, reply) => {
    if (!isAdmin(request.auth)) return reply.code(403).send({ message: '仅超级管理员可以修改系统品牌' });
    const schema = z.object({
      system_name: z.string().trim().min(1).max(60),
      system_logo: z.string().max(2_000_000).optional().default(''),
      system_description: z.string().max(500).optional().default(''),
      system_subtitle: z.string().max(80).optional().default(''),
      login_headline: z.string().max(300).optional().default(''),
      login_background: z.string().max(3_000_000).optional().default(''),
      login_gradient: z.enum(['aurora', 'ocean', 'midnight', 'sunset', 'forest']).optional().default('aurora'),
      login_copyright: z.string().max(160).optional().default(''),
      login_status_text: z.string().max(80).optional().default(''),
      default_sidebar_theme: z.string().max(40).optional().default('ink'),
      nav_labels: z.record(z.string()).optional().default({}),
    });
    const body = schema.parse(request.body || {});
    if (body.system_logo && !/^data:image\/(png|jpeg|jpg|webp|svg\+xml);base64,/i.test(body.system_logo)) {
      return reply.code(400).send({ message: 'Logo 需为 PNG / JPEG / WebP / SVG 图片' });
    }
    if (body.login_background && !/^data:image\/(png|jpeg|jpg|webp);base64,/i.test(body.login_background)) {
      return reply.code(400).send({ message: '登录背景需为 PNG / JPEG / WebP 图片' });
    }
    await setSetting('system_name', body.system_name);
    await setSetting('system_logo', body.system_logo || '');
    await setSetting('system_description', body.system_description || '');
    await setSetting('system_subtitle', body.system_subtitle || '');
    await setSetting('login_headline', body.login_headline || '');
    await setSetting('login_background', body.login_background || '');
    await setSetting('login_gradient', body.login_gradient || 'aurora');
    await setSetting('login_copyright', body.login_copyright || '');
    await setSetting('login_status_text', body.login_status_text || '');
    await setSetting('default_sidebar_theme', body.default_sidebar_theme || 'ink');
    await setSetting('nav_labels', JSON.stringify(body.nav_labels || {}));
    await audit(request, { action: 'system.branding_update', entityType: 'system', summary: `更新系统品牌：${body.system_name}` });
    return { data: await branding() };
  });

  app.get('/api/system/map', { preHandler: authenticate }, async () => ({ data: await mapAsset() }));

  app.get('/api/base-data', { preHandler: authenticate }, async () => ({ data: await readBaseData() }));

  app.put('/api/base-data', { preHandler: authenticate }, async (request, reply) => {
    if (!isAdmin(request.auth)) return reply.code(403).send({ message: '仅超级管理员可以配置基础数据' });
    const option = z.object({ value: z.string().trim().min(1).max(40), label: z.string().trim().min(1).max(60) });
    const schema = z.object({
      ticket_sources: z.array(option).min(1).max(50),
      priorities: z.array(option).min(1).max(20),
      impacts: z.array(option).min(1).max(20),
      urgencies: z.array(option).min(1).max(20),
      change_types: z.array(option).min(1).max(20),
      risks: z.array(option).min(1).max(20),
    });
    const body = schema.parse(request.body || {});
    await setSetting('base_data', JSON.stringify(body));
    await setSetting('ticket_sources', JSON.stringify(body.ticket_sources));
    await audit(request, { action: 'system.base_data', entityType: 'system', summary: '更新基础数据字典' });
    return { data: body };
  });

  app.get('/api/ticket-sources', { preHandler: authenticate }, async () => {
    const baseData = await readBaseData();
    return { data: baseData.ticket_sources };
  });

  app.put('/api/ticket-sources', { preHandler: authenticate }, async (request, reply) => {
    if (!isAdmin(request.auth)) return reply.code(403).send({ message: '仅超级管理员可以配置工单来源' });
    const schema = z.object({ sources: z.array(z.object({ value: z.string().trim().min(1).max(40), label: z.string().trim().min(1).max(60) })).min(1).max(50) });
    const body = schema.parse(request.body || {});
    const baseData = await readBaseData();
    baseData.ticket_sources = body.sources;
    await setSetting('base_data', JSON.stringify(baseData));
    await setSetting('ticket_sources', JSON.stringify(body.sources));
    await audit(request, { action: 'system.ticket_sources', entityType: 'system', summary: '更新工单来源选项' });
    return { data: body.sources };
  });

  app.get('/api/system/third-party', { preHandler: authenticate }, async (request, reply) => {
    if (!isAdmin(request.auth)) return reply.code(403).send({ message: '仅超级管理员可以查看第三方对接配置' });
    let config = {};
    try { config = JSON.parse(await getSetting('third_party_config', '{}')); } catch { config = {}; }
    const zabbix = await db('zabbix_integrations').select('id', 'name', 'base_url', 'enabled').orderBy('id');
    return { data: { amap_web_key: '', amap_js_key: '', amap_security_code: '', ...config, zabbix } };
  });

  app.put('/api/system/third-party', { preHandler: authenticate }, async (request, reply) => {
    if (!isAdmin(request.auth)) return reply.code(403).send({ message: '仅超级管理员可以修改第三方对接配置' });
    const schema = z.object({
      amap_web_key: z.string().trim().max(200).default(''),
      amap_js_key: z.string().trim().max(200).default(''),
      amap_security_code: z.string().trim().max(200).default(''),
    });
    const body = schema.parse(request.body || {});
    await setSetting('third_party_config', JSON.stringify(body));
    await audit(request, { action: 'system.third_party', entityType: 'system', summary: '更新第三方 API 配置' });
    return { data: body };
  });

  app.get('/api/system/amap-config', { preHandler: authenticate }, async () => {
    let config = {};
    try { config = JSON.parse(await getSetting('third_party_config', '{}')); } catch { config = {}; }
    return { data: { js_key: config.amap_js_key || '', web_key: config.amap_web_key || '', security_code: config.amap_security_code || '', configured: Boolean(config.amap_js_key) } };
  });

  app.post('/api/system/third-party/test-amap', { preHandler: authenticate }, async (request, reply) => {
    if (!isAdmin(request.auth)) return reply.code(403).send({ message: '仅超级管理员可以测试高德 API' });
    let config = {};
    try { config = JSON.parse(await getSetting('third_party_config', '{}')); } catch { config = {}; }
    const key = String(request.body?.key || config.amap_web_key || '').trim();
    if (!key) return reply.code(400).send({ message: '请先填写 Web 服务 Key' });
    try {
      const response = await fetch(`https://restapi.amap.com/v3/ip?key=${encodeURIComponent(key)}`, { signal: AbortSignal.timeout(8000) });
      const data = await response.json();
      if (data.status === '1') return { ok: true, message: '高德 Web 服务 API 连接成功', province: data.province || '', city: data.city || '' };
      return reply.code(502).send({ message: `高德 API 返回失败：${data.info || 'Key 无效或服务未开通'}` });
    } catch (error) {
      return reply.code(502).send({ message: `高德 API 连接失败：${error.message}` });
    }
  });

  app.get('/api/system/zabbix-sync-config', { preHandler: authenticate }, async () => {
    let config = {};
    try { config = JSON.parse(await getSetting('zabbix_sync_config', '{}')); } catch { config = {}; }
    return { data: { alert_minutes: 0, host_minutes: 5, specs_minutes: 5, inventory_minutes: 60, ...config } };
  });

  app.put('/api/system/zabbix-sync-config', { preHandler: authenticate }, async (request, reply) => {
    if (!isAdmin(request.auth)) return reply.code(403).send({ message: '仅超级管理员可以修改同步频率' });
    const body = z.object({
      alert_minutes: z.coerce.number().int().min(0).max(1440),
      host_minutes: z.coerce.number().int().min(0).max(1440),
      specs_minutes: z.coerce.number().int().min(0).max(1440),
      inventory_minutes: z.coerce.number().int().min(0).max(1440).default(60),
    }).parse(request.body || {});
    await setSetting('zabbix_sync_config', JSON.stringify(body));
    await audit(request, { action: 'system.zabbix_sync_config', entityType: 'system', summary: '更新 Zabbix 自动同步频率' });
    return { data: body };
  });

  app.get('/api/system/datacenter-order', { preHandler: authenticate }, async () => {
    let ids = [];
    try { ids = JSON.parse(await getSetting('datacenter_order', '[]')); } catch { ids = []; }
    return { data: Array.isArray(ids) ? ids.map(Number) : [] };
  });

  app.put('/api/system/datacenter-order', { preHandler: authenticate }, async (request, reply) => {
    if (!isAdmin(request.auth)) return reply.code(403).send({ message: '仅超级管理员可以调整数据中心顺序' });
    const body = z.object({ ids: z.array(z.coerce.number().int().positive()).max(500) }).parse(request.body || {});
    await setSetting('datacenter_order', JSON.stringify([...new Set(body.ids)]));
    await audit(request, { action: 'system.datacenter_order', entityType: 'system', summary: '调整数据中心显示顺序' });
    return { data: body.ids };
  });

  app.get('/api/system/zabbix-os-mappings', { preHandler: authenticate }, async () => {
    let rules = [];
    try { rules = JSON.parse(await getSetting('zabbix_os_mappings', '[]')); } catch { rules = []; }
    return { data: Array.isArray(rules) ? rules : [] };
  });

  app.put('/api/system/zabbix-os-mappings', { preHandler: authenticate }, async (request, reply) => {
    if (!isAdmin(request.auth)) return reply.code(403).send({ message: '仅超级管理员可以修改操作系统映射' });
    const body = z.object({ rules: z.array(z.object({ pattern: z.string().trim().min(1).max(120), name: z.string().trim().min(1).max(160) })).max(200) }).parse(request.body || {});
    await setSetting('zabbix_os_mappings', JSON.stringify(body.rules));
    await audit(request, { action: 'system.zabbix_os_mappings', entityType: 'system', summary: `更新 Zabbix 操作系统映射 ${body.rules.length} 条` });
    return { data: body.rules };
  });

  app.get('/api/system/ci-basic-fields', { preHandler: authenticate }, async () => {
    let config = {};
    try { config = JSON.parse(await getSetting('ci_basic_fields', '{}')); } catch { config = {}; }
    return { data: config };
  });

  app.put('/api/system/ci-basic-fields', { preHandler: [authenticate, requirePermission('cmdb.model_manage')] }, async (request, reply) => {
    const body = z.object({ typeCode: z.string().min(1).max(80), config: z.record(z.object({ label: z.string().max(120), hidden: z.boolean(), list: z.boolean().optional().default(true) })) }).parse(request.body || {});
    let current = {};
    try { current = JSON.parse(await getSetting('ci_basic_fields', '{}')); } catch { current = {}; }
    current[body.typeCode] = body.config;
    await setSetting('ci_basic_fields', JSON.stringify(current));
    await audit(request, { action: 'system.ci_basic_fields', entityType: 'system', summary: `更新 ${body.typeCode} 基础字段配置` });
    return { data: current };
  });

  app.get('/api/system/navigation', { preHandler: authenticate }, async () => {
    let config = {};
    try { config = JSON.parse(await getSetting('navigation_config', '{}')); } catch { config = {}; }
    return { data: { assetOrder: [], navLayout: {}, ...config } };
  });

  app.put('/api/system/navigation', { preHandler: authenticate }, async (request, reply) => {
    if (!isAdmin(request.auth)) return reply.code(403).send({ message: '仅超级管理员可以修改全局菜单' });
    const body = z.object({
      assetOrder: z.array(z.string().max(300)).default([]),
      navLayout: z.object({ groups: z.array(z.string()).optional(), items: z.array(z.string()).optional(), placements: z.record(z.string()).optional() }).default({}),
    }).parse(request.body || {});
    await setSetting('navigation_config', JSON.stringify(body));
    let index = 1;
    for (const href of body.assetOrder) {
      const match = /^\/cmdb\?type=([^&]+)$/.exec(href);
      if (!match) continue;
      await db('ci_types').where({ code: decodeURIComponent(match[1]) }).update({ sort_order: index, updated_at: nowIso() });
      index += 1;
    }
    await audit(request, { action: 'system.navigation', entityType: 'system', summary: '更新全局菜单与资产类型顺序' });
    return { data: body };
  });

  app.get('/api/system/syslog', { preHandler: authenticate }, async (request, reply) => {
    if (!isAdmin(request.auth)) return reply.code(403).send({ message: '仅超级管理员可以查看 Syslog 配置' });
    let config = {};
    try { config = JSON.parse(await getSetting('syslog_config', '{}')); } catch { config = {}; }
    return { data: { enabled: false, host: '', port: 514, protocol: 'udp', facility: 1, ...config } };
  });

  app.put('/api/system/syslog', { preHandler: authenticate }, async (request, reply) => {
    if (!isAdmin(request.auth)) return reply.code(403).send({ message: '仅超级管理员可以修改 Syslog 配置' });
    const schema = z.object({
      enabled: z.boolean().default(false),
      host: z.string().trim().max(200).default(''),
      port: z.coerce.number().int().min(1).max(65535).default(514),
      protocol: z.enum(['udp', 'tcp']).default('udp'),
      facility: z.coerce.number().int().min(0).max(23).default(1),
    });
    const body = schema.parse(request.body || {});
    await setSetting('syslog_config', JSON.stringify(body));
    await audit(request, { action: 'system.syslog_update', entityType: 'system', summary: '更新 Syslog 同步配置' });
    return { data: body };
  });

  app.post('/api/system/syslog/test', { preHandler: authenticate }, async (request, reply) => {
    if (!isAdmin(request.auth)) return reply.code(403).send({ message: '仅超级管理员可以测试 Syslog' });
    const result = await testSyslog();
    if (result.skipped) return reply.code(400).send({ message: '请先启用并填写 Syslog 服务器地址' });
    if (!result.ok) return reply.code(502).send({ message: `Syslog 测试失败：${result.error || '无法连接'}` });
    return { ok: true };
  });

  app.get('/api/system/login-security', { preHandler: authenticate }, async (request, reply) => {
    if (!isAdmin(request.auth)) return reply.code(403).send({ message: '仅超级管理员可以查看登录安全策略' });
    let policy = {};
    try { policy = JSON.parse(await getSetting('login_security', '{}')); } catch { policy = {}; }
    return { data: { max_failures: 8, lock_minutes: 15, idle_timeout_minutes: 10, ip_whitelist: '', ip_blacklist: '', ...policy } };
  });

  app.get('/api/system/session-policy', { preHandler: authenticate }, async () => {
    let policy = {};
    try { policy = JSON.parse(await getSetting('login_security', '{}')); } catch { policy = {}; }
    return { data: { idle_timeout_minutes: Math.max(1, Math.min(1440, Number(policy.idle_timeout_minutes) || 10)) } };
  });

  app.put('/api/system/login-security', { preHandler: authenticate }, async (request, reply) => {
    if (!isAdmin(request.auth)) return reply.code(403).send({ message: '仅超级管理员可以修改登录安全策略' });
    const schema = z.object({
      max_failures: z.coerce.number().int().min(1).max(100),
      lock_minutes: z.coerce.number().int().min(1).max(1440),
      idle_timeout_minutes: z.coerce.number().int().min(1).max(1440).default(10),
      ip_whitelist: z.string().max(4000).default(''),
      ip_blacklist: z.string().max(4000).default(''),
    });
    const body = schema.parse(request.body || {});
    await setSetting('login_security', JSON.stringify(body));
    await audit(request, { action: 'system.login_security', entityType: 'system', summary: '更新登录 IP/MAC 与锁定策略' });
    return { data: body };
  });

  app.put('/api/privacy', { preHandler: authenticate }, async (request, reply) => {
    if (!isAdmin(request.auth)) return reply.code(403).send({ message: '仅超级管理员可以修改隐私协议' });
    const schema = z.object({
      title: z.string().trim().min(2).max(160),
      summary: z.string().trim().max(2000).default(''),
      sections: z.array(z.object({ title: z.string().trim().min(1).max(160), paragraphs: z.array(z.string().max(5000)).default([]), bullets: z.array(z.string().max(2000)).default([]) })).max(50),
    });
    const body = schema.parse(request.body || {});
    await setSetting('custom_privacy', JSON.stringify(body));
    await audit(request, { action: 'system.privacy_update', entityType: 'system', summary: '更新隐私协议内容' });
    return { ok: true };
  });

  app.get('/api/system/runtime-status', { preHandler: authenticate }, async (request) => {
    const startedAt = Date.now();
    let dbOk = true;
    let dbLatency = 0;
    try {
      const begin = Date.now();
      await db.raw('select 1');
      dbLatency = Date.now() - begin;
    } catch {
      dbOk = false;
    }
    const [zabbixCount, channelCount, pendingCount] = await Promise.all([
      db('zabbix_integrations').count({ count: 'id' }).first().catch(() => ({ count: 0 })),
      db('notification_channels').where({ enabled: true }).count({ count: 'id' }).first().catch(() => ({ count: 0 })),
      db('ticket_deletion_requests').where({ status: 'pending' }).count({ count: 'id' }).first().catch(() => ({ count: 0 })),
    ]);
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const memoryPercent = Math.round(((totalMem - freeMem) / totalMem) * 100);
    const load = os.loadavg()[0];
    const cpuPercent = cpuUsagePercent();
    const processUsage = process.cpuUsage();
    const processDelta = lastProcessCpu ? { user: processUsage.user - lastProcessCpu.user, system: processUsage.system - lastProcessCpu.system } : null;
    lastProcessCpu = processUsage;
    const processCpuPercent = processDelta ? Math.min(100, Math.round(((processDelta.user + processDelta.system) / 1000 / Math.max(1, process.uptime() * 1000)) * 100)) : 0;
    let disk = null;
    try {
      const stat = fs.statfsSync(process.cwd());
      const total = stat.blocks * stat.bsize;
      const free = stat.bavail * stat.bsize;
      disk = { total, free, used_percent: Math.round(((total - free) / Math.max(1, total)) * 100) };
    } catch {}
    const anomalies = [];
    if (!dbOk) anomalies.push({ service: '数据库', severity: 'critical', detail: '数据库连通性检查失败，请检查数据库进程、连接数与磁盘空间。' });
    if (dbLatency > 500) anomalies.push({ service: '数据库', severity: 'warning', detail: `数据库查询延迟 ${dbLatency}ms，超过 500ms 阈值。` });
    if (memoryPercent >= 90) anomalies.push({ service: '主机内存', severity: memoryPercent >= 96 ? 'critical' : 'warning', detail: `主机内存使用率 ${memoryPercent}%，可用 ${Math.round(freeMem / 1024 / 1024)}MB。` });
    if (disk && disk.used_percent >= 90) anomalies.push({ service: '磁盘容量', severity: disk.used_percent >= 96 ? 'critical' : 'warning', detail: `工作目录磁盘使用率 ${disk.used_percent}%。` });
    if (!Number(zabbixCount?.count)) anomalies.push({ service: 'Zabbix 集成', severity: 'warning', detail: '尚未配置 Zabbix 集成，告警与端口状态不会同步。' });
    if (!Number(channelCount?.count)) anomalies.push({ service: '通知渠道', severity: 'warning', detail: '没有启用的通知渠道，告警与工单事件无法外发。' });
    const adminView = isAdmin(request.auth);
    return {
      data: {
        status: dbOk && !anomalies.some((item) => item.severity === 'critical') ? 'healthy' : 'degraded',
        uptime_seconds: Math.round(process.uptime()),
        started_at: new Date(Date.now() - process.uptime() * 1000).toISOString(),
        host: { platform: os.platform(), release: os.release(), arch: os.arch(), cpu_count: os.cpus().length, cpu_model: os.cpus()[0]?.model || '', load_1m: load, uptime_seconds: Math.round(os.uptime()) },
        cpu_percent: cpuPercent,
        process_cpu_percent: processCpuPercent,
        memory: { total: totalMem, free: freeMem, used_percent: memoryPercent, process_rss: process.memoryUsage().rss },
        disk,
        database: { ok: dbOk, latency_ms: dbLatency },
        services: [
          { key: 'web', name: 'Web 服务', status: 'up', detail: `进程运行 ${Math.floor(process.uptime() / 60)} 分钟` },
          { key: 'database', name: '数据库', status: dbOk ? 'up' : 'down', detail: dbOk ? `${dbLatency}ms` : '连接失败' },
          { key: 'zabbix', name: 'Zabbix 集成', status: Number(zabbixCount?.count) ? 'up' : 'idle', detail: `${Number(zabbixCount?.count)} 个集成` },
          { key: 'notifications', name: '通知渠道', status: Number(channelCount?.count) ? 'up' : 'idle', detail: `${Number(channelCount?.count)} 个启用渠道` },
          { key: 'approvals', name: '审批队列', status: Number(pendingCount?.count) ? 'busy' : 'up', detail: `${Number(pendingCount?.count)} 个待审批` },
        ],
        anomalies: adminView ? anomalies : [],
        anomaly_details_restricted: !adminView,
        checked_at: new Date().toISOString(),
      },
    };
  });


  app.put('/api/system/map', { preHandler: authenticate }, async (request, reply) => {
    if (!isAdmin(request.auth)) return reply.code(403).send({ message: '仅超级管理员可以更新地图图源' });
    const schema = z.object({ svg: z.string().min(20).max(3_000_000) });
    const { svg } = schema.parse(request.body || {});
    if (!/<svg[\s>]/i.test(svg) || !/<\/svg>/i.test(svg)) return reply.code(400).send({ message: '请上传有效的 SVG 地图文件' });
    await setSetting('custom_map_svg', svg);
    await audit(request, { action: 'system.map_update', entityType: 'system', summary: '更新系统标准地图图源' });
    return { data: await mapAsset() };
  });

  app.delete('/api/system/map', { preHandler: authenticate }, async (request, reply) => {
    if (!isAdmin(request.auth)) return reply.code(403).send({ message: '仅超级管理员可以恢复地图图源' });
    await setSetting('custom_map_svg', '');
    await audit(request, { action: 'system.map_reset', entityType: 'system', summary: '恢复系统默认地图图源' });
    return { data: await mapAsset() };
  });

  app.get('/api/maintenance', { preHandler: authenticate }, async () => ({ data: await maintenanceRows() }));

  app.post('/api/maintenance', { preHandler: [authenticate, requirePermission('dashboard.view')] }, async (request, reply) => {
    if (!isAdmin(request.auth)) return reply.code(403).send({ message: '仅超级管理员可以发布维护公告' });
    const schema = z.object({
      title: z.string().trim().min(2).max(200),
      content: z.string().trim().min(4).max(10000),
      start_at: z.string().min(10),
      end_at: z.string().min(10),
      notify_users: z.boolean().default(false),
    });
    const body = schema.parse(request.body || {});
    if (new Date(body.end_at).getTime() <= new Date(body.start_at).getTime()) return reply.code(400).send({ message: '结束时间必须晚于开始时间' });
    const ts = nowIso();
    const id = await insertReturningId(db('maintenance_notices'), {
      title: body.title,
      content: body.content,
      start_at: body.start_at,
      end_at: body.end_at,
      status: 'planned',
      notify_users: body.notify_users,
      notified_at: null,
      created_by: request.auth.id,
      created_at: ts,
      updated_at: ts,
    });
    if (body.notify_users) {
      await notifyMaintenance({ ...body, id });
      await db('maintenance_notices').where({ id }).update({ notified_at: nowIso() });
    }
    await audit(request, { action: 'maintenance.create', entityType: 'maintenance', entityId: id, summary: `发布维护公告：${body.title}` });
    return reply.code(201).send({ data: (await maintenanceRows({ 'maintenance_notices.id': id }))[0] });
  });

  app.put('/api/maintenance/:id', { preHandler: authenticate }, async (request, reply) => {
    if (!isAdmin(request.auth)) return reply.code(403).send({ message: '仅超级管理员可以修改维护公告' });
    const id = Number(request.params.id);
    const existing = await db('maintenance_notices').where({ id }).first();
    if (!existing) return reply.code(404).send({ message: '维护公告不存在' });
    const schema = z.object({
      title: z.string().trim().min(2).max(200),
      content: z.string().trim().min(4).max(10000),
      start_at: z.string().min(10),
      end_at: z.string().min(10),
      status: z.enum(['planned', 'active', 'completed', 'cancelled']).default('planned'),
      notify_users: z.boolean().default(false),
    });
    const body = schema.parse(request.body || {});
    if (new Date(body.end_at).getTime() <= new Date(body.start_at).getTime()) return reply.code(400).send({ message: '结束时间必须晚于开始时间' });
    await db('maintenance_notices').where({ id }).update({ ...body, updated_at: nowIso() });
    if (body.notify_users && !existing.notified_at) {
      await notifyMaintenance(body);
      await db('maintenance_notices').where({ id }).update({ notified_at: nowIso() });
    }
    await audit(request, { action: 'maintenance.update', entityType: 'maintenance', entityId: id, summary: `更新维护公告：${body.title}` });
    return { data: (await maintenanceRows({ 'maintenance_notices.id': id }))[0] };
  });

  app.delete('/api/maintenance/:id', { preHandler: authenticate }, async (request, reply) => {
    if (!isAdmin(request.auth)) return reply.code(403).send({ message: '仅超级管理员可以删除维护公告' });
    const id = Number(request.params.id);
    const existing = await db('maintenance_notices').where({ id }).first();
    if (!existing) return reply.code(404).send({ message: '维护公告不存在' });
    await db('maintenance_notices').where({ id }).del();
    await audit(request, { action: 'maintenance.delete', entityType: 'maintenance', entityId: id, summary: `删除维护公告：${existing.title}` });
    return { ok: true };
  });

  app.post('/api/maintenance/:id/notify', { preHandler: authenticate }, async (request, reply) => {
    if (!isAdmin(request.auth)) return reply.code(403).send({ message: '仅超级管理员可以发送维护通知' });
    const id = Number(request.params.id);
    const notice = await db('maintenance_notices').where({ id }).first();
    if (!notice) return reply.code(404).send({ message: '维护公告不存在' });
    const result = await notifyMaintenance(notice);
    await db('maintenance_notices').where({ id }).update({ notified_at: nowIso(), notify_users: true, updated_at: nowIso() });
    await audit(request, { action: 'maintenance.notify', entityType: 'maintenance', entityId: id, summary: `发送维护通知：${notice.title}` });
    return { ok: true, result };
  });
}
