import { z } from 'zod';
import { db, insertReturningId } from '../db/index.js';
import { authenticate, requirePermission } from '../lib/auth.js';
import { audit } from '../lib/audit.js';
import { nowIso, parseJson } from '../lib/helpers.js';

const SEVERITY_RANK = { disaster: 5, high: 4, average: 3, warning: 2, information: 1, not_classified: 0 };
const CITY_FALLBACK = {
  上海: { latitude: 31.2304, longitude: 121.4737 },
  北京: { latitude: 39.9042, longitude: 116.4074 },
  深圳: { latitude: 22.5431, longitude: 114.0579 },
  广州: { latitude: 23.1291, longitude: 113.2644 },
};

function networkState(severity) {
  const rank = SEVERITY_RANK[String(severity || '').toLowerCase()] || 0;
  if (rank >= 4) return 'down';
  if (rank > 0) return 'degraded';
  return 'degraded';
}

function worstStatus(statuses) {
  if (statuses.includes('down')) return 'down';
  if (statuses.includes('degraded')) return 'degraded';
  if (statuses.includes('healthy')) return 'healthy';
  return 'unknown';
}

async function datacenterBase(datacenter) {
  const attrs = parseJson(datacenter.attributes, {});
  const city = attrs.city || String(datacenter.location || '').slice(0, 2);
  const fallback = CITY_FALLBACK[city] || { latitude: 34.0, longitude: 108.0 };
  let latitude = Number(attrs.latitude ?? fallback.latitude);
  let longitude = Number(attrs.longitude ?? fallback.longitude);
  // Tolerate legacy/imported rows where latitude and longitude were entered in reverse order.
  if (Math.abs(latitude) > 90 && Math.abs(longitude) <= 90) {
    [latitude, longitude] = [longitude, latitude];
  }
  return {
    ...datacenter,
    attributes: attrs,
    city,
    latitude,
    longitude,
  };
}

async function networkContext(datacenterId) {
  const rackRows = await db('rack_profiles').where({ datacenter_id: datacenterId }).select('ci_id');
  const rackIds = rackRows.map((row) => row.ci_id);
  if (!rackIds.length) {
    return { network_devices: [], open_alerts: [], network_status: 'unknown', zabbix_last_sync: null };
  }
  const devices = await db('rack_placements')
    .join('cis', 'rack_placements.ci_id', 'cis.id')
    .join('ci_types', 'cis.ci_type_id', 'ci_types.id')
    .select(
      'cis.id',
      'cis.asset_no',
      'cis.name',
      'cis.status',
      'cis.ip_address',
      'cis.bmc_address',
      'ci_types.code as type_code',
      'ci_types.name as type_name',
      'rack_placements.rack_id',
      'rack_placements.start_u',
      'rack_placements.u_height',
    )
    .whereIn('rack_placements.rack_id', rackIds);
  const networkDevices = devices.filter((device) => device.type_code === 'network');
  if (!networkDevices.length) {
    return { network_devices: [], open_alerts: [], network_status: 'unknown', zabbix_last_sync: null };
  }
  const hostKeys = [...new Set(networkDevices.flatMap((device) => [device.asset_no, device.name, device.ip_address, device.bmc_address]).filter(Boolean))];
  const events = await db('zabbix_events')
    .whereRaw("upper(event_status) not in ('RESOLVED', 'RECOVERY')")
    .whereIn('host_name', hostKeys)
    .orderBy('received_at', 'desc');
  const eventMap = new Map();
  for (const event of events) {
    if (!eventMap.has(event.host_name)) eventMap.set(event.host_name, []);
    eventMap.get(event.host_name).push(event);
  }
  const enriched = networkDevices.map((device) => {
    const deviceEvents = [...(eventMap.get(device.asset_no) || []), ...(eventMap.get(device.name) || []), ...(eventMap.get(device.ip_address) || []), ...(eventMap.get(device.bmc_address) || [])];
    const unique = [...new Map(deviceEvents.map((event) => [event.id, event])).values()];
    let status = 'healthy';
    if (device.status === 'offline') status = 'down';
    else if (device.status === 'maintenance') status = 'degraded';
    if (unique.length) status = worstStatus([status, networkState(unique[0].severity)]);
    return {
      ...device,
      status,
      open_alerts: unique.length,
      latest_alert: unique[0] ? {
        event_name: unique[0].event_name,
        severity: unique[0].severity,
        received_at: unique[0].received_at,
        event_status: unique[0].event_status,
      } : null,
    };
  });
  const zabbixLastSync = events[0]?.received_at || null;
  return {
    network_devices: enriched,
    open_alerts: events.slice(0, 10),
    network_status: worstStatus(enriched.map((device) => device.status)),
    zabbix_last_sync: zabbixLastSync,
  };
}

