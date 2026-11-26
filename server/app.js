import fs from 'node:fs';
import path from 'node:path';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import { ZodError } from 'zod';
import { config } from './config.js';
import authRoutes from './routes/auth.js';
import userRoutes from './routes/users.js';
import cmdbRoutes from './routes/cmdb.js';
import workflowRoutes from './routes/workflows.js';
import ticketRoutes from './routes/tickets.js';
import richAttachmentRoutes from './routes/richAttachments.js';
import zabbixRoutes from './routes/zabbix.js';
import dashboardRoutes from './routes/dashboard.js';
import notificationRoutes from './routes/notifications.js';
import relationRoutes from './routes/relations.js';
import infrastructureRoutes from './routes/infrastructure.js';
import datacenterRoutes from './routes/datacenters.js';
import systemRoutes from './routes/system.js';
import deletionRoutes from './routes/deletions.js';
import reportRoutes from './routes/reports.js';
import topologyRoutes from './routes/topology.js';
import { AVATAR_DIR, ensureAvatarDir } from './lib/avatars.js';

export async function buildApp() {
  const app = Fastify({
    logger: {
      level: process.env.LOG_LEVEL || 'info',
      transport:
        config.env === 'development' && process.env.LOG_PRETTY === 'true'
          ? { target: 'pino-pretty', options: { colorize: true } }
          : undefined,
    },
    bodyLimit: 5 * 1024 * 1024,
    trustProxy: true,
  });

  await app.register(cors, {
    origin: config.corsOrigins,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  });
  await app.register(multipart, {
    limits: { fileSize: 50 * 1024 * 1024, files: 1 },
  });

  app.addHook('onSend', async (request, reply, payload) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('X-Frame-Options', 'SAMEORIGIN');
    reply.header('Referrer-Policy', 'strict-origin-when-cross-origin');
    reply.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    reply.header('Content-Security-Policy', "default-src 'self'; img-src 'self' data: blob: https://*.amap.com https://*.autonavi.com; style-src 'self' 'unsafe-inline' https://*.amap.com; script-src 'self' 'unsafe-inline' 'unsafe-eval' https://webapi.amap.com https://restapi.amap.com https://*.amap.com; connect-src 'self' https://*.amap.com https://restapi.amap.com; worker-src 'self' blob:; frame-src 'self' blob:; font-src 'self' data:");
    return payload;
  });

  app.get('/api/health', async () => ({
    ok: true,
    service: 'NextITOps ITSM',
    version: process.env.APP_VERSION || '1.0.0.20261126',
    database: config.db.client,
    time: new Date().toISOString(),
  }));

  app.get('/api', async () => ({
    name: 'NextITOps ITSM API',
    version: process.env.APP_VERSION || '1.0.0.20261126',
    docs: '/api/health',
  }));

  await app.register(authRoutes);
  await app.register(userRoutes);
  await app.register(cmdbRoutes);
  await app.register(workflowRoutes);
  await app.register(ticketRoutes);
  await app.register(richAttachmentRoutes);
  await app.register(zabbixRoutes);
  await app.register(dashboardRoutes);
  await app.register(notificationRoutes);
  await app.register(relationRoutes);
  await app.register(infrastructureRoutes);
  await app.register(datacenterRoutes);
  await app.register(systemRoutes);
  await app.register(deletionRoutes);
  await app.register(reportRoutes);
  await app.register(topologyRoutes);

  await ensureAvatarDir();
  await app.register(fastifyStatic, {
    root: AVATAR_DIR,
    prefix: '/api/avatars/',
    decorateReply: false,
    maxAge: config.env === 'production' ? '7d' : 0,
  });

  app.all('/api/*', async (request, reply) => {
    return reply.code(404).send({ message: '接口不存在' });
  });

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ZodError) {
      return reply.code(400).send({
        message: error.issues[0]?.message || '请求参数不正确',
        details: error.issues,
      });
    }
    if (error.code === 'FST_REQ_FILE_TOO_LARGE' || error.code === 'FST_FILES_LIMIT') {
      return reply.code(413).send({ message: '上传文件不得超过 10MB' });
    }
    if (error.code === 'FST_ERR_CTP_BODY_TOO_LARGE') {
      return reply.code(413).send({ message: '请求内容过大' });
    }
    const status = error.statusCode || 500;
    if (status >= 500) request.log.error({ err: error }, 'request failed');
    return reply.code(status).send({
      message: status >= 500 ? '服务器处理请求时发生错误' : error.message,
      ...(error.details ? { details: error.details } : {}),
    });
  });

  const indexFile = path.join(config.webDist, 'index.html');
  if (fs.existsSync(indexFile)) {
    await app.register(fastifyStatic, {
      root: config.webDist,
      prefix: '/',
      wildcard: true,
      maxAge: config.env === 'production' ? '1h' : 0,
    });
    app.setNotFoundHandler((request, reply) => {
      if (request.url.startsWith('/api/')) {
        return reply.code(404).send({ message: '接口不存在' });
      }
      if (request.method === 'GET') return reply.sendFile('index.html');
      return reply.code(404).send({ message: '资源不存在' });
    });
  } else {
    app.setNotFoundHandler((request, reply) => {
      if (request.url.startsWith('/api/')) return reply.code(404).send({ message: '接口不存在' });
      return reply.code(404).send({
        message: '前端尚未构建。开发模式请访问 Vite 地址，生产模式请先运行 npm run build。',
      });
    });
  }

  return app;
}
