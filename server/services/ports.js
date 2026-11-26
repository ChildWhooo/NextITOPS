import { db, insertReturningId } from '../db/index.js';
import { nowIso } from '../lib/helpers.js';

function numberOrZero(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.round(number)) : 0;
}

function normalizeStatus(value) {
  const status = String(value || '').toLowerCase();
  if (['up', '1', 'connected', 'ok', 'link_up'].includes(status)) return 'up';
  if (['down', '0', 'disconnected', 'fail', 'link_down'].includes(status)) return 'down';
  return 'unknown';
}

export async function syncPortSnapshot({ host, hostIp, ports, ciId = null, source = 'zabbix' }) {
  const hostName = String(host || '').trim();
  const ip = String(hostIp || '').trim();
  if (!ciId && !hostName && !ip) return { matched_ci: null, created: 0, updated: 0, skipped: 0, reason: 'host is required' };

  let ci = null;
  if (ciId) ci = await db('cis').where({ id: Number(ciId) }).first();
  if (!ci && hostName) ci = await db('cis').where({ asset_no: hostName }).first();
  if (!ci && hostName) ci = await db('cis').where({ name: hostName }).first();
  if (!ci && ip) ci = await db('cis').where({ ip_address: ip }).first();
  if (!ci && ip) ci = await db('cis').where({ bmc_address: ip }).first();
  if (!ci) return { matched_ci: null, created: 0, updated: 0, skipped: Array.isArray(ports) ? ports.length : 0, reason: 'no CI matched host' };

  let created = 0;
  let updated = 0;
  let skipped = 0;
  for (const item of Array.isArray(ports) ? ports : []) {
    const portName = String(item.port_name || item.name || '').trim();
    if (!portName) {
      skipped += 1;
      continue;
    }
    let switchCi = null;
    const switchRef = item.connected_switch_id ?? item.switch_asset_no ?? item.switch ?? null;
    if (switchRef !== null && switchRef !== undefined && switchRef !== '') {
      if (/^\d+$/.test(String(switchRef))) switchCi = await db('cis').where({ id: Number(switchRef) }).first();
      if (!switchCi) switchCi = await db('cis').where({ asset_no: String(switchRef) }).first();
    }
    const existing = await db('ci_network_ports').where({ ci_id: ci.id, port_name: portName }).first();
    const values = {
      port_type: String(item.port_type || item.type || existing?.port_type || 'ethernet').slice(0, 30),
      mac_address: String(item.mac_address || item.mac || existing?.mac_address || '').slice(0, 80),
      speed_mbps: item.speed_mbps !== undefined || item.speed !== undefined ? numberOrZero(item.speed_mbps ?? item.speed) : Number(existing?.speed_mbps || 0),
      current_speed_mbps: item.current_speed_mbps !== undefined || item.current_speed !== undefined ? numberOrZero(item.current_speed_mbps ?? item.current_speed) : Number(existing?.current_speed_mbps || 0),
      connected_switch_id: switchCi?.id ?? existing?.connected_switch_id ?? null,
      connected_switch_port: String(item.connected_switch_port || item.switch_port || existing?.connected_switch_port || '').slice(0, 120),
      link_status: item.link_status !== undefined || item.status !== undefined ? normalizeStatus(item.link_status ?? item.status) : (existing?.link_status || 'unknown'),
      source: source === 'zabbix-agent' ? 'zabbix-agent' : 'zabbix',
      last_synced_at: nowIso(),
      updated_at: nowIso(),
    };
    if (existing) {
      await db('ci_network_ports').where({ id: existing.id }).update(values);
      updated += 1;
    } else {
      await insertReturningId(db('ci_network_ports'), {
        ci_id: ci.id,
        port_name: portName,
        notes: '',
        created_at: nowIso(),
        ...values,
      });
      created += 1;
    }
  }
  return {
    matched_ci: { id: ci.id, asset_no: ci.asset_no, name: ci.name },
    created,
    updated,
    skipped,
    total: created + updated,
  };
}
