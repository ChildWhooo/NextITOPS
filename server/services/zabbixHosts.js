import { db, insertReturningId } from '../db/index.js';
import { nowIso } from '../lib/helpers.js';
import { zabbixRpc } from './zabbix.js';
import { reconcileLinkedAssetsForHost } from './ciLifecycle.js';

export const BUILTIN_TYPE_ORDER = ['server', 'storage', 'network', 'security', 'virtualization_host', 'virtualization', 'vm'];

export const BUILTIN_TYPE_ALIASES = {
  server: 'server', '服务器': 'server', servers: 'server', 'linux servers': 'server', 'windows servers': 'server', 'linux server': 'server',
  storage: 'storage', '存储': 'storage', '存储设备': 'storage',
  network: 'network', '网络设备': 'network', '网络': 'network', 'network devices': 'network', networkdevice: 'network',
  security: 'security', '信息安全设备': 'security', '安全设备': 'security', securitydevice: 'security',
  pm: 'server', '物理服务器': 'server', physical: 'server', 'physical server': 'server',
  'virtualization host': 'virtualization_host', 'virtualization hosts': 'virtualization_host', '虚拟化主机': 'virtualization_host', '虚拟化宿主机': 'virtualization_host', hypervisor: 'virtualization_host', esxi: 'virtualization_host', 'vmware esxi': 'virtualization_host', 'vmware-esxi': 'virtualization_host', 'esxi host': 'virtualization_host', 'hyper-v': 'virtualization_host', hyperv: 'virtualization_host', kvm: 'virtualization_host', xen: 'virtualization_host', proxmox: 'virtualization_host',
  'virtualization platform': 'virtualization', virtualization: 'virtualization', '虚拟化平台': 'virtualization', vsphere: 'virtualization', vcenter: 'virtualization', 'vmware vsphere': 'virtualization',
  vm: 'vm', '虚拟机': 'vm', virtualmachine: 'vm', 'virtual machines': 'vm', vms: 'vm',
};

export function builtinTypeMappings() {
  const groups = new Map(BUILTIN_TYPE_ORDER.map((code) => [code, { ci_type_code: code, values: [] }]));
  for (const [value, code] of Object.entries(BUILTIN_TYPE_ALIASES)) {
    const group = groups.get(code);
    if (group && !group.values.includes(value)) group.values.push(value);
  }
  return [...groups.values()].filter((group) => group.values.length);
}

export function normalizeHostType(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw || raw === 'null' || raw === 'none' || raw === 'unknown') return '';
  const exact = BUILTIN_TYPE_ALIASES[raw] || BUILTIN_TYPE_ALIASES[raw.replace(/\s+/g, ' ')];
  if (exact) return exact;
  if (raw.includes('virtualization platform') || raw.includes('虚拟化平台') || raw.includes('vsphere') || raw.includes('vcenter')) return 'virtualization';
  if (raw.includes('esxi') || raw.includes('hyper-v') || raw.includes('hyperv') || raw.includes('kvm') || raw.includes('xen') || raw.includes('proxmox')) return 'virtualization_host';
  if (raw.includes('virtualization') || raw.includes('虚拟化')) return 'virtualization_host';
  if (raw.includes('virtual machine') || raw.includes('virtualmachine') || raw === 'vm' || raw.startsWith('vm ') || raw.includes('虚拟机')) return 'vm';
  if (raw.includes('storage') || raw.includes('存储')) return 'storage';
  if (raw.includes('network') || raw.includes('网络')) return 'network';
  if (raw.includes('security') || raw.includes('安全') || raw.includes('firewall')) return 'security';
  if (raw.includes('server') || raw.includes('服务器')) return 'server';
  return '';
}

export function zabbixValueKey(value) {
  return String(value || '').trim().toLowerCase();
}

export async function loadZabbixTypeMappings() {
  return db('zabbix_type_mappings as mapping')
    .join('ci_types as type', 'mapping.ci_type_id', 'type.id')
    .select(
      'mapping.id',
      'mapping.zabbix_value',
      'mapping.ci_type_id',
      'mapping.description',
      'mapping.enabled',
      'type.code as ci_type_code',
      'type.name as ci_type_name',
      'type.color as ci_type_color',
      'type.icon as ci_type_icon',
    )
    .where('mapping.enabled', true)
    .where('type.enabled', true)
    .orderBy('mapping.id');
}

