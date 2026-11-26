import { z } from 'zod';
import { db, insertReturningId } from '../db/index.js';
import { config } from '../config.js';
import { authenticate, requirePermission } from '../lib/auth.js';
import { audit } from '../lib/audit.js';
import { asArray, nowIso, paginate, parseJson, randomToken } from '../lib/helpers.js';
import {
  SEVERITIES,
  normalizeZabbixAlert,
  processZabbixAlert,
  syncZabbixProblems,
  testZabbixConnection,
} from '../services/zabbix.js';
import { syncPortSnapshot } from '../services/ports.js';
import { approveHostCandidate, approveHostCandidates, builtinTypeMappings, restoreHostCandidate, syncZabbixHosts } from '../services/zabbixHosts.js';
import { syncZabbixHostSpecs } from '../services/zabbixSpecs.js';
import { syncZabbixInventory, diagnoseZabbixInventory } from '../services/zabbixInventory.js';

const conditionSchema = z.object({
  field: z.enum(['severity', 'host', 'host_ip', 'event_name', 'tag']),
  operator: z.enum(['equals', 'not_equals', 'contains', 'not_contains', 'in', 'not_in', 'gte', 'lte', 'exists', 'not_exists']),
  value: z.string().optional().default(''),
});

const booleanValue = z.preprocess((value) => {
  if (typeof value === 'number') return value !== 0;
  if (value === '1') return true;
  if (value === '0') return false;
  return value;
}, z.boolean());

const typeMappingSchema = z.object({
  zabbix_value: z.string().trim().min(1, '请输入 Zabbix 类型值').max(120),
  ci_type_id: z.coerce.number().int().positive('请选择 CI 类型'),
  description: z.string().trim().max(300).optional().default(''),
  enabled: booleanValue.default(true),
});

const typeMappingPatchSchema = z.object({
  zabbix_value: z.string().trim().min(1, '请输入 Zabbix 类型值').max(120).optional(),
  ci_type_id: z.coerce.number().int().positive('请选择 CI 类型').optional(),
  description: z.string().trim().max(300).optional(),
  enabled: booleanValue.optional(),
});

const integrationSchema = z.object({
  name: z.string().trim().min(1),
  base_url: z.string().url('Zabbix 地址格式不正确'),
  api_token: z.string().optional().default(''),
  enabled: booleanValue.default(true),
  workflow_id: z.coerce.number().int().positive().nullable().optional(),
  default_assignee_id: z.coerce.number().int().positive().nullable().optional(),
  severity_threshold: z.enum(SEVERITIES.map((item) => item.value)).default('warning'),
  conditions: z.array(conditionSchema).default([]),
  create_only_on_problem: booleanValue.default(true),
  reopen_resolved: booleanValue.default(true),
});

function publicIntegration(row, { includeSecret = false } = {}) {
  return {
    ...row,
    api_token: row.api_token ? '••••••••' : '',
    has_token: Boolean(row.api_token),
    conditions: asArray(row.conditions, []),
    mapping: parseJson(row.mapping, {}),
    webhook_secret: includeSecret ? row.webhook_secret : undefined,
  };
}

