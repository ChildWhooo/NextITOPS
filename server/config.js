import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT_DIR = path.resolve(__dirname, '..');

function bool(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
}

const dbClientRaw = (process.env.DB_CLIENT || 'better-sqlite3').toLowerCase();
const dbClient = ['sqlite', 'sqlite3'].includes(dbClientRaw) ? 'better-sqlite3' : dbClientRaw;

export const config = {
  env: process.env.NODE_ENV || 'development',
  port: Number(process.env.PORT || 8080),
  host: process.env.HOST || '0.0.0.0',
  rootDir: ROOT_DIR,
  dataDir: path.resolve(ROOT_DIR, process.env.DATA_DIR || 'data'),
  webDist: path.resolve(ROOT_DIR, 'dist'),
  jwtSecret: process.env.JWT_SECRET || 'nextitops-local-dev-secret-change-me',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '12h',
  autoSeed: bool(process.env.AUTO_SEED, true),
  clusterWorkers: Number(process.env.CLUSTER_WORKERS || 0),
  publicUrl: process.env.PUBLIC_URL || '',
  webhookBaseUrl: process.env.WEBHOOK_PUBLIC_URL || '',
  corsOrigins: process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(',').map((item) => item.trim()) : true,
  db: {
    client: dbClient,
    url: process.env.DATABASE_URL || '',
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT || (dbClient === 'pg' ? 5432 : 3306)),
    database:
      process.env.DB_NAME ||
      (dbClient === 'better-sqlite3'
        ? path.resolve(ROOT_DIR, process.env.DB_FILE || 'data/itsm.db')
        : 'nextitops'),
    user: process.env.DB_USER || 'nextitops',
    password: process.env.DB_PASSWORD || '',
    ssl: bool(process.env.DB_SSL, false),
    poolMin: Number(process.env.DB_POOL_MIN || 0),
    poolMax: Number(process.env.DB_POOL_MAX || (dbClient === 'better-sqlite3' ? 1 : 10)),
  },
  zabbix: {
    timeoutMs: Number(process.env.ZABBIX_TIMEOUT_MS || 10000),
  },
};

export const ROLE_PERMISSIONS = [
  { code: 'dashboard.view', name: '查看工作台', group: '概览' },
  { code: 'cmdb.view', name: '查看 CMDB', group: 'CMDB' },
  { code: 'cmdb.edit', name: '维护 CI 资产', group: 'CMDB' },
  { code: 'cmdb.import', name: '导入 / 导出 CI', group: 'CMDB' },
  { code: 'cmdb.model_manage', name: '配置 CMDB 模型', group: 'CMDB' },
  { code: 'itsm.view', name: '查看工单', group: 'ITSM' },
  { code: 'itsm.create', name: '提交工单', group: 'ITSM' },
  { code: 'itsm.edit', name: '处理工单', group: 'ITSM' },
  { code: 'itsm.approve', name: '审批工单', group: 'ITSM' },
  { code: 'itsm.workflow_manage', name: '设计 ITSM 流程', group: 'ITSM' },
  { code: 'integration.manage', name: '管理监控集成', group: '自动化' },
  { code: 'notification.manage', name: '配置通知渠道', group: '自动化' },
  { code: 'system.user_manage', name: '管理用户', group: '系统' },
  { code: 'system.role_manage', name: '管理角色权限', group: '系统' },
  { code: 'system.audit_view', name: '查看审计日志', group: '系统' },
];

export const NOTIFICATION_EVENTS = [
  { code: 'ticket.created', label: '新工单创建', group: '工单', description: '事件、问题、变更创建时通知' },
  { code: 'ticket.assigned', label: '工单分派 / 转派', group: '工单', description: '负责人发生变化时通知' },
  { code: 'ticket.advanced', label: '流程阶段流转', group: '工单', description: '工单推进到下一阶段时通知' },
  { code: 'ticket.approved', label: '审批通过', group: '工单', description: 'CAB 或流程审批通过时通知' },
  { code: 'ticket.rejected', label: '审批驳回', group: '工单', description: '审批被驳回、工单取消时通知' },
  { code: 'ticket.closed', label: '工单关闭', group: '工单', description: '工单关闭归档时通知' },
  { code: 'ticket.reopened', label: '工单重新打开', group: '工单', description: '已解决或关闭工单被重新打开时通知' },
  { code: 'alert.recovery', label: 'Zabbix 告警恢复', group: '告警', description: 'Zabbix 恢复事件关联到工单时通知' },
];

export const NOTIFICATION_EVENT_CODES = NOTIFICATION_EVENTS.map((event) => event.code);

export const DEFAULT_NOTIFICATION_CHANNELS = [
  {
    type: 'email',
    name: 'SMTP 邮件',
    config: {
      host: '',
      port: 465,
      secure: true,
      user: '',
      password: '',
      from: 'NextITOps <noreply@example.com>',
      extraRecipients: '',
    },
  },
  {
    type: 'feishu',
    name: '飞书机器人',
    config: { webhook: '', mentionUsers: true },
  },
  {
    type: 'wecom',
    name: '企业微信机器人',
    config: { webhook: '', mentionUsers: true },
  },
];
