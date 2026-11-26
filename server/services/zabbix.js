import crypto from 'node:crypto';
import { db, insertReturningId } from '../db/index.js';
import { asArray, addHours, nowIso, parseJson, randomToken } from '../lib/helpers.js';
import { queueTicketNotification } from './notifications.js';

export const SEVERITIES = [
  { value: 'not_classified', label: '未分类', rank: 0, color: 'slate' },
  { value: 'information', label: '信息', rank: 1, color: 'sky' },
  { value: 'warning', label: '警告', rank: 2, color: 'amber' },
  { value: 'average', label: '一般严重', rank: 3, color: 'orange' },
  { value: 'high', label: '高', rank: 4, color: 'rose' },
  { value: 'disaster', label: '灾难', rank: 5, color: 'red' },
];

const SEVERITY_RANK = Object.fromEntries(SEVERITIES.map((item) => [item.value, item.rank]));
const PRIORITY_BY_SEVERITY = {
  not_classified: 'low',
  information: 'low',
  warning: 'medium',
  average: 'medium',
  high: 'high',
  disaster: 'critical',
};

const SEVERITY_ALIASES = {
  'not classified': 'not_classified',
  not_classified: 'not_classified',
  unknown: 'not_classified',
  information: 'information',
  info: 'information',
  warning: 'warning',
  average: 'average',
  high: 'high',
  disaster: 'disaster',
  未分类: 'not_classified',
  信息: 'information',
  警告: 'warning',
  一般严重: 'average',
  高: 'high',
  灾难: 'disaster',
};

const STATUS_ALIASES = {
  problem: 'PROBLEM',
  resolved: 'RECOVERY',
  recovery: 'RECOVERY',
  ok: 'RECOVERY',
  1: 'PROBLEM',
  0: 'RECOVERY',
};

export function normalizeSeverity(value) {
  if (value === null || value === undefined || value === '') return 'warning';
  if (typeof value === 'number') {
    return SEVERITIES[Math.max(0, Math.min(5, value))]?.value || 'warning';
  }
  const raw = String(value).trim();
  if (/^\d+$/.test(raw)) return SEVERITIES[Math.max(0, Math.min(5, Number(raw)))]?.value || 'warning';
  return SEVERITY_ALIASES[raw.toLowerCase()] || 'warning';
}

export function severityLabel(value) {
  return SEVERITIES.find((item) => item.value === normalizeSeverity(value))?.label || value;
}

function statusFrom(value, fallback = 'PROBLEM') {
  if (value === null || value === undefined || value === '') return fallback;
  return STATUS_ALIASES[String(value).toLowerCase()] || fallback;
}

export function normalizeZabbixAlert(payload = {}) {
  const event = payload.event || {};
  const host = payload.host || {};
  const trigger = payload.trigger || {};
  const tags = asArray(event.tags || payload.tags || trigger.tags, []);
  const status = statusFrom(event.status ?? payload.status ?? payload.event_status, 'PROBLEM');
  const severity = normalizeSeverity(event.severity ?? payload.severity ?? trigger.priority);
  const name = event.name || payload.event_name || payload.name || trigger.description || 'Zabbix 告警';
  const hostName = (typeof host === 'string' ? host : host.host || host.name) || payload.host_name || payload.host || '';
  const hostIp = (typeof host === 'object' ? host.ip || host.interfaces?.[0]?.ip : '') || payload.host_ip || '';
  const eventId = String(event.id || payload.event_id || payload.eventid || trigger.eventid || `${hostName}:${name}`);
  const triggerId = String(trigger.triggerid || payload.trigger_id || trigger.id || '');
  return {
    event_id: eventId.slice(0, 100),
    trigger_id: triggerId.slice(0, 100),
    host_name: String(hostName).slice(0, 160),
    host_ip: String(hostIp || '').slice(0, 80),
    severity,
    severity_rank: SEVERITY_RANK[severity],
    event_name: String(name).slice(0, 300),
    event_status: status,
    tags: tags.map((tag) =>
      typeof tag === 'string'
        ? { tag, value: '' }
        : { tag: String(tag.tag || tag.name || ''), value: String(tag.value || '') },
    ),
    raw: payload,
  };
}

