import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { db, insertReturningId } from '../db/index.js';
import { authenticate } from '../lib/auth.js';
import { nowIso } from '../lib/helpers.js';
import { ensureUploadDir, UPLOAD_DIR } from '../lib/uploads.js';

export default async function richAttachmentRoutes(app) {
  app.post('/api/rich-attachments', { preHandler: authenticate }, async (request, reply) => {
    const file = await request.file();
    if (!file) return reply.code(400).send({ message: '请选择文件' });
    const buffer = await file.toBuffer();
    if (buffer.length > 50 * 1024 * 1024) return reply.code(413).send({ message: '附件不能超过 50MB' });
    ensureUploadDir();
    const ext = path.extname(file.filename || '').slice(0, 20);
    const storedName = `${crypto.randomUUID()}${ext}`;
    fs.writeFileSync(path.join(UPLOAD_DIR, storedName), buffer);
    const token = crypto.randomUUID().replaceAll('-', '');
    const id = await insertReturningId(db('rich_attachments'), {
      token,
      filename: String(file.filename || 'attachment').slice(0, 300),
      stored_name: storedName,
      mime_type: file.mimetype || 'application/octet-stream',
      size: buffer.length,
      uploaded_by: request.auth.id,
      created_at: nowIso(),
    });
    return reply.code(201).send({ data: { id, token, filename: file.filename, mime_type: file.mimetype, size: buffer.length, url: `/api/rich-attachments/public/${token}` } });
  });

  app.get('/api/rich-attachments/public/:token', async (request, reply) => {
    const attachment = await db('rich_attachments').where({ token: request.params.token }).first();
    if (!attachment) return reply.code(404).send({ message: '附件不存在' });
    const filePath = path.join(UPLOAD_DIR, attachment.stored_name);
    if (!fs.existsSync(filePath)) return reply.code(404).send({ message: '附件文件不存在' });
    reply.header('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(attachment.filename)}`);
    reply.type(attachment.mime_type || 'application/octet-stream');
    return reply.send(fs.createReadStream(filePath));
  });
}
