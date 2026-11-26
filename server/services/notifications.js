import nodemailer from 'nodemailer';
import { db, insertReturningId } from '../db/index.js';
import { decryptPhone } from '../lib/phone.js';
import {
  config,
  DEFAULT_NOTIFICATION_CHANNELS,
  NOTIFICATION_EVENT_CODES,
  NOTIFICATION_EVENTS,
} from '../config.js';
import { asArray, nowIso, parseJson } from '../lib/helpers.js';

const TYPE_LABELS = { incident: '事件', problem: '问题', change: '变更' };
const STATUS_LABELS = {
  new: '待受理',
  in_progress: '处理中',
  pending_approval: '待审批',
  resolved: '已解决',
  closed: '已关闭',
  cancelled: '已取消',
};
const PRIORITY_LABELS = { critical: '紧急', high: '高', medium: '中', low: '低' };
const EVENT_TITLES = {
  'ticket.created': '新工单创建',
  'ticket.assigned': '工单已分派',
  'ticket.advanced': '工单已流转',
  'ticket.approved': '审批已通过',
  'ticket.rejected': '审批已驳回',
  'ticket.closed': '工单已关闭',
  'ticket.reopened': '工单已重新打开',
  'alert.recovery': 'Zabbix 告警已恢复',
};

const CHANNEL_TYPES = new Set(['email', 'feishu', 'wecom']);

function baseUrlFrom(value) {
  return String(value || config.publicUrl || `http://localhost:${config.port}`).replace(/\/+$/, '');
}

function maskEmailTarget(emails) {
  return emails.join(', ').slice(0, 500);
}

function safeWebhookTarget(webhook) {
  try {
    const url = new URL(webhook);
    return `${url.protocol}//${url.host}${url.pathname.replace(/\/[^/]{16,}$/, '/***')}`;
  } catch {
    return 'Webhook';
  }
}

export function eventLabel(code) {
  return NOTIFICATION_EVENTS.find((event) => event.code === code)?.label || code;
}

export function serializeChannel(row) {
  const raw = parseJson(row.config, {});
  const cfg = { ...raw };
  if (row.type === 'email') {
    cfg.hasPassword = Boolean(raw.password);
    cfg.password = '';
  }
  return {
    ...row,
    config: cfg,
    events: asArray(row.events, NOTIFICATION_EVENT_CODES),
  };
}

export async function ensureNotificationChannels() {
  const existing = await db('notification_channels').select('type');
  const existingTypes = new Set(existing.map((row) => row.type));
  const ts = nowIso();
  for (const channel of DEFAULT_NOTIFICATION_CHANNELS) {
    if (existingTypes.has(channel.type)) continue;
    await insertReturningId(db('notification_channels'), {
      type: channel.type,
      name: channel.name,
      enabled: false,
      events: JSON.stringify(NOTIFICATION_EVENT_CODES),
      config: JSON.stringify(channel.config),
      last_test_at: null,
      last_test_status: null,
      created_at: ts,
      updated_at: ts,
    });
  }
}

export async function listNotificationChannels() {
  await ensureNotificationChannels();
  const rows = await db('notification_channels').orderByRaw("case type when 'email' then 0 when 'feishu' then 1 when 'wecom' then 2 else 3 end");
  return rows.map(serializeChannel);
}

function normalizeEvents(events) {
  if (!Array.isArray(events)) return NOTIFICATION_EVENT_CODES;
  return [...new Set(events)].filter((code) => NOTIFICATION_EVENT_CODES.includes(code));
}