function conditionFieldValue(alert, field) {
  switch (field) {
    case 'severity':
      return alert.severity_rank;
    case 'host':
    case 'host_name':
      return alert.host_name;
    case 'host_ip':
      return alert.host_ip;
    case 'event_name':
    case 'trigger':
      return alert.event_name;
    case 'tag':
      return alert.tags.map((tag) => (tag.value ? `${tag.tag}=${tag.value}` : tag.tag));
    case 'event_id':
      return alert.event_id;
    default:
      return '';
  }
}

function compareText(actual, expected, operator) {
  const a = String(actual ?? '').toLowerCase();
  const e = String(expected ?? '').toLowerCase();
  switch (operator) {
    case 'equals':
      return a === e;
    case 'not_equals':
      return a !== e;
    case 'contains': {
      const keywords = e.split(/[,，|]/).map((item) => item.trim()).filter(Boolean);
      return keywords.some((keyword) => a.includes(keyword));
    }
    case 'not_contains': {
      const keywords = e.split(/[,，|]/).map((item) => item.trim()).filter(Boolean);
      return keywords.every((keyword) => !a.includes(keyword));
    }
    case 'starts_with':
      return a.startsWith(e);
    case 'in':
      return String(expected).split(/[,，]/).map((item) => item.trim().toLowerCase()).includes(a);
    case 'not_in':
      return !String(expected).split(/[,，]/).map((item) => item.trim().toLowerCase()).includes(a);
    case 'gte':
      return Number(actual) >= Number(expected);
    case 'lte':
      return Number(actual) <= Number(expected);
    case 'exists':
      return Array.isArray(actual) ? actual.length > 0 : Boolean(actual);
    case 'not_exists':
      return Array.isArray(actual) ? actual.length === 0 : !actual;
    default:
      return false;
  }
}

export function evaluateConditions(alert, conditions = [], severityThreshold = 'warning') {
  const thresholdRank = SEVERITY_RANK[normalizeSeverity(severityThreshold)] ?? 2;
  if (alert.severity_rank < thresholdRank) {
    return { matched: false, reason: `严重级别低于阈值「${severityLabel(severityThreshold)}」` };
  }
  for (const condition of conditions || []) {
    if (!condition?.field || !condition?.operator) continue;
    const actual = conditionFieldValue(alert, condition.field);
    let matched = false;
    if (condition.field === 'severity') {
      const expectedRank = SEVERITY_RANK[normalizeSeverity(condition.value)];
      if (condition.operator === 'gte') matched = alert.severity_rank >= expectedRank;
      else if (condition.operator === 'lte') matched = alert.severity_rank <= expectedRank;
      else if (condition.operator === 'equals') matched = alert.severity === normalizeSeverity(condition.value);
      else if (condition.operator === 'not_equals') matched = alert.severity !== normalizeSeverity(condition.value);
      else matched = compareText(actual, condition.value, condition.operator);
    } else if (condition.field === 'tag') {
      const expected = String(condition.value || '').toLowerCase();
      const tags = actual.map((item) => item.toLowerCase());
      matched = tags.some((tag) => compareText(tag, expected, condition.operator));
    } else {
      matched = compareText(actual, condition.value, condition.operator);
    }
    if (!matched) {
      return {
        matched: false,
        reason: `条件未命中：${condition.field} ${condition.operator} ${condition.value ?? ''}`.trim(),
      };
    }
  }
  return { matched: true, reason: '全部条件通过' };
}

export async function zabbixRpc(integration, method, params = {}, timeoutMs = 10000) {
  const base = String(integration.base_url || '').replace(/\/+$/, '');
  if (!base) throw new Error('未配置 Zabbix 地址');
  const url = base.endsWith('/api_jsonrpc.php') ? base : `${base}/api_jsonrpc.php`;
  const headers = { 'Content-Type': 'application/json-rpc' };
  // Zabbix rejects apiinfo.version when an Authorization header is present.
  const publicMethods = new Set(['apiinfo.version', 'user.login']);
  if (integration.api_token && !publicMethods.has(method)) headers.Authorization = `Bearer ${integration.api_token}`;
  const started = Date.now();
  let response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ jsonrpc: '2.0', method, params, id: 1 }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    const reason = error.name === 'TimeoutError' ? '连接超时' : error.cause?.code || error.message;
    throw new Error(`无法连接 Zabbix API：${reason}`);
  }
  const latency = Date.now() - started;
  const text = await response.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`Zabbix 返回了非 JSON 响应（HTTP ${response.status}）`);
  }
  if (data.error) {
    throw new Error(`Zabbix API 错误：${data.error.data || data.error.message || '未知错误'}`);
  }
  if (!response.ok) throw new Error(`Zabbix API HTTP ${response.status}`);
  return { result: data.result, latency };
}

