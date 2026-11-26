import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { db, insertReturningId, dialect } from '../db/index.js';
import { authenticate, requirePermission } from '../lib/auth.js';
import { audit } from '../lib/audit.js';
import {
  asArray,
  httpError,
  nowIso,
  paginate,
  parseJson,
} from '../lib/helpers.js';
import { createCIWorkbook, createCITemplate, parseCIImport, CORE_COLUMNS } from '../lib/excel.js';
import { canApproveDeletion } from '../lib/deletionPolicy.js';
import { sanitizeRichText } from '../lib/richText.js';
import { getSetting } from '../lib/systemSettings.js';
import { syncCILocation } from '../services/ciLocation.js';
import { deleteCIWithLinkedAssets, reconcileLinkedAssetsForHost } from '../services/ciLifecycle.js';

async function findLocationConflict(location, excludeId = null) {
  if (!location) return null;
  const query = db('cis')
    .join('rack_placements', 'cis.id', 'rack_placements.ci_id')
    .select('cis.id', 'cis.asset_no', 'cis.name', 'cis.location')
    .where('cis.location', location);
  if (excludeId) query.whereNot('cis.id', excludeId);
  return query.first();
}

function compareIpAddress(left, right) {
  const a = String(left || '').split('.').map(Number);
  const b = String(right || '').split('.').map(Number);
  for (let index = 0; index < 4; index += 1) {
    const diff = (Number.isFinite(a[index]) ? a[index] : 0) - (Number.isFinite(b[index]) ? b[index] : 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

function customAttributeSortExpression(fieldKey, fieldType) {
  const numeric = ['number', 'integer', 'float', 'currency'].includes(String(fieldType || '').toLowerCase());
  if (dialect() === 'pg') {
    const expression = db.raw('(??::jsonb ->> ?)', ['cis.attributes', fieldKey]);
    return numeric ? db.raw('CAST((??::jsonb ->> ?) AS double precision)', ['cis.attributes', fieldKey]) : expression;
  }
  const path = `$.${fieldKey}`;
  if (dialect() === 'mysql2') {
    const expression = db.raw('JSON_UNQUOTE(JSON_EXTRACT(??, ?))', ['cis.attributes', path]);
    return numeric ? db.raw('CAST(JSON_UNQUOTE(JSON_EXTRACT(??, ?)) AS DECIMAL(20, 6))', ['cis.attributes', path]) : expression;
  }
  const expression = db.raw('json_extract(??, ?)', ['cis.attributes', path]);
  return numeric ? db.raw('CAST(json_extract(??, ?) AS REAL)', ['cis.attributes', path]) : expression;
}

async function getHiddenBasicFields(typeCode) {  try {
    const config = JSON.parse(await getSetting('ci_basic_fields', '{}'));
    return Object.entries(config?.[typeCode] || {}).filter(([, value]) => value?.hidden).map(([key]) => key);
  } catch {
    return [];
  }
}

function normalizeDatacenterCoordinates(type, attributes) {  if (type?.code !== 'datacenter') return attributes;
  const next = { ...(attributes || {}) };
  const latitude = Number(next.latitude);
  const longitude = Number(next.longitude);
  if (Number.isFinite(latitude) && Number.isFinite(longitude) && Math.abs(latitude) > 90 && Math.abs(longitude) <= 90) {
    next.latitude = longitude;
    next.longitude = latitude;
  }
  return next;
}

async function takeoverManualIp(ciId, assetNo, ipAddress, actorId) {
  if (!ipAddress) return;
  const manual = await db('ip_assets').where({ ip_address: ipAddress }).first();
  if (!manual) return;
  await insertReturningId(db('ip_assignment_history'), {
    ip_address: ipAddress,
    action: 'cmdb_takeover',
    previous_asset_no: manual.asset_no || manual.notes || '',
    previous_owner: manual.owner || '',
    previous_notes: manual.notes || '',
    new_ci_id: ciId,
    new_asset_no: assetNo,
    actor_id: actorId,
    created_at: nowIso(),
  });
  await db('ip_assets').where({ id: manual.id }).del();
}

async function ciAccess(auth, ci, { edit = false } = {}) {
  if (auth?.role?.code === 'admin') return true;
  if (!ci?.asset_manager_id) return true;
  if (Number(ci.asset_manager_id) === Number(auth.id)) return true;
  const grant = await db('ci_acl').where({ ci_id: ci.id, user_id: auth.id }).first();
  return Boolean(grant && (edit ? grant.can_edit : grant.can_view));
}

const CORE_KEYS = new Set([
  'asset_no', 'name', 'status', 'criticality', 'environment', 'owner_id', 'owner_name', 'department',
  'location', 'vendor', 'model', 'serial_no', 'ip_address', 'bmc_address', 'mac_address', 'os_name', 'cpu', 'memory',
  'disk', 'purchase_date', 'warranty_end', 'cost', 'description', 'attributes', 'ci_type_id', 'id',
]);
const FIELD_TYPES = ['text', 'textarea', 'number', 'date', 'select', 'multiselect', 'ci_ref'];

function cleanString(value, fallback = '') {
  if (value === null || value === undefined) return fallback;
  return String(value).trim();
}

function ciPayload(body) {
  return {
    asset_no: cleanString(body.asset_no),
    name: cleanString(body.name),
    ci_type_id: Number(body.ci_type_id),
    status: cleanString(body.status, 'in_use'),
    criticality: cleanString(body.criticality, 'medium'),
    environment: cleanString(body.environment, 'production'),
    owner_id: body.owner_id ? Number(body.owner_id) : null,
    asset_manager_id: body.asset_manager_id ? Number(body.asset_manager_id) : null,
    department: cleanString(body.department),
    location: cleanString(body.location),
    vendor: cleanString(body.vendor),
    model: cleanString(body.model),
    serial_no: cleanString(body.serial_no),
    ip_address: cleanString(body.ip_address),
    mac_address: cleanString(body.mac_address),
    bmc_address: cleanString(body.bmc_address),
    os_name: cleanString(body.os_name),
    cpu: cleanString(body.cpu),
    memory: cleanString(body.memory),
    disk: cleanString(body.disk),
    purchase_date: cleanString(body.purchase_date),
    warranty_end: cleanString(body.warranty_end),
    cost: Number(body.cost || 0),
    description: cleanString(body.description),
    attributes: body.attributes && typeof body.attributes === 'object' ? body.attributes : {},
  };
}

function autoAssetNo(type) {
  const code = String(type?.code || 'ci').toUpperCase().replace(/[^A-Z0-9]+/g, '').slice(0, 12) || 'CI';
  return `AUTO-${code}-${Date.now().toString(36).toUpperCase()}-${randomUUID().slice(0, 6).toUpperCase()}`;
}

async function nextAutoAssetNo(type) {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const candidate = autoAssetNo(type);
    if (!(await db('cis').where({ asset_no: candidate }).first())) return candidate;
  }
  throw httpError(500, '自动生成资产编号失败，请重试');
}

function autoAssetName(type, assetNo) {
  const suffix = String(assetNo || '').replace(/[^a-z0-9]/gi, '').slice(-6).toUpperCase();
  return `${type.name}（未命名${suffix ? ` ${suffix}` : ''}）`;
}

async function fillHiddenRequiredFields(type, body, existing = null) {
  const hiddenFields = new Set(await getHiddenBasicFields(type.code));
  if (!cleanString(body.asset_no) && hiddenFields.has('asset_no')) {
    body.asset_no = existing?.asset_no || await nextAutoAssetNo(type);
  }
  if (!cleanString(body.name) && hiddenFields.has('name')) {
    body.name = existing?.name || autoAssetName(type, body.asset_no);
  }
  return hiddenFields;
}

async function getTypeByParam(value) {
  if (!value) return null;
  const numeric = Number(value);
  const query = db('ci_types');
  if (Number.isInteger(numeric) && numeric > 0) query.where({ id: numeric });
  else query.where({ code: value });
  return query.first();
}

function validateAttributes(typeFields, attributes) {
  const missing = [];
  const errors = [];
  const cleaned = {};
  for (const field of typeFields) {
    const raw = attributes?.[field.field_key];
    if (raw === undefined || raw === null || raw === '') {
      if (field.required) missing.push(field.label);
      continue;
    }
    const options = asArray(field.options, []);
    if (field.field_type === 'number') {
      const value = Number(raw);
      if (Number.isNaN(value)) errors.push(`${field.label}需为数字`);
      else cleaned[field.field_key] = value;
    } else if (field.field_type === 'multiselect') {
      const values = Array.isArray(raw) ? raw : String(raw).split(/[，,;；]/).map((item) => item.trim()).filter(Boolean);
      if (options.length && values.some((item) => !options.includes(item))) errors.push(`${field.label}包含无效选项`);
      cleaned[field.field_key] = values;
    } else if (field.field_type === 'select') {
      const value = String(raw);
      if (options.length && !options.includes(value)) errors.push(`${field.label}必须为：${options.join(' / ')}`);
      cleaned[field.field_key] = value;
    } else if (field.field_type === 'ci_ref') {
      const value = Number(raw);
      if (!Number.isInteger(value) || value <= 0) errors.push(`${field.label}需选择有效的资产`);
      else cleaned[field.field_key] = value;
    } else {
      cleaned[field.field_key] = String(raw).trim();
    }
  }
  if (missing.length) errors.push(`请填写必填字段：${missing.join('、')}`);
  if (errors.length) throw httpError(400, errors.join('；'));
  return cleaned;
}

async function validateCIRefs(typeFields, attributes) {
  const referenceFields = typeFields.filter((field) => field.field_type === 'ci_ref' && attributes?.[field.field_key] !== undefined);
  if (!referenceFields.length) return;
  const values = [...new Set(referenceFields.map((field) => Number(attributes[field.field_key])).filter((value) => Number.isInteger(value) && value > 0))];
  if (!values.length) return;
  const rows = await db('cis')
    .join('ci_types', 'cis.ci_type_id', 'ci_types.id')
    .select('cis.id', 'cis.asset_no', 'cis.name', 'ci_types.code as type_code')
    .whereIn('cis.id', values);
  const byId = new Map(rows.map((row) => [row.id, row]));
  const errors = [];
  for (const field of referenceFields) {
    const row = byId.get(Number(attributes[field.field_key]));
    const allowedTypes = asArray(field.options, []);
    if (!row) {
      errors.push(`${field.label}关联的资产不存在`);
    } else if (allowedTypes.length && !allowedTypes.includes(row.type_code)) {
      errors.push(`${field.label}只能选择${allowedTypes.join(' / ')}类型的资产`);
    }
  }
  if (errors.length) throw httpError(400, errors.join('；'));
}

function softwareInventoryQuery(ciId) {
  return db('ci_relations')
    .join('cis as software', 'ci_relations.target_ci_id', 'software.id')
    .join('ci_types as software_type', 'software.ci_type_id', 'software_type.id')
    .where('ci_relations.source_ci_id', ciId)
    .where('ci_relations.relation_type', 'software_installed')
    .where('software_type.code', 'software');
}

function softwareInventorySource(row) {
  return String(row.asset_no || '').startsWith('SW-ZBX-') ? 'zabbix' : 'manual';
}

async function ciDetail(id) {
  const ci = await db('cis')
    .leftJoin('ci_types', 'cis.ci_type_id', 'ci_types.id')
    .leftJoin('users as owners', 'cis.owner_id', 'owners.id')
    .select(
      'cis.*',
      'ci_types.name as type_name',
      'ci_types.code as type_code',
      'ci_types.color as type_color',
      'ci_types.icon as type_icon',
      'owners.name as owner_name',
      'owners.avatar_url as owner_avatar_url',
      'owners.email as owner_email',
      'owners.department as owner_department',
    )
    .where('cis.id', id)
    .first();
  if (!ci) return null;

  const fields = await db('ci_field_defs').where({ ci_type_id: ci.ci_type_id }).orderBy('sort_order');
  const attributes = parseJson(ci.attributes, {});
  const referenceIds = [...new Set(
    fields
      .filter((field) => field.field_type === 'ci_ref')
      .map((field) => Number(attributes[field.field_key]))
      .filter((value) => Number.isInteger(value) && value > 0),
  )];
  const referenceValues = {};
  if (referenceIds.length) {
    const references = await db('cis')
      .join('ci_types', 'cis.ci_type_id', 'ci_types.id')
      .select(
        'cis.id',
        'cis.asset_no',
        'cis.name',
        'ci_types.code as type_code',
        'ci_types.name as type_name',
      )
      .whereIn('cis.id', referenceIds);
    for (const reference of references) {
      referenceValues[String(reference.id)] = reference;
    }
  }
  let relations = await db('ci_relations')
    .leftJoin('cis as target', 'ci_relations.target_ci_id', 'target.id')
    .leftJoin('ci_types as target_type', 'target.ci_type_id', 'target_type.id')
    .leftJoin('ci_relation_types as relation_type', 'ci_relations.relation_type', 'relation_type.code')
    .select(
      'ci_relations.*',
      'target.asset_no as target_asset_no',
      'target.name as target_name',
      'target.status as target_status',
      'target_type.name as target_type_name',
      'target_type.color as target_type_color',
      'relation_type.name as relation_forward_label',
      'relation_type.reverse_name as relation_reverse_label',
      'relation_type.color as relation_type_color',
    )
    .where('ci_relations.source_ci_id', id);
  const incoming = await db('ci_relations')
    .leftJoin('cis as source', 'ci_relations.source_ci_id', 'source.id')
    .leftJoin('ci_types as source_type', 'source.ci_type_id', 'source_type.id')
    .leftJoin('ci_relation_types as relation_type', 'ci_relations.relation_type', 'relation_type.code')
    .select(
      'ci_relations.*',
      'source.asset_no as source_asset_no',
      'source.name as source_name',
      'source.status as source_status',
      'source_type.name as source_type_name',
      'source_type.color as source_type_color',
      'relation_type.name as relation_forward_label',
      'relation_type.reverse_name as relation_reverse_label',
      'relation_type.color as relation_type_color',
    )
    .where('ci_relations.target_ci_id', id);
  const tickets = await db('ticket_cis')
    .join('tickets', 'ticket_cis.ticket_id', 'tickets.id')
    .select(
      'tickets.id',
      'tickets.ticket_no',
      'tickets.title',
      'tickets.type',
      'tickets.status',
      'tickets.priority',
      'tickets.updated_at',
    )
    .where('ticket_cis.ci_id', id)
    .orderBy('tickets.updated_at', 'desc')
    .limit(20);
  const history = await db('audit_logs')
    .where({ entity_type: 'ci', entity_id: String(id) })
    .orderBy('created_at', 'desc')
    .limit(10);
  const ports = await db('ci_network_ports')
    .leftJoin('cis as sw', 'ci_network_ports.connected_switch_id', 'sw.id')
    .leftJoin('ci_types as sw_type', 'sw.ci_type_id', 'sw_type.id')
    .select(
      'ci_network_ports.*',
      'sw.asset_no as switch_asset_no',
      'sw.name as switch_name',
      'sw_type.name as switch_type_name',
    )
    .where('ci_network_ports.ci_id', id)
    .orderBy('ci_network_ports.port_name');
  const placement = await db('rack_placements')
    .leftJoin('cis as rack', 'rack_placements.rack_id', 'rack.id')
    .leftJoin('rack_profiles', 'rack_placements.rack_id', 'rack_profiles.ci_id')
    .leftJoin('cis as dc', 'rack_profiles.datacenter_id', 'dc.id')
    .select(
      'rack_placements.*',
      'rack.asset_no as rack_asset_no',
      'rack.name as rack_name',
      'rack_profiles.capacity_u',
      'rack_profiles.numbering',
      'dc.name as datacenter_name',
    )
    .where('rack_placements.ci_id', id)
    .first();
  const softwareInventory = await softwareInventoryQuery(id)
    .select('software.id', 'software.asset_no', 'software.name', 'software.status', 'software.attributes')
    .orderBy('software.name')
    .orderBy('software.asset_no')
    .limit(20);
  const softwareInventoryCountRow = await softwareInventoryQuery(id)
    .countDistinct({ count: 'software.id' })
    .first();
  const softwareRelationRows = await softwareInventoryQuery(id)
    .select('software.id', 'software.asset_no', 'software.attributes');
  const zabbixSoftwareIds = new Set(
    softwareRelationRows
      .filter((row) => softwareInventorySource(row) === 'zabbix')
      .map((row) => Number(row.id)),
  );
  relations = relations.filter((row) => !zabbixSoftwareIds.has(Number(row.target_ci_id)));

  return {
    ...ci,
    attributes,
    reference_values: referenceValues,
    fields: fields.map((field) => ({ ...field, options: asArray(field.options, []) })),
    relations: relations.map((row) => ({ ...row, direction: 'outgoing' })),
    incoming_relations: incoming.map((row) => ({ ...row, direction: 'incoming' })),
    software_inventory: softwareInventory.map((row) => ({
      id: row.id,
      asset_no: row.asset_no,
      name: row.name,
      status: row.status,
      version: parseJson(row.attributes, {}).version || '',
      source: softwareInventorySource(row),
    })),
    software_inventory_count: Number(softwareInventoryCountRow?.count || 0),
    ports,
    placement: placement || null,
    tickets,
    history,
  };
}

async function syncRackDatacenter(rackId) {
  const rack = await db('cis').leftJoin('ci_types', 'cis.ci_type_id', 'ci_types.id')
    .select('cis.id', 'ci_types.code as type_code', 'cis.attributes').where('cis.id', rackId).first();
  if (!rack || rack.type_code !== 'rack') return;
  const outgoing = await db('ci_relations')
    .join('cis as target', 'ci_relations.target_ci_id', 'target.id')
    .join('ci_types as target_type', 'target.ci_type_id', 'target_type.id')
    .select('target.id')
    .where({ 'ci_relations.source_ci_id': rackId, 'target_type.code': 'datacenter' })
    .whereIn('ci_relations.relation_type', ['member_of', 'contains'])
    .first();
  const incoming = await db('ci_relations')
    .join('cis as source', 'ci_relations.source_ci_id', 'source.id')
    .join('ci_types as source_type', 'source.ci_type_id', 'source_type.id')
    .select('source.id')
    .where({ 'ci_relations.target_ci_id': rackId, 'source_type.code': 'datacenter' })
    .whereIn('ci_relations.relation_type', ['member_of', 'contains'])
    .first();
  const datacenterId = outgoing?.id || incoming?.id || null;
  const profile = await db('rack_profiles').where({ ci_id: rackId }).first();
  if (profile) {
    if (profile.datacenter_id !== datacenterId) {
      await db('rack_profiles').where({ id: profile.id }).update({ datacenter_id: datacenterId, updated_at: nowIso() });
    }
    return;
  }
  if (datacenterId) {
    const attrs = parseJson(rack.attributes, {});
    const ts = nowIso();
    await insertReturningId(db('rack_profiles'), {
      ci_id: rackId, datacenter_id: datacenterId, capacity_u: Number(attrs.capacity_u || 47),
      numbering: 'bottom_up', notes: '', created_at: ts, updated_at: ts,
    });
  }
}

async function syncRackDatacenterForRelation(sourceId, targetId) {
  const rows = await db('cis').leftJoin('ci_types', 'cis.ci_type_id', 'ci_types.id')
    .select('cis.id', 'ci_types.code as type_code').whereIn('cis.id', [sourceId, targetId]);
  for (const row of rows) if (row.type_code === 'rack') await syncRackDatacenter(row.id);
}

export default async function cmdbRoutes(app) {
  // ---------- CI model ----------
  app.get('/api/ci-types', { preHandler: authenticate }, async () => {
    const types = await db('ci_types').orderBy('sort_order').orderBy('id');
    const counts = await db('cis').select('ci_type_id').count({ count: '*' }).groupBy('ci_type_id');
    const fieldCounts = await db('ci_field_defs').select('ci_type_id').count({ count: '*' }).groupBy('ci_type_id');
    const countMap = Object.fromEntries(counts.map((row) => [row.ci_type_id, Number(row.count)]));
    const fieldMap = Object.fromEntries(fieldCounts.map((row) => [row.ci_type_id, Number(row.count)]));
    return {
      data: types.map((type) => ({ ...type, ci_count: countMap[type.id] || 0, field_count: fieldMap[type.id] || 0 })),
      total: types.reduce((sum, type) => sum + (countMap[type.id] || 0), 0),
    };
  });

  app.get('/api/ci-types/:id', { preHandler: authenticate }, async (request, reply) => {
    const type = await getTypeByParam(request.params.id);
    if (!type) return reply.code(404).send({ message: 'CI 类型不存在' });
    const fields = await db('ci_field_defs').where({ ci_type_id: type.id }).orderBy('sort_order');
    const count = await db('cis').where({ ci_type_id: type.id }).count({ count: '*' }).first();
    return {
      data: {
        ...type,
        ci_count: Number(count?.count || 0),
        fields: fields.map((field) => ({ ...field, options: asArray(field.options, []) })),
      },
    };
  });

  app.post(
    '/api/ci-types',
    { preHandler: [authenticate, requirePermission('cmdb.model_manage')] },
    async (request, reply) => {
      const schema = z.object({
        code: z.string().trim().min(2).regex(/^[a-z][a-z0-9_-]+$/, '类型编码需为小写字母、数字与横线'),
        name: z.string().trim().min(1),
        icon: z.string().default('Box'),
        color: z.string().default('#4f6ef7'),
        description: z.string().default(''),
        sort_order: z.coerce.number().default(99),
        rackable: z.boolean().default(false),
      });
      const body = schema.parse(request.body || {});
      if (await db('ci_types').where({ code: body.code }).first()) {
        return reply.code(409).send({ message: 'CI 类型编码已存在' });
      }
      const ts = nowIso();
      const id = await insertReturningId(db('ci_types'), {
        ...body,
        builtin: false,
        enabled: true,
        created_at: ts,
        updated_at: ts,
      });
      await audit(request, { action: 'ci_type.create', entityType: 'ci_type', entityId: id, summary: `新增 CI 类型 ${body.name}` });
      return reply.code(201).send({ data: { id, ...body } });
    },
  );

  app.put(
    '/api/ci-types/:id',
    { preHandler: [authenticate, requirePermission('cmdb.model_manage')] },
    async (request, reply) => {
      const id = Number(request.params.id);
      const type = await db('ci_types').where({ id }).first();
      if (!type) return reply.code(404).send({ message: 'CI 类型不存在' });
      const schema = z.object({
        name: z.string().trim().min(1).optional(),
        icon: z.string().optional(),
        color: z.string().optional(),
        description: z.string().optional(),
        sort_order: z.coerce.number().optional(),
        enabled: z.preprocess((value) => value === 1 || value === '1' || value === true, z.boolean()).optional(),
        rackable: z.preprocess((value) => value === 1 || value === '1' || value === true, z.boolean()).optional(),
      });
      const body = schema.parse(request.body || {});
      await db('ci_types').where({ id }).update({ ...body, updated_at: nowIso() });
      await audit(request, { action: 'ci_type.update', entityType: 'ci_type', entityId: id, summary: `更新 CI 类型 ${body.name || type.name}` });
      return { ok: true };
    },
  );

  app.delete(
    '/api/ci-types/:id',
    { preHandler: [authenticate, requirePermission('cmdb.model_manage')] },
    async (request, reply) => {
      const id = Number(request.params.id);
      const type = await db('ci_types').where({ id }).first();
      if (!type) return reply.code(404).send({ message: 'CI 类型不存在' });
      if (type.builtin) return reply.code(400).send({ message: '内置类型不可删除，可停用或改名' });
      const count = await db('cis').where({ ci_type_id: id }).count({ count: '*' }).first();
      if (Number(count?.count || 0) > 0) return reply.code(409).send({ message: '该类型下仍有 CI，无法删除' });
      await db('ci_types').where({ id }).del();
      await audit(request, { action: 'ci_type.delete', entityType: 'ci_type', entityId: id, summary: `删除 CI 类型 ${type.name}` });
      return { ok: true };
    },
  );

  app.post(
    '/api/ci-types/:id/fields',
    { preHandler: [authenticate, requirePermission('cmdb.model_manage')] },
    async (request, reply) => {
      const type = await db('ci_types').where({ id: Number(request.params.id) }).first();
      if (!type) return reply.code(404).send({ message: 'CI 类型不存在' });
      const schema = z.object({
        field_key: z.string().trim().min(2).regex(/^[a-z][a-z0-9_]+$/, '字段标识需为小写字母、数字与下划线'),
        label: z.string().trim().min(1),
        field_type: z.enum(FIELD_TYPES),
        options: z.array(z.string()).default([]),
        placeholder: z.string().default(''),
        group_name: z.string().default('扩展属性'),
        required: z.boolean().default(false),
        show_in_list: z.boolean().default(false),
        sort_order: z.coerce.number().default(99),
      });
      const body = schema.parse(request.body || {});
      if (CORE_KEYS.has(body.field_key)) return reply.code(400).send({ message: '字段标识与基础字段冲突' });
      if (await db('ci_field_defs').where({ ci_type_id: type.id, field_key: body.field_key }).first()) {
        return reply.code(409).send({ message: '该类型下字段标识已存在' });
      }
      if (['select', 'multiselect'].includes(body.field_type) && !body.options.length) {
        return reply.code(400).send({ message: '单选/多选字段需要配置选项' });
      }
      const id = await insertReturningId(db('ci_field_defs'), {
        ...body,
        ci_type_id: type.id,
        options: JSON.stringify(body.options),
        created_at: nowIso(),
      });
      await audit(request, { action: 'ci_field.create', entityType: 'ci_type', entityId: type.id, summary: `新增扩展字段 ${body.label}` });
      return reply.code(201).send({ data: { id, ...body } });
    },
  );

  app.post(
    '/api/ci-fields/bulk-delete',
    { preHandler: [authenticate, requirePermission('cmdb.model_manage')] },
    async (request, reply) => {
      const schema = z.object({
        ids: z.array(z.coerce.number().int().positive()).min(1, '请选择至少一个字段').max(100),
      });
      const { ids } = schema.parse(request.body || {});
      const uniqueIds = [...new Set(ids)];
      const fields = await db('ci_field_defs').whereIn('id', uniqueIds);
      if (!fields.length) return reply.code(404).send({ message: '所选字段不存在' });
      const typeIds = [...new Set(fields.map((field) => field.ci_type_id))];
      const types = await db('ci_types').whereIn('id', typeIds).select('id', 'name');
      const typeMap = Object.fromEntries(types.map((type) => [type.id, type.name]));

      await db('ci_field_defs').whereIn('id', fields.map((field) => field.id)).del();
      for (const typeId of typeIds) {
        const keys = fields.filter((field) => field.ci_type_id === typeId).map((field) => field.field_key);
        const cis = await db('cis').where({ ci_type_id: typeId });
        for (const ci of cis) {
          const attributes = parseJson(ci.attributes, {});
          let changed = false;
          for (const key of keys) {
            if (key in attributes) {
              delete attributes[key];
              changed = true;
            }
          }
          if (changed) await db('cis').where({ id: ci.id }).update({ attributes: JSON.stringify(attributes), updated_at: nowIso() });
        }
      }
      await audit(request, {
        action: 'ci_field.bulk_delete',
        entityType: 'ci_type',
        entityId: typeIds.length === 1 ? typeIds[0] : '',
        summary: `批量删除 ${fields.length} 个扩展字段：${fields.slice(0, 5).map((field) => field.label).join('、')}${fields.length > 5 ? ' 等' : ''}`,
        detail: { fields: fields.map((field) => ({ id: field.id, type: typeMap[field.ci_type_id], label: field.label, key: field.field_key })) },
      });
      return { ok: true, deleted: fields.length };
    },
  );

  app.put(
    '/api/ci-fields/:id',
    { preHandler: [authenticate, requirePermission('cmdb.model_manage')] },
    async (request, reply) => {
      const id = Number(request.params.id);
      const field = await db('ci_field_defs').where({ id }).first();
      if (!field) return reply.code(404).send({ message: '字段不存在' });
      const schema = z.object({
        label: z.string().trim().min(1).optional(),
        field_type: z.enum(FIELD_TYPES).optional(),
        options: z.array(z.string()).optional(),
        placeholder: z.string().optional(),
        group_name: z.string().optional(),
        required: z.boolean().optional(),
        show_in_list: z.boolean().optional(),
        sort_order: z.coerce.number().optional(),
      });
      const body = schema.parse(request.body || {});
      const nextType = body.field_type || field.field_type;
      const nextOptions = body.options || asArray(field.options, []);
      if (['select', 'multiselect'].includes(nextType) && !nextOptions.length) {
        return reply.code(400).send({ message: '单选/多选字段需要配置选项' });
      }
      await db('ci_field_defs')
        .where({ id })
        .update({
          ...body,
          ...(body.options ? { options: JSON.stringify(body.options) } : {}),
        });
      await audit(request, { action: 'ci_field.update', entityType: 'ci_type', entityId: field.ci_type_id, summary: `更新扩展字段 ${body.label || field.label}` });
      return { ok: true };
    },
  );

  app.delete(
    '/api/ci-fields/:id',
    { preHandler: [authenticate, requirePermission('cmdb.model_manage')] },
    async (request, reply) => {
      const id = Number(request.params.id);
      const field = await db('ci_field_defs').where({ id }).first();
      if (!field) return reply.code(404).send({ message: '字段不存在' });
      await db('ci_field_defs').where({ id }).del();
      const cis = await db('cis').where({ ci_type_id: field.ci_type_id });
      for (const ci of cis) {
        const attributes = parseJson(ci.attributes, {});
        if (field.field_key in attributes) {
          delete attributes[field.field_key];
          await db('cis').where({ id: ci.id }).update({ attributes: JSON.stringify(attributes), updated_at: nowIso() });
        }
      }
      await audit(request, { action: 'ci_field.delete', entityType: 'ci_type', entityId: field.ci_type_id, summary: `删除扩展字段 ${field.label}` });
      return { ok: true };
    },
  );

  // ---------- CI list, import / export ----------
  app.get('/api/cis/options', { preHandler: authenticate }, async (request) => {
    const q = request.query.q || '';
    const typeCodes = String(request.query.types || '').split(',').map((item) => item.trim()).filter(Boolean).slice(0, 20);
    const query = db('cis')
      .leftJoin('ci_types', 'cis.ci_type_id', 'ci_types.id')
      .select('cis.id', 'cis.ci_type_id', 'cis.asset_no', 'cis.name', 'cis.status', 'ci_types.code as type_code', 'ci_types.name as type_name', 'ci_types.color as type_color')
      .orderBy('cis.updated_at', 'desc')
      .limit(Math.min(500, Math.max(1, Number(request.query.limit) || 30)));
    if (typeCodes.length) query.whereIn('ci_types.code', typeCodes);
    if (q) query.where((builder) => builder.where('cis.name', 'like', `%${q}%`).orWhere('cis.asset_no', 'like', `%${q}%`).orWhere('cis.ip_address', 'like', `%${q}%`).orWhere('cis.bmc_address', 'like', `%${q}%`));
    return { data: await query };
  });

  app.get('/api/cis/template', { preHandler: [authenticate, requirePermission('cmdb.import')] }, async (request, reply) => {
    const type = await getTypeByParam(request.query.type);
    if (!type) return reply.code(400).send({ message: '请指定有效的 CI 类型' });
    const fields = await db('ci_field_defs').where({ ci_type_id: type.id }).orderBy('sort_order');
    const hiddenFields = await getHiddenBasicFields(type.code);
    const buffer = await createCITemplate({ ciType: type, fields, hiddenFields });
    const filename = `${type.name}_CI导入模板.xlsx`;
    reply.header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    reply.header('Content-Disposition', `attachment; filename="ci-template-${type.code}.xlsx"; filename*=UTF-8''${encodeURIComponent(filename)}`);
    return reply.send(Buffer.from(buffer));
  });

  app.get('/api/cis/export', { preHandler: [authenticate, requirePermission('cmdb.import')] }, async (request, reply) => {
    const type = await getTypeByParam(request.query.type);
    if (!type) return reply.code(400).send({ message: '请指定有效的 CI 类型' });
    const fields = await db('ci_field_defs').where({ ci_type_id: type.id }).orderBy('sort_order');
    const query = db('cis')
      .leftJoin('users as owners', 'cis.owner_id', 'owners.id')
      .select('cis.*', 'owners.name as owner_name')
      .where('cis.ci_type_id', type.id)
      .orderBy('cis.asset_no');
    if (request.query.status) query.where('cis.status', request.query.status);
    if (request.query.criticality) query.where('cis.criticality', request.query.criticality);
    if (request.query.q) {
      query.where((builder) =>
        builder.where('cis.name', 'like', `%${request.query.q}%`).orWhere('cis.asset_no', 'like', `%${request.query.q}%`).orWhere('cis.ip_address', 'like', `%${request.query.q}%`).orWhere('cis.bmc_address', 'like', `%${request.query.q}%`),
      );
    }
    const rows = await query;
    const hiddenFields = await getHiddenBasicFields(type.code);
    const buffer = await createCIWorkbook({ ciType: type, fields, rows, hiddenFields });
    const filename = `${type.name}_CI资产_${new Date().toISOString().slice(0, 10)}.xlsx`;
    reply.header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    reply.header('Content-Disposition', `attachment; filename="ci-${type.code}-${new Date().toISOString().slice(0, 10)}.xlsx"; filename*=UTF-8''${encodeURIComponent(filename)}`);
    return reply.send(Buffer.from(buffer));
  });

  app.post('/api/cis/import', { preHandler: [authenticate, requirePermission('cmdb.import')] }, async (request, reply) => {
    const type = await getTypeByParam(request.query.type);
    if (!type) return reply.code(400).send({ message: '请指定有效的 CI 类型' });
    const file = await request.file({ limits: { fileSize: 10 * 1024 * 1024 } });
    if (!file) return reply.code(400).send({ message: '请上传 .xlsx 文件' });
    if (!file.filename.toLowerCase().endsWith('.xlsx')) return reply.code(400).send({ message: '仅支持 .xlsx 格式文件' });
    const mode = request.query.mode === 'create' ? 'create' : 'upsert';
    const buffer = await file.toBuffer();
    const fields = await db('ci_field_defs').where({ ci_type_id: type.id }).orderBy('sort_order');
    const users = await db('users').select('id', 'name', 'username', 'email');
    const hiddenFields = await getHiddenBasicFields(type.code);
    const hidden = new Set(hiddenFields);
    let parsed;
    try {
      parsed = await parseCIImport({ buffer, ciType: type, fields, users, hiddenFields });
    } catch (error) {
      return reply.code(400).send({ message: error.message || 'Excel 解析失败' });
    }

    let created = 0;
    let updated = 0;
    const errors = [...parsed.errors];
    const ts = nowIso();
    const importIds = [...new Set(parsed.rows.map((row) => Number(row.__ci_id)).filter(Boolean))];
    const importAssetNos = [...new Set(parsed.rows.map((row) => row.asset_no).filter(Boolean))];
    const importSerials = [...new Set(parsed.rows.map((row) => String(row.serial_no || '').trim()).filter(Boolean))];
    const existingRows = importIds.length || importAssetNos.length
      ? await db('cis').where((builder) => {
        if (importIds.length) builder.whereIn('id', importIds);
        if (importAssetNos.length) builder.orWhereIn('asset_no', importAssetNos);
      })
      : [];
    const serialRows = importSerials.length ? await db('cis').whereIn('serial_no', importSerials) : [];
    const byId = new Map(existingRows.map((row) => [Number(row.id), row]));
    const byAssetNo = new Map(existingRows.map((row) => [row.asset_no, row]));
    const bySerialNo = new Map(serialRows.filter((row) => row.serial_no).map((row) => [String(row.serial_no).trim(), row]));
    for (const row of parsed.rows) {
      const existing = row.__ci_id ? byId.get(Number(row.__ci_id)) : (row.asset_no ? byAssetNo.get(row.asset_no) : null);
      if (!row.asset_no && hidden.has('asset_no')) {
        row.asset_no = existing?.asset_no || await nextAutoAssetNo(type);
      }
      if (!row.name && hidden.has('name')) {
        row.name = existing?.name || autoAssetName(type, row.asset_no);
      }
    }
    const preflightErrors = [];
    const seenAssets = new Set();
    const seenSerials = new Set();
    for (const row of parsed.rows) {
      const existing = row.__ci_id ? byId.get(Number(row.__ci_id)) : byAssetNo.get(row.asset_no);
      if (seenAssets.has(row.asset_no)) preflightErrors.push({ row: row.row, asset_no: row.asset_no, message: `资产编号 ${row.asset_no} 在 Excel 内重复` });
      seenAssets.add(row.asset_no);
      const serial = String(row.serial_no || '').trim();
      if (serial) {
        if (seenSerials.has(serial)) preflightErrors.push({ row: row.row, asset_no: row.asset_no, message: `Excel 内序列号重复：${serial}` });
        seenSerials.add(serial);
        const serialOwner = bySerialNo.get(serial);
        if (serialOwner && (!existing || Number(serialOwner.id) !== Number(existing.id))) {
          preflightErrors.push({ row: row.row, asset_no: row.asset_no, message: `序列号已被资产 ${serialOwner.asset_no} 使用` });
        }
      }
      const assetOwner = byAssetNo.get(row.asset_no);
      if (assetOwner && existing && Number(assetOwner.id) !== Number(existing.id)) {
        preflightErrors.push({ row: row.row, asset_no: row.asset_no, message: `资产编号已被资产 ${assetOwner.asset_no} 使用` });
      }
    }
    if (preflightErrors.length) {
      const sample = preflightErrors.slice(0, 5).map((item) => `${item.asset_no || `第${item.row}行`}：${item.message}`).join('；');
      return reply.code(400).send({ message: `导入校验失败：${preflightErrors.length} 处资产编号或序列号重复（${sample}）`, errors: preflightErrors.slice(0, 100) });
    }
    for (const row of parsed.rows) {
      try {
        const { row: rowNumber, __ci_id: ciId, ...record } = row;
        let existing = ciId ? byId.get(Number(ciId)) : null;
        if (!existing) existing = byAssetNo.get(record.asset_no) || null;
        if (existing && existing.ci_type_id !== type.id) {
          errors.push({ row: rowNumber, asset_no: record.asset_no, message: '该资产编号已被其他类型占用' });
          continue;
        }
        const assetNoOwner = byAssetNo.get(record.asset_no);
        if (assetNoOwner && (!existing || assetNoOwner.id !== existing.id)) {
          errors.push({ row: rowNumber, asset_no: record.asset_no, message: '资产编号已被其他资产占用' });
          continue;
        }
        if (existing && mode === 'create') {
          errors.push({ row: rowNumber, asset_no: record.asset_no, message: '资产已存在，当前导入模式为仅新建' });
          continue;
        }
        if (existing) {
          const oldAssetNo = existing.asset_no;
          await db('cis').where({ id: existing.id }).update({
            ...record,
            attributes: JSON.stringify(record.attributes),
            updated_at: ts,
          });
          byAssetNo.delete(oldAssetNo);
          byAssetNo.set(record.asset_no, { ...existing, ...record });
          updated += 1;
        } else {
          const newId = await insertReturningId(db('cis'), {
            ...record,
            attributes: JSON.stringify(record.attributes),
            created_by: request.auth.id,
            created_at: ts,
            updated_at: ts,
          });
          byAssetNo.set(record.asset_no, { id: newId, ci_type_id: type.id, asset_no: record.asset_no });
          created += 1;
        }
      } catch (error) {
        errors.push({ row: row.row, asset_no: row.asset_no, message: error.message || '写入失败' });
      }
    }
    await audit(request, {
      action: 'ci.import',
      entityType: 'ci_type',
      entityId: type.id,
      summary: `导入 ${type.name}：新建 ${created}，更新 ${updated}，失败 ${errors.length}`,
      detail: { created, updated, errors: errors.slice(0, 50) },
    });
    return {
      import_type: type.name,
      created,
      updated,
      failed: errors.length,
      empty_rows: parsed.emptyRows,
      errors: errors.slice(0, 100),
    };
  });

  app.get('/api/cis', { preHandler: [authenticate, requirePermission('cmdb.view')] }, async (request) => {
    const { page, pageSize, limit, offset } = paginate(request.query);
    const query = db('cis')
      .leftJoin('ci_types', 'cis.ci_type_id', 'ci_types.id')
      .leftJoin('users as owners', 'cis.owner_id', 'owners.id');
    let selectedType = null;
    if (request.query.type) {
      selectedType = await getTypeByParam(request.query.type);
      if (selectedType) query.where('cis.ci_type_id', selectedType.id);
    }
    if (request.query.status) query.where('cis.status', request.query.status);
    if (request.query.criticality) query.where('cis.criticality', request.query.criticality);
    if (request.query.environment) query.where('cis.environment', request.query.environment);
    if (request.query.owner_id) query.where('cis.owner_id', request.query.owner_id);
    if (request.auth.role?.code !== 'admin') {
      query.where((builder) => builder
        .whereNull('cis.asset_manager_id')
        .orWhere('cis.asset_manager_id', request.auth.id)
        .orWhereExists(db('ci_acl').select(1).whereRaw('ci_acl.ci_id = cis.id').where('ci_acl.user_id', request.auth.id).where('ci_acl.can_view', true)));
    }
    const filters = parseJson(request.query.filters, []);
    if (Array.isArray(filters)) {
      const standardFields = new Set(CORE_COLUMNS.map((column) => column.key));
      for (const filter of filters.slice(0, 12)) {
        const field = String(filter?.field || '');
        const value = String(filter?.value || '').trim();
        if (!value) continue;
        if (field.startsWith('attr.')) {
          const code = field.slice(5);
          if (/^[a-zA-Z0-9_]+$/.test(code)) query.where('cis.attributes', 'like', `%${value}%`);
        } else if (standardFields.has(field)) {
          if (filter.op === 'equals') query.where(`cis.${field}`, value);
          else query.where(`cis.${field}`, 'like', `%${value}%`);
        }
      }
    }
    if (request.query.q) {
      const term = `%${request.query.q}%`;
      query.where((builder) =>
        builder
          .where('cis.name', 'like', term)
          .orWhere('cis.asset_no', 'like', term)
          .orWhere('cis.ip_address', 'like', term)
          .orWhere('cis.bmc_address', 'like', term)
          .orWhere('cis.serial_no', 'like', term)
          .orWhere('cis.model', 'like', term)
          .orWhere('cis.location', 'like', term),
      );
    }
    const totalRow = await query.clone().count({ count: 'cis.id' }).first();
    const sortable = {
      ...Object.fromEntries(CORE_COLUMNS.map((column) => [column.key, `cis.${column.key}`])),
      type_name: 'ci_types.name',
      owner_name: 'owners.name',
      updated_at: 'cis.updated_at',
      created_at: 'cis.created_at',
    };
    const requestedSort = String(request.query.sortBy || '');
    const sortBy = sortable[requestedSort] || 'cis.asset_no';
    let sortExpression = null;
    if (requestedSort.startsWith('attr:') && selectedType) {
      const fieldKey = requestedSort.slice(5);
      if (/^[a-zA-Z0-9_]+$/.test(fieldKey)) {
        const field = await db('ci_field_defs')
          .where({ ci_type_id: selectedType.id, field_key: fieldKey })
          .first();
        if (field) sortExpression = customAttributeSortExpression(fieldKey, field.field_type);
      }
    }
    const sortDir = String(request.query.sortDir).toLowerCase() === 'desc' ? 'desc' : 'asc';
    const selection = [
      'cis.*',
      'ci_types.name as type_name',
      'ci_types.code as type_code',
      'ci_types.color as type_color',
      'ci_types.icon as type_icon',
      'owners.name as owner_name',
      'owners.avatar_url as owner_avatar_url',
    ];
    let rows;
    if (requestedSort === 'ip_address') {
      const allRows = await query.select(selection).orderBy('cis.asset_no');
      const direction = sortDir === 'desc' ? -1 : 1;
      rows = allRows
        .sort((a, b) => direction * compareIpAddress(a.ip_address, b.ip_address))
        .slice(offset, offset + limit);
    } else {
      rows = await query
        .select(selection)
        .orderBy(sortExpression || sortBy, sortDir)
        .limit(limit)
        .offset(offset);
    }
    return {
      data: rows.map((row) => ({ ...row, attributes: parseJson(row.attributes, {}) })),
      pagination: { page, pageSize, total: Number(totalRow?.count || 0) },
    };
  });

  app.get('/api/cis/:id', { preHandler: [authenticate, requirePermission('cmdb.view')] }, async (request, reply) => {
    const data = await ciDetail(Number(request.params.id));
    if (!data) return reply.code(404).send({ message: 'CI 不存在' });
    if (!(await ciAccess(request.auth, data))) return reply.code(403).send({ message: '无权查看该资产' });
    return { data };
  });

  app.get('/api/cis/:id/software', { preHandler: [authenticate, requirePermission('cmdb.view')] }, async (request, reply) => {
    const id = Number(request.params.id);
    const ci = await db('cis').where({ id }).first();
    if (!ci) return reply.code(404).send({ message: 'CI 不存在' });
    if (!(await ciAccess(request.auth, ci))) return reply.code(403).send({ message: '无权查看该资产' });

    const page = Math.max(1, Number(request.query.page || 1) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(request.query.pageSize || 10) || 10));
    const q = String(request.query.q || '').trim();
    const source = ['zabbix', 'manual'].includes(String(request.query.source || ''))
      ? String(request.query.source)
      : 'all';

    const base = softwareInventoryQuery(id);
    if (q) {
      const pattern = `%${q}%`;
      base.where((builder) => {
        builder.where('software.name', 'like', pattern)
          .orWhere('software.asset_no', 'like', pattern);
      });
    }
    if (source === 'zabbix') {
      base.where('software.asset_no', 'like', 'SW-ZBX-%');
    } else if (source === 'manual') {
      base.where((builder) => {
        builder.whereNull('software.asset_no')
          .orWhereNot('software.asset_no', 'like', 'SW-ZBX-%');
      });
    }

    const totalRow = await base.clone().countDistinct({ count: 'software.id' }).first();
    const rows = await base.clone()
      .select(
        'software.id',
        'software.asset_no',
        'software.name',
        'software.status',
        'software.attributes',
        'ci_relations.id as relation_id',
        'ci_relations.description as relation_description',
      )
      .orderBy('software.name')
      .orderBy('software.asset_no')
      .limit(pageSize)
      .offset((page - 1) * pageSize);

    return {
      data: rows.map((row) => ({
        id: row.id,
        asset_no: row.asset_no,
        name: row.name,
        status: row.status,
        version: parseJson(row.attributes, {}).version || '',
        source: softwareInventorySource(row),
        relation_id: row.relation_id,
        relation_description: row.relation_description || '',
      })),
      pagination: { page, pageSize, total: Number(totalRow?.count || 0) },
    };
  });

  const portSchema = z.object({
    port_name: z.string().trim().min(1).max(80),
    port_type: z.enum(['ethernet', 'fiber', 'rj45', 'sfp', 'sfp_plus', 'bmc', 'management', 'console', 'power']).default('ethernet'),
    mac_address: z.string().default(''),
    speed_mbps: z.coerce.number().min(0).default(0),
    current_speed_mbps: z.coerce.number().min(0).default(0),
    connected_switch_id: z.coerce.number().int().positive().nullable().optional(),
    connected_switch_port: z.string().default(''),
    link_status: z.enum(['up', 'down', 'unknown']).default('unknown'),
    notes: z.string().default(''),
  });

  app.get('/api/cis/:id/ports', { preHandler: [authenticate, requirePermission('cmdb.view')] }, async (request, reply) => {
    const ci = await db('cis').where({ id: Number(request.params.id) }).first();
    if (!ci) return reply.code(404).send({ message: 'CI 不存在' });
    const ports = await db('ci_network_ports')
      .leftJoin('cis as sw', 'ci_network_ports.connected_switch_id', 'sw.id')
      .leftJoin('ci_types as sw_type', 'sw.ci_type_id', 'sw_type.id')
      .select('ci_network_ports.*', 'sw.asset_no as switch_asset_no', 'sw.name as switch_name', 'sw_type.name as switch_type_name')
      .where('ci_network_ports.ci_id', ci.id)
      .orderBy('ci_network_ports.port_name');
    return { data: ports, bmc_address: ci.bmc_address || '', business_address: ci.ip_address || '' };
  });

  app.post('/api/cis/:id/ports', { preHandler: [authenticate, requirePermission('cmdb.edit')] }, async (request, reply) => {
    const ci = await db('cis').where({ id: Number(request.params.id) }).first();
    if (!ci) return reply.code(404).send({ message: 'CI 不存在' });
    const body = portSchema.parse(request.body || {});
    if (body.connected_switch_id) {
      const sw = await db('cis').where({ id: body.connected_switch_id }).first();
      if (!sw) return reply.code(400).send({ message: '连接设备不存在' });
    }
    if (await db('ci_network_ports').where({ ci_id: ci.id, port_name: body.port_name }).first()) {
      return reply.code(409).send({ message: '该 CI 下端口名称已存在' });
    }
    const id = await insertReturningId(db('ci_network_ports'), {
      ...body,
      connected_switch_id: body.connected_switch_id || null,
      ci_id: ci.id,
      source: 'manual',
      last_synced_at: null,
      created_at: nowIso(),
      updated_at: nowIso(),
    });
    await audit(request, { action: 'port.create', entityType: 'ci', entityId: ci.id, summary: `新增端口 ${ci.asset_no} ${body.port_name}` });
    return reply.code(201).send({ id });
  });

  app.put('/api/cis/:id/ports/:portId', { preHandler: [authenticate, requirePermission('cmdb.edit')] }, async (request, reply) => {
    const ciId = Number(request.params.id);
    const portId = Number(request.params.portId);
    const port = await db('ci_network_ports').where({ id: portId, ci_id: ciId }).first();
    if (!port) return reply.code(404).send({ message: '端口不存在' });
    const body = portSchema.parse(request.body || {});
    if (body.connected_switch_id) {
      const sw = await db('cis').where({ id: body.connected_switch_id }).first();
      if (!sw) return reply.code(400).send({ message: '连接设备不存在' });
    }
    const duplicate = await db('ci_network_ports').where({ ci_id: ciId, port_name: body.port_name }).whereNot({ id: portId }).first();
    if (duplicate) return reply.code(409).send({ message: '该 CI 下端口名称已存在' });
    await db('ci_network_ports').where({ id: portId }).update({
      ...body,
      connected_switch_id: body.connected_switch_id || null,
      updated_at: nowIso(),
    });
    await audit(request, { action: 'port.update', entityType: 'ci', entityId: ciId, summary: `更新端口 ${body.port_name}` });
    return { ok: true };
  });

  app.delete('/api/cis/:id/ports/:portId', { preHandler: [authenticate, requirePermission('cmdb.edit')] }, async (request, reply) => {
    const ciId = Number(request.params.id);
    const portId = Number(request.params.portId);
    const port = await db('ci_network_ports').where({ id: portId, ci_id: ciId }).first();
    if (!port) return reply.code(404).send({ message: '端口不存在' });
    await db('ci_network_ports').where({ id: portId }).del();
    await audit(request, { action: 'port.delete', entityType: 'ci', entityId: ciId, summary: `删除端口 ${port.port_name}` });
    return { ok: true };
  });

  app.post('/api/cis/bulk-access', { preHandler: [authenticate, requirePermission('cmdb.edit')] }, async (request, reply) => {
    const schema = z.object({
      ids: z.array(z.coerce.number().int().positive()).min(1).max(500),
      asset_manager_id: z.coerce.number().int().positive().nullable().optional(),
      grants: z.array(z.object({ user_id: z.coerce.number().int().positive(), can_edit: z.boolean().default(false) })).max(500).default([]),
    });
    const body = schema.parse(request.body || {});
    if (request.auth.role?.code !== 'admin') {
      const managed = await db('cis').whereIn('id', body.ids).where('asset_manager_id', request.auth.id).select('id');
      if (managed.length !== body.ids.length) return reply.code(403).send({ message: '只能为本人管理的资产批量授权' });
    }
    for (const id of body.ids) {
      await db('cis').where({ id }).update({ asset_manager_id: body.asset_manager_id || null, updated_at: nowIso() });
      await db('ci_acl').where({ ci_id: id }).del();
      for (const grant of body.grants) await insertReturningId(db('ci_acl'), { ci_id: id, user_id: grant.user_id, can_view: true, can_edit: grant.can_edit, created_at: nowIso() });
    }
    await audit(request, { action: 'ci.bulk_access', entityType: 'ci', summary: `批量授权 ${body.ids.length} 个资产` });
    return { ok: true, updated: body.ids.length };
  });

  app.post('/api/cis/bulk', { preHandler: [authenticate, requirePermission('cmdb.edit')] }, async (request, reply) => {
    const schema = z.object({
      ids: z.array(z.coerce.number().int().positive()).min(1, '请选择至少一个 CI').max(500, '单次最多处理 500 个 CI'),
      action: z.enum(['update', 'delete', 'convert']),
      values: z.record(z.any()).optional(),
      target_type_id: z.coerce.number().int().positive().optional(),
    });
    const body = schema.parse(request.body || {});
    const ids = [...new Set(body.ids)];
    const rows = await db('cis').whereIn('id', ids).select('id', 'asset_no', 'name', 'ci_type_id', 'attributes');
    if (!rows.length) return reply.code(404).send({ message: '所选 CI 不存在或已被删除' });

    if (body.action === 'convert') {
      if (!body.target_type_id) return reply.code(400).send({ message: '请选择目标 CI 类型' });
      const typeIds = new Set(rows.map((row) => row.ci_type_id));
      if (typeIds.size > 1) return reply.code(400).send({ message: '批量转换仅支持同一 CI 类型；请按类型筛选后再操作' });
      const sourceType = await db('ci_types').where({ id: [...typeIds][0] }).first();
      if (!sourceType) return reply.code(400).send({ message: '源 CI 类型不存在' });
      if (Number(body.target_type_id) === Number(sourceType.id)) return reply.code(400).send({ message: '目标类型不能与当前类型相同' });
      const targetType = await db('ci_types').where({ id: body.target_type_id }).first();
      if (!targetType || !targetType.enabled) return reply.code(400).send({ message: '目标 CI 类型不存在或已停用' });
      if (!targetType.rackable) {
        const placed = await db('rack_placements').whereIn('ci_id', ids).select('ci_id');
        if (placed.length) return reply.code(400).send({ message: `所选资产中有 ${placed.length} 个已上架，目标类型「${targetType.name}」不支持机柜上架；请先下架后再转换` });
      }
      const fields = await db('ci_field_defs').where({ ci_type_id: targetType.id }).orderBy('sort_order');
      const ts = nowIso();
      const prepared = [];
      for (const row of rows) {
        const currentAttributes = parseJson(row.attributes, {});
        const targetAttributes = validateAttributes(fields, currentAttributes);
        await validateCIRefs(fields, targetAttributes);
        prepared.push({
          row,
          attributes: {
            ...currentAttributes,
            ...targetAttributes,
            __converted_from: sourceType.code,
            __converted_at: ts,
          },
        });
      }
      let converted = 0;
      for (const { row, attributes } of prepared) {
        await db('cis').where({ id: row.id }).update({
          ci_type_id: targetType.id,
          attributes: JSON.stringify(attributes),
          updated_at: ts,
        });
        await insertReturningId(db('ci_change_logs'), {
          ci_id: row.id,
          action: 'type_convert',
          changes: JSON.stringify({
            ci_type: { from: sourceType.code, to: targetType.code },
            from_name: sourceType.name,
            to_name: targetType.name,
          }),
          source: 'manual',
          ticket_id: null,
          actor_id: request.auth.id,
          created_at: ts,
        });
        await syncCILocation(row.id);
        converted += 1;
      }
      await audit(request, {
        action: 'ci.bulk_convert',
        entityType: 'ci',
        summary: `批量转换 ${converted} 个 CI 类型：${sourceType.name} → ${targetType.name}`,
        detail: { ids, from: sourceType.code, to: targetType.code, assets: rows.map((row) => row.asset_no) },
      });
      return { ok: true, converted, target_type: { id: targetType.id, code: targetType.code, name: targetType.name } };
    }

    if (body.action === 'delete') {
      if (request.auth.role?.code !== 'admin') {
        const types = await db('ci_types').whereIn('id', [...new Set(rows.map((row) => row.ci_type_id))]).select('id', 'name');
        const typeMap = Object.fromEntries(types.map((type) => [type.id, type.name]));
        let requested = 0;
        for (const row of rows) {
          if (await db('ci_deletion_requests').where({ ci_id: row.id, status: 'pending' }).first()) continue;
          await insertReturningId(db('ci_deletion_requests'), {
            ci_id: row.id,
            ci_asset_no: row.asset_no,
            ci_name: row.name,
            ci_type_name: typeMap[row.ci_type_id] || '',
            requester_id: request.auth.id,
            reason: '批量删除申请',
            status: 'pending',
            reviewed_by: null,
            review_comment: '',
            snapshot: JSON.stringify(row),
            created_at: nowIso(),
            updated_at: nowIso(),
          });
          requested += 1;
        }
        await audit(request, { action: 'ci.bulk_delete_request', entityType: 'ci', summary: `批量提交 ${requested} 个 CI 删除申请` });
        return { ok: true, pending_approval: true, requested, deleted: 0 };
      }
      for (const id of ids) {
        await deleteCIWithLinkedAssets(id);
      }
      await audit(request, {
        action: 'ci.bulk_delete',
        entityType: 'ci',
        summary: `批量删除 ${rows.length} 个 CI：${rows.slice(0, 5).map((row) => row.asset_no).join('、')}${rows.length > 5 ? ' 等' : ''}`,
        detail: { ids, assets: rows.map((row) => ({ id: row.id, asset_no: row.asset_no, name: row.name })) },
      });
      return { ok: true, deleted: rows.length, missing: ids.length - rows.length };
    }

    const typeIds = new Set(rows.map((row) => row.ci_type_id));
    if (typeIds.size > 1) {
      return reply.code(400).send({ message: '批量修改仅支持同一 CI 类型；请按类型筛选后再操作' });
    }
    const values = body.values || {};
    const forbidden = ['asset_no', 'name', 'ip_address', 'ci_type_id'];
    const bad = forbidden.find((key) => Object.prototype.hasOwnProperty.call(values, key));
    if (bad) return reply.code(400).send({ message: `批量修改不允许修改字段：${bad}` });
    const allowed = ['status', 'criticality', 'environment', 'owner_id', 'asset_manager_id', 'department', 'location', 'vendor', 'model', 'serial_no', 'bmc_address', 'mac_address', 'os_name', 'cpu', 'memory', 'disk', 'purchase_date', 'warranty_end', 'cost', 'description'];
    const update = {};
    for (const key of allowed) {
      if (!Object.prototype.hasOwnProperty.call(values, key)) continue;
      if (['status', 'criticality', 'environment'].includes(key) && values[key] === '') continue;
      update[key] = ['owner_id', 'asset_manager_id', 'cost'].includes(key)
        ? (values[key] === null || values[key] === '' ? null : Number(values[key]))
        : String(values[key] ?? '').trim();
    }
    if (update.status && !['in_use', 'idle', 'maintenance', 'retired', 'planned', 'offline'].includes(update.status)) return reply.code(400).send({ message: '无效的资产状态' });
    if (update.criticality && !['critical', 'high', 'medium', 'low'].includes(update.criticality)) return reply.code(400).send({ message: '无效的关键级别' });
    if (update.environment && !['production', 'staging', 'test', 'dr'].includes(update.environment)) return reply.code(400).send({ message: '无效的运行环境' });
    for (const ownerKey of ['owner_id', 'asset_manager_id']) {
      if (update[ownerKey]) {
        const owner = await db('users').where({ id: update[ownerKey], status: 'active' }).first();
        if (!owner) return reply.code(400).send({ message: '所选负责人不存在或账号已停用' });
      }
    }
    const attributePatch = values.attributes && typeof values.attributes === 'object' && !Array.isArray(values.attributes) ? values.attributes : {};
    if (!Object.keys(update).length && !Object.keys(attributePatch).length) return reply.code(400).send({ message: '请至少选择一个需要修改的字段' });
    const type = await db('ci_types').where({ id: [...typeIds][0] }).first();
    const hiddenBasicFields = await getHiddenBasicFields(type?.code || '');
    const hiddenUpdate = Object.keys(update).find((key) => hiddenBasicFields.includes(key));
    if (hiddenUpdate) return reply.code(400).send({ message: `字段 ${hiddenUpdate} 已在 CI 模型中隐藏，不能批量修改` });
    update.updated_at = nowIso();
    if (Object.keys(attributePatch).length) {
      const typeFields = await db('ci_field_defs').where({ ci_type_id: type.id });
      const referenceFields = typeFields.filter((field) => field.field_type === 'ci_ref' && Object.prototype.hasOwnProperty.call(attributePatch, field.field_key));
      for (const field of referenceFields) {
        const value = Number(attributePatch[field.field_key]);
        if (!Number.isInteger(value) || value <= 0) return reply.code(400).send({ message: `${field.label}需选择有效的资产` });
        attributePatch[field.field_key] = value;
      }
      if (referenceFields.length) await validateCIRefs(referenceFields, attributePatch);
    }
    await db('cis').whereIn('id', ids).update(update);
    if (update.status) {
      for (const row of rows) await reconcileLinkedAssetsForHost(row.id);
    }
    if (Object.keys(attributePatch).length) {
      for (const row of rows) {
        const attributes = { ...parseJson(row.attributes, {}), ...attributePatch };
        await db('cis').where({ id: row.id }).update({ attributes: JSON.stringify(attributes), updated_at: nowIso() });
      }
    }
    await audit(request, {
      action: 'ci.bulk_update',
      entityType: 'ci',
      summary: `批量更新 ${rows.length} 个${type?.name || 'CI'}：${[...Object.keys(update), ...Object.keys(attributePatch)].filter((key) => key !== 'updated_at').join('、')}`,
      detail: {
        ids,
        type: type?.name,
        changes: Object.fromEntries(Object.entries(update).filter(([key]) => key !== 'updated_at')),
        assets: rows.map((row) => row.asset_no),
      },
    });
    return { ok: true, updated: rows.length, missing: ids.length - rows.length, changes: update };
  });

  app.post('/api/cis', { preHandler: [authenticate, requirePermission('cmdb.edit')] }, async (request, reply) => {
    const body = ciPayload(request.body || {});
    body.description = sanitizeRichText(body.description);
    const type = await db('ci_types').where({ id: body.ci_type_id }).first();
    if (!type) return reply.code(400).send({ message: 'CI 类型不存在' });
    await fillHiddenRequiredFields(type, body);
    if (!body.asset_no) return reply.code(400).send({ message: '资产编号不能为空' });
    if (!body.name) return reply.code(400).send({ message: '资产名称不能为空' });
    if (await db('cis').where({ asset_no: body.asset_no }).first()) {
      return reply.code(409).send({ message: '资产编号已存在' });
    }
    const locationConflict = await findLocationConflict(body.location);
    if (locationConflict) return reply.code(409).send({ message: `位置「${body.location}」已被上架资产 ${locationConflict.asset_no} 占用` });
    const fields = await db('ci_field_defs').where({ ci_type_id: type.id });
    body.attributes = validateAttributes(fields, body.attributes);
    await validateCIRefs(fields, body.attributes);
    body.attributes = normalizeDatacenterCoordinates(type, body.attributes);
    const ts = nowIso();
    const id = await insertReturningId(db('cis'), {
      ...body,
      attributes: JSON.stringify(body.attributes),
      created_by: request.auth.id,
      created_at: ts,
      updated_at: ts,
    });
    await takeoverManualIp(id, body.asset_no, body.ip_address, request.auth.id);
    await audit(request, { action: 'ci.create', entityType: 'ci', entityId: id, summary: `新建 ${type.name} ${body.asset_no} ${body.name}` });
    return reply.code(201).send({ data: await ciDetail(id) });
  });

  app.put('/api/cis/:id', { preHandler: [authenticate, requirePermission('cmdb.edit')] }, async (request, reply) => {
    const id = Number(request.params.id);
    const existing = await db('cis').where({ id }).first();
    if (!existing) return reply.code(404).send({ message: 'CI 不存在' });
    if (!(await ciAccess(request.auth, existing, { edit: true }))) return reply.code(403).send({ message: '无权编辑该资产' });
    const body = ciPayload({ ...existing, ...(request.body || {}), attributes: request.body?.attributes ?? parseJson(existing.attributes, {}) });
    body.description = sanitizeRichText(body.description);
    const type = await db('ci_types').where({ id: body.ci_type_id }).first();
    if (!type) return reply.code(400).send({ message: 'CI 类型不存在' });
    await fillHiddenRequiredFields(type, body, existing);
    if (!body.asset_no || !body.name) return reply.code(400).send({ message: '资产编号与名称不能为空' });
    const duplicate = await db('cis').where({ asset_no: body.asset_no }).whereNot({ id }).first();
    if (duplicate) return reply.code(409).send({ message: '资产编号已被占用' });
    const locationConflict = await findLocationConflict(body.location, id);
    if (locationConflict) return reply.code(409).send({ message: `位置「${body.location}」已被上架资产 ${locationConflict.asset_no} 占用` });
    const fields = await db('ci_field_defs').where({ ci_type_id: type.id });
    body.attributes = validateAttributes(fields, body.attributes);
    await validateCIRefs(fields, body.attributes);
    body.attributes = normalizeDatacenterCoordinates(type, body.attributes);
    await db('cis')
      .where({ id })
      .update({ ...body, attributes: JSON.stringify(body.attributes), updated_at: nowIso() });
    if (String(existing.status) !== String(body.status)) {
      await reconcileLinkedAssetsForHost(id);
    }
    await takeoverManualIp(id, body.asset_no, body.ip_address, request.auth.id);
    const changes = {};
    for (const key of ['asset_no', 'name', 'status', 'criticality', 'environment', 'owner_id', 'asset_manager_id', 'department', 'location', 'vendor', 'model', 'serial_no', 'ip_address', 'bmc_address', 'os_name', 'cpu', 'memory', 'disk', 'purchase_date', 'warranty_end', 'cost', 'description']) {
      if (String(existing[key] ?? '') !== String(body[key] ?? '')) changes[key] = { from: existing[key] ?? null, to: body[key] ?? null };
    }
    if (Object.keys(changes).length) {
      await insertReturningId(db('ci_change_logs'), {
        ci_id: id,
        action: 'update',
        changes: JSON.stringify(changes),
        source: request.body?.change_ticket_id ? 'change_ticket' : 'manual',
        ticket_id: request.body?.change_ticket_id || null,
        actor_id: request.auth.id,
        created_at: nowIso(),
      });
    }
    await audit(request, { action: 'ci.update', entityType: 'ci', entityId: id, summary: `更新 ${type.name} ${body.asset_no} ${body.name}` });
    return { data: await ciDetail(id) };
  });

  app.post('/api/cis/:id/clone', { preHandler: [authenticate, requirePermission('cmdb.edit')] }, async (request, reply) => {
    const id = Number(request.params.id);
    const source = await db('cis').where({ id }).first();
    if (!source) return reply.code(404).send({ message: '源资产不存在' });
    const assetNo = String(request.body?.asset_no || '').trim();
    const name = String(request.body?.name || '').trim();
    if (!assetNo || !name) return reply.code(400).send({ message: '请填写新资产编号和名称' });
    if (await db('cis').where({ asset_no: assetNo }).first()) return reply.code(409).send({ message: '资产编号已存在' });
    const ts = nowIso();
    const cloneAttributes = parseJson(source.attributes, {});
    delete cloneAttributes.location_auto;
    const newId = await insertReturningId(db('cis'), {
      ...source,
      id: undefined,
      asset_no: assetNo,
      name,
      location: '',
      attributes: JSON.stringify(cloneAttributes),
      created_at: ts,
      updated_at: ts,
    });
    await audit(request, { action: 'ci.clone', entityType: 'ci', entityId: newId, summary: `克隆资产 ${source.asset_no} → ${assetNo}` });
    return reply.code(201).send({ data: await ciDetail(newId) });
  });

  app.get('/api/cis/:id/access', { preHandler: [authenticate, requirePermission('cmdb.view')] }, async (request, reply) => {
    const id = Number(request.params.id);
    const ci = await db('cis').where({ id }).first();
    if (!ci) return reply.code(404).send({ message: 'CI 不存在' });
    const acl = await db('ci_acl').leftJoin('users', 'ci_acl.user_id', 'users.id').select('ci_acl.*', 'users.name as user_name').where('ci_acl.ci_id', id);
    const users = await db('users').where({ status: 'active' }).select('id', 'name', 'username', 'department');
    return { data: { asset_manager_id: ci.asset_manager_id, acl, users } };
  });

  app.put('/api/cis/:id/access', { preHandler: [authenticate, requirePermission('cmdb.edit')] }, async (request, reply) => {
    const id = Number(request.params.id);
    const ci = await db('cis').where({ id }).first();
    if (!ci) return reply.code(404).send({ message: 'CI 不存在' });
    if (request.auth.role?.code !== 'admin' && ci.asset_manager_id !== request.auth.id) return reply.code(403).send({ message: '仅资产管理员或超级管理员可以授权资产' });
    const schema = z.object({
      asset_manager_id: z.coerce.number().int().positive().nullable().optional(),
      grants: z.array(z.object({ user_id: z.coerce.number().int().positive(), can_edit: z.boolean().default(false) })).max(500).default([]),
    });
    const body = schema.parse(request.body || {});
    await db('cis').where({ id }).update({ asset_manager_id: body.asset_manager_id || null, updated_at: nowIso() });
    await db('ci_acl').where({ ci_id: id }).del();
    for (const grant of body.grants) {
      await insertReturningId(db('ci_acl'), { ci_id: id, user_id: grant.user_id, can_view: true, can_edit: grant.can_edit, created_at: nowIso() });
    }
    await audit(request, { action: 'ci.access_update', entityType: 'ci', entityId: id, summary: `更新资产授权 ${ci.asset_no}` });
    return { ok: true };
  });
  app.get('/api/ip-assets/history', { preHandler: [authenticate, requirePermission('cmdb.view')] }, async (request) => {
    const query = db('ip_assignment_history').leftJoin('users', 'ip_assignment_history.actor_id', 'users.id').select('ip_assignment_history.*', 'users.name as actor_name').orderBy('created_at', 'desc').limit(500);
    if (request.query.ip) query.where('ip_address', String(request.query.ip));
    return { data: await query };
  });

  app.get('/api/ip-assets', { preHandler: [authenticate, requirePermission('cmdb.view')] }, async () => {
    const rows = await db('ip_assets')
      .leftJoin('cis', 'ip_assets.ci_id', 'cis.id')
      .leftJoin('ci_types', 'cis.ci_type_id', 'ci_types.id')
      .select('ip_assets.*', 'cis.asset_no as linked_asset_no', 'cis.name as linked_ci_name', 'ci_types.name as linked_type_name')
      .orderBy('ip_assets.ip_address');
    return { data: rows };
  });

  app.post('/api/ip-assets', { preHandler: [authenticate, requirePermission('cmdb.edit')] }, async (request, reply) => {
    const schema = z.object({
      ip_address: z.string().trim().min(7).max(80),
      status: z.enum(['in_use', 'idle', 'reserved', 'offline']).default('in_use'),
      owner: z.string().trim().max(120).default(''),
      notes: z.string().trim().max(500).default(''),
      ci_id: z.coerce.number().int().positive().nullable().optional(),
    });
    const body = schema.parse(request.body || {});
    if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(body.ip_address)) return reply.code(400).send({ message: '请输入合法的 IPv4 地址' });
    if (await db('ip_assets').where({ ip_address: body.ip_address }).first()) return reply.code(409).send({ message: '该 IP 已存在手工台账中' });
    if (await db('cis').where({ ip_address: body.ip_address }).first()) return reply.code(409).send({ message: '该 IP 已被 CMDB 资产使用' });
    if (body.ci_id && !(await db('cis').where({ id: body.ci_id }).first())) return reply.code(404).send({ message: '关联资产不存在' });
    if (body.ci_id) {
      const linkedType = await db('cis').join('ci_types', 'cis.ci_type_id', 'ci_types.id').where('cis.id', body.ci_id).first('ci_types.code');
      if (!['server', 'network', 'security', 'virtualization', 'virtualization_host', 'vm', 'business'].includes(linkedType?.code)) return reply.code(400).send({ message: '该资产类型不具备网络承载实体，不能关联 IP' });
    }
    const id = await insertReturningId(db('ip_assets'), { ...body, ci_id: body.ci_id || null, created_at: nowIso(), updated_at: nowIso() });
    await audit(request, { action: 'ip_asset.create', entityType: 'ip_asset', entityId: id, summary: `新增手工 IP ${body.ip_address}` });
    return reply.code(201).send({ data: await db('ip_assets').where({ id }).first() });
  });

  app.put('/api/ip-assets/:id', { preHandler: [authenticate, requirePermission('cmdb.edit')] }, async (request, reply) => {
    const id = Number(request.params.id);
    const existing = await db('ip_assets').where({ id }).first();
    if (!existing) return reply.code(404).send({ message: '手工 IP 不存在' });
    const schema = z.object({
      ip_address: z.string().trim().min(7).max(80),
      status: z.enum(['in_use', 'idle', 'reserved', 'offline']).default('in_use'),
      owner: z.string().trim().max(120).default(''),
      notes: z.string().trim().max(500).default(''),
      ci_id: z.coerce.number().int().positive().nullable().optional(),
    });
    const body = schema.parse(request.body || {});
    if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(body.ip_address)) return reply.code(400).send({ message: '请输入合法的 IPv4 地址' });
    if (await db('ip_assets').where({ ip_address: body.ip_address }).whereNot({ id }).first()) return reply.code(409).send({ message: '该 IP 已存在手工台账中' });
    if (body.ci_id && !(await db('cis').where({ id: body.ci_id }).first())) return reply.code(404).send({ message: '关联资产不存在' });
    if (body.ci_id) {
      const linkedType = await db('cis').join('ci_types', 'cis.ci_type_id', 'ci_types.id').where('cis.id', body.ci_id).first('ci_types.code');
      if (!['server', 'network', 'security', 'virtualization', 'virtualization_host', 'vm', 'business'].includes(linkedType?.code)) return reply.code(400).send({ message: '该资产类型不具备网络承载实体，不能关联 IP' });
    }
    await db('ip_assets').where({ id }).update({ ...body, ci_id: body.ci_id || null, updated_at: nowIso() });
    await audit(request, { action: 'ip_asset.update', entityType: 'ip_asset', entityId: id, summary: `编辑手工 IP ${body.ip_address}` });
    return { data: await db('ip_assets').where({ id }).first() };
  });

  app.delete('/api/ip-assets/:id', { preHandler: [authenticate, requirePermission('cmdb.edit')] }, async (request) => {
    const id = Number(request.params.id);
    await db('ip_assets').where({ id }).del();
    await audit(request, { action: 'ip_asset.delete', entityType: 'ip_asset', entityId: id, summary: '删除手工 IP' });
    return { ok: true };
  });

  app.get('/api/ip-subnets', { preHandler: [authenticate, requirePermission('cmdb.view')] }, async () => {
    return { data: await db('ip_subnets').orderBy('subnet') };
  });

  app.put('/api/ip-subnets', { preHandler: [authenticate, requirePermission('cmdb.edit')] }, async (request, reply) => {
    const schema = z.object({ subnet: z.string().trim().min(1).max(80), label: z.string().trim().max(120).default(''), vlan: z.string().trim().max(60).default(''), notes: z.string().trim().max(500).default('') });
    const body = schema.parse(request.body || {});
    const existing = await db('ip_subnets').where({ subnet: body.subnet }).first();
    if (existing) await db('ip_subnets').where({ id: existing.id }).update({ ...body, updated_at: nowIso() });
    else await insertReturningId(db('ip_subnets'), { ...body, updated_at: nowIso() });
    await audit(request, { action: 'ip_subnet.update', entityType: 'ip_subnet', entityId: body.subnet, summary: `更新网段 ${body.subnet} 标签` });
    return { data: await db('ip_subnets').where({ subnet: body.subnet }).first() };
  });

  app.post('/api/ip-assets/import', { preHandler: [authenticate, requirePermission('cmdb.edit')] }, async (request, reply) => {
    const schema = z.object({ items: z.array(z.object({ ip_address: z.string().trim(), status: z.enum(['in_use', 'idle', 'reserved', 'offline']).default('in_use'), owner: z.string().max(120).default(''), notes: z.string().max(500).default('') })).min(1).max(2000) });
    const body = schema.parse(request.body || {});
    let imported = 0;
    const skipped = [];
    for (const item of body.items) {
      if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(item.ip_address)) { skipped.push({ ip: item.ip_address, reason: '格式错误' }); continue; }
      if (await db('ip_assets').where({ ip_address: item.ip_address }).first()) { skipped.push({ ip: item.ip_address, reason: '已登记' }); continue; }
      if (await db('cis').where({ ip_address: item.ip_address }).first()) { skipped.push({ ip: item.ip_address, reason: 'CMDB 已使用' }); continue; }
      await insertReturningId(db('ip_assets'), { ...item, created_at: nowIso(), updated_at: nowIso() });
      imported += 1;
    }
    await audit(request, { action: 'ip_asset.import', entityType: 'ip_asset', summary: `导入手工 IP ${imported} 条，跳过 ${skipped.length} 条` });
    return { data: { imported, skipped } };
  });

  app.get('/api/ip-inventory', { preHandler: [authenticate, requirePermission('cmdb.view')] }, async () => {
    const rows = await db('cis')
      .leftJoin('ci_types', 'cis.ci_type_id', 'ci_types.id')
      .leftJoin('users as manager', 'cis.asset_manager_id', 'manager.id')
      .select('cis.id', 'cis.asset_no', 'cis.name', 'cis.ip_address', 'cis.bmc_address', 'cis.mac_address', 'cis.status', 'cis.location', 'cis.attributes', 'ci_types.name as type_name', 'ci_types.code as type_code', 'manager.name as manager_name');
    const extraIps = await db('ci_ips').whereIn('status', ['active', 'offline']).select('*');
    const rowsById = new Map(rows.map((row) => [row.id, row]));
    const entries = [];
    const ipv4 = (ip) => /^\d{1,3}(\.\d{1,3}){3}$/.test(ip);
    const ipAttributeKey = (key) => /(^|[_\s-])(ip|ipv4|ipv6|address|addr)([_\s-]|$)|ip$|地址$/i.test(key);
    const addCandidates = (row, values, source, interfaceName) => {
      for (const raw of values) {
        for (const candidate of String(raw || '').split(/[\s,;]+/)) {
          if (ipv4(candidate)) entries.push({ ...row, ip_address: candidate, source, interface_name: interfaceName, status: row.status });
        }
      }
    };
    for (const row of rows) {
      addCandidates(row, [row.ip_address], 'ci', '源自CMDB');
      addCandidates(row, [row.bmc_address], 'bmc', '带外管理');
      let attributes = {};
      try { attributes = JSON.parse(row.attributes || '{}'); } catch { attributes = {}; }
      for (const [key, value] of Object.entries(attributes)) {
        if (typeof value === 'string' && ipAttributeKey(key)) addCandidates(row, [value], 'attribute', key);
      }
    }
    for (const ip of extraIps) {
      const row = rowsById.get(ip.ci_id);
      if (row) entries.push({ ...row, status: ip.status === 'offline' ? 'offline' : row.status, ip_address: ip.ip_address, source: 'ci_ip', interface_name: ip.interface_name || '附加 IP' });
    }
    const manualIps = await db('ip_assets')
      .leftJoin('cis', 'ip_assets.ci_id', 'cis.id')
      .select('ip_assets.*', 'cis.asset_no as linked_asset_no', 'cis.name as linked_ci_name')
      .orderBy('ip_assets.ip_address');
    for (const manual of manualIps) {
      entries.push({
        id: `manual-${manual.id}`,
        manual_id: manual.id,
        asset_no: manual.linked_asset_no || 'MANUAL',
        name: manual.linked_ci_name || manual.notes || '手工登记 IP',
        ip_address: manual.ip_address,
        status: manual.status,
        location: '手工登记',
        type_name: manual.linked_ci_name ? '手工 IP · 已关联资产' : '手工登记',
        manager_name: manual.owner || '',
        source: 'manual',
        interface_name: manual.notes || '人工维护',
        linked_ci_id: manual.ci_id,
        linked_asset_no: manual.linked_asset_no,
        linked_ci_name: manual.linked_ci_name,
      });
    }
    const unique = new Map();
    for (const entry of entries) unique.set(`${entry.id}:${entry.ip_address}`, entry);
    const groups = new Map();
    for (const entry of [...unique.values()]) {
      if (!ipv4(entry.ip_address)) continue;
      const subnet = entry.ip_address.split('.').slice(0, 3).join('.') + '.0/24';
      if (!groups.has(subnet)) groups.set(subnet, []);
      groups.get(subnet).push(entry);
    }
    const subnetRows = await db('ip_subnets').select('*');
    const subnetMeta = new Map(subnetRows.map((row) => [row.subnet, row]));
    return {
      data: [...groups.entries()].sort(([a], [b]) => compareIpAddress(a.split('/')[0], b.split('/')[0])).map(([subnet, items]) => ({
        subnet,
        count: items.length,
        label: subnetMeta.get(subnet)?.label || '',
        vlan: subnetMeta.get(subnet)?.vlan || '',
        notes: subnetMeta.get(subnet)?.notes || '',
        items: items.sort((a, b) => compareIpAddress(a.ip_address, b.ip_address)),
      })),
    };
  });

  app.get('/api/cis/:id/changes', { preHandler: [authenticate, requirePermission('cmdb.view')] }, async (request) => {
    const rows = await db('ci_change_logs')
      .leftJoin('users', 'ci_change_logs.actor_id', 'users.id')
      .leftJoin('tickets', 'ci_change_logs.ticket_id', 'tickets.id')
      .select('ci_change_logs.*', 'users.name as actor_name', 'tickets.ticket_no', 'tickets.title as ticket_title')
      .where('ci_change_logs.ci_id', Number(request.params.id))
      .orderBy('ci_change_logs.created_at', 'desc')
      .limit(100);
    return { data: rows.map((row) => ({ ...row, changes: parseJson(row.changes, {}) })) };
  });

  app.delete('/api/cis/:id', { preHandler: [authenticate, requirePermission('cmdb.edit')] }, async (request, reply) => {
    const id = Number(request.params.id);
    const ci = await db('cis').leftJoin('ci_types', 'cis.ci_type_id', 'ci_types.id').select('cis.*', 'ci_types.name as type_name').where('cis.id', id).first();
    if (!ci) return reply.code(404).send({ message: 'CI 不存在' });
    if (!(await ciAccess(request.auth, ci, { edit: true }))) return reply.code(403).send({ message: '无权删除该资产' });
    if (request.auth.role?.code !== 'admin') {
      const existing = await db('ci_deletion_requests').where({ ci_id: id, status: 'pending' }).first();
      if (existing) return reply.code(409).send({ message: '该 CI 已有待审批的删除申请' });
      const requestId = await insertReturningId(db('ci_deletion_requests'), {
        ci_id: id,
        ci_asset_no: ci.asset_no,
        ci_name: ci.name,
        ci_type_name: ci.type_name || '',
        requester_id: request.auth.id,
        reason: String(request.body?.reason || '').slice(0, 500),
        status: 'pending',
        reviewed_by: null,
        review_comment: '',
        snapshot: JSON.stringify(ci),
        created_at: nowIso(),
        updated_at: nowIso(),
      });
      await audit(request, { action: 'ci.delete_request', entityType: 'ci', entityId: id, summary: `申请删除 CI ${ci.asset_no} ${ci.name}` });
      return reply.code(202).send({ ok: true, pending_approval: true, request_id: requestId, message: '删除申请已提交，等待审批' });
    }
    await deleteCIWithLinkedAssets(id);
    await audit(request, { action: 'ci.delete', entityType: 'ci', entityId: id, summary: `删除 CI ${ci.asset_no} ${ci.name}` });
    return { ok: true };
  });

  app.get('/api/ci-deletion-requests', { preHandler: authenticate }, async (request, reply) => {
    const allowed = await canApproveDeletion(request.auth);
    if (!allowed) return reply.code(403).send({ message: '没有 CI 删除审批权限' });
    const rows = await db('ci_deletion_requests')
      .leftJoin('users as requester', 'ci_deletion_requests.requester_id', 'requester.id')
      .leftJoin('users as reviewer', 'ci_deletion_requests.reviewed_by', 'reviewer.id')
      .select('ci_deletion_requests.*', 'requester.name as requester_name', 'reviewer.name as reviewer_name')
      .where('ci_deletion_requests.status', request.query.status || 'pending')
      .orderBy('ci_deletion_requests.created_at', 'desc');
    return { data: rows.map((row) => ({ ...row, snapshot: parseJson(row.snapshot, {}) })) };
  });

  app.post('/api/ci-deletion-requests/:id/approve', { preHandler: authenticate }, async (request, reply) => {
    if (!(await canApproveDeletion(request.auth))) return reply.code(403).send({ message: '没有 CI 删除审批权限' });
    const id = Number(request.params.id);
    const deletion = await db('ci_deletion_requests').where({ id, status: 'pending' }).first();
    if (!deletion) return reply.code(404).send({ message: '删除申请不存在或已处理' });
    await deleteCIWithLinkedAssets(deletion.ci_id);
    await db('ci_deletion_requests').where({ id }).update({ status: 'approved', reviewed_by: request.auth.id, review_comment: String(request.body?.comment || '').slice(0, 500), updated_at: nowIso() });
    await audit(request, { action: 'ci.delete_approve', entityType: 'ci', entityId: deletion.ci_id, summary: `审批通过删除 CI ${deletion.ci_asset_no}` });
    return { ok: true };
  });

  app.post('/api/ci-deletion-requests/:id/reject', { preHandler: authenticate }, async (request, reply) => {
    if (!(await canApproveDeletion(request.auth))) return reply.code(403).send({ message: '没有 CI 删除审批权限' });
    const id = Number(request.params.id);
    const deletion = await db('ci_deletion_requests').where({ id, status: 'pending' }).first();
    if (!deletion) return reply.code(404).send({ message: '删除申请不存在或已处理' });
    await db('ci_deletion_requests').where({ id }).update({ status: 'rejected', reviewed_by: request.auth.id, review_comment: String(request.body?.comment || '').slice(0, 500), updated_at: nowIso() });
    await audit(request, { action: 'ci.delete_reject', entityType: 'ci', entityId: deletion.ci_id, summary: `驳回删除 CI ${deletion.ci_asset_no}` });
    return { ok: true };
  });

  app.post('/api/cis/:id/relations', { preHandler: [authenticate, requirePermission('cmdb.edit')] }, async (request, reply) => {    const sourceId = Number(request.params.id);
    const schema = z.object({
      target_ci_id: z.coerce.number().int().positive(),
      relation_type: z.string().trim().min(2).max(40),
      description: z.string().default(''),
    });
    const body = schema.parse(request.body || {});
    if (body.target_ci_id === sourceId) return reply.code(400).send({ message: '不能关联自身' });
    const [source, target, relationType] = await Promise.all([
      db('cis').where({ id: sourceId }).first(),
      db('cis').where({ id: body.target_ci_id }).first(),
      db('ci_relation_types').where({ code: body.relation_type, enabled: true }).first(),
    ]);
    if (!source || !target) return reply.code(404).send({ message: 'CI 不存在' });
    if (!relationType) return reply.code(400).send({ message: '关联关系类型不存在或已停用' });
    if (relationType.from_type_id && source.ci_type_id !== relationType.from_type_id) {
      return reply.code(400).send({ message: `关系「${relationType.name}」不支持当前 CI 作为源对象` });
    }
    if (relationType.to_type_id && target.ci_type_id !== relationType.to_type_id) {
      return reply.code(400).send({ message: `关系「${relationType.name}」不支持当前 CI 作为目标对象` });
    }
    if (await db('ci_relations').where({ source_ci_id: sourceId, target_ci_id: body.target_ci_id, relation_type: body.relation_type }).first()) {
      return reply.code(409).send({ message: '该关系已存在' });
    }
    const id = await insertReturningId(db('ci_relations'), {
      source_ci_id: sourceId,
      target_ci_id: body.target_ci_id,
      relation_type: body.relation_type,
      description: body.description,
      created_at: nowIso(),
    });
    if (['member_of', 'contains'].includes(body.relation_type)) await syncRackDatacenterForRelation(sourceId, body.target_ci_id);
    await syncCILocation(sourceId);
    await syncCILocation(body.target_ci_id);
    await audit(request, { action: 'ci.relation_create', entityType: 'ci', entityId: sourceId, summary: `建立 CI 关系：${source.asset_no} ${relationType.name} ${target.asset_no}` });
    return reply.code(201).send({ id });
  });

  app.delete('/api/cis/:id/relations/:relationId', { preHandler: [authenticate, requirePermission('cmdb.edit')] }, async (request) => {
    const id = Number(request.params.relationId);
    const relation = await db('ci_relations').where({ id }).first();
    if (!relation) return httpError(404, '关系不存在');
    await db('ci_relations').where({ id }).del();
    if (['member_of', 'contains'].includes(relation.relation_type)) await syncRackDatacenterForRelation(relation.source_ci_id, relation.target_ci_id);
    await syncCILocation(relation.source_ci_id);
    await syncCILocation(relation.target_ci_id);
    await audit(request, { action: 'ci.relation_delete', entityType: 'ci', entityId: relation.source_ci_id, summary: '删除 CI 关系' });
    return { ok: true };
  });
}
