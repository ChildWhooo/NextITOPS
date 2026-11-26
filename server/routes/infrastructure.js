import { z } from 'zod';
import { db, insertReturningId } from '../db/index.js';
import { authenticate, requirePermission } from '../lib/auth.js';
import { audit } from '../lib/audit.js';
import { asArray, httpError, nowIso, parseJson } from '../lib/helpers.js';
import { syncCILocation } from '../services/ciLocation.js';

const NUMBERINGS = ['bottom_up', 'top_down'];

async function rackRecord(id) {
  return db('cis')
    .leftJoin('ci_types', 'cis.ci_type_id', 'ci_types.id')
    .select('cis.*', 'ci_types.code as type_code', 'ci_types.name as type_name')
    .where('cis.id', id)
    .first();
}

async function ensureRackProfile(rack) {
  let profile = await db('rack_profiles').where({ ci_id: rack.id }).first();
  if (profile) {
    if (!profile.datacenter_id) {
      const outgoing = await db('ci_relations')
        .join('cis as target', 'ci_relations.target_ci_id', 'target.id')
        .join('ci_types as target_type', 'target.ci_type_id', 'target_type.id')
        .select('target.id')
        .where({ 'ci_relations.source_ci_id': rack.id, 'target_type.code': 'datacenter' })
        .whereIn('ci_relations.relation_type', ['member_of', 'contains'])
        .first();
      const incoming = await db('ci_relations')
        .join('cis as source', 'ci_relations.source_ci_id', 'source.id')
        .join('ci_types as source_type', 'source.ci_type_id', 'source_type.id')
        .select('source.id')
        .where({ 'ci_relations.target_ci_id': rack.id, 'source_type.code': 'datacenter' })
        .whereIn('ci_relations.relation_type', ['member_of', 'contains'])
        .first();
      const datacenterId = outgoing?.id || incoming?.id || null;
      if (datacenterId) {
        await db('rack_profiles').where({ id: profile.id }).update({ datacenter_id: datacenterId, updated_at: nowIso() });
        profile = await db('rack_profiles').where({ id: profile.id }).first();
      }
    }
    return profile;
  }
  const attrs = parseJson(rack.attributes, {});
  const relation = await db('ci_relations')
    .leftJoin('cis as target', 'ci_relations.target_ci_id', 'target.id')
    .leftJoin('ci_types as target_type', 'target.ci_type_id', 'target_type.id')
    .select('target.id')
    .where({ 'ci_relations.source_ci_id': rack.id, 'ci_relations.relation_type': 'member_of', 'target_type.code': 'datacenter' })
    .first();
  const ts = nowIso();
  const id = await insertReturningId(db('rack_profiles'), {
    ci_id: rack.id,
    datacenter_id: relation?.id || null,
    capacity_u: Number(attrs.capacity_u || 47),
    numbering: 'bottom_up',
    notes: '',
    created_at: ts,
    updated_at: ts,
  });
  profile = await db('rack_profiles').where({ id }).first();
  return profile;
}

function placementRange(placement) {
  return [placement.start_u, placement.start_u + placement.u_height - 1];
}

function overlaps(a, b) {
  const [aStart, aEnd] = placementRange(a);
  const [bStart, bEnd] = placementRange(b);
  return aStart <= bEnd && bStart <= aEnd;
}

function uLabel(start, height = 1) {
  return height > 1 ? `${start}U-${start + height - 1}U` : `${start}U`;
}