function mappingTypeFor(value, mappings = []) {
  const key = zabbixValueKey(value);
  if (!key) return '';
  return mappings.find((mapping) => zabbixValueKey(mapping.zabbix_value) === key)?.ci_type_code || '';
}

function typeForValue(value, mappings = []) {
  const mapped = mappingTypeFor(value, mappings);
  return mapped ? { type: mapped, source: 'mapping' } : { type: normalizeHostType(value), source: '' };
}

function tagsOf(host) {
  return Array.isArray(host.tags) ? host.tags : [];
}

export function detectHostType(host, typeMappings = []) {
  const tags = tagsOf(host);
  for (const key of ['cmdb.type', 'cmdb_type', 'host_type', 'type', 'device_type']) {
    const tag = tags.find((item) => String(item.tag || '').toLowerCase() === key);
    const detected = typeForValue(tag?.value, typeMappings);
    if (detected.type) return { type: detected.type, source: detected.source ? `mapping:tag:${key}` : `tag:${key}` };
  }
  for (const group of host.groups || []) {
    const detected = typeForValue(group.name, typeMappings);
    if (detected.type) return { type: detected.type, source: detected.source ? 'mapping:group' : `group:${group.name}` };
  }
  const detected = typeForValue(host.inventory?.type, typeMappings);
  if (detected.type) return { type: detected.type, source: detected.source ? 'mapping:inventory' : 'inventory:type' };
  return { type: '', source: '' };
}

export function primaryIp(host) {
  const interfaces = host.interfaces || [];
  const candidates = interfaces
    .map((item) => ({ ip: String(item.ip || '').trim(), main: String(item.main ?? '0'), type: String(item.type ?? '') }))
    .filter((item) => item.ip && item.ip !== '127.0.0.1' && item.ip !== '::1');
  return candidates.find((item) => item.main === '1')?.ip || candidates[0]?.ip || '';
}

function assetNoFor(host) {
  const base = `ZBX-${host.host}`.replace(/[^a-zA-Z0-9_.-]/g, '-').slice(0, 60);
  return base || `ZBX-${host.hostid}`;
}

async function nextAssetNo(host) {
  const base = assetNoFor(host);
  let value = base;
  let suffix = 1;
  while (await db('cis').where({ asset_no: value }).first()) value = `${base}-${suffix++}`;
  return value;
}

async function queueCandidate(integration, host, type, reason, firstSync = false) {
  const ts = nowIso();
  const existing = await db('zabbix_discovered_hosts').where({ integration_id: integration.id, host_id: String(host.hostid) }).first();
  const row = {
    integration_id: integration.id,
    host_id: String(host.hostid),
    host_name: String(host.host || ''),
    display_name: String(host.name || host.host || ''),
    ip_address: primaryIp(host),
    zabbix_type: type || '',
    ci_type_code: type || '',
    reason: firstSync ? '首次全量同步，等待确认' : reason,
    status: 'pending',
    payload: JSON.stringify(host),
    last_seen_at: ts,
    updated_at: ts,
  };
  if (existing) {
    await db('zabbix_discovered_hosts').where({ id: existing.id }).update(row);
    return existing.id;
  }
  return insertReturningId(db('zabbix_discovered_hosts'), { ...row, first_seen_at: ts, created_at: ts });
}