function alertDescription(alert) {
  const tags = alert.tags.length ? alert.tags.map((tag) => `${tag.tag}${tag.value ? `=${tag.value}` : ''}`).join(', ') : '无';
  return [
    '由 Zabbix 监控平台自动创建。',
    '',
    `告警事件：${alert.event_name}`,
    `主机：${alert.host_name || '未知'}${alert.host_ip ? ` (${alert.host_ip})` : ''}`,
    `严重级别：${severityLabel(alert.severity)}`,
    `事件 ID：${alert.event_id}`,
    `标签：${tags}`,
    '',
    '请结合 CMDB 影响分析进行诊断与处置，并在恢复后关闭事件。',
  ].join('\n');
}

async function systemUserId() {
  const admin = await db('users').where({ username: 'admin' }).first();
  if (admin) return admin.id;
  const any = await db('users').first();
  return any?.id || null;
}

async function findCI(alert) {
  if (alert.host_name) {
    const byAsset = await db('cis').where({ asset_no: alert.host_name }).first();
    if (byAsset) return byAsset;
  }
  if (alert.host_ip) {
    const byIp = await db('cis').where({ ip_address: alert.host_ip }).first();
    if (byIp) return byIp;
  }
  if (alert.host_name) {
    const byName = await db('cis').where({ name: alert.host_name }).first();
    if (byName) return byName;
  }
  return null;
}

async function recordEvent(integration, alert, { ticketId = null, processingStatus, note = '' } = {}) {
  const dedupeKey = `zbx:${integration.id}:${alert.event_id}:${alert.event_status}`.slice(0, 290);
  const existing = await db('zabbix_events').where({ dedupe_key: dedupeKey }).first();
  if (existing) return { row: existing, duplicate: true, dedupeKey };
  try {
    const id = await insertReturningId(db('zabbix_events'), {
      integration_id: integration.id,
      event_id: alert.event_id,
      trigger_id: alert.trigger_id,
      host_name: alert.host_name,
      host_ip: alert.host_ip,
      severity: alert.severity,
      event_name: alert.event_name,
      event_status: alert.event_status,
      tags: JSON.stringify(alert.tags),
      payload: JSON.stringify(alert.raw).slice(0, 60000),
      ticket_id: ticketId,
      processing_status: processingStatus,
      processing_note: note.slice(0, 300),
      dedupe_key: dedupeKey,
      received_at: nowIso(),
    });
    return { row: { id, dedupe_key: dedupeKey, ticket_id: ticketId }, duplicate: false, dedupeKey };
  } catch (error) {
    if (/unique|duplicate/i.test(error.message)) {
      const row = await db('zabbix_events').where({ dedupe_key: dedupeKey }).first();
      return { row, duplicate: true, dedupeKey };
    }
    throw error;
  }
}

async function addSystemComment(ticketId, body, action = 'zabbix.note') {
  const ts = nowIso();
  await insertReturningId(db('ticket_comments'), {
    ticket_id: ticketId,
    user_id: null,
    body,
    is_internal: true,
    created_at: ts,
  });
  await insertReturningId(db('ticket_stage_history'), {
    ticket_id: ticketId,
    stage_id: null,
    stage_name: '',
    action,
    actor_id: null,
    comment: body.slice(0, 1000),
    created_at: ts,
  });
}