export async function updateNotificationChannel(id, input) {
  const channel = await db('notification_channels').where({ id }).first();
  if (!channel) return null;
  const currentConfig = parseJson(channel.config, {});
  const nextConfig = { ...currentConfig, ...(input.config || {}) };
  delete nextConfig.hasPassword;
  if (channel.type === 'email') {
    if (!nextConfig.password) nextConfig.password = currentConfig.password || '';
    nextConfig.port = Number(nextConfig.port || 465);
    nextConfig.secure = Boolean(nextConfig.secure);
  }
  const events = normalizeEvents(input.events ?? asArray(channel.events, NOTIFICATION_EVENT_CODES));
  await db('notification_channels')
    .where({ id })
    .update({
      name: String(input.name ?? channel.name).trim().slice(0, 100) || channel.name,
      enabled: input.enabled === undefined ? Boolean(channel.enabled) : Boolean(input.enabled),
      events: JSON.stringify(events),
      config: JSON.stringify(nextConfig),
      updated_at: nowIso(),
    });
  return serializeChannel(await db('notification_channels').where({ id }).first());
}

function buildEmailHtml({ title, content, url, ticketNo }) {
  const escaped = content
    .split('\n')
    .map((line) => `<div style="margin:5px 0;color:#475569;font-size:13px;line-height:1.65">${escapeHtml(line) || '&nbsp;'}</div>`)
    .join('');
  return `<!doctype html>
<html><body style="margin:0;background:#f5f6fa;padding:24px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','PingFang SC','Microsoft YaHei',sans-serif">
  <div style="max-width:600px;margin:0 auto;background:#fff;border:1px solid #e7eaf1;border-radius:16px;overflow:hidden">
    <div style="background:#0b1220;padding:22px 26px">
      <div style="color:#fff;font-size:18px;font-weight:600;letter-spacing:-.2px">NextITOps <span style="font-size:10px;color:#94a3b8;font-weight:500;margin-left:6px">ITSM & CMDB</span></div>
      <div style="color:#94a3b8;font-size:11px;margin-top:4px">IT 服务通知 · 自动发送</div>
    </div>
    <div style="padding:24px 26px">
      <div style="display:inline-block;background:#eef2ff;color:#4f6ef7;font-size:10px;font-weight:600;padding:4px 8px;border-radius:6px">${escapeHtml(title)}</div>
      <h2 style="margin:12px 0 16px;font-size:19px;line-height:1.5;color:#0f172a">${escapeHtml(ticketNo || title)}</h2>
      <div style="border-top:1px solid #eef1f6;padding-top:14px">${escaped}</div>
      ${url ? `<a href="${escapeHtml(url)}" style="display:inline-block;margin-top:20px;background:#4f6ef7;color:#fff;text-decoration:none;padding:10px 18px;border-radius:9px;font-size:12px;font-weight:600">查看详情 →</a>` : ''}
    </div>
    <div style="background:#fafbfd;border-top:1px solid #eef1f6;padding:14px 26px;color:#94a3b8;font-size:10px">
      此邮件由 NextITOps 自动发送，请勿直接回复。如无需接收，请联系 IT 服务管理员。
    </div>
  </div>
</body></html>`;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function createTransport(emailConfig) {
  return nodemailer.createTransport({
    host: emailConfig.host,
    port: Number(emailConfig.port || 465),
    secure: Boolean(emailConfig.secure),
    auth: emailConfig.user
      ? { user: emailConfig.user, pass: emailConfig.password }
      : undefined,
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 15000,
    tls: { rejectUnauthorized: emailConfig.rejectUnauthorized !== false },
  });
}

async function sendEmail(channel, message, recipients) {
  const cfg = parseJson(channel.config, {});
  if (!cfg.host) throw new Error('SMTP 服务器地址未配置');
  const transport = createTransport(cfg);
  const from = cfg.from || cfg.user || 'NextITOps <noreply@localhost>';
  await transport.sendMail({
    from,
    to: recipients.join(', '),
    subject: message.title,
    text: message.content,
    html: buildEmailHtml(message),
  });
  transport.close();
  return { target: maskEmailTarget(recipients) };
}

async function postWebhook(url, payload) {
  if (!url) throw new Error('Webhook 地址未配置');
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(10000),
  });
  const text = await response.text();
  let data = null;
  try {
    data = JSON.parse(text);
  } catch {
    data = null;
  }
  if (!response.ok) throw new Error(`Webhook HTTP ${response.status}`);
  if (data && typeof data === 'object') {
    if (data.errcode !== undefined && Number(data.errcode) !== 0) throw new Error(`企业微信返回错误：${data.errmsg || data.errcode}`);
    if (data.code !== undefined && Number(data.code) !== 0) throw new Error(`飞书返回错误：${data.msg || data.code}`);
  }
  return text;
}