async function businessMapForDevices(deviceIds) {
  if (!deviceIds.length) return new Map();
  const rows = await db('ci_relations')
    .join('cis as business', 'ci_relations.source_ci_id', 'business.id')
    .join('ci_types as business_type', 'business.ci_type_id', 'business_type.id')
    .select(
      'ci_relations.target_ci_id',
      'business.id',
      'business.asset_no',
      'business.name',
      'business.criticality',
      'business.status',
      'business.description',
      'business_type.color as type_color',
    )
    .where({ 'ci_relations.relation_type': 'business_runs_on', 'business_type.code': 'business' })
    .whereIn('ci_relations.target_ci_id', deviceIds);
  const map = new Map();
  for (const row of rows) {
    if (!map.has(row.target_ci_id)) map.set(row.target_ci_id, []);
    map.get(row.target_ci_id).push(row);
  }
  return map;
}

async function datacenterLinkRows() {
  const rows = await db('datacenter_links')
    .join('cis as source_dc', 'datacenter_links.source_dc_id', 'source_dc.id')
    .join('cis as target_dc', 'datacenter_links.target_dc_id', 'target_dc.id')
    .leftJoin('cis as monitored', 'datacenter_links.zabbix_ci_id', 'monitored.id')
    .select(
      'datacenter_links.*',
      'source_dc.name as source_name',
      'source_dc.asset_no as source_asset_no',
      'target_dc.name as target_name',
      'target_dc.asset_no as target_asset_no',
      'monitored.name as monitored_name',
      'monitored.asset_no as monitored_asset_no',
    )
    .orderBy('datacenter_links.id');
  const result = [];
  for (const row of rows) {
    let effectiveStatus = row.status;
    let statusSource = 'manual';
    if (row.source === 'zabbix' && row.zabbix_ci_id) {
      const monitored = await db('cis').where({ id: row.zabbix_ci_id }).first();
      const hosts = monitored ? [monitored.asset_no, monitored.name, monitored.ip_address, monitored.bmc_address].filter(Boolean) : [];
      const events = hosts.length
        ? await db('zabbix_events').whereRaw("upper(event_status) not in ('RESOLVED', 'RECOVERY')").whereIn('host_name', hosts)
        : [];
      const highest = events.reduce((max, event) => Math.max(max, SEVERITY_RANK[String(event.severity).toLowerCase()] || 0), 0);
      effectiveStatus = monitored?.status === 'offline' || highest >= 4 ? 'down' : highest > 0 ? 'degraded' : 'up';
      statusSource = 'zabbix';
    }
    result.push({ ...row, effective_status: effectiveStatus, status_source: statusSource });
  }
  return result;
}

const linkSchema = z.object({
  source_dc_id: z.coerce.number().int().positive(),
  target_dc_id: z.coerce.number().int().positive(),
  name: z.string().trim().min(1).max(160),
  carrier: z.string().trim().max(80).default(''),
  bandwidth_mbps: z.coerce.number().int().min(0).max(10000000).default(0),
  status: z.enum(['up', 'degraded', 'down']).default('up'),
  source: z.enum(['manual', 'zabbix']).default('manual'),
  zabbix_ci_id: z.coerce.number().int().positive().nullable().optional(),
  zabbix_metric: z.string().trim().max(160).default(''),
  notes: z.string().trim().max(300).default(''),
});