export async function createIncidentFromAlert(integration, alert, eventRowId) {
  const workflowQuery = db('workflows').where({ ticket_type: 'incident', is_active: true });
  let workflow;
  if (integration.workflow_id) workflow = await workflowQuery.clone().where({ id: integration.workflow_id }).first();
  if (!workflow) {
    workflow = await workflowQuery.clone().where({ is_default: true }).first();
    if (!workflow) workflow = await workflowQuery.clone().orderBy('id').first();
  }
  if (!workflow) throw new Error('没有可用的默认事件流程，请先在流程设计中配置');
  const stages = await db('workflow_stages').where({ workflow_id: workflow.id }).orderBy('seq');
  if (!stages.length) throw new Error('事件流程未配置阶段');
  const firstStage = stages[0];
  const mapping = parseJson(integration.mapping, {});
  const priority = PRIORITY_BY_SEVERITY[alert.severity] || 'medium';
  const category = mapping.category || '监控告警';
  const requesterId = integration.default_assignee_id || (await systemUserId());
  const ci = await findCI(alert);
  const ts = nowIso();
  const year = new Date().getFullYear();
  const title = `[Zabbix] ${alert.event_name}${alert.host_name ? ` · ${alert.host_name}` : ''}`.slice(0, 240);

  const ticketId = await db.transaction(async (trx) => {
    const placeholder = `TMP-${crypto.randomUUID()}`;
    const id = await insertReturningId(trx('tickets'), {
      ticket_no: placeholder,
      type: 'incident',
      title,
      description: alertDescription(alert),
      status: 'new',
      priority,
      impact: alert.severity_rank >= 4 ? 'high' : 'medium',
      urgency: alert.severity_rank >= 4 ? 'high' : 'medium',
      category,
      source: 'zabbix',
      requester_id: requesterId,
      assignee_id: integration.default_assignee_id || null,
      workflow_id: workflow.id,
      current_stage_id: firstStage.id,
      resolution: '',
      sla_due_at: addHours(ts, firstStage.sla_hours),
      risk: 'medium',
      change_type: 'normal',
      planned_start: '',
      planned_end: '',
      created_at: ts,
      updated_at: ts,
    });
    const ticketNo = `INC-${year}-${String(id).padStart(4, '0')}`;
    await trx('tickets').where({ id }).update({ ticket_no: ticketNo, zabbix_event_id: eventRowId || null });
    await insertReturningId(trx('ticket_stage_history'), {
      ticket_id: id,
      stage_id: firstStage.id,
      stage_name: firstStage.name,
      action: 'created',
      actor_id: null,
      comment: `Zabbix 告警自动创建事件（${severityLabel(alert.severity)}）`,
      created_at: ts,
    });
    if (ci) {
      await insertReturningId(trx('ticket_cis'), { ticket_id: id, ci_id: ci.id, created_at: ts });
    }
    return id;
  });

  const ticket = await db('tickets').where({ id: ticketId }).first();
  await insertReturningId(db('audit_logs'), {
    user_id: null,
    actor_name: 'Zabbix 自动化',
    action: 'zabbix.ticket_created',
    entity_type: 'ticket',
    entity_id: String(ticketId),
    summary: `Zabbix 告警自动创建事件 ${ticket.ticket_no}`,
    detail: JSON.stringify({ integration_id: integration.id, event_id: alert.event_id, severity: alert.severity, ci: ci?.asset_no || null }),
    ip: '',
    created_at: ts,
  });
  queueTicketNotification('ticket.created', ticketId, { actorName: 'Zabbix 自动化' });
  return ticket;
}

async function hasHumanIntervention(ticketId) {
  const [history, comment] = await Promise.all([
    db('ticket_stage_history').where({ ticket_id: ticketId }).whereNotNull('actor_id').first(),
    db('ticket_comments').where({ ticket_id: ticketId }).whereNotNull('user_id').first(),
  ]);
  return Boolean(history || comment);
}

