/**
 * Production baseline initializer.
 *
 * Run once against an EMPTY database:
 *   APP_VERSION=1.0.20261106 node scripts/production-init.mjs
 *
 * It creates the schema and base metadata, then removes all demo business data,
 * keeping only roles/types/workflows and the built-in admin/auditor accounts.
 * High-de API configuration is intentionally removed.
 */
import { db, initDatabase } from '../server/db/index.js';

const count = async (table) => Number((await db(table).count({ count: '*' }).first())?.count || 0);
if ((await db.schema.hasTable('users')) && (await count('users')) > 0) {
  throw new Error('目标数据库已有用户数据。production-init 仅用于全新空库；如确认覆盖请先备份并手动清空。');
}

await initDatabase({ seed: true });

const tables = [
  'ticket_attachments', 'ticket_comments', 'ticket_stage_history', 'ticket_cis', 'ticket_relations', 'ticket_deletion_requests', 'tickets',
  'ci_acl', 'ci_change_logs', 'ci_deletion_requests', 'ci_ips', 'ci_network_ports', 'ci_relations', 'datacenter_links', 'rack_placements', 'rack_profiles', 'rich_attachments', 'cis',
  'ip_assets', 'ip_assignment_history', 'ip_subnets', 'maintenance_notices', 'audit_logs', 'zabbix_events', 'zabbix_integrations', 'notification_logs',
];
for (const table of tables) {
  try { await db(table).del(); } catch (error) { console.warn('[production-init] skip', table, error.message); }
}
await db('users').whereNotIn('username', ['admin', 'auditor']).del();
await db('users').where({ username: 'admin' }).update({ name: '管理员', status: 'active', privacy_consent_version: null, privacy_consent_at: null, privacy_consent_ip: null });
await db('users').where({ username: 'auditor' }).update({ name: '审计管理员', status: 'active', privacy_consent_version: null, privacy_consent_at: null, privacy_consent_ip: null });
await db('system_settings').whereIn('setting_key', ['third_party_config', 'custom_map_svg']).del();

console.log('[production-init] ready', {
  users: await count('users'),
  cis: await count('cis'),
  tickets: await count('tickets'),
  ciTypes: await count('ci_types'),
  workflows: await count('workflows'),
  maintenance: await count('maintenance_notices'),
  audit: await count('audit_logs'),
});
await db.destroy();
