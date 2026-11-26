import { db } from '../db/index.js';
import { parseJson } from '../lib/helpers.js';

function formatRackLocation(rack, placement) {
  const label = rack?.asset_no || rack?.name || '机柜';
  if (!placement) return label;
  const end = placement.start_u + placement.u_height - 1;
  return `${label} ${placement.start_u}U${end > placement.start_u ? `-${end}U` : ''}`;
}

export async function deriveCILocation(ciId) {
  const ci = await db('cis as c')
    .leftJoin('ci_types as t', 'c.ci_type_id', 't.id')
    .select('c.*', 't.code as type_code')
    .where('c.id', ciId)
    .first();
  if (!ci) return null;
  const placement = await db('rack_placements as rp')
    .join('cis as rack', 'rp.rack_id', 'rack.id')
    .select('rack.asset_no', 'rack.name', 'rp.start_u', 'rp.u_height')
    .where('rp.ci_id', ciId)
    .first();
  if (placement) return formatRackLocation(placement, placement);

  const relations = await db('ci_relations')
    .leftJoin('cis as target', 'ci_relations.target_ci_id', 'target.id')
    .leftJoin('ci_types as target_type', 'target.ci_type_id', 'target_type.id')
    .select('target.id', 'target.name', 'target.asset_no', 'target_type.code as target_code')
    .where('ci_relations.source_ci_id', ciId);
  const datacenter = relations.find((row) => row.target_code === 'datacenter');
  if (datacenter) return datacenter.name;
  const rack = relations.find((row) => row.target_code === 'rack');
  if (rack) return rack.asset_no || rack.name;
  if (ci.type_code !== 'virtualization_host') {
    const virtualization = relations.find((row) => ['virtualization', 'virtualization_host', 'vm'].includes(row.target_code));
    if (virtualization) {
      return virtualization.target_code === 'virtualization_host'
        ? `虚拟化宿主机：${virtualization.name}`
        : `虚拟化平台：${virtualization.name}`;
    }
  }
  const server = relations.find((row) => row.target_code === 'server');
  if (server) return `服务器：${server.name}`;

  const incoming = await db('ci_relations')
    .leftJoin('cis as source', 'ci_relations.source_ci_id', 'source.id')
    .leftJoin('ci_types as source_type', 'source.ci_type_id', 'source_type.id')
    .select('source.id', 'source.name', 'source.asset_no', 'source_type.code as source_code')
    .where('ci_relations.target_ci_id', ciId);
  const host = incoming.find((row) => row.source_code === 'virtualization_host');
  if (host) return `虚拟化宿主机：${host.name}`;
  const serverHost = incoming.find((row) => row.source_code === 'server');
  if (serverHost) return `服务器：${serverHost.name}`;
  const platform = incoming.find((row) => row.source_code === 'virtualization');
  if (platform) return `虚拟化平台：${platform.name}`;
  return null;
}

export async function syncCILocation(ciId) {
  if (!ciId) return;
  const ci = await db('cis').where({ id: ciId }).first();
  if (!ci) return;
  const attributes = parseJson(ci.attributes, {});
  const location = await deriveCILocation(ciId);
  if (location) {
    await db('cis').where({ id: ciId }).update({
      location,
      attributes: JSON.stringify({ ...attributes, location_auto: true }),
      updated_at: new Date().toISOString(),
    });
  } else if (attributes.location_auto) {
    await db('cis').where({ id: ciId }).update({
      location: '',
      attributes: JSON.stringify({ ...attributes, location_auto: false }),
      updated_at: new Date().toISOString(),
    });
  }
}

export async function backfillCILocations() {
  const placed = await db('rack_placements').select('ci_id');
  const ids = [...new Set(placed.map((row) => Number(row.ci_id)).filter(Boolean))];
  for (const id of ids) {
    try { await syncCILocation(id); } catch (error) { console.error('[location] backfill failed', id, error.message); }
  }
  return ids.length;
}