export async function processZabbixAlert(integration, payload, { source = 'webhook' } = {}) {
  const alert = normalizeZabbixAlert(payload);
  if (!integration.enabled) {
    return { accepted: false, action: 'ignored', reason: '集成已停用' };
  }
  const conditions = parseJson(integration.conditions, []);
  const evaluation = evaluateConditions(alert, conditions, integration.severity_threshold);
  if (!evaluation.matched) {
    const record = await recordEvent(integration, alert, { processingStatus: 'ignored', note: evaluation.reason });
    return { accepted: false, action: 'ignored', reason: evaluation.reason, event_id: record.row?.id, normalized: alert };
  }

  if (alert.event_status === 'RECOVERY') {
    const previous = await db('zabbix_events')
      .where({ integration_id: integration.id, event_id: alert.event_id })
      .whereNotNull('ticket_id')
      .orderBy('id', 'desc')
      .first();
    if (previous?.ticket_id) {
      const ticket = await db('tickets').where({ id: previous.ticket_id }).first();
      const canAutoClose = ticket && !['resolved', 'closed', 'cancelled'].includes(ticket.status) && !(await hasHumanIntervention(ticket.id));
      if (canAutoClose) {
        const ts = nowIso();
        await db.transaction(async (trx) => {
          await trx('tickets').where({ id: ticket.id }).update({
            status: 'closed',
            resolution: 'Zabbix 告警已自动恢复，系统自动关闭工单。',
            resolved_at: ticket.resolved_at || ts,
            closed_at: ts,
            updated_at: ts,
          });
          await insertReturningId(trx('ticket_stage_history'), {
            ticket_id: ticket.id,
            stage_id: ticket.current_stage_id || null,
            stage_name: '系统自动恢复',
            action: 'closed',
            actor_id: null,
            comment: `Zabbix 告警已自动恢复：${alert.event_name}。工单无人工介入，系统自动关闭。`,
            created_at: ts,
          });
          await trx('zabbix_events').where({ ticket_id: ticket.id }).update({
            event_status: 'RESOLVED',
            processing_status: 'auto_closed',
            processing_note: 'Zabbix 告警自动恢复，工单无人工介入，系统自动关闭',
          });
        });
        const record = await recordEvent(integration, alert, {
          ticketId: ticket.id,
          processingStatus: 'auto_closed',
          note: '告警自动恢复，工单已自动关闭',
        });
        queueTicketNotification('ticket.closed', ticket.id, { actorName: 'Zabbix 自动化' });
        return { accepted: true, action: 'auto_closed', ticket_id: ticket.id, ticket_no: ticket.ticket_no, event_id: record.row?.id, normalized: alert };
      }
      await addSystemComment(previous.ticket_id, `Zabbix 告警已恢复：${alert.event_name}。该工单已有人员处理，请确认服务状态后关闭事件。`, 'zabbix.recovery');
      const record = await recordEvent(integration, alert, {
        ticketId: previous.ticket_id,
        processingStatus: 'recovery_notice',
        note: '已向原事件追加恢复通知',
      });
      queueTicketNotification('alert.recovery', previous.ticket_id, { actorName: 'Zabbix 自动化' });
      return { accepted: true, action: 'recovery', ticket_id: previous.ticket_id, event_id: record.row?.id, normalized: alert };
    }
    const record = await recordEvent(integration, alert, { processingStatus: 'recovery_unmatched', note: '未找到关联事件' });
    return { accepted: true, action: 'recovery_unmatched', event_id: record.row?.id, normalized: alert };
  }

  const priorEvent = await db('zabbix_events')
    .where({ integration_id: integration.id, event_id: alert.event_id })
    .whereNotNull('ticket_id')
    .orderBy('id', 'desc')
    .first();
  if (priorEvent?.ticket_id) {
    const ticket = await db('tickets').where({ id: priorEvent.ticket_id }).first();
    if (ticket) {
      if (['resolved', 'closed'].includes(ticket.status) && integration.reopen_resolved) {
        await db('tickets').where({ id: ticket.id }).update({ status: 'in_progress', resolved_at: null, closed_at: null, updated_at: nowIso() });
        await addSystemComment(ticket.id, `Zabbix 告警再次触发（${severityLabel(alert.severity)}）：${alert.event_name}。事件已自动重新打开。`, 'zabbix.reopened');
      } else {
        await addSystemComment(ticket.id, `Zabbix 重复告警（${severityLabel(alert.severity)}）：${alert.event_name}，最近触发时间 ${new Date().toLocaleString('zh-CN', { hour12: false })}。`, 'zabbix.repeat');
      }
      const record = await recordEvent(integration, alert, {
        ticketId: ticket.id,
        processingStatus: 'deduplicated',
        note: '已关联到已有事件',
      });
      return { accepted: true, action: 'deduplicated', ticket_id: ticket.id, ticket_no: ticket.ticket_no, event_id: record.row?.id, normalized: alert };
    }
  }

  if (integration.create_only_on_problem && alert.event_status !== 'PROBLEM') {
    const record = await recordEvent(integration, alert, { processingStatus: 'ignored', note: '仅处理 PROBLEM 事件' });
    return { accepted: false, action: 'ignored', reason: '仅处理 PROBLEM 事件', event_id: record.row?.id, normalized: alert };
  }

  const record = await recordEvent(integration, alert, { processingStatus: 'received', note: '正在创建事件' });
  if (record.duplicate) {
    return { accepted: true, action: 'duplicate_event', event_id: record.row?.id, ticket_id: record.row?.ticket_id, normalized: alert };
  }
  const ticket = await createIncidentFromAlert(integration, alert, record.row.id);
  await db('zabbix_events').where({ id: record.row.id }).update({
    ticket_id: ticket.id,
    processing_status: 'ticket_created',
    processing_note: `已自动创建事件 ${ticket.ticket_no}`,
  });
  return {
    accepted: true,
    action: 'ticket_created',
    ticket_id: ticket.id,
    ticket_no: ticket.ticket_no,
    event_id: record.row.id,
    normalized: alert,
    source,
  };
}

