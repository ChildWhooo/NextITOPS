import { z } from 'zod';
import { db } from '../db/index.js';
import { authenticate, requirePermission } from '../lib/auth.js';
import { audit } from '../lib/audit.js';
import { NOTIFICATION_EVENTS, NOTIFICATION_EVENT_CODES } from '../config.js';
import {
  listNotificationChannels,
  notificationLogs,
  testNotificationChannel,
  updateNotificationChannel,
} from '../services/notifications.js';

const configSchema = z.record(z.any());

export default async function notificationRoutes(app) {
  app.get(
    '/api/notifications/channels',
    { preHandler: [authenticate, requirePermission('notification.manage')] },
    async () => ({
      data: await listNotificationChannels(),
      events: NOTIFICATION_EVENTS,
    }),
  );

  app.put(
    '/api/notifications/channels/:id',
    { preHandler: [authenticate, requirePermission('notification.manage')] },
    async (request, reply) => {
      const id = Number(request.params.id);
      const schema = z.object({
        name: z.string().trim().min(1).max(100).optional(),
        enabled: z.boolean().optional(),
        events: z.array(z.enum(NOTIFICATION_EVENT_CODES)).optional(),
        config: configSchema.optional(),
      });
      const body = schema.parse(request.body || {});
      const existing = await db('notification_channels').where({ id }).first();
      if (!existing) return reply.code(404).send({ message: '通知渠道不存在' });
      if (body.enabled) {
        const merged = { ...(JSON.parse(existing.config || '{}')), ...(body.config || {}) };
        if (existing.type === 'email' && !merged.host) {
          return reply.code(400).send({ message: '启用 SMTP 邮件前请配置 SMTP 服务器地址' });
        }
        if (['feishu', 'wecom'].includes(existing.type) && !merged.webhook) {
          return reply.code(400).send({ message: '启用机器人通知前请配置 Webhook 地址' });
        }
      }
      const updated = await updateNotificationChannel(id, body);
      await audit(request, {
        action: 'notification.update',
        entityType: 'notification_channel',
        entityId: id,
        summary: `更新通知渠道 ${updated.name}${updated.enabled ? '（已启用）' : '（未启用）'}`,
        detail: { events: updated.events, enabled: updated.enabled },
      });
      return { data: updated };
    },
  );

  app.post(
    '/api/notifications/channels/:id/test',
    { preHandler: [authenticate, requirePermission('notification.manage')] },
    async (request, reply) => {
      const id = Number(request.params.id);
      const channel = await db('notification_channels').where({ id }).first();
      if (!channel) return reply.code(404).send({ message: '通知渠道不存在' });
      const recipient = String(request.body?.recipient || request.auth.email || '').trim();
      const result = await testNotificationChannel(id, { recipient, actorName: request.auth.name });
      await audit(request, {
        action: 'notification.test',
        entityType: 'notification_channel',
        entityId: id,
        summary: `测试通知渠道 ${channel.name}：${result.status === 'success' ? '成功' : result.error || '未发送'}`,
      });
      return {
        status: result.status,
        error: result.error || null,
        channel: result.channel,
      };
    },
  );

  app.get(
    '/api/notifications/logs',
    { preHandler: [authenticate, requirePermission('notification.manage')] },
    async (request) => {
      const page = Math.max(1, Number(request.query.page || 1));
      const pageSize = Math.min(100, Math.max(1, Number(request.query.pageSize || 20)));
      return notificationLogs({
        page,
        pageSize,
        status: request.query.status,
        channelType: request.query.channel_type,
        q: request.query.q,
      });
    },
  );
}
