import { db, insertReturningId } from '../db/index.js';
import { nowIso, parseJson } from './helpers.js';
import { sendSyslog } from './syslog.js';

/**
 * Return a stable, human-readable client address for audit records.
 * Fastify's request.ip already respects X-Forwarded-For when trustProxy is enabled.
 */
export function clientIp(request) {
  let ip =
    request?.ip ||
    (typeof request?.headers?.['x-forwarded-for'] === 'string' ? request.headers['x-forwarded-for'].split(',')[0].trim() : '') ||
    request?.raw?.socket?.remoteAddress ||
    request?.socket?.remoteAddress ||
    '';
  if (ip.startsWith('::ffff:')) ip = ip.slice(7);
  if (ip === '::1') ip = '127.0.0.1';
  return String(ip).slice(0, 80);
}

/**
 * Persist an audit record without ever failing the business operation.
 * Pass `actor` explicitly when the request is not authenticated yet (for example login).
 */
export async function audit(request, { action, entityType = '', entityId = '', summary = '', detail = {}, actor }) {
  try {
    const currentActor = actor || request?.auth;
    await insertReturningId(db('audit_logs'), {
      user_id: currentActor?.id || null,
      actor_name: currentActor?.name || '系统',
      action,
      entity_type: entityType,
      entity_id: entityId === null || entityId === undefined ? '' : String(entityId),
      summary,
      detail: JSON.stringify(detail || {}),
      ip: clientIp(request),
      created_at: nowIso(),
    });
    sendSyslog({ action, summary, actor: currentActor?.name || '系统', entityType, entityId, ip: clientIp(request) }).catch(() => {});
  } catch (error) {
    request?.log?.warn({ err: error }, 'failed to write audit log');
  }
}

export function auditRow(row) {
  return { ...row, detail: parseJson(row.detail, {}) };
}

const ENTITY_LABELS = {
  user: '用户',
  role: '角色',
  ci: '配置项',
  ci_type: 'CI 类型',
  workflow: '流程',
  ticket: '工单',
  integration: '集成',
  notification_channel: '通知渠道',
  relation_type: '关联关系',
};

/**
 * Resolve audit entity IDs into labels meaningful to end users.
 * Avoids showing bare internal IDs such as “用户 #1” in the UI.
 */
export async function enrichAuditRows(rows) {
  const grouped = {};
  for (const row of rows) {
    if (!row.entity_type || !row.entity_id) continue;
    grouped[row.entity_type] = grouped[row.entity_type] || new Set();
    if (/^\d+$/.test(String(row.entity_id))) grouped[row.entity_type].add(Number(row.entity_id));
  }

  const labels = {};
  const keysOf = (type) => [...(grouped[type] || [])];
  const put = (type, id, label) => {
    if (label) labels[`${type}:${id}`] = label;
  };

  if (keysOf('user').length) {
    const users = await db('users').whereIn('id', keysOf('user')).select('id', 'name', 'username');
    users.forEach((user) => put('user', user.id, `${user.name}${user.username ? ` (@${user.username})` : ''}`));
  }
  if (keysOf('ci').length) {
    const cis = await db('cis').whereIn('id', keysOf('ci')).select('id', 'asset_no', 'name');
    cis.forEach((ci) => put('ci', ci.id, `${ci.asset_no} · ${ci.name}`));
  }
  if (keysOf('ci_type').length) {
    const types = await db('ci_types').whereIn('id', keysOf('ci_type')).select('id', 'name');
    types.forEach((type) => put('ci_type', type.id, type.name));
  }
  if (keysOf('workflow').length) {
    const workflows = await db('workflows').whereIn('id', keysOf('workflow')).select('id', 'name');
    workflows.forEach((workflow) => put('workflow', workflow.id, workflow.name));
  }
  if (keysOf('ticket').length) {
    const tickets = await db('tickets').whereIn('id', keysOf('ticket')).select('id', 'ticket_no', 'title');
    tickets.forEach((ticket) => put('ticket', ticket.id, `${ticket.ticket_no} · ${ticket.title}`));
  }
  if (keysOf('role').length) {
    const roles = await db('roles').whereIn('id', keysOf('role')).select('id', 'name');
    roles.forEach((role) => put('role', role.id, role.name));
  }
  if (keysOf('integration').length) {
    const integrations = await db('zabbix_integrations').whereIn('id', keysOf('integration')).select('id', 'name');
    integrations.forEach((integration) => put('integration', integration.id, integration.name));
  }
  if (keysOf('notification_channel').length) {
    const channels = await db('notification_channels').whereIn('id', keysOf('notification_channel')).select('id', 'name');
    channels.forEach((channel) => put('notification_channel', channel.id, channel.name));
  }
  if (keysOf('relation_type').length) {
    const types = await db('ci_relation_types').whereIn('id', keysOf('relation_type')).select('id', 'name', 'reverse_name');
    types.forEach((type) => put('relation_type', type.id, `${type.name} / ${type.reverse_name}`));
  }

  return rows.map((row) => {
    const key = `${row.entity_type}:${row.entity_id}`;
    const entityLabel =
      labels[key] ||
      (row.entity_id ? '记录已删除' : String(row.action).includes('bulk') ? '批量操作' : '');
    return {
      ...auditRow(row),
      entity_type_label: ENTITY_LABELS[row.entity_type] || row.entity_type || '系统',
      entity_label: entityLabel,
    };
  });
}