async function sendFeishu(channel, message, users) {
  const cfg = parseJson(channel.config, {});
  const mentions = cfg.mentionUsers
    ? users
        .filter((user) => user.feishu_open_id)
        .map((user) => `<at user_id="${escapeHtml(user.feishu_open_id)}">${escapeHtml(user.name)}</at>`)
        .join(' ')
    : '';
  const text = [message.title, '', message.content, mentions].filter(Boolean).join('\n');
  await postWebhook(cfg.webhook, { msg_type: 'text', content: { text } });
  return { target: safeWebhookTarget(cfg.webhook) };
}

async function sendWecom(channel, message, users) {
  const cfg = parseJson(channel.config, {});
  const ids = cfg.mentionUsers ? users.map((user) => user.wecom_userid).filter(Boolean) : [];
  const phones = cfg.mentionUsers ? users.map((user) => decryptPhone(user.phone)).filter(Boolean) : [];
  const text = [message.title, '', message.content].join('\n');
  await postWebhook(cfg.webhook, {
    msgtype: 'text',
    text: {
      content: text,
      ...(ids.length ? { mentioned_list: ids } : {}),
      ...(phones.length ? { mentioned_mobile_list: phones } : {}),
    },
  });
  return { target: safeWebhookTarget(cfg.webhook) };
}

async function logDelivery({ channel, eventType, ticketId, target, title, content, status, error }) {
  try {
    await insertReturningId(db('notification_logs'), {
      channel_id: channel.id,
      channel_type: channel.type,
      channel_name: channel.name,
      event_type: eventType,
      ticket_id: ticketId || null,
      target: String(target || '').slice(0, 500),
      title: String(title || '').slice(0, 300),
      content,
      status,
      error: error ? String(error).slice(0, 2000) : '',
      created_at: nowIso(),
    });
  } catch (err) {
    console.error('[notification] failed to write delivery log', err);
  }
}

async function deliver(channel, eventType, message, users, ticketId) {
  const recipients = users.filter((user) => user.email);
  const extra = String(parseJson(channel.config, {}).extraRecipients || '')
    .split(/[,;，；\s]+/)
    .map((item) => item.trim())
    .filter(Boolean);
  const emails = [...new Set([...recipients.map((user) => user.email), ...extra])];
  if (channel.type === 'email' && !emails.length) {
    await logDelivery({ channel, eventType, ticketId, target: '', title: message.title, content: message.content, status: 'skipped', error: '没有可用的收件人邮箱' });
    return { status: 'skipped' };
  }
  try {
    let result;
    if (channel.type === 'email') result = await sendEmail(channel, message, emails);
    else if (channel.type === 'feishu') result = await sendFeishu(channel, message, users);
    else if (channel.type === 'wecom') result = await sendWecom(channel, message, users);
    else throw new Error(`未知通知渠道：${channel.type}`);
    await logDelivery({ channel, eventType, ticketId, target: result.target, title: message.title, content: message.content, status: 'success' });
    return { status: 'success', target: result.target };
  } catch (error) {
    await logDelivery({ channel, eventType, ticketId, target: '', title: message.title, content: message.content, status: 'failed', error: error.message });
    return { status: 'failed', error: error.message };
  }
}