async function rackLayout(id) {
  const rack = await rackRecord(id);
  if (!rack || rack.type_code !== 'rack') return null;
  const profile = await ensureRackProfile(rack);
  const datacenter = profile.datacenter_id
    ? await db('cis').where({ id: profile.datacenter_id }).select('id', 'asset_no', 'name', 'location').first()
    : null;
  const placements = await db('rack_placements')
    .join('cis', 'rack_placements.ci_id', 'cis.id')
    .join('ci_types', 'cis.ci_type_id', 'ci_types.id')
    .leftJoin('users', 'cis.owner_id', 'users.id')
    .select(
      'rack_placements.*',
      'cis.asset_no',
      'cis.name',
      'cis.status',
      'cis.criticality',
      'cis.ip_address',
      'cis.bmc_address',
      'cis.attributes',
      'ci_types.code as type_code',
      'ci_types.name as type_name',
      'ci_types.color as type_color',
      'users.name as owner_name',
    )
    .where('rack_placements.rack_id', id)
    .orderBy('rack_placements.start_u');
  const blanks = await db('rack_blank_units').where({ rack_id: id }).orderBy('start_u');
  const occupied = new Set();
  for (const placement of placements) {
    for (let unit = placement.start_u; unit < placement.start_u + placement.u_height; unit += 1) occupied.add(unit);
  }
  for (const blank of blanks) {
    for (let unit = blank.start_u; unit < blank.start_u + blank.u_height; unit += 1) occupied.add(unit);
  }
  const placementU = placements.reduce((sum, placement) => sum + placement.u_height, 0);
  const blankU = blanks.reduce((sum, blank) => sum + blank.u_height, 0);
  return {
    ...rack,
    attributes: parseJson(rack.attributes, {}),
    profile,
    datacenter,
    placements: placements.map((placement) => ({ ...placement, attributes: parseJson(placement.attributes, {}) })),
    blanks,
    occupied_units: [...occupied].sort((a, b) => a - b),
    stats: {
      capacity_u: profile.capacity_u,
      used_u: placementU + blankU,
      free_u: profile.capacity_u - placementU - blankU,
      device_count: placements.length,
      blank_u: blankU,
    },
  };
}

async function upsertRackRelations(ciId, rackId) {
  const rackTargets = await db('ci_relations')
    .join('cis as target', 'ci_relations.target_ci_id', 'target.id')
    .join('ci_types as target_type', 'target.ci_type_id', 'target_type.id')
    .select('ci_relations.id')
    .where({ 'ci_relations.source_ci_id': ciId, 'ci_relations.relation_type': 'installed_on', 'target_type.code': 'rack' });
  if (rackTargets.length) await db('ci_relations').whereIn('id', rackTargets.map((row) => row.id)).del();
  if (rackId) {
    const exists = await db('ci_relations').where({ source_ci_id: ciId, target_ci_id: rackId, relation_type: 'installed_on' }).first();
    if (!exists) {
      await insertReturningId(db('ci_relations'), {
        source_ci_id: ciId,
        target_ci_id: rackId,
        relation_type: 'installed_on',
        description: '机柜上架位置',
        created_at: nowIso(),
      });
    }
  }
}

function defaultHeight(ci) {
  const attrs = parseJson(ci.attributes, {});
  const raw = String(attrs.rack_unit || attrs.u_height || '1U');
  const match = raw.match(/(\d+)/);
  return match ? Math.max(1, Math.min(20, Number(match[1]))) : 1;
}