export default async function zabbixRoutes(app) {
  // Standard Zabbix 7 media-type endpoint. It uses the first enabled integration.
  app.post('/api/webhooks/zabbix/zbx_to_itsm', async (request, reply) => {
    const integration = await db('zabbix_integrations').where({ enabled: true }).orderBy('id').first();
    if (!integration) return reply.code(404).send({ message: '尚未配置启用的 Zabbix 集成' });
    const payload = request.body || {};
    const items = Array.isArray(payload) ? payload : [payload];
    const results = [];
    for (const item of items.slice(0, 20)) {
      try {
        results.push(await processZabbixAlert(integration, item, { source: 'webhook' }));
      } catch (error) {
        request.log.error({ err: error }, 'zabbix webhook failed');
        results.push({ accepted: false, action: 'error', reason: error.message });
      }
    }
    return reply.code(202).send({ ok: true, processed: results.length, results });
  });

  // Public webhook. The secret in the URL is the credential.
  app.post('/api/webhooks/zabbix/:secret', async (request, reply) => {
    const integration = await db('zabbix_integrations').where({ webhook_secret: request.params.secret }).first();
    if (!integration) return reply.code(404).send({ message: 'Webhook 不存在或已失效' });
    if (!integration.enabled) return reply.code(403).send({ message: '该集成已停用' });
    const payload = request.body || {};
    const items = Array.isArray(payload) ? payload : [payload];
    const results = [];
    for (const item of items.slice(0, 20)) {
      try {
        results.push(await processZabbixAlert(integration, item, { source: 'webhook' }));
      } catch (error) {
        request.log.error({ err: error }, 'zabbix webhook failed');
        results.push({ accepted: false, action: 'error', reason: error.message });
      }
    }
    return reply.code(202).send({ ok: true, processed: results.length, results });
  });

  app.post('/api/webhooks/zabbix/:secret/ports', async (request, reply) => {
    const integration = await db('zabbix_integrations').where({ webhook_secret: request.params.secret }).first();
    if (!integration) return reply.code(404).send({ message: 'Webhook 不存在或已失效' });
    if (!integration.enabled) return reply.code(403).send({ message: '该集成已停用' });
    const payload = request.body || {};
    const ports = Array.isArray(payload.ports) ? payload.ports : [];
    if (!ports.length) return reply.code(400).send({ message: 'ports 数组不能为空' });
    try {
      const result = await syncPortSnapshot({
        host: payload.host?.host || payload.host || payload.host_name,
        hostIp: payload.host?.ip || payload.host_ip,
        ports,
      });
      return reply.code(202).send({ ok: true, source: 'zabbix', ...result });
    } catch (error) {
      return reply.code(500).send({ message: error.message || '端口数据同步失败' });
    }
  });

  app.post('/api/integrations/zabbix/hosts/sync', { preHandler: [authenticate, requirePermission('integration.manage')] }, async (request, reply) => {
    const schema = z.object({
      hosts: z.array(z.object({
        host: z.string().trim().min(1).max(200),
        ip: z.string().trim().min(1).max(80),
        type: z.enum(['server', 'network', 'vm']).default('server'),
        status: z.enum(['online', 'offline']).default('online'),
        host_id: z.string().optional().default(''),
      })).max(1000),
    });
    const body = schema.parse(request.body || {});
    const typeCodes = { server: 'server', network: 'network', vm: 'vm' };
    const types = await db('ci_types').whereIn('code', ['server', 'network', 'vm']).select('id', 'code');
    const typeMap = Object.fromEntries(types.map((type) => [type.code, type.id]));
    let created = 0;
    let updated = 0;
    for (const host of body.hosts) {
      const now = nowIso();
      const existingIp = await db('ci_ips').where({ ip_address: host.ip }).whereIn('status', ['active']).orderBy('id', 'desc').first();
      let ci = existingIp ? await db('cis').where({ id: existingIp.ci_id }).first() : null;
      if (!ci) ci = await db('cis').where({ ip_address: host.ip }).first();
      if (ci && ci.status === 'offline' && host.status === 'online') {
        await db('ci_ips').where({ ip_address: host.ip }).update({ status: 'released', released_at: nowIso() });
        ci = null;
      }
      if (!ci) {
        if (host.status === 'offline') continue;
        const baseNo = `ZBX-${host.host}`.replace(/[^a-zA-Z0-9_.-]/g, '-').slice(0, 60);
        let assetNo = baseNo;
        let suffix = 1;
        while (await db('cis').where({ asset_no: assetNo }).first()) assetNo = `${baseNo}-${suffix++}`;
        const ciTypeId = typeMap[typeCodes[host.type]] || typeMap.server;
        const id = await insertReturningId(db('cis'), {
          asset_no: assetNo,
          name: host.host,
          ci_type_id: ciTypeId,
          status: host.status === 'offline' ? 'offline' : 'in_use',
          criticality: 'medium',
          environment: 'production',
          ip_address: host.ip,
          description: '由 Zabbix 自动发现，请在 CMDB 中补全厂商、型号、位置等信息。',
          attributes: JSON.stringify({ zabbix_host: host.host, zabbix_host_id: host.host_id, discovered: true }),
          created_at: now,
          updated_at: now,
        });
        ci = await db('cis').where({ id }).first();
        created += 1;
      } else {
        await db('cis').where({ id: ci.id }).update({ status: host.status === 'offline' ? 'offline' : 'in_use', updated_at: now });
        updated += 1;
      }
      if (existingIp && existingIp.ci_id !== ci.id) {
        await db('ci_ips').where({ id: existingIp.id }).update({ status: 'released', released_at: now });
      }
      const ipRow = await db('ci_ips').where({ ci_id: ci.id, ip_address: host.ip }).first();
      if (ipRow) await db('ci_ips').where({ id: ipRow.id }).update({ status: host.status === 'offline' ? 'offline' : 'active', last_seen_at: now, released_at: null });
      else await insertReturningId(db('ci_ips'), { ci_id: ci.id, ip_address: host.ip, status: host.status === 'offline' ? 'offline' : 'active', source: 'zabbix', last_seen_at: now, created_at: now });
    }
    await audit(request, { action: 'zabbix.hosts_sync', entityType: 'integration', summary: `Zabbix 主机同步：新增 ${created}，更新 ${updated}` });
    return { ok: true, created, updated };
  });

  app.delete('/api/integrations/zabbix/events/:id', { preHandler: [authenticate] }, async (request, reply) => {
    if (request.auth.role?.code !== 'admin') return reply.code(403).send({ message: '仅超级管理员可以删除告警记录' });
    const id = Number(request.params.id);
    const event = await db('zabbix_events').where({ id }).first();
    if (!event) return reply.code(404).send({ message: '告警记录不存在' });
    await db('zabbix_events').where({ id }).del();
    await audit(request, { action: 'zabbix.event_delete', entityType: 'integration', entityId: id, summary: `删除监控告警 ${event.event_id}` });
    return { ok: true, ticket_no: event.ticket_id ? event.ticket_no || null : null };
  });

  app.get('/api/integrations/zabbix', { preHandler: [authenticate, requirePermission('integration.manage')] }, async (request) => {
    const integrations = await db('zabbix_integrations').orderBy('id');
    const eventCounts = await db('zabbix_events').select('integration_id').count({ count: '*' }).groupBy('integration_id');
    const ticketCounts = await db('zabbix_events').whereNotNull('ticket_id').select('integration_id').count({ count: '*' }).groupBy('integration_id');
    const eventMap = Object.fromEntries(eventCounts.map((row) => [row.integration_id, Number(row.count)]));
    const ticketMap = Object.fromEntries(ticketCounts.map((row) => [row.integration_id, Number(row.count)]));
    return {
      data: integrations.map((row) => ({
        ...publicIntegration(row, { includeSecret: true }),
        event_count: eventMap[row.id] || 0,
        ticket_count: ticketMap[row.id] || 0,
      })),
      severities: SEVERITIES,
      webhook_base: `${config.webhookBaseUrl || config.publicUrl || `${request.protocol}://${request.headers.host}`}/api/webhooks/zabbix`.replace(/\/+$/, ''),
    };
  });

  app.post('/api/integrations/zabbix', { preHandler: [authenticate, requirePermission('integration.manage')] }, async (request, reply) => {
    const body = integrationSchema.parse(request.body || {});
    const ts = nowIso();
    const id = await insertReturningId(db('zabbix_integrations'), {
      ...body,
      conditions: JSON.stringify(body.conditions),
      mapping: JSON.stringify({ priority: 'severity', category: '监控告警' }),
      webhook_secret: `zbx_${randomToken(20)}`,
      last_sync_at: null,
      last_test_at: null,
      last_test_status: null,
      created_at: ts,
      updated_at: ts,
    });
    await audit(request, { action: 'zabbix.create', entityType: 'integration', entityId: id, summary: `新增 Zabbix 集成 ${body.name}` });
    const row = await db('zabbix_integrations').where({ id }).first();
    return reply.code(201).send({ data: publicIntegration(row, { includeSecret: true }) });
  });

  app.put('/api/integrations/zabbix/:id', { preHandler: [authenticate, requirePermission('integration.manage')] }, async (request, reply) => {
    const id = Number(request.params.id);
    const existing = await db('zabbix_integrations').where({ id }).first();
    if (!existing) return reply.code(404).send({ message: 'Zabbix 集成不存在' });
    const body = integrationSchema.partial().parse(request.body || {});
    const update = { ...body, updated_at: nowIso() };
    if (body.conditions) update.conditions = JSON.stringify(body.conditions);
    if (!body.api_token || body.api_token === '••••••••') delete update.api_token;
    await db('zabbix_integrations').where({ id }).update(update);
    await audit(request, { action: 'zabbix.update', entityType: 'integration', entityId: id, summary: `更新 Zabbix 集成 ${body.name || existing.name}` });
    const row = await db('zabbix_integrations').where({ id }).first();
    return { data: publicIntegration(row, { includeSecret: true }) };
  });

  app.delete('/api/integrations/zabbix/:id', { preHandler: [authenticate, requirePermission('integration.manage')] }, async (request, reply) => {
    const id = Number(request.params.id);
    const existing = await db('zabbix_integrations').where({ id }).first();
    if (!existing) return reply.code(404).send({ message: 'Zabbix 集成不存在' });
    await db('zabbix_integrations').where({ id }).del();
    await audit(request, { action: 'zabbix.delete', entityType: 'integration', entityId: id, summary: `删除 Zabbix 集成 ${existing.name}` });
    return { ok: true };
  });

  app.post('/api/integrations/zabbix/:id/regenerate-secret', { preHandler: [authenticate, requirePermission('integration.manage')] }, async (request, reply) => {
    const id = Number(request.params.id);
    const existing = await db('zabbix_integrations').where({ id }).first();
    if (!existing) return reply.code(404).send({ message: 'Zabbix 集成不存在' });
    const secret = `zbx_${randomToken(20)}`;
    await db('zabbix_integrations').where({ id }).update({ webhook_secret: secret, updated_at: nowIso() });
    await audit(request, { action: 'zabbix.secret', entityType: 'integration', entityId: id, summary: '重置 Webhook 密钥' });
    return { data: { webhook_secret: secret } };
  });

  app.post('/api/integrations/zabbix/:id/test', { preHandler: [authenticate, requirePermission('integration.manage')] }, async (request, reply) => {
    const id = Number(request.params.id);
    const integration = await db('zabbix_integrations').where({ id }).first();
    if (!integration) return reply.code(404).send({ message: 'Zabbix 集成不存在' });
    try {
      const result = await testZabbixConnection(integration);
      await db('zabbix_integrations').where({ id }).update({ last_test_at: nowIso(), last_test_status: 'success', updated_at: nowIso() });
      return { ok: true, ...result };
    } catch (error) {
      await db('zabbix_integrations').where({ id }).update({ last_test_at: nowIso(), last_test_status: 'failed', updated_at: nowIso() });
      return reply.code(502).send({ message: error.message || '连接 Zabbix 失败' });
    }
  });

  app.post('/api/integrations/zabbix/:id/simulate', { preHandler: [authenticate, requirePermission('integration.manage')] }, async (request, reply) => {
    const id = Number(request.params.id);
    const integration = await db('zabbix_integrations').where({ id }).first();
    if (!integration) return reply.code(404).send({ message: 'Zabbix 集成不存在' });
    const sample = request.body?.sample || {};
    const payload = {
      event: {
        id: `sim-${Date.now()}`,
        name: sample.name || 'High CPU utilization on SRV-PROD-001',
        severity: sample.severity || 'High',
        status: 'PROBLEM',
        tags: sample.tags || [{ tag: 'service', value: 'erp' }],
      },
      host: { host: sample.host || 'SRV-PROD-001', ip: sample.ip || '10.20.1.11' },
      trigger: { triggerid: 'sim-31870' },
    };
    try {
      const result = await processZabbixAlert(integration, payload, { source: 'simulate' });
      await audit(request, {
        action: 'zabbix.simulate',
        entityType: 'integration',
        entityId: id,
        summary: `模拟 Zabbix 告警：${result.action}${result.ticket_no ? ` ${result.ticket_no}` : ''}`,
      });
      return { ok: true, action: result.action, reason: result.reason || null, ticket_id: result.ticket_id || null, ticket_no: result.ticket_no || null };
    } catch (error) {
      return reply.code(500).send({ message: error.message || '模拟告警失败' });
    }
  });

  app.post('/api/integrations/zabbix/:id/sync', { preHandler: [authenticate, requirePermission('integration.manage')] }, async (request, reply) => {
    const id = Number(request.params.id);
    const integration = await db('zabbix_integrations').where({ id }).first();
    if (!integration) return reply.code(404).send({ message: 'Zabbix 集成不存在' });
    try {
      const result = await syncZabbixProblems(integration);
      await audit(request, {
        action: 'zabbix.sync',
        entityType: 'integration',
        entityId: id,
        summary: `同步 Zabbix 告警：拉取 ${result.fetched}，新建 ${result.created}`,
      });
      return { ok: true, ...result };
    } catch (error) {
      return reply.code(502).send({ message: error.message || '同步 Zabbix 告警失败' });
    }
  });

  app.post('/api/integrations/zabbix/:id/sync-host-specs', { preHandler: [authenticate, requirePermission('integration.manage')] }, async (request, reply) => {
    const id = Number(request.params.id);
    const integration = await db('zabbix_integrations').where({ id }).first();
    if (!integration) return reply.code(404).send({ message: 'Zabbix 集成不存在' });
    try {
      const result = await syncZabbixHostSpecs(integration);
      await audit(request, { action: 'zabbix.host_specs', entityType: 'integration', entityId: id, summary: `同步主机配置：更新 ${result.updated} 台` });
      return { ok: true, ...result };
    } catch (error) {
      return reply.code(502).send({ message: error.message || '同步主机配置失败' });
    }
  });

  app.post('/api/integrations/zabbix/:id/sync-inventory', { preHandler: [authenticate, requirePermission('integration.manage')] }, async (request, reply) => {
    const id = Number(request.params.id);
    const integration = await db('zabbix_integrations').where({ id }).first();
    if (!integration) return reply.code(404).send({ message: 'Zabbix 集成不存在' });
    try {
      const diagnostics = request.query?.diagnostics === '1' || request.query?.diagnostics === 'true';
      const result = await syncZabbixInventory(integration, { diagnostics });
      await audit(request, {
        action: 'zabbix.inventory_sync',
        entityType: 'integration',
        entityId: id,
        summary: `同步 Zabbix 资产清单：主机 ${result.hosts} 台，新软件 ${result.software_created}，关联 ${result.software_verified || result.software_linked}/${result.software_expected || result.software_linked}，MAC ${result.macs}${result.failed_hosts?.length ? `，跳过失败主机 ${result.failed_hosts.length} 台` : ''}`,
      });
      return { ok: true, ...result };
    } catch (error) {
      return reply.code(502).send({ message: error.message || '同步资产清单失败' });
    }
  });

  app.get('/api/integrations/zabbix/:id/inventory-diagnostics', { preHandler: [authenticate, requirePermission('integration.manage')] }, async (request, reply) => {
    const id = Number(request.params.id);
    const integration = await db('zabbix_integrations').where({ id }).first();
    if (!integration) return reply.code(404).send({ message: 'Zabbix 集成不存在' });
    try {
      const result = await diagnoseZabbixInventory(integration, {
        q: request.query?.q,
        ciType: request.query?.ci_type || request.query?.ciType,
        page: request.query?.page,
        pageSize: request.query?.page_size || request.query?.pageSize,
        issue: request.query?.issue,
      });
      return { ok: true, ...result };
    } catch (error) {
      return reply.code(502).send({ message: error.message || '资产清单诊断失败' });
    }
  });

  app.get('/api/integrations/zabbix/:id/inventory-summary', { preHandler: [authenticate, requirePermission('integration.manage')] }, async (request, reply) => {
    const id = Number(request.params.id);
    const integration = await db('zabbix_integrations').where({ id }).first();
    if (!integration) return reply.code(404).send({ message: 'Zabbix 集成不存在' });
    const hosts = await db('cis')
      .join('ci_types', 'cis.ci_type_id', 'ci_types.id')
      .select('cis.id')
      .where('cis.zabbix_integration_id', id)
      .whereIn('ci_types.code', ['server', 'vm']);
    const hostIds = hosts.map((host) => host.id);
    let software = 0;
    let macs = 0;
    if (hostIds.length) {
      const softwareRow = await db('ci_relations as relation')
        .join('cis as target', 'relation.target_ci_id', 'target.id')
        .whereIn('relation.source_ci_id', hostIds)
        .where('relation.relation_type', 'software_installed')
        .where('target.asset_no', 'like', 'SW-ZBX-%')
        .countDistinct({ count: 'target.id' })
        .first();
      const macRow = await db('ci_network_ports')
        .whereIn('ci_id', hostIds)
        .where('source', 'zabbix-agent')
        .whereNot('mac_address', '')
        .count({ count: '*' })
        .first();
      software = Number(softwareRow?.count || 0);
      macs = Number(macRow?.count || 0);
    }
    return {
      data: {
        hosts: hostIds.length,
        software,
        macs,
        last_sync_at: integration.last_inventory_sync_at || null,
      },
    };
  });

  app.post('/api/integrations/zabbix/:id/sync-hosts', { preHandler: [authenticate, requirePermission('integration.manage')] }, async (request, reply) => {
    const id = Number(request.params.id);
    const integration = await db('zabbix_integrations').where({ id }).first();
    if (!integration) return reply.code(404).send({ message: 'Zabbix 集成不存在' });
    try {
      const result = await syncZabbixHosts(integration);
      await audit(request, {
        action: 'zabbix.hosts_pull', entityType: 'integration', entityId: id,
        summary: `同步 Zabbix 主机：新增 ${result.created}，更新 ${result.updated}，待确认 ${result.pending}，下线 ${result.offline}`,
      });
      return { ok: true, ...result };
    } catch (error) {
      return reply.code(502).send({ message: error.message || '同步 Zabbix 主机失败' });
    }
  });

  app.get('/api/integrations/zabbix/:id/host-candidates', { preHandler: [authenticate, requirePermission('integration.manage')] }, async (request) => {
    const id = Number(request.params.id);
    const requestedStatus = String(request.query.status || 'pending');
    const status = ['pending', 'ignored'].includes(requestedStatus) ? requestedStatus : 'pending';
    const { page, pageSize, limit, offset } = paginate(request.query);
    const query = db('zabbix_discovered_hosts').where({ integration_id: id, status });
    if (request.query.q) {
      const term = `%${request.query.q}%`;
      query.where((builder) => builder.where('host_name', 'like', term).orWhere('display_name', 'like', term).orWhere('ip_address', 'like', term));
    }
    const totalRow = await query.clone().count({ count: 'id' }).first();
    const rows = await query.orderBy('id', 'desc').limit(limit).offset(offset);
    return { data: rows.map((row) => ({ ...row, payload: undefined })), pagination: { page, pageSize, total: Number(totalRow?.count || 0) } };
  });

  app.post('/api/integrations/zabbix/:id/host-candidates/batch-approve', { preHandler: [authenticate, requirePermission('integration.manage')] }, async (request, reply) => {
    const body = z.object({ items: z.array(z.object({ id: z.coerce.number().int().positive(), ci_type_code: z.string().min(1).max(40) })).min(1).max(500) }).parse(request.body || {});
    const results = await approveHostCandidates(Number(request.params.id), body.items);
    await audit(request, { action: 'zabbix.host_batch_approve', entityType: 'integration', entityId: Number(request.params.id), summary: `批量确认 Zabbix 主机 ${results.filter((item) => item.ok).length}/${results.length}` });
    return { data: results };
  });

  app.post('/api/integrations/zabbix/:id/host-candidates/:candidateId/approve', { preHandler: [authenticate, requirePermission('integration.manage')] }, async (request, reply) => {
    try {
      const result = await approveHostCandidate(Number(request.params.id), Number(request.params.candidateId), request.body?.ci_type_code || '');
      await audit(request, { action: 'zabbix.host_approve', entityType: 'integration', entityId: Number(request.params.id), summary: `确认 Zabbix 主机，创建/更新 CI ${result.ci_id}` });
      return { ok: true, ...result };
    } catch (error) {
      return reply.code(400).send({ message: error.message });
    }
  });

  app.post('/api/integrations/zabbix/:id/host-candidates/:candidateId/ignore', { preHandler: [authenticate, requirePermission('integration.manage')] }, async (request) => {
    await db('zabbix_discovered_hosts').where({ id: Number(request.params.candidateId), integration_id: Number(request.params.id) }).update({ status: 'ignored', updated_at: nowIso() });
    return { ok: true };
  });

  app.post('/api/integrations/zabbix/:id/host-candidates/:candidateId/restore', { preHandler: [authenticate, requirePermission('integration.manage')] }, async (request, reply) => {
    try {
      await restoreHostCandidate(Number(request.params.id), Number(request.params.candidateId));
      await audit(request, { action: 'zabbix.host_restore', entityType: 'integration', entityId: Number(request.params.id), summary: `恢复已忽略的 Zabbix 主机 #${request.params.candidateId}` });
      return { ok: true };
    } catch (error) {
      return reply.code(400).send({ message: error.message });
    }
  });

  app.get('/api/integrations/zabbix/events', { preHandler: [authenticate, requirePermission('itsm.view')] }, async (request) => {
    const { page, pageSize, limit, offset } = paginate(request.query);
    const query = db('zabbix_events')
      .leftJoin('zabbix_integrations', 'zabbix_events.integration_id', 'zabbix_integrations.id')
      .leftJoin('tickets', 'zabbix_events.ticket_id', 'tickets.id');
    if (request.query.integration_id) query.where('zabbix_events.integration_id', Number(request.query.integration_id));
    if (request.query.severity) query.where('zabbix_events.severity', request.query.severity);
    if (request.query.status) query.where('zabbix_events.event_status', request.query.status);
    if (request.query.processing_status) query.where('zabbix_events.processing_status', request.query.processing_status);
    if (request.query.q) {
      const term = `%${request.query.q}%`;
      query.where((builder) =>
        builder.where('zabbix_events.event_name', 'like', term).orWhere('zabbix_events.host_name', 'like', term).orWhere('zabbix_events.event_id', 'like', term),
      );
    }
    const totalRow = await query.clone().count({ count: 'zabbix_events.id' }).first();
    const rows = await query
      .select(
        'zabbix_events.*',
        'zabbix_integrations.name as integration_name',
        'tickets.ticket_no',
        'tickets.title as ticket_title',
        'tickets.status as ticket_status',
      )
      .orderBy('zabbix_events.received_at', 'desc')
      .limit(limit)
      .offset(offset);
    return {
      data: rows.map((row) => ({
        ...row,
        tags: parseJson(row.tags, []),
        payload: undefined,
        severity_label: SEVERITIES.find((item) => item.value === row.severity)?.label || row.severity,
      })),
      pagination: { page, pageSize, total: Number(totalRow?.count || 0) },
    };
  });

  app.get('/api/integrations/zabbix/events/stats', { preHandler: [authenticate, requirePermission('itsm.view')] }, async () => {
    const count = async (builder) => Number((await builder.count({ count: '*' }).first())?.count || 0);
    const total = await count(db('zabbix_events'));
    const last24h = await count(db('zabbix_events').where('received_at', '>', new Date(Date.now() - 86400000).toISOString()));
    const openProblems = Number(
      (await db('zabbix_events').where({ event_status: 'PROBLEM' }).countDistinct({ count: 'event_id' }).first())?.count || 0,
    );
    const ticketsCreated = await count(db('zabbix_events').where({ processing_status: 'ticket_created' }));
    const ignored = await count(db('zabbix_events').where({ processing_status: 'ignored' }));
    const severityRows = await db('zabbix_events').select('severity').count({ count: '*' }).groupBy('severity');
    const processingRows = await db('zabbix_events').select('processing_status').count({ count: '*' }).groupBy('processing_status');
    return {
      total,
      last24h,
      open_problems: openProblems,
      tickets_created: ticketsCreated,
      ignored,
      by_severity: Object.fromEntries(severityRows.map((row) => [row.severity, Number(row.count)])),
      by_processing: Object.fromEntries(processingRows.map((row) => [row.processing_status, Number(row.count)])),
    };
  });

  app.get('/api/integrations/zabbix/events/:id', { preHandler: [authenticate, requirePermission('itsm.view')] }, async (request, reply) => {
    const row = await db('zabbix_events as events')
      .leftJoin('zabbix_integrations as integrations', 'events.integration_id', 'integrations.id')
      .leftJoin('tickets', 'events.ticket_id', 'tickets.id')
      .select('events.*', 'integrations.name as integration_name', 'tickets.ticket_no')
      .where('events.id', Number(request.params.id))
      .first();
    if (!row) return reply.code(404).send({ message: '告警事件不存在' });
    return {
      data: {
        ...row,
        tags: parseJson(row.tags, []),
        payload: parseJson(row.payload, {}),
        normalized: normalizeZabbixAlert(parseJson(row.payload, {})),
        severity_label: SEVERITIES.find((item) => item.value === row.severity)?.label || row.severity,
      },
    };
  });

  app.get('/api/zabbix/type-mappings', { preHandler: [authenticate, requirePermission('integration.manage')] }, async () => {
    const rows = await db('zabbix_type_mappings as mapping')
      .join('ci_types as type', 'mapping.ci_type_id', 'type.id')
      .select(
        'mapping.*',
        'type.code as ci_type_code',
        'type.name as ci_type_name',
        'type.color as ci_type_color',
        'type.icon as ci_type_icon',
        'type.enabled as ci_type_enabled',
      )
      .orderBy('mapping.id');
    const builtin = builtinTypeMappings();
    const builtinTypes = await db('ci_types')
      .whereIn('code', builtin.map((group) => group.ci_type_code))
      .select('code', 'name', 'color', 'icon', 'enabled');
    const typeLookup = new Map(builtinTypes.map((type) => [type.code, type]));
    return {
      data: rows,
      builtin: builtin.map((group) => {
        const type = typeLookup.get(group.ci_type_code);
        return {
          ...group,
          ci_type_name: type?.name || group.ci_type_code,
          ci_type_color: type?.color || '',
          ci_type_icon: type?.icon || '',
          ci_type_enabled: Boolean(type?.enabled),
        };
      }),
    };
  });

  app.post('/api/zabbix/type-mappings', { preHandler: [authenticate, requirePermission('integration.manage')] }, async (request, reply) => {
    const body = typeMappingSchema.parse(request.body || {});
    const type = await db('ci_types').where({ id: body.ci_type_id }).first();
    if (!type || !type.enabled) return reply.code(400).send({ message: '目标 CI 类型不存在或已停用' });
    const duplicate = await db('zabbix_type_mappings').whereRaw('LOWER(zabbix_value) = ?', [body.zabbix_value.toLowerCase()]).first();
    if (duplicate) return reply.code(409).send({ message: `Zabbix 类型值「${body.zabbix_value}」已存在映射` });
    const ts = nowIso();
    const id = await insertReturningId(db('zabbix_type_mappings'), {
      ...body,
      created_at: ts,
      updated_at: ts,
    });
    await audit(request, { action: 'zabbix.type_mapping_create', entityType: 'zabbix_type_mapping', entityId: id, summary: `新增类型映射 ${body.zabbix_value} → ${type.name}` });
    const row = await db('zabbix_type_mappings as mapping')
      .join('ci_types as type', 'mapping.ci_type_id', 'type.id')
      .select('mapping.*', 'type.code as ci_type_code', 'type.name as ci_type_name', 'type.color as ci_type_color', 'type.icon as ci_type_icon')
      .where('mapping.id', id)
      .first();
    return reply.code(201).send({ data: row });
  });

  app.put('/api/zabbix/type-mappings/:id', { preHandler: [authenticate, requirePermission('integration.manage')] }, async (request, reply) => {
    const id = Number(request.params.id);
    const existing = await db('zabbix_type_mappings').where({ id }).first();
    if (!existing) return reply.code(404).send({ message: '类型映射不存在' });
    const body = typeMappingPatchSchema.parse(request.body || {});
    if (body.ci_type_id) {
      const type = await db('ci_types').where({ id: body.ci_type_id }).first();
      if (!type || !type.enabled) return reply.code(400).send({ message: '目标 CI 类型不存在或已停用' });
    }
    if (body.zabbix_value) {
      const duplicate = await db('zabbix_type_mappings')
        .whereRaw('LOWER(zabbix_value) = ?', [body.zabbix_value.toLowerCase()])
        .whereNot({ id })
        .first();
      if (duplicate) return reply.code(409).send({ message: `Zabbix 类型值「${body.zabbix_value}」已存在映射` });
    }
    await db('zabbix_type_mappings').where({ id }).update({ ...body, updated_at: nowIso() });
    await audit(request, { action: 'zabbix.type_mapping_update', entityType: 'zabbix_type_mapping', entityId: id, summary: `更新类型映射 ${body.zabbix_value || existing.zabbix_value}` });
    const row = await db('zabbix_type_mappings as mapping')
      .join('ci_types as type', 'mapping.ci_type_id', 'type.id')
      .select('mapping.*', 'type.code as ci_type_code', 'type.name as ci_type_name', 'type.color as ci_type_color', 'type.icon as ci_type_icon')
      .where('mapping.id', id)
      .first();
    return { data: row };
  });

  app.delete('/api/zabbix/type-mappings/:id', { preHandler: [authenticate, requirePermission('integration.manage')] }, async (request, reply) => {
    const id = Number(request.params.id);
    const existing = await db('zabbix_type_mappings').where({ id }).first();
    if (!existing) return reply.code(404).send({ message: '类型映射不存在' });
    await db('zabbix_type_mappings').where({ id }).del();
    await audit(request, { action: 'zabbix.type_mapping_delete', entityType: 'zabbix_type_mapping', entityId: id, summary: `删除类型映射 ${existing.zabbix_value}` });
    return { ok: true };
  });

  app.get('/api/zabbix/severities', { preHandler: authenticate }, async () => ({ data: SEVERITIES }));
}