export async function testZabbixConnection(integration) {
  const started = Date.now();
  const version = await zabbixRpc(integration, 'apiinfo.version', {}, 10000);
  let hosts = null;
  try {
    hosts = await zabbixRpc(integration, 'host.get', { countOutput: true }, 10000);
  } catch {
    hosts = null;
  }
  return {
    version: version.result,
    host_count: hosts?.result !== undefined ? Number(hosts.result) : null,
    latency_ms: Date.now() - started,
  };
}

export async function syncZabbixProblems(integration) {
  const problems = await zabbixRpc(
    integration,
    'problem.get',
    {
      output: 'extend',
      selectTags: 'extend',
      sortfield: ['eventid'],
      sortorder: 'DESC',
      limit: 100,
    },
    20000,
  );
  const rows = Array.isArray(problems.result) ? problems.result : [];
  const triggerIds = [...new Set(rows.map((problem) => String(problem.objectid || '')).filter(Boolean))];
  const triggerHosts = new Map();
  if (triggerIds.length) {
    const triggers = await zabbixRpc(integration, 'trigger.get', {
      triggerids: triggerIds,
      output: ['triggerid'],
      selectHosts: ['hostid', 'host', 'name'],
    }, 20000);
    for (const trigger of triggers.result || []) {
      triggerHosts.set(String(trigger.triggerid), Array.isArray(trigger.hosts) ? trigger.hosts[0] : null);
    }
  }
  const results = [];
  for (const problem of rows) {
    const host = triggerHosts.get(String(problem.objectid)) || null;
    const payload = {
      event: {
        id: problem.eventid,
        name: problem.name,
        severity: Number(problem.severity || 0),
        status: 'PROBLEM',
        tags: problem.tags || [],
      },
      host: host ? { host: host.host, name: host.name, ip: host.interfaces?.[0]?.ip || '' } : {},
      trigger: { triggerid: problem.objectid, description: problem.name },
    };
    try {
      results.push(await processZabbixAlert(integration, payload, { source: 'sync' }));
    } catch (error) {
      results.push({ accepted: false, action: 'error', reason: error.message, event_id: problem.eventid });
    }
  }
  await db('zabbix_integrations').where({ id: integration.id }).update({ last_sync_at: nowIso(), updated_at: nowIso() });
  return {
    fetched: rows.length,
    created: results.filter((item) => item.action === 'ticket_created').length,
    deduplicated: results.filter((item) => ['deduplicated', 'duplicate_event', 'recovery'].includes(item.action)).length,
    ignored: results.filter((item) => item.action === 'ignored').length,
    errors: results.filter((item) => item.action === 'error').length,
    results: results.slice(0, 100),
  };
}

export { randomToken };