async function applyHost(integration, host, type) {
  const hostId = String(host.hostid);
  const ip = primaryIp(host);
  const displayName = String(host.name || host.host || hostId);
  let existing = await db('cis').where({ zabbix_integration_id: integration.id, zabbix_host_id: hostId }).first();
  // A host may be recreated in Zabbix or its asset number edited manually. Match the
  // stable host name + IP pair before creating a duplicate CI.
  if (!existing && host.host && ip) {
    existing = await db('cis')
      .where({ zabbix_integration_id: integration.id, zabbix_host: String(host.host), ip_address: ip })
      .first();
  }
  const offline = String(host.status ?? '0') === '1';

  if (!existing) {
    const ipOwner = ip ? await db('ci_ips').join('cis', 'ci_ips.ci_id', 'cis.id')
      .select('ci_ips.*', 'cis.status as ci_status', 'cis.zabbix_host_id')
      .where('ci_ips.ip_address', ip).where('ci_ips.status', 'active').orderBy('ci_ips.id', 'desc').first() : null;
    if (ipOwner && ipOwner.zabbix_host_id !== hostId) {
      if (ipOwner.ci_status !== 'offline') return { action: 'pending', reason: `IP ${ip} 已被其他在线资产占用` };
      await db('ci_ips').where({ id: ipOwner.id }).update({ status: 'released', released_at: nowIso() });
    }
    const nameConflict = await db('cis').where({ name: displayName }).whereNot({ zabbix_host_id: hostId }).first();
    if (nameConflict) return { action: 'pending', reason: `主机名 ${displayName} 已存在其他资产` };
    const typeRow = await db('ci_types').where({ code: type }).first();
    if (!typeRow) return { action: 'pending', reason: `CMDB 缺少 CI 类型 ${type}` };
    const ts = nowIso();
    const assetNo = await nextAssetNo(host);
    const ciId = await insertReturningId(db('cis'), {
      asset_no: assetNo,
      name: displayName,
      ci_type_id: typeRow.id,
      status: offline ? 'offline' : 'in_use',
      criticality: 'medium',
      environment: 'production',
      ip_address: ip,
      description: '由 Zabbix 自动发现，请在 CMDB 中补全厂商、型号、位置等信息。',
      attributes: JSON.stringify({ zabbix_host: host.host, zabbix_host_id: hostId, zabbix_type: type, discovered: true }),
      zabbix_host_id: hostId,
      zabbix_host: String(host.host || ''),
      zabbix_integration_id: integration.id,
      zabbix_last_seen_at: ts,
      created_at: ts,
      updated_at: ts,
    });
    if (ip) await insertReturningId(db('ci_ips'), { ci_id: ciId, ip_address: ip, status: offline ? 'offline' : 'active', source: 'zabbix', last_seen_at: ts, created_at: ts });
    return { action: 'created', ci_id: ciId };
  }

  const ts = nowIso();
  const nextStatus = offline ? 'offline' : 'in_use';
  const statusChanged = existing.status !== nextStatus;
  await db('cis').where({ id: existing.id }).update({
    name: displayName,
    status: nextStatus,
    ip_address: ip || existing.ip_address,
    zabbix_host: String(host.host || ''),
    zabbix_host_id: hostId,
    zabbix_last_seen_at: ts,
    updated_at: ts,
  });
  if (statusChanged) await reconcileLinkedAssetsForHost(existing.id);
  if (ip) {
    const ipRow = await db('ci_ips').where({ ci_id: existing.id, ip_address: ip }).first();
    if (ipRow) await db('ci_ips').where({ id: ipRow.id }).update({ status: offline ? 'offline' : 'active', last_seen_at: ts, released_at: null });
    else await insertReturningId(db('ci_ips'), { ci_id: existing.id, ip_address: ip, status: offline ? 'offline' : 'active', source: 'zabbix', last_seen_at: ts, created_at: ts });
  }
  return { action: 'updated', ci_id: existing.id };
}