async function ticketNotificationPayload(ticketId, eventType, actorName = '') {
  const ticket = await db('tickets')
    .leftJoin('workflow_stages', 'tickets.current_stage_id', 'workflow_stages.id')
    .leftJoin('workflows', 'tickets.workflow_id', 'workflows.id')
    .leftJoin('users as requester', 'tickets.requester_id', 'requester.id')
    .leftJoin('users as assignee', 'tickets.assignee_id', 'assignee.id')
    .select(
      'tickets.*',
      'workflow_stages.name as stage_name',
      'workflows.name as workflow_name',
      'requester.name as requester_name',
      'requester.email as requester_email',
      'requester.feishu_open_id as requester_feishu_open_id',
      'requester.wecom_userid as requester_wecom_userid',
      'assignee.name as assignee_name',
      'assignee.email as assignee_email',
      'assignee.feishu_open_id as assignee_feishu_open_id',
      'assignee.wecom_userid as assignee_wecom_userid',
      'assignee.phone as assignee_phone',
    )
    .where('tickets.id', ticketId)
    .first();
  if (!ticket) return null;

  const users = [];
  if (ticket.requester_id) {
    users.push({
      id: ticket.requester_id,
      name: ticket.requester_name,
      email: ticket.requester_email,
      feishu_open_id: ticket.requester_feishu_open_id,
      wecom_userid: ticket.requester_wecom_userid,
      phone: '',
    });
  }
  if (ticket.assignee_id && ticket.assignee_id !== ticket.requester_id) {
    users.push({
      id: ticket.assignee_id,
      name: ticket.assignee_name,
      email: ticket.assignee_email,
      feishu_open_id: ticket.assignee_feishu_open_id,
      wecom_userid: ticket.assignee_wecom_userid,
      phone: ticket.assignee_phone,
    });
  }
  const titleLabel = EVENT_TITLES[eventType] || eventLabel(eventType);
  const typeLabel = TYPE_LABELS[ticket.type] || ticket.type;
  const url = `${baseUrlFrom()}/tickets/${ticket.type}/${ticket.id}`;
  const content = [
    `${typeLabel}工单：${ticket.ticket_no}`,
    `标题：${ticket.title}`,
    `状态：${STATUS_LABELS[ticket.status] || ticket.status}　优先级：${PRIORITY_LABELS[ticket.priority] || ticket.priority}`,
    `请求人：${ticket.requester_name || '—'}　负责人：${ticket.assignee_name || '未分配'}`,
    `当前阶段：${ticket.stage_name || '—'}　流程：${ticket.workflow_name || '—'}`,
    actorName ? `操作人：${actorName}` : '',
    ticket.description ? `摘要：${String(ticket.description).replace(/\s+/g, ' ').slice(0, 160)}` : '',
    `查看详情：${url}`,
  ]
    .filter(Boolean)
    .join('\n');
  return {
    ticket,
    users,
    title: `[NextITOps] ${titleLabel} · ${ticket.ticket_no}`,
    content,
    url,
    ticketNo: ticket.ticket_no,
  };
}

export async function notifyTicketEvent(eventType, ticketId, { actorName = '' } = {}) {
  if (!NOTIFICATION_EVENT_CODES.includes(eventType)) return { delivered: 0, channels: 0 };
  const message = await ticketNotificationPayload(ticketId, eventType, actorName);
  if (!message) return { delivered: 0, channels: 0 };
  return notify(eventType, message, ticketId);
}

export async function notifyPassword(user, password) {
  await ensureNotificationChannels();
  const channels = await db('notification_channels').where({ enabled: true });
  if (!channels.length) return { delivered: 0, channels: 0 };
  const message = {
    title: '[NextITOps] 账号初始密码',
    content: [`${user.name}，你的平台账号已创建。`, `用户名：${user.username}`, `初始密码：${password}`, '首次登录后请立即修改密码。'].join('\n'),
    url: baseUrlFrom(),
  };
  let delivered = 0;
  for (const channel of channels) {
    const result = await deliver(channel, 'user.password', message, [user], null);
    if (result.status === 'success') delivered += 1;
  }
  return { delivered, channels: channels.length };
}