export default async function infrastructureRoutes(app) {
  app.get('/api/infrastructure', { preHandler: [authenticate, requirePermission('cmdb.view')] }, async () => {
    const datacenters = await db('cis')
      .join('ci_types', 'cis.ci_type_id', 'ci_types.id')
      .select('cis.id', 'cis.asset_no', 'cis.name', 'cis.location', 'cis.status')
      .where('ci_types.code', 'datacenter')
      .orderBy('cis.name');
    const racks = await db('cis')
      .join('ci_types', 'cis.ci_type_id', 'ci_types.id')
      .select('cis.*', 'ci_types.name as type_name', 'ci_types.color as type_color')
      .where('ci_types.code', 'rack')
      .orderBy('cis.name');
    const profiles = [];
    for (const rack of racks) profiles.push(await ensureRackProfile(rack));
    const counts = await db('rack_placements').select('rack_id').count({ count: '*' }).groupBy('rack_id');
    const countMap = Object.fromEntries(counts.map((row) => [row.rack_id, Number(row.count)]));
    const profileMap = Object.fromEntries(profiles.map((profile) => [profile.ci_id, profile]));
    const datacenterMap = Object.fromEntries(datacenters.map((datacenter) => [datacenter.id, datacenter]));
    const grouped = datacenters.map((datacenter) => ({
      ...datacenter,
      racks: racks
        .filter((rack) => profileMap[rack.id]?.datacenter_id === datacenter.id)
        .map((rack) => ({
          ...rack,
          attributes: parseJson(rack.attributes, {}),
          profile: profileMap[rack.id],
          device_count: countMap[rack.id] || 0,
        })),
    }));
    const unassigned = racks
      .filter((rack) => !profileMap[rack.id]?.datacenter_id)
      .map((rack) => ({ ...rack, attributes: parseJson(rack.attributes, {}), profile: profileMap[rack.id], device_count: countMap[rack.id] || 0 }));
    const placed = await db('rack_placements').count({ count: '*' }).first();
    const rackableTypes = await db('ci_types').where({ rackable: true, enabled: true }).select('id');
    const totalRackable = await db('cis').whereIn('ci_type_id', rackableTypes.map((type) => type.id)).count({ count: '*' }).first();
    return {
      datacenters: grouped,
      unassigned,
      default_datacenter: unassigned.find((rack) => datacenterMap[rack.profile?.datacenter_id]) || null,
      stats: {
        rack_count: racks.length,
        datacenter_count: datacenters.length,
        placed_devices: Number(placed?.count || 0),
        unplaced_devices: Math.max(0, Number(totalRackable?.count || 0) - Number(placed?.count || 0)),
      },
    };
  });

  app.get('/api/racks/:id', { preHandler: [authenticate, requirePermission('cmdb.view')] }, async (request, reply) => {
    const layout = await rackLayout(Number(request.params.id));
    if (!layout) return reply.code(404).send({ message: '机柜不存在' });
    return { data: layout };
  });

  app.put('/api/racks/:id/profile', { preHandler: [authenticate, requirePermission('cmdb.edit')] }, async (request, reply) => {
    const id = Number(request.params.id);
    const rack = await rackRecord(id);
    if (!rack || rack.type_code !== 'rack') return reply.code(404).send({ message: '机柜不存在' });
    const schema = z.object({
      capacity_u: z.coerce.number().int().min(1).max(60),
      numbering: z.enum(NUMBERINGS),
      datacenter_id: z.coerce.number().int().positive().nullable().optional(),
      notes: z.string().default(''),
    });
    const body = schema.parse(request.body || {});
    const placementRows = await db('rack_placements').where({ rack_id: id });
    const overflow = placementRows.find((placement) => placement.start_u + placement.u_height - 1 > body.capacity_u);
    if (overflow) return reply.code(400).send({ message: `容量不能小于已有设备占用位置（设备起始 ${overflow.start_u}U）` });
    const blankRows = await db('rack_blank_units').where({ rack_id: id });
    const blankOverflow = blankRows.find((blank) => blank.start_u + blank.u_height - 1 > body.capacity_u);
    if (blankOverflow) return reply.code(400).send({ message: `容量不能小于已有空挡板占用位置（空挡板起始 ${blankOverflow.start_u}U）` });
    if (body.datacenter_id) {
      const dc = await db('cis')
        .join('ci_types', 'cis.ci_type_id', 'ci_types.id')
        .select('cis.id')
        .where({ 'cis.id': body.datacenter_id, 'ci_types.code': 'datacenter' })
        .first();
      if (!dc) return reply.code(400).send({ message: '所选数据中心不存在' });
    }
    const ts = nowIso();
    const profile = await ensureRackProfile(rack);
    await db('rack_profiles').where({ id: profile.id }).update({
      capacity_u: body.capacity_u,
      numbering: body.numbering,
      datacenter_id: body.datacenter_id || null,
      notes: body.notes,
      updated_at: ts,
    });
    const attrs = parseJson(rack.attributes, {});
    await db('cis').where({ id }).update({
      attributes: JSON.stringify({ ...attrs, capacity_u: body.capacity_u, numbering: body.numbering }),
      updated_at: ts,
    });
    await db('ci_relations')
      .where({ source_ci_id: id, relation_type: 'member_of' })
      .whereIn('target_ci_id', db('cis').join('ci_types', 'cis.ci_type_id', 'ci_types.id').select('cis.id').where('ci_types.code', 'datacenter'))
      .del();
    if (body.datacenter_id) {
      await insertReturningId(db('ci_relations'), {
        source_ci_id: id,
        target_ci_id: body.datacenter_id,
        relation_type: 'member_of',
        description: '机柜所属数据中心',
        created_at: ts,
      });
    }
    await audit(request, { action: 'rack.profile_update', entityType: 'ci', entityId: id, summary: `更新机柜 ${rack.asset_no}：${body.capacity_u}U / ${body.numbering === 'top_down' ? '从上到下' : '从下到上'}` });
    return { data: await rackLayout(id) };
  });

  app.get('/api/racks/:id/unplaced', { preHandler: [authenticate, requirePermission('cmdb.view')] }, async (request, reply) => {
    const id = Number(request.params.id);
    const rack = await rackRecord(id);
    if (!rack || rack.type_code !== 'rack') return reply.code(404).send({ message: '机柜不存在' });
    const query = db('cis')
      .join('ci_types', 'cis.ci_type_id', 'ci_types.id')
      .leftJoin('rack_placements', 'cis.id', 'rack_placements.ci_id')
      .select('cis.id', 'cis.asset_no', 'cis.name', 'cis.status', 'cis.criticality', 'cis.ip_address', 'cis.bmc_address', 'cis.attributes', 'ci_types.code as type_code', 'ci_types.name as type_name', 'ci_types.color as type_color')
      .where('ci_types.rackable', true)
      .whereNull('rack_placements.id')
      .orderBy('cis.name')
      .limit(500);
    if (request.query.q) {
      const term = `%${request.query.q}%`;
      query.where((builder) => builder.where('cis.name', 'like', term).orWhere('cis.asset_no', 'like', term));
    }
    const rows = await query;
    return { data: rows.map((row) => ({ ...row, attributes: parseJson(row.attributes, {}), default_u_height: defaultHeight(row) })) };
  });

  app.post('/api/racks/:id/placements', { preHandler: [authenticate, requirePermission('cmdb.edit')] }, async (request, reply) => {
    const rackId = Number(request.params.id);
    const rack = await rackRecord(rackId);
    if (!rack || rack.type_code !== 'rack') return reply.code(404).send({ message: '机柜不存在' });
    const schema = z.object({
      ci_id: z.coerce.number().int().positive(),
      start_u: z.coerce.number().int().min(1),
      u_height: z.coerce.number().int().min(1).max(20).default(1),
      side: z.enum(['front', 'rear']).default('front'),
      notes: z.string().default(''),
    });
    const body = schema.parse(request.body || {});
    const ci = await db('cis')
      .join('ci_types', 'cis.ci_type_id', 'ci_types.id')
      .select('cis.*', 'ci_types.rackable', 'ci_types.name as type_name', 'ci_types.code as type_code')
      .where('cis.id', body.ci_id)
      .first();
    if (!ci) return reply.code(404).send({ message: '设备不存在' });
    if (!ci.rackable) return reply.code(400).send({ message: `${ci.type_name} 未开启「可上架设备」属性` });
    if (ci.id === rackId) return reply.code(400).send({ message: '机柜不能放入自身' });
    const profile = await ensureRackProfile(rack);
    if (body.start_u + body.u_height - 1 > profile.capacity_u) {
      return reply.code(400).send({ message: `设备超出机柜容量 ${profile.capacity_u}U` });
    }
    const existingForCi = await db('rack_placements').where({ ci_id: body.ci_id }).first();
    const others = await db('rack_placements').where({ rack_id: rackId }).whereNot({ ci_id: body.ci_id });
    const candidate = { start_u: body.start_u, u_height: body.u_height };
    const conflict = others.find((placement) => overlaps(candidate, placement));
    if (conflict) {
      return reply.code(409).send({ message: `${uLabel(conflict.start_u, conflict.u_height)} 已被其他设备占用` });
    }
    const blanks = await db('rack_blank_units').where({ rack_id: rackId });
    const blankConflict = blanks.find((blank) => overlaps(candidate, blank));
    if (blankConflict) {
      return reply.code(409).send({ message: `${uLabel(blankConflict.start_u, blankConflict.u_height)} 已安装空挡板，不可上架设备` });
    }
    const ts = nowIso();
    let placementId;
    if (existingForCi) {
      placementId = existingForCi.id;
      await db('rack_placements').where({ id: existingForCi.id }).update({
        rack_id: rackId,
        start_u: body.start_u,
        u_height: body.u_height,
        side: body.side,
        notes: body.notes,
        updated_at: ts,
      });
    } else {
      placementId = await insertReturningId(db('rack_placements'), {
        rack_id: rackId,
        ci_id: body.ci_id,
        start_u: body.start_u,
        u_height: body.u_height,
        side: body.side,
        notes: body.notes,
        created_at: ts,
        updated_at: ts,
      });
    }
    await upsertRackRelations(body.ci_id, rackId);
    await syncCILocation(body.ci_id);
    await audit(request, { action: 'rack.place', entityType: 'ci', entityId: body.ci_id, summary: `设备上架：${ci.asset_no} → ${rack.asset_no} ${uLabel(body.start_u, body.u_height)}` });
    return { ok: true, placement_id: placementId, data: await rackLayout(rackId) };
  });

  app.delete('/api/racks/:id/placements/:placementId', { preHandler: [authenticate, requirePermission('cmdb.edit')] }, async (request, reply) => {
    const rackId = Number(request.params.id);
    const placement = await db('rack_placements').where({ id: Number(request.params.placementId), rack_id: rackId }).first();
    if (!placement) return reply.code(404).send({ message: '上架记录不存在' });
    const ci = await db('cis').where({ id: placement.ci_id }).first();
    await db('rack_placements').where({ id: placement.id }).del();
    await upsertRackRelations(placement.ci_id, null);
    await syncCILocation(placement.ci_id);
    await audit(request, { action: 'rack.unplace', entityType: 'ci', entityId: placement.ci_id, summary: `设备下架：${ci?.asset_no || placement.ci_id} 从 ${rackId} 移除` });
    return { ok: true };
  });

  app.post('/api/racks/:id/blanks', { preHandler: [authenticate, requirePermission('cmdb.edit')] }, async (request, reply) => {
    const rackId = Number(request.params.id);
    const rack = await rackRecord(rackId);
    if (!rack || rack.type_code !== 'rack') return reply.code(404).send({ message: '机柜不存在' });
    const schema = z.object({
      start_u: z.coerce.number().int().min(1),
      u_height: z.coerce.number().int().min(1).max(60).default(1),
      notes: z.string().max(300).default(''),
    });
    const body = schema.parse(request.body || {});
    const profile = await ensureRackProfile(rack);
    if (body.start_u + body.u_height - 1 > profile.capacity_u) {
      return reply.code(400).send({ message: `空挡板超出机柜容量 ${profile.capacity_u}U` });
    }
    const candidate = { start_u: body.start_u, u_height: body.u_height };
    const placements = await db('rack_placements').where({ rack_id: rackId });
    const placementConflict = placements.find((placement) => overlaps(candidate, placement));
    if (placementConflict) {
      return reply.code(409).send({ message: `${uLabel(placementConflict.start_u, placementConflict.u_height)} 已有设备，不能安装空挡板` });
    }
    const blanks = await db('rack_blank_units').where({ rack_id: rackId });
    const blankConflict = blanks.find((blank) => overlaps(candidate, blank));
    if (blankConflict) return reply.code(409).send({ message: `${uLabel(blankConflict.start_u, blankConflict.u_height)} 已存在空挡板` });
    const ts = nowIso();
    const blankId = await insertReturningId(db('rack_blank_units'), {
      rack_id: rackId,
      start_u: body.start_u,
      u_height: body.u_height,
      notes: body.notes,
      created_at: ts,
      updated_at: ts,
    });
    await audit(request, { action: 'rack.blank_create', entityType: 'ci', entityId: rackId, summary: `机柜 ${rack.asset_no} 安装 ${body.u_height}U 空挡板：${uLabel(body.start_u, body.u_height)}` });
    return reply.code(201).send({ ok: true, blank_id: blankId, data: await rackLayout(rackId) });
  });

  app.put('/api/racks/:id/blanks/:blankId', { preHandler: [authenticate, requirePermission('cmdb.edit')] }, async (request, reply) => {
    const rackId = Number(request.params.id);
    const blankId = Number(request.params.blankId);
    const rack = await rackRecord(rackId);
    if (!rack || rack.type_code !== 'rack') return reply.code(404).send({ message: '机柜不存在' });
    const blank = await db('rack_blank_units').where({ id: blankId, rack_id: rackId }).first();
    if (!blank) return reply.code(404).send({ message: '空挡板不存在' });
    const schema = z.object({
      start_u: z.coerce.number().int().min(1).optional(),
      u_height: z.coerce.number().int().min(1).max(60).optional(),
      notes: z.string().max(300).optional(),
    });
    const body = schema.parse(request.body || {});
    const startU = body.start_u ?? blank.start_u;
    const uHeight = body.u_height ?? blank.u_height;
    const profile = await ensureRackProfile(rack);
    if (startU + uHeight - 1 > profile.capacity_u) {
      return reply.code(400).send({ message: `空挡板超出机柜容量 ${profile.capacity_u}U` });
    }
    const candidate = { start_u: startU, u_height: uHeight };
    const placements = await db('rack_placements').where({ rack_id: rackId });
    const placementConflict = placements.find((placement) => overlaps(candidate, placement));
    if (placementConflict) {
      return reply.code(409).send({ message: `${uLabel(placementConflict.start_u, placementConflict.u_height)} 已有设备，不能移动空挡板` });
    }
    const blanks = await db('rack_blank_units').where({ rack_id: rackId }).whereNot({ id: blankId });
    const blankConflict = blanks.find((item) => overlaps(candidate, item));
    if (blankConflict) return reply.code(409).send({ message: `${uLabel(blankConflict.start_u, blankConflict.u_height)} 已存在空挡板` });
    await db('rack_blank_units').where({ id: blankId }).update({
      start_u: startU,
      u_height: uHeight,
      notes: body.notes ?? blank.notes,
      updated_at: nowIso(),
    });
    await audit(request, { action: 'rack.blank_move', entityType: 'ci', entityId: rackId, summary: `机柜 ${rack.asset_no} 移动 ${uHeight}U 空挡板：${uLabel(blank.start_u, blank.u_height)} → ${uLabel(startU, uHeight)}` });
    return { ok: true, data: await rackLayout(rackId) };
  });

  app.delete('/api/racks/:id/blanks/:blankId', { preHandler: [authenticate, requirePermission('cmdb.edit')] }, async (request, reply) => {
    const rackId = Number(request.params.id);
    const blank = await db('rack_blank_units').where({ id: Number(request.params.blankId), rack_id: rackId }).first();
    if (!blank) return reply.code(404).send({ message: '空挡板不存在' });
    const rack = await rackRecord(rackId);
    await db('rack_blank_units').where({ id: blank.id }).del();
    await audit(request, { action: 'rack.blank_delete', entityType: 'ci', entityId: rackId, summary: `机柜 ${rack?.asset_no || rackId} 移除 ${blank.u_height}U 空挡板：${uLabel(blank.start_u, blank.u_height)}` });
    return { ok: true, data: await rackLayout(rackId) };
  });
}