export async function syncZabbixHosts(integration) {
  const response = await zabbixRpc(integration, 'host.get', {
    output: ['hostid', 'host', 'name', 'status', 'description'],
    selectInterfaces: ['interfaceid', 'ip', 'main', 'type', 'port', 'available'],
    selectGroups: ['groupid', 'name'],
    selectTags: 'extend',
    selectInventory: ['type', 'os'],
  });
  const hosts = Array.isArray(response.result) ? response.result : [];
  const firstSync = !integration.last_host_sync_at;
  const counts = { total: hosts.length, created: 0, updated: 0, pending: 0, offline: 0 };
  const seen = new Set();
  const typeMappings = await loadZabbixTypeMappings();

  for (const host of hosts) {
    const hostId = String(host.hostid || '');
    if (!hostId) continue;
    seen.add(hostId);
    const detected = detectHostType(host, typeMappings);
    const ip = primaryIp(host);
    const staged = await db('zabbix_discovered_hosts').where({ integration_id: integration.id, host_id: hostId }).first();

    // Approved and ignored hosts are human decisions. Keep them out of the pending
    // queue on every later sync, even when detection is temporarily incomplete.
    if (staged && staged.status === 'ignored') {
      await db('zabbix_discovered_hosts').where({ id: staged.id }).update({ last_seen_at: nowIso(), updated_at: nowIso() });
      continue;
    }
    if (staged && staged.status === 'approved') {
      if (detected.type && ip) {
        const result = await applyHost(integration, host, staged.ci_type_code || detected.type);
        if (result.action !== 'pending') {
          await db('zabbix_discovered_hosts').where({ id: staged.id }).update({ last_seen_at: nowIso(), updated_at: nowIso() });
        }
      }
      continue;
    }
    if (firstSync) {
      await queueCandidate(integration, host, detected.type, '首次全量同步，等待确认', true);
      counts.pending += 1;
      continue;
    }
    if (!detected.type) {
      await queueCandidate(integration, host, '', '无法判断主机类型');
      counts.pending += 1;
      continue;
    }
    if (!ip) {
      await queueCandidate(integration, host, detected.type, '没有可用的主 IP');
      counts.pending += 1;
      continue;
    }
    const result = await applyHost(integration, host, detected.type);
    if (result.action === 'pending') {
      await queueCandidate(integration, host, detected.type, result.reason);
      counts.pending += 1;
    } else {
      counts[result.action] = (counts[result.action] || 0) + 1;
      await db('zabbix_discovered_hosts').where({ integration_id: integration.id, host_id: hostId }).update({ status: 'auto', ci_id: result.ci_id, reason: '', last_seen_at: nowIso(), updated_at: nowIso() });
    }
  }

  const mapped = await db('cis').where({ zabbix_integration_id: integration.id }).whereNot('zabbix_host_id', '');
  for (const ci of mapped) {
    if (seen.has(String(ci.zabbix_host_id))) continue;
    await db('cis').where({ id: ci.id }).update({ status: 'offline', updated_at: nowIso() });
    await reconcileLinkedAssetsForHost(ci.id);
    await db('ci_ips').where({ ci_id: ci.id }).whereIn('status', ['active']).update({ status: 'offline', released_at: null });
    counts.offline += 1;
  }

  await db('zabbix_integrations').where({ id: integration.id }).update({ last_host_sync_at: nowIso(), updated_at: nowIso() });
  return { ...counts, first_sync: firstSync };
}

export async function restoreHostCandidate(integrationId, candidateId) {
  const candidate = await db('zabbix_discovered_hosts').where({ id: candidateId, integration_id: integrationId }).first();
  if (!candidate) throw new Error('待确认主机不存在');
  if (candidate.status !== 'ignored') throw new Error('只有已忽略的主机可以恢复');
  await db('zabbix_discovered_hosts').where({ id: candidate.id }).update({
    status: 'pending',
    ci_id: null,
    reason: '已恢复为待确认',
    updated_at: nowIso(),
  });
  return { id: candidate.id };
}

export async function approveHostCandidates(integrationId, items) {
  const results = [];
  for (const item of items) {
    try {
      const result = await approveHostCandidate(integrationId, Number(item.id), item.ci_type_code || '');
      results.push({ id: item.id, ok: true, ...result });
    } catch (error) {
      results.push({ id: item.id, ok: false, message: error.message });
    }
  }
  return results;
}

export async function approveHostCandidate(integrationId, candidateId, typeCode = '') {
  const candidate = await db('zabbix_discovered_hosts').where({ id: candidateId, integration_id: integrationId }).first();
  if (!candidate) throw new Error('待确认主机不存在');
  const host = JSON.parse(candidate.payload || '{}');
  const type = normalizeHostType(typeCode) || normalizeHostType(candidate.zabbix_type);
  if (!type) throw new Error('请选择有效的 CI 类型');
  if (!primaryIp(host)) throw new Error('该主机没有可用的主 IP');
  const result = await applyHost({ id: integrationId }, host, type);
  if (result.action === 'pending') throw new Error(result.reason);
  await db('zabbix_discovered_hosts').where({ id: candidate.id }).update({ status: 'approved', ci_id: result.ci_id, updated_at: nowIso() });
  return result;
}