async function datacenterStats(datacenter, network) {
  const racks = await db('rack_profiles').where({ datacenter_id: datacenter.id }).select('ci_id');
  const rackIds = racks.map((row) => row.ci_id);
  const placements = rackIds.length
    ? await db('rack_placements').join('cis', 'rack_placements.ci_id', 'cis.id').join('ci_types', 'cis.ci_type_id', 'ci_types.id').select('cis.id', 'ci_types.code as type_code').whereIn('rack_placements.rack_id', rackIds)
    : [];
  const businesses = await businessMapForDevices(placements.map((row) => row.id));
  const businessKeys = new Set();
  for (const list of businesses.values()) for (const item of list) businessKeys.add(item.id);
  const deviceCount = placements.length;
  const networkCount = network.network_devices.length;
  return {
    rack_count: rackIds.length,
    device_count: deviceCount,
    network_device_count: networkCount,
    business_count: businessKeys.size,
  };
}

export default async function datacenterRoutes(app) {
  app.get('/api/datacenters', { preHandler: [authenticate, requirePermission('cmdb.view')] }, async () => {
    const rows = await db('cis')
      .join('ci_types', 'cis.ci_type_id', 'ci_types.id')
      .select('cis.*', 'ci_types.name as type_name', 'ci_types.color as type_color')
      .where('ci_types.code', 'datacenter')
      .orderBy('cis.name');
    const data = [];
    for (const row of rows) {
      const base = await datacenterBase(row);
      const network = await networkContext(base.id);
      const stats = await datacenterStats(base, network);
      data.push({ ...base, ...stats, ...network, status_color: network.network_status === 'healthy' ? '#10b981' : network.network_status === 'down' ? '#f43f5e' : network.network_status === 'degraded' ? '#f59e0b' : '#94a3b8' });
    }
    return {
      data,
      stats: {
        datacenter_count: data.length,
        rack_count: data.reduce((sum, item) => sum + item.rack_count, 0),
        device_count: data.reduce((sum, item) => sum + item.device_count, 0),
        business_count: data.reduce((sum, item) => sum + item.business_count, 0),
        degraded_count: data.filter((item) => item.network_status !== 'healthy').length,
      },
    };
  });

  app.get('/api/datacenters/:id', { preHandler: [authenticate, requirePermission('cmdb.view')] }, async (request, reply) => {
    const row = await db('cis')
      .join('ci_types', 'cis.ci_type_id', 'ci_types.id')
      .select('cis.*', 'ci_types.name as type_name', 'ci_types.color as type_color')
      .where({ 'cis.id': Number(request.params.id), 'ci_types.code': 'datacenter' })
      .first();
    if (!row) return reply.code(404).send({ message: '数据中心不存在' });
    const base = await datacenterBase(row);
    const network = await networkContext(base.id);
    const stats = await datacenterStats(base, network);
    const rackProfiles = await db('rack_profiles')
      .join('cis as rack', 'rack_profiles.ci_id', 'rack.id')
      .select('rack_profiles.*', 'rack.asset_no', 'rack.name', 'rack.status', 'rack.location', 'rack.criticality')
      .where('rack_profiles.datacenter_id', base.id)
      .orderBy('rack.asset_no');
    const rackIds = rackProfiles.map((rack) => rack.ci_id);
    const placements = rackIds.length
      ? await db('rack_placements')
          .join('cis', 'rack_placements.ci_id', 'cis.id')
          .join('ci_types', 'cis.ci_type_id', 'ci_types.id')
          .select(
            'rack_placements.*',
            'cis.asset_no',
            'cis.name',
            'cis.status',
            'cis.criticality',
            'cis.ip_address',
            'cis.bmc_address',
            'cis.description',
            'ci_types.code as type_code',
            'ci_types.name as type_name',
            'ci_types.color as type_color',
          )
          .whereIn('rack_placements.rack_id', rackIds)
          .orderBy('rack_placements.start_u')
      : [];
    const businessMap = await businessMapForDevices(placements.map((placement) => placement.ci_id));
    const deviceByRack = new Map();
    for (const placement of placements) {
      if (!deviceByRack.has(placement.rack_id)) deviceByRack.set(placement.rack_id, []);
      deviceByRack.get(placement.rack_id).push({
        ...placement,
        businesses: businessMap.get(placement.ci_id) || [],
      });
    }
    const racks = rackProfiles.map((rack) => {
      const devices = deviceByRack.get(rack.ci_id) || [];
      return {
        ...rack,
        capacity_u: rack.capacity_u,
        used_u: devices.reduce((sum, device) => sum + device.u_height, 0),
        devices,
      };
    });
    return {
      data: {
        ...base,
        ...stats,
        ...network,
        racks,
      },
    };
  });

  app.get('/api/datacenter-links', { preHandler: [authenticate, requirePermission('cmdb.view')] }, async () => {
    return { data: await datacenterLinkRows() };
  });

  app.post('/api/datacenter-links', { preHandler: authenticate }, async (request, reply) => {
    if (request.auth.role?.code !== 'admin') return reply.code(403).send({ message: '仅超级管理员可以维护网络线路' });
    const body = linkSchema.parse(request.body || {});
    if (body.source_dc_id === body.target_dc_id) return reply.code(400).send({ message: '线路两端不能是同一数据中心' });
    const dcs = await db('cis').join('ci_types', 'cis.ci_type_id', 'ci_types.id').whereIn('cis.id', [body.source_dc_id, body.target_dc_id]).where('ci_types.code', 'datacenter');
    if (dcs.length !== 2) return reply.code(400).send({ message: '源或目标数据中心不存在' });
    const ts = nowIso();
    const id = await insertReturningId(db('datacenter_links'), {
      ...body,
      zabbix_ci_id: body.zabbix_ci_id || null,
      created_at: ts,
      updated_at: ts,
    });
    await audit(request, { action: 'datacenter.link_create', entityType: 'system', entityId: id, summary: `新增数据中心线路：${body.name}` });
    return reply.code(201).send({ data: (await datacenterLinkRows()).find((row) => row.id === id) });
  });

  app.put('/api/datacenter-links/:id', { preHandler: authenticate }, async (request, reply) => {
    if (request.auth.role?.code !== 'admin') return reply.code(403).send({ message: '仅超级管理员可以维护网络线路' });
    const id = Number(request.params.id);
    if (!(await db('datacenter_links').where({ id }).first())) return reply.code(404).send({ message: '线路不存在' });
    const body = linkSchema.parse(request.body || {});
    if (body.source_dc_id === body.target_dc_id) return reply.code(400).send({ message: '线路两端不能是同一数据中心' });
    await db('datacenter_links').where({ id }).update({ ...body, zabbix_ci_id: body.zabbix_ci_id || null, updated_at: nowIso() });
    await audit(request, { action: 'datacenter.link_update', entityType: 'system', entityId: id, summary: `更新数据中心线路：${body.name}` });
    return { data: (await datacenterLinkRows()).find((row) => row.id === id) };
  });

  app.delete('/api/datacenter-links/:id', { preHandler: authenticate }, async (request, reply) => {
    if (request.auth.role?.code !== 'admin') return reply.code(403).send({ message: '仅超级管理员可以维护网络线路' });
    const id = Number(request.params.id);
    const existing = await db('datacenter_links').where({ id }).first();
    if (!existing) return reply.code(404).send({ message: '线路不存在' });
    await db('datacenter_links').where({ id }).del();
    await audit(request, { action: 'datacenter.link_delete', entityType: 'system', entityId: id, summary: `删除数据中心线路：${existing.name}` });
    return { ok: true };
  });
}
