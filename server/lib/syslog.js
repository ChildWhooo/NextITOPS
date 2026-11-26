import dgram from 'node:dgram';
import net from 'node:net';
import os from 'node:os';
import { db } from '../db/index.js';

async function readConfig() {
  try {
    const row = await db('system_settings').where({ setting_key: 'syslog_config' }).first();
    return row ? JSON.parse(row.setting_value || '{}') : {};
  } catch {
    return {};
  }
}

export async function sendSyslog({ action = 'audit', summary = '', actor = '系统', entityType = '', entityId = '', ip = '', at = new Date() } = {}) {
  const config = await readConfig();
  if (!config.enabled || !config.host || !config.port) return { skipped: true };
  const facility = Math.min(23, Math.max(0, Number(config.facility ?? 1)));
  const severity = 6;
  const priority = facility * 8 + severity;
  const hostname = os.hostname();
  const timestamp = at.toISOString();
  const entity = entityType ? ` [${entityType}${entityId ? `:${entityId}` : ''}]` : '';
  const message = `<${priority}>1 ${timestamp} ${hostname} NextITOps - - ${action} actor=${actor} ip=${ip || '-'}${entity} ${summary}`;
  const payload = Buffer.from(message, 'utf8');
  const port = Number(config.port);
  if (config.protocol === 'tcp') {
    return new Promise((resolve) => {
      const socket = net.createConnection({ host: config.host, port, timeout: 2500 }, () => {
        socket.end(payload, () => { socket.destroy(); resolve({ ok: true }); });
      });
      socket.on('timeout', () => { socket.destroy(); resolve({ ok: false, error: 'timeout' }); });
      socket.on('error', (error) => { socket.destroy(); resolve({ ok: false, error: error.message }); });
    });
  }
  return new Promise((resolve) => {
    const socket = dgram.createSocket('udp4');
    socket.send(payload, port, config.host, (error) => {
      socket.close();
      resolve(error ? { ok: false, error: error.message } : { ok: true });
    });
  });
}

export async function testSyslog(config) {
  const result = await sendSyslog({ action: 'system.syslog_test', summary: 'NextITOps Syslog 连通性测试', actor: '系统', at: new Date() });
  if (config) {
    // Test uses the stored configuration; the caller persists before testing.
  }
  return result;
}