export async function notifyMaintenance({ title, content, start_at, end_at }) {
  await ensureNotificationChannels();
  const channels = await db('notification_channels').where({ enabled: true });
  if (!channels.length) return { delivered: 0, channels: 0, skipped: 'no enabled channels' };
  const users = await db('users').where({ status: 'active' }).select('id', 'name', 'email', 'feishu_open_id', 'wecom_userid', 'phone');
  const message = {
    title: `[NextITOps] 维护公告 · ${title}`.slice(0, 300),
    content: [
      `维护主题：${title}`,
      `维护窗口：${start_at} 至 ${end_at}`,
      content,
      `查看系统：${baseUrlFrom()}`,
    ].join('\n'),
    url: baseUrlFrom(),
  };
  let delivered = 0;
  for (const channel of channels) {
    const result = await deliver(channel, 'maintenance.notice', message, users, null);
    if (result.status === 'success') delivered += 1;
  }
  return { delivered, channels: channels.length, users: users.length };
}

async function notify(eventType, message, ticketId) {
  await ensureNotificationChannels();
  const channels = await db('notification_channels').where({ enabled: true });
  const subscribed = channels.filter((channel) => asArray(channel.events, NOTIFICATION_EVENT_CODES).includes(eventType));
  if (!subscribed.length) return { delivered: 0, channels: 0 };
  const results = [];
  for (const channel of subscribed) {
    results.push(await deliver(channel, eventType, message, message.users, ticketId));
  }
  return { delivered: results.filter((item) => item.status === 'success').length, channels: subscribed.length, results };
}

export function queueTicketNotification(eventType, ticketId, options = {}) {
  setImmediate(() => {
    notifyTicketEvent(eventType, ticketId, options).catch((error) => console.error('[notification] dispatch failed', error));
  });
}

export async function testNotificationChannel(id, { recipient, actorName = '管理员' } = {}) {
  const channel = await db('notification_channels').where({ id }).first();
  if (!channel) return null;
  const testRecipient = String(recipient || '').trim();
  const testUser = {
    id: null,
    name: actorName,
    email: testRecipient,
    feishu_open_id: '',
    wecom_userid: '',
    phone: '',
  };
  const message = {
    title: '[NextITOps] 通知渠道测试',
    content: [
      '这是一条测试通知。',
      `渠道：${channel.name}`,
      `时间：${new Date().toLocaleString('zh-CN', { hour12: false })}`,
      '如果你收到此消息，说明渠道配置可用。',
    ].join('\n'),
    url: baseUrlFrom(),
    ticketNo: 'TEST',
  };
  const users = [testUser];
  if (channel.type !== 'email') users.length = 0;
  const result = await deliver(channel, 'channel.test', message, users, null);
  await db('notification_channels').where({ id }).update({
    last_test_at: nowIso(),
    last_test_status: result.status === 'success' ? 'success' : 'failed',
    updated_at: nowIso(),
  });
  return { ...result, channel: serializeChannel(await db('notification_channels').where({ id }).first()) };
}

export async function notificationLogs({ page = 1, pageSize = 20, status, channelType, q } = {}) {
  const query = db('notification_logs');
  if (status) query.where({ status });
  if (channelType) query.where({ channel_type: channelType });
  if (q) query.where((builder) => builder.where('title', 'like', `%${q}%`).orWhere('target', 'like', `%${q}%`));
  const totalRow = await query.clone().count({ count: '*' }).first();
  const rows = await query
    .orderBy('created_at', 'desc')
    .limit(pageSize)
    .offset((page - 1) * pageSize);
  return { data: rows, pagination: { page, pageSize, total: Number(totalRow?.count || 0) } };
}

export { CHANNEL_TYPES };
