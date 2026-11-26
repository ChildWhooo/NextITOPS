import { z } from 'zod';
import { db } from '../db/index.js';
import { authenticate } from '../lib/auth.js';
import { parseJson } from '../lib/helpers.js';

const ASSET_FIELDS = [
  { key: 'asset_no', label: '资产编号', type: 'text' },
  { key: 'name', label: '资产名称', type: 'text' },
  { key: 'type_name', label: '资产类型', type: 'select', options: [] },
  { key: 'status', label: '状态', type: 'select', options: ['in_use', 'idle', 'maintenance', 'retired', 'planned', 'offline'] },
  { key: 'criticality', label: '重要性', type: 'select', options: ['critical', 'high', 'medium', 'low'] },
  { key: 'environment', label: '环境', type: 'select', options: ['production', 'staging', 'test', 'dr'] },
  { key: 'department', label: '部门', type: 'text' },
  { key: 'location', label: '位置', type: 'text' },
  { key: 'vendor', label: '品牌/厂商', type: 'text' },
  { key: 'model', label: '型号', type: 'text' },
  { key: 'serial_no', label: '序列号', type: 'text' },
  { key: 'ip_address', label: 'IP 地址', type: 'text' },
  { key: 'mac_addresses', label: 'MAC 地址', type: 'text' },
  { key: 'purchase_date', label: '购买日期', type: 'date' },
  { key: 'warranty_end', label: '保修到期', type: 'date' },
  { key: 'cost', label: '资产价值', type: 'number' },
  { key: 'owner_name', label: '负责人', type: 'text' },
  { key: 'manager_name', label: '资产管理员', type: 'text' },
];

const TICKET_FIELDS = [
  { key: 'ticket_no', label: '工单编号', type: 'text' },
  { key: 'title', label: '标题', type: 'text' },
  { key: 'type', label: '工单类型', type: 'select', options: ['incident', 'problem', 'change'] },
  { key: 'status', label: '状态', type: 'select', options: ['new', 'in_progress', 'pending_approval', 'resolved', 'closed', 'cancelled'] },
  { key: 'priority', label: '优先级', type: 'select', options: ['critical', 'high', 'medium', 'low'] },
  { key: 'source', label: '来源', type: 'text' },
  { key: 'category', label: '分类', type: 'text' },
  { key: 'requester_name', label: '发起人', type: 'text' },
  { key: 'assignee_name', label: '负责人', type: 'text' },
  { key: 'stage_name', label: '当前阶段', type: 'text' },
  { key: 'created_at', label: '创建时间', type: 'date' },
  { key: 'resolved_at', label: '解决时间', type: 'date' },
  { key: 'closed_at', label: '关闭时间', type: 'date' },
];

const EXTRA_FIELDS = [
  { key: 'ip_addresses', label: '全部 IP 地址', type: 'text' },
  { key: 'relation_description', label: '关系说明', type: 'text' },
];

const DEFAULT_RELATED_FIELDS = ['asset_no', 'name', 'type_name', 'status', 'ip_address'];
const DEFAULT_SEED_FIELDS = ['asset_no', 'name'];
const QUERY_CHUNK = 400;
const FIELD_TYPES = new Set(['text', 'select', 'date', 'number']);

const filterSchema = z.object({
  field: z.string().max(100),
  operator: z.enum(['equals', 'not_equals', 'contains', 'in', 'gt', 'gte', 'lt', 'lte', 'empty', 'not_empty']),
  value: z.string().max(500).default(''),
});

function normalizeSearchText(value) {
  return String(value ?? '').toLowerCase().replace(/[\s()（）\-]/g, '');
}

function versionParts(value) {
  return String(value ?? '').toLowerCase().replace(/^v/, '').split(/[._\-+]/).filter((part) => part !== '');
}

// Compare dotted versions such as 1.20, v1.20.3 or 7.9; fall back to numeric
// comparison for plain values and locale comparison for arbitrary text.
function compareOrderedValues(left, right) {
  const leftNumber = Number(left);
  const rightNumber = Number(right);
  if (Number.isFinite(leftNumber) && Number.isFinite(rightNumber)) return leftNumber - rightNumber;
  const a = versionParts(left);
  const b = versionParts(right);
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const av = a[index] ?? '0';
    const bv = b[index] ?? '0';
    const an = Number(av);
    const bn = Number(bv);
    if (Number.isFinite(an) && Number.isFinite(bn)) {
      if (an !== bn) return an - bn;
      continue;
    }
    const result = String(av).localeCompare(String(bv));
    if (result !== 0) return result;
  }
  return 0;
}

function chunk(items, size = QUERY_CHUNK) {
  const result = [];
  for (let index = 0; index < items.length; index += size) result.push(items.slice(index, index + size));
  return result;
}

function attributesOf(row) {
  return parseJson(row?.attributes, {}) || {};
}

function valueOf(row, field) {
  if (!row) return '';
  if (field === 'ip_addresses') return row.ip_addresses || '';
  if (field === 'mac_addresses') return row.mac_addresses || '';
  if (field === 'relation_description') return row.relation_description || '';
  if (field.startsWith('attr:')) return attributesOf(row)[field.slice(5)] ?? '';
  return row[field] ?? '';
}

function labelOf(field, customFields, typeId) {
  if (field === 'type_name') return '资产类型';
  const fixed = [...ASSET_FIELDS, ...EXTRA_FIELDS].find((item) => item.key === field);
  if (fixed) return fixed.label;
  if (field.startsWith('attr:')) {
    const key = field.slice(5);
    const defs = customFields.filter((item) => Number(item.ci_type_id) === Number(typeId) && item.field_key === key);
    return defs[0]?.label || key;
  }
  return field;
}

async function loadCustomFields() {
  const rows = await db('ci_field_defs').select('ci_type_id', 'field_key', 'label', 'field_type', 'options', 'show_in_list', 'sort_order');
  return rows.map((row) => {
    let options = [];
    try { options = JSON.parse(row.options || '[]'); } catch { options = []; }
    const type = row.field_type === 'select' ? 'select' : row.field_type === 'date' ? 'date' : row.field_type === 'number' ? 'number' : 'text';
    return {
      key: `attr:${row.field_key}`,
      field_key: row.field_key,
      ci_type_id: Number(row.ci_type_id),
      label: row.label,
      type: FIELD_TYPES.has(type) ? type : 'text',
      options,
      show_in_list: Boolean(row.show_in_list),
      sort_order: Number(row.sort_order || 0),
    };
  });
}

function catalogFor(typeId, customFields) {
  return [...ASSET_FIELDS, ...EXTRA_FIELDS, ...customFields.filter((field) => Number(field.ci_type_id) === Number(typeId))];
}

function catalogForTypes(typeIds, customFields) {
  const ids = new Set(typeIds.map(Number));
  const catalog = [...ASSET_FIELDS, ...EXTRA_FIELDS];
  const seen = new Set(catalog.map((field) => field.key));
  for (const field of customFields) {
    if (!ids.has(Number(field.ci_type_id)) || seen.has(field.key)) continue;
    seen.add(field.key);
    catalog.push(field);
  }
  return catalog;
}

function labelOfTypes(field, customFields, typeIds) {
  if (field === 'type_name') return '资产类型';
  const fixed = [...ASSET_FIELDS, ...EXTRA_FIELDS].find((item) => item.key === field);
  if (fixed) return fixed.label;
  if (field.startsWith('attr:')) {
    const key = field.slice(5);
    const ids = new Set(typeIds.map(Number));
    const def = customFields.find((item) => ids.has(Number(item.ci_type_id)) && item.field_key === key);
    return def?.label || key;
  }
  return field;
}

function matchesFilters(row, filters) {
  return (filters || []).every((filter) => {
    if (!filter.field) return true;
    const actual = String(valueOf(row, filter.field) ?? '');
    if (filter.operator === 'empty') return !actual;
    if (filter.operator === 'not_empty') return Boolean(actual);
    if (filter.operator === 'equals') return actual === filter.value;
    if (filter.operator === 'not_equals') return actual !== filter.value;
    if (filter.operator === 'contains') return actual.toLowerCase().includes(filter.value.toLowerCase());
    if (filter.operator === 'in') return filter.value.split(',').map((item) => item.trim()).filter(Boolean).includes(actual);
    if (filter.operator === 'gt') return compareOrderedValues(actual, filter.value) > 0;
    if (filter.operator === 'gte') return compareOrderedValues(actual, filter.value) >= 0;
    if (filter.operator === 'lt') return compareOrderedValues(actual, filter.value) < 0;
    if (filter.operator === 'lte') return compareOrderedValues(actual, filter.value) <= 0;
    return true;
  });
}

function baseAssetQuery() {
  return db('cis')
    .leftJoin('ci_types', 'cis.ci_type_id', 'ci_types.id')
    .leftJoin('users as owner', 'cis.owner_id', 'owner.id')
    .leftJoin('users as manager', 'cis.asset_manager_id', 'manager.id')
    .select('cis.*', 'ci_types.name as type_name', 'ci_types.code as type_code', 'owner.name as owner_name', 'manager.name as manager_name');
}

const SEED_FILTER_COLUMNS = {
  asset_no: 'cis.asset_no',
  name: 'cis.name',
  type_name: 'ci_types.name',
  type_code: 'ci_types.code',
  status: 'cis.status',
  criticality: 'cis.criticality',
  environment: 'cis.environment',
  department: 'cis.department',
  location: 'cis.location',
  vendor: 'cis.vendor',
  model: 'cis.model',
  serial_no: 'cis.serial_no',
  ip_address: 'cis.ip_address',
  purchase_date: 'cis.purchase_date',
  warranty_end: 'cis.warranty_end',
  cost: 'cis.cost',
  owner_name: 'owner.name',
  manager_name: 'manager.name',
};

const TICKET_FILTER_COLUMNS = {
  ticket_no: 'tickets.ticket_no',
  title: 'tickets.title',
  type: 'tickets.type',
  status: 'tickets.status',
  priority: 'tickets.priority',
  source: 'tickets.source',
  category: 'tickets.category',
  assignee_name: 'assignee.name',
  requester_name: 'requester.name',
  stage_name: 'stage.name',
};

// Apply standard fields in SQL before the JS fallback. Filtering after a limit
// silently misses matches beyond the first page; report queries intentionally
// have no artificial row cap.
function applySeedFilter(query, filter, columns = SEED_FILTER_COLUMNS) {
  const column = columns[filter.field];
  if (!column) return query;
  const value = String(filter.value ?? '');
  switch (filter.operator) {
    case 'equals': return query.where(column, value);
    case 'contains': return query.where(column, 'like', `%${value}%`);
    case 'in': {
      const values = value.split(',').map((item) => item.trim()).filter(Boolean);
      return values.length ? query.whereIn(column, values) : query.whereRaw('1 = 0');
    }
    case 'empty': return query.where((builder) => builder.whereNull(column).orWhere(column, ''));
    case 'not_empty': return query.whereNotNull(column).whereNot(column, '');
    case 'gt': return query.where(column, '>', value);
    case 'gte': return query.where(column, '>=', value);
    case 'lt': return query.where(column, '<', value);
    case 'lte': return query.where(column, '<=', value);
    default: return query;
  }
}

async function loadSeedRows(typeId, filters) {
  let query = baseAssetQuery().where('cis.ci_type_id', typeId);
  for (const filter of filters || []) query = applySeedFilter(query, filter);
  const rows = await query.orderBy('cis.asset_no');
  return rows.filter((row) => matchesFilters(row, filters));
}

async function loadAssetsByIds(ids) {
  const unique = [...new Set(ids.map(Number).filter((id) => Number.isInteger(id) && id > 0))];
  const rows = [];
  for (const batch of chunk(unique)) {
    if (!batch.length) continue;
    rows.push(...await baseAssetQuery().whereIn('cis.id', batch));
  }
  return rows;
}

async function loadIpAddresses(ids) {
  const map = new Map();
  const unique = [...new Set(ids.map(Number).filter(Boolean))];
  for (const batch of chunk(unique)) {
    if (!batch.length) continue;
    const rows = await db('ci_ips').whereIn('ci_id', batch).whereIn('status', ['active', 'offline']).select('ci_id', 'ip_address', 'interface_name', 'status');
    for (const row of rows) {
      if (!map.has(row.ci_id)) map.set(row.ci_id, []);
      map.get(row.ci_id).push(row);
    }
  }
  return map;
}

async function loadMacAddresses(ids) {
  const map = new Map();
  const unique = [...new Set(ids.map(Number).filter(Boolean))];
  for (const batch of chunk(unique)) {
    if (!batch.length) continue;
    const rows = await db('ci_network_ports')
      .whereIn('ci_id', batch)
      .whereNot('mac_address', '')
      .select('ci_id', 'port_name', 'mac_address');
    for (const row of rows) {
      if (!map.has(Number(row.ci_id))) map.set(Number(row.ci_id), []);
      map.get(Number(row.ci_id)).push(row);
    }
  }
  return map;
}

function attachMacAddresses(rows, macMap) {
  for (const row of rows) {
    if (!row) continue;
    const seen = new Set();
    const values = [];
    for (const port of macMap.get(Number(row.id)) || []) {
      const mac = String(port.mac_address || '').trim();
      if (!mac || seen.has(mac.toLowerCase())) continue;
      seen.add(mac.toLowerCase());
      values.push(port.port_name ? `${port.port_name}：${mac}` : mac);
    }
    row.mac_addresses = values.slice(0, 30).join(' / ');
  }
}

function attachIpAddresses(rows, ipMap) {
  for (const row of rows) {
    if (!row) continue;
    const values = [];
    if (row.ip_address) values.push(String(row.ip_address));
    for (const ip of ipMap.get(Number(row.id)) || []) {
      const label = ip.interface_name ? `${ip.ip_address}（${ip.interface_name}）` : String(ip.ip_address);
      if (!values.some((value) => value === label || value === String(ip.ip_address))) values.push(label);
    }
    row.ip_addresses = [...new Set(values)].slice(0, 12).join(' / ');
  }
}

function resolveFields(typeId, requested, role, customFields, fallback = DEFAULT_RELATED_FIELDS) {
  const catalog = catalogFor(typeId, customFields);
  const wanted = Array.isArray(requested) && requested.length ? requested : fallback;
  const seen = new Set();
  return wanted
    .filter((key) => catalog.some((field) => field.key === key) && !seen.has(key) && seen.add(key))
    .map((key) => ({
      key: `${role}:${key}`,
      sourceKey: key,
      role,
      label: labelOf(key, customFields, typeId),
      type: catalog.find((field) => field.key === key)?.type || 'text',
    }));
}

function project(row, role, columns) {
  const output = {};
  for (const column of columns) output[column.key] = valueOf(row, column.sourceKey);
  return output;
}

function typeIdByCode(types, code) {
  return types.find((type) => type.code === code)?.id || null;
}

function defaultRelatedFields(typeCode, customFields, typeId) {
  const custom = customFields
    .filter((field) => Number(field.ci_type_id) === Number(typeId) && field.show_in_list)
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((field) => field.key);
  if (typeCode === 'server') return ['asset_no', 'name', 'type_name', 'status', 'ip_address', 'model', 'environment', 'location', ...custom];
  if (typeCode === 'vm') return ['asset_no', 'name', 'type_name', 'status', 'ip_address', 'environment', 'location', ...custom];
  if (typeCode === 'business') return ['asset_no', 'name', 'type_name', 'status', 'attr:business_code', 'attr:business_owner', 'attr:user_count', 'attr:service_level', ...custom];
  if (typeCode === 'software') return ['asset_no', 'name', 'type_name', 'status', 'attr:version', ...custom];
  if (typeCode === 'os') return ['asset_no', 'name', 'type_name', 'status', 'attr:version', ...custom];
  return ['asset_no', 'name', 'type_name', 'status', 'ip_address', ...custom];
}

function defaultRelatedFieldsForTypes(targetTypes, customFields) {
  const fields = [];
  const seen = new Set();
  for (const type of targetTypes) {
    for (const key of defaultRelatedFields(type.code, customFields, type.id)) {
      if (seen.has(key)) continue;
      seen.add(key);
      fields.push(key);
    }
  }
  return fields;
}

function resolveRelatedFields(targetTypes, requested, customFields, fallback) {
  const typeIds = targetTypes.map((type) => type.id);
  const catalog = catalogForTypes(typeIds, customFields);
  const seen = new Set();
  const wanted = Array.isArray(requested) && requested.length ? requested : fallback;
  return wanted
    .filter((key) => catalog.some((field) => field.key === key) && !seen.has(key) && seen.add(key))
    .map((key) => ({
      key: `related:${key}`,
      sourceKey: key,
      role: 'related',
      label: labelOfTypes(key, customFields, typeIds),
      type: catalog.find((field) => field.key === key)?.type || 'text',
    }));
}

async function relationDefinitions() {
  return db('ci_relation_types as rt')
    .leftJoin('ci_types as ft', 'rt.from_type_id', 'ft.id')
    .leftJoin('ci_types as tt', 'rt.to_type_id', 'tt.id')
    .where('rt.enabled', true)
    .select('rt.code', 'rt.name', 'rt.reverse_name', 'rt.from_type_id', 'rt.to_type_id', 'ft.name as from_type_name', 'ft.code as from_type_code', 'tt.name as to_type_name', 'tt.code as to_type_code')
    .orderBy('rt.sort_order');
}

function findTypeByText(types, text, fallbackCode = 'server') {
  const aliases = {
    server: ['服务器', '主机', '物理机'],
    vm: ['虚拟机', '虚机'],
    software: ['软件'],
    business: ['业务系统', '业务'],
    os: ['操作系统', '系统'],
    storage: ['存储设备', '存储'],
    network: ['网络设备', '交换机', '防火墙'],
    security: ['信息安全设备', '安全设备'],
    datacenter: ['数据中心', '机房'],
    rack: ['机柜'],
    virtualization: ['虚拟化平台'],
    virtualization_host: ['虚拟化宿主机', '宿主机'],
  };
  const lowered = text.toLowerCase();
  for (const type of types) {
    const names = [type.name, type.code, ...(aliases[type.code] || [])].map((name) => String(name).toLowerCase());
    if (names.some((name) => name && lowered.includes(name))) return type;
  }
  return types.find((type) => type.code === fallbackCode) || null;
}

const TYPE_ALIASES = {
  server: ['服务器', '物理机'],
  vm: ['虚拟机', '虚机'],
  network: ['网络设备', '交换机', '路由器'],
  security: ['信息安全设备', '安全设备', '防火墙'],
  storage: ['存储设备', '存储'],
  datacenter: ['数据中心', '机房'],
  rack: ['机柜'],
  virtualization: ['虚拟化平台'],
  virtualization_host: ['虚拟化宿主机', '宿主机'],
};

function typesByText(types, text) {
  const lowered = text.toLowerCase();
  return types.filter((type) => {
    const names = [type.name, type.code, ...(TYPE_ALIASES[type.code] || [])]
      .map((name) => String(name || '').toLowerCase())
      .filter(Boolean);
    return names.some((name) => lowered.includes(name));
  });
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function cleanConditionValue(value) {
  return String(value || '')
    .replace(/\s*的\s*(?:主机|服务器|虚拟机|虚机|物理机|资产|列表|信息|吗|呢)\s*$/i, '')
    .replace(/\s*(?:吗|呢)\s*$/i, '')
    .trim();
}

function captureFieldValue(text, labels) {
  for (const label of labels) {
    const match = text.match(new RegExp(`${escapeRegex(label)}\\s*(?:为|是|等于|:|：)\\s*([^，,。；;]+)`, 'i'));
    if (match) {
      const value = cleanConditionValue(match[1]);
      if (value) return value;
    }
  }
  return '';
}

function captureComparison(text, labels) {
  for (const label of labels) {
    const match = text.match(new RegExp(`${escapeRegex(label)}\\s*(大于等于|不小于|不低于|大于|高于|超过|小于等于|不大于|不高于|小于|低于)\\s*([^，,。；;的]+)`, 'i'));
    if (match) {
      const raw = match[2].trim().replace(/[a-zA-Z]+$/g, '');
      const operator = /大于等于|不小于|不低于/.test(match[1])
        ? 'gte'
        : /小于等于|不大于|不高于/.test(match[1])
          ? 'lte'
          : /大于|高于|超过/.test(match[1])
            ? 'gt'
            : 'lt';
      if (raw) return { operator, value: raw };
    }
  }
  return null;
}

function statusValue(value) {
  return {
    使用中: 'in_use', 在用: 'in_use', 正常: 'in_use',
    闲置: 'idle', 空闲: 'idle',
    维护: 'maintenance', 维护中: 'maintenance',
    已退役: 'retired', 退役: 'retired',
    计划: 'planned', 规划: 'planned',
    离线: 'offline', 下线: 'offline',
  }[value] || value;
}

function criticalityValue(value) {
  return { 核心: 'critical', 紧急: 'critical', 高: 'high', 重要: 'high', 中: 'medium', 一般: 'medium', 低: 'low' }[value] || value;
}

function environmentValue(value) {
  return { 生产: 'production', 生产环境: 'production', 预发: 'staging', 测试: 'test', 灾备: 'dr' }[value] || value;
}

function normalizeTypeIds(ids) {
  return [...new Set(ids.map(Number).filter((id) => Number.isInteger(id) && id > 0))];
}

const STANDARD_FILTER_DEFS = [
  { field: 'ip_address', labels: ['IP地址', 'IP 地址', 'IP'], operator: 'equals' },
  { field: 'asset_no', labels: ['资产编号', '资产号', '编号'], operator: 'equals' },
  { field: 'name', labels: ['资产名称', '名称', '名字'], operator: 'contains' },
  { field: 'status', labels: ['资产状态', '状态'], operator: 'equals', map: statusValue },
  { field: 'criticality', labels: ['重要性', '重要级别', '重要程度', '级别'], operator: 'equals', map: criticalityValue },
  { field: 'environment', labels: ['环境'], operator: 'equals', map: environmentValue },
  { field: 'owner_name', labels: ['负责人', '责任人', '所有人'], operator: 'contains' },
  { field: 'manager_name', labels: ['资产管理员', '管理员'], operator: 'contains' },
  { field: 'department', labels: ['所属部门', '部门'], operator: 'contains' },
  { field: 'location', labels: ['机房位置', '位置'], operator: 'contains' },
  { field: 'vendor', labels: ['品牌厂商', '品牌/厂商', '厂商', '品牌'], operator: 'contains' },
  { field: 'model', labels: ['设备型号', '型号'], operator: 'contains' },
  { field: 'serial_no', labels: ['序列号', 'SN号', 'SN'], operator: 'equals' },
];

function parseVersionCondition(text) {
  if (/版本\s*(?:不限定|不限|任意|所有)/.test(text)) return { unlimited: true };
  let normalized = text
    .replace(/大于\s*\/\s*高于/g, '大于')
    .replace(/高于\s*\/\s*大于/g, '大于')
    .replace(/小于\s*\/\s*低于/g, '小于')
    .replace(/低于\s*\/\s*小于/g, '小于')
    .replace(/(?:大于|高于)\s*(?:或|\/)\s*(?:小于|低于)/g, '不等于');
  const match = normalized.match(/版本(?:号)?\s*(大于等于|不小于|不低于|大于|高于|超过|小于等于|不大于|不高于|小于|低于|不等于|等于|为|是)?\s*v?([0-9][a-z0-9._-]*)/i);
  if (!match) return null;
  const word = match[1] || '';
  const value = match[2];
  const operator = /大于等于|不小于|不低于/.test(word)
    ? 'gte'
    : /小于等于|不大于|不高于/.test(word)
      ? 'lte'
      : /大于|高于|超过/.test(word)
        ? 'gt'
        : /小于|低于/.test(word)
          ? 'lt'
          : /不等于/.test(word)
            ? 'not_equals'
            : 'equals';
  return { operator, value, unlimited: false };
}

function extractOsName(text) {
  const match = text.match(/(?:操作系统|(?<![a-z])OS)\s*(?:为|是|等于|:|：)?\s*([a-z0-9][a-z0-9 ._-]*)/i);
  return match ? cleanConditionValue(match[1]) : '';
}

function extractAssetConditions(text, typeIds, customFields) {
  const filters = [];
  const interpretation = [];
  const seen = new Set();
  for (const def of STANDARD_FILTER_DEFS) {
    if (seen.has(def.field)) continue;
    const comparison = def.operator !== 'equals' ? null : captureComparison(text, def.labels);
    const value = captureFieldValue(text, def.labels);
    if (!value && !comparison) continue;
    const finalValue = comparison?.value || value;
    const mapped = def.map ? def.map(finalValue) : finalValue;
    filters.push({ field: def.field, operator: comparison?.operator || def.operator, value: mapped });
    interpretation.push(`${def.labels[0]}${comparison ? ` ${comparison.operator === 'gt' ? '>' : comparison.operator === 'lt' ? '<' : comparison.operator === 'gte' ? '≥' : '≤'} ` : ' '}${finalValue}`);
    seen.add(def.field);
  }

  const scopedCustom = customFields
    .filter((field) => !typeIds.length || typeIds.includes(Number(field.ci_type_id)))
    .sort((a, b) => String(b.label).length - String(a.label).length);
  for (const field of scopedCustom) {
    if (seen.has(field.key)) continue;
    const labels = [...new Set([field.label, String(field.label || '').replace(/\s+/g, '')])]
      .filter((label) => String(label || '').length >= 2);
    if (!labels.length) continue;
    const comparison = field.type === 'number' ? captureComparison(text, labels) : null;
    const value = captureFieldValue(text, labels);
    if (!value && !comparison) continue;
    const finalValue = comparison?.value || value;
    filters.push({ field: field.key, operator: comparison?.operator || 'contains', value: finalValue });
    interpretation.push(`${field.label} ${comparison ? (comparison.operator === 'gt' ? '>' : comparison.operator === 'lt' ? '<' : comparison.operator === 'gte' ? '≥' : '≤') : '包含'} ${finalValue}`);
    seen.add(field.key);
  }
  return { filters, interpretation };
}

async function resolveOsHostIds(osName) {
  const osType = await db('ci_types').where({ code: 'os' }).first();
  if (!osType) return { osIds: [], hostIds: [], names: [] };
  const wanted = normalizeSearchText(osName);
  if (!wanted) return { osIds: [], hostIds: [], names: [] };
  const osRows = await baseAssetQuery().where('cis.ci_type_id', osType.id);
  const matchedOs = osRows.filter((row) => normalizeSearchText(`${row.name || ''} ${row.asset_no || ''}`).includes(wanted));
  if (!matchedOs.length) return { osIds: [], hostIds: [], names: [] };
  const osIds = matchedOs.map((row) => Number(row.id));
  const edges = await db('ci_relations')
    .where({ relation_type: 'os_installed' })
    .whereIn('target_ci_id', osIds)
    .select('source_ci_id');
  return {
    osIds,
    hostIds: [...new Set(edges.map((edge) => Number(edge.source_ci_id)).filter(Boolean))],
    names: matchedOs.map((row) => row.name),
  };
}



export default async function reportRoutes(app) {
  app.get('/api/reports/fields', { preHandler: authenticate }, async () => {
    const customFields = await loadCustomFields();
    const types = await db('ci_types').where({ enabled: true }).select('id', 'code', 'name').orderBy('sort_order');
    const assetFields = ASSET_FIELDS.map((field) => field.key === 'type_name' ? { ...field, options: types.map((type) => type.name) } : field);
    const relations = await relationDefinitions();
    return {
      data: {
        assets: [...assetFields, ...customFields],
        global_fields: assetFields,
        custom_fields: customFields,
        extra_fields: EXTRA_FIELDS,
        tickets: TICKET_FIELDS,
        ci_types: types,
        relations,
      },
    };
  });

  app.post('/api/reports/data', { preHandler: authenticate }, async (request, reply) => {
    const schema = z.object({
      source: z.enum(['asset', 'ticket']).default('asset'),
      fields: z.array(z.string().max(100)).min(1).max(60),
      ci_type_id: z.coerce.number().int().positive().optional(),
      ci_type_ids: z.array(z.coerce.number().int().positive()).max(20).optional(),
      date_from: z.string().max(40).optional().default(''),
      date_to: z.string().max(40).optional().default(''),
      filters: z.array(filterSchema).max(20).default([]),
    });
    const body = schema.parse(request.body || {});
    if (body.source === 'asset') {
      let query = baseAssetQuery();
      const typeIds = body.ci_type_ids?.length ? body.ci_type_ids : body.ci_type_id ? [body.ci_type_id] : [];
      if (typeIds.length) query.whereIn('cis.ci_type_id', typeIds);
      if (body.date_from) query.where('cis.created_at', '>=', body.date_from);
      if (body.date_to) query.where('cis.created_at', '<=', `${body.date_to}T23:59:59.999Z`);
      for (const filter of body.filters) query = applySeedFilter(query, filter);
      const rows = await query.orderBy('cis.asset_no');
      const filteredRows = rows.filter((row) => matchesFilters(row, body.filters));
      if (body.fields.includes('mac_addresses')) attachMacAddresses(filteredRows, await loadMacAddresses(filteredRows.map((row) => row.id)));
      const mapped = filteredRows.map((row) => {
        const output = {};
        for (const field of body.fields) output[field] = valueOf(row, field);
        return output;
      });
      return { data: mapped, total: mapped.length };
    }
    let query = db('tickets')
      .leftJoin('users as assignee', 'tickets.assignee_id', 'assignee.id')
      .leftJoin('users as requester', 'tickets.requester_id', 'requester.id')
      .leftJoin('workflow_stages as stage', 'tickets.current_stage_id', 'stage.id')
      .select('tickets.*', 'assignee.name as assignee_name', 'requester.name as requester_name', 'stage.name as stage_name');
    if (body.date_from) query.where('tickets.created_at', '>=', body.date_from);
    if (body.date_to) query.where('tickets.created_at', '<=', `${body.date_to}T23:59:59.999Z`);
    for (const filter of body.filters) query = applySeedFilter(query, filter, TICKET_FILTER_COLUMNS);
    const rows = await query.orderBy('tickets.created_at', 'desc');
    const filteredRows = rows.filter((row) => matchesFilters(row, body.filters));
    const mapped = filteredRows.map((row) => Object.fromEntries(body.fields.map((field) => [field, row[field] ?? ''])));
    return { data: mapped, total: mapped.length };
  });

  app.post('/api/reports/related', { preHandler: authenticate }, async (request, reply) => {
    const schema = z.object({
      source_type_id: z.coerce.number().int().positive(),
      filters: z.array(filterSchema).max(20).default([]),
      seed_ci_ids: z.array(z.coerce.number().int().positive()).max(5000).optional(),
      relation_code: z.string().max(40),
      direction: z.enum(['outgoing', 'incoming']),
      target_type_id: z.coerce.number().int().positive().optional(),
      target_type_ids: z.array(z.coerce.number().int().positive()).max(20).optional(),
      target_ci_ids: z.array(z.coerce.number().int().positive()).max(5000).optional(),
      output_mode: z.enum(['related', 'both', 'seed']).default('related'),
      seed_fields: z.array(z.string().max(100)).max(60).default([]),
      related_fields: z.array(z.string().max(100)).max(60).default([]),
    });
    const body = schema.parse(request.body || {});
    const relation = await db('ci_relation_types').where({ code: body.relation_code }).first();
    if (!relation) return reply.code(400).send({ message: '关联类型不存在' });
    const outgoing = body.direction === 'outgoing';
    const expectedSeedType = outgoing ? relation.from_type_id : relation.to_type_id;
    const expectedTargetType = outgoing ? relation.to_type_id : relation.from_type_id;
    if (expectedSeedType && Number(expectedSeedType) !== Number(body.source_type_id)) {
      return reply.code(400).send({ message: '当前资产类型与该关联方向不匹配' });
    }
    const requestedTargetIds = body.target_type_ids?.length
      ? body.target_type_ids
      : [body.target_type_id || expectedTargetType].filter(Boolean);
    if (!requestedTargetIds.length) return reply.code(400).send({ message: '请选择关联资产类型' });
    if (expectedTargetType && requestedTargetIds.some((id) => Number(id) !== Number(expectedTargetType))) {
      return reply.code(400).send({ message: '关联资产类型与该关联的固定目标类型不匹配' });
    }
    if (expectedTargetType && new Set(requestedTargetIds.map(Number)).size > 1) {
      return reply.code(400).send({ message: '该关联关系只支持一个目标资产类型' });
    }
    const targetTypeIds = [...new Set(requestedTargetIds.map(Number))];
    const targetTypes = await db('ci_types').whereIn('id', targetTypeIds).select('id', 'code', 'name');
    if (targetTypes.length !== targetTypeIds.length) {
      return reply.code(400).send({ message: '关联资产类型不存在或已停用' });
    }

    const allSeedRows = await loadSeedRows(body.source_type_id, body.filters);
    const seedIdSet = body.seed_ci_ids ? new Set(body.seed_ci_ids.map(Number)) : null;
    const seedRows = seedIdSet ? allSeedRows.filter((row) => seedIdSet.has(Number(row.id))) : allSeedRows;
    if (!seedRows.length) return { data: [], columns: [], total: 0, seeds: 0, related: 0 };
    const seedMap = new Map(seedRows.map((row) => [Number(row.id), row]));
    const seedColumn = outgoing ? 'source_ci_id' : 'target_ci_id';
    const relatedColumn = outgoing ? 'target_ci_id' : 'source_ci_id';
    const edges = [];
    for (const batch of chunk([...seedMap.keys()])) {
      const rows = await db('ci_relations')
        .whereIn(seedColumn, batch)
        .where('relation_type', relation.code)
        .select('id as relation_id', 'source_ci_id', 'target_ci_id', 'description as relation_description');
      edges.push(...rows);
    }
    const relatedIds = [...new Set(edges.map((edge) => Number(edge[relatedColumn])).filter(Boolean))];
    const relatedRows = await loadAssetsByIds(relatedIds);
    const targetTypeIdSet = new Set(targetTypeIds);
    const targetCiIdSet = body.target_ci_ids ? new Set(body.target_ci_ids.map(Number)) : null;
    const relatedMap = new Map(relatedRows
      .filter((row) => targetTypeIdSet.has(Number(row.ci_type_id)) && (!targetCiIdSet || targetCiIdSet.has(Number(row.id))))
      .map((row) => [Number(row.id), row]));
    const validEdges = edges.filter((edge) => relatedMap.has(Number(edge[relatedColumn])) && seedMap.has(Number(edge[seedColumn])));
    if (!validEdges.length) return { data: [], columns: [], total: 0, seeds: seedRows.length, related: 0 };

    const customFields = await loadCustomFields();
    const seedType = await db('ci_types').where({ id: body.source_type_id }).first();
    const defaultRelated = defaultRelatedFieldsForTypes(targetTypes, customFields);
    const defaultSeed = body.output_mode === 'related' ? [] : DEFAULT_SEED_FIELDS;
    const seedColumns = body.output_mode === 'seed' || body.output_mode === 'both'
      ? resolveFields(body.source_type_id, body.seed_fields, 'seed', customFields, defaultSeed)
      : resolveFields(body.source_type_id, body.seed_fields, 'seed', customFields, []);
    const relatedColumns = body.output_mode === 'seed'
      ? []
      : resolveRelatedFields(targetTypes, body.related_fields, customFields, defaultRelated);
    const columns = [...seedColumns, ...relatedColumns];

    const ipMap = await loadIpAddresses([...seedMap.keys(), ...relatedMap.keys()]);
    attachIpAddresses([...seedMap.values()], ipMap);
    attachIpAddresses([...relatedMap.values()], ipMap);

    let rows;
    if (body.output_mode === 'seed') {
      const seen = new Set();
      rows = [];
      for (const edge of validEdges) {
        const seed = seedMap.get(Number(edge[seedColumn]));
        if (!seed || seen.has(Number(seed.id))) continue;
        seen.add(Number(seed.id));
        seed.relation_description = edge.relation_description || '';
        rows.push(project(seed, 'seed', seedColumns));
      }
    } else {
      // 一个源资产可能通过多条关系指向同一个目标（例如同一台主机安装了多个
      // nginx 版本/重复软件记录）。只输出目标资产字段时必须按目标去重，否则
      // 报表会把同一台主机重复显示几十次。
      const seenRows = new Set();
      rows = [];
      for (const edge of validEdges) {
        const seed = seedMap.get(Number(edge[seedColumn]));
        const related = relatedMap.get(Number(edge[relatedColumn]));
        if (!seed || !related) continue;
        const rowKey = body.output_mode === 'related'
          ? `related:${related.id}`
          : `pair:${seed.id}:${related.id}`;
        if (seenRows.has(rowKey)) continue;
        seenRows.add(rowKey);
        related.relation_description = edge.relation_description || '';
        rows.push({ ...project(seed, 'seed', seedColumns), ...project(related, 'related', relatedColumns) });
      }
    }
    return {
      data: rows,
      columns,
      total: rows.length,
      seeds: seedRows.length,
      related: relatedMap.size,
      relation: {
        code: relation.code,
        name: relation.name,
        reverse_name: relation.reverse_name,
        direction: body.direction,
        source_type_id: body.source_type_id,
        target_type_id: targetTypeIds[0],
        target_type_ids: targetTypeIds,
        source_type_name: seedType?.name || '',
        target_type_name: targetTypes.map((type) => type.name).join('、'),
        target_type_names: targetTypes.map((type) => type.name),
      },
    };
  });

  app.post('/api/reports/parse', { preHandler: authenticate }, async (request, reply) => {
    const schema = z.object({ prompt: z.string().trim().min(2).max(500) });
    const { prompt } = schema.parse(request.body || {});
    const types = await db('ci_types').where({ enabled: true }).select('id', 'code', 'name').orderBy('sort_order');
    const customFields = await loadCustomFields();
    const typeByCode = (code) => types.find((type) => type.code === code) || null;
    const softwareType = typeByCode('software');
    const serverType = typeByCode('server');
    const vmType = typeByCode('vm');
    const businessType = typeByCode('business');
    const osType = typeByCode('os');
    const text = prompt.replace(/[，。！？；：、]/g, ' ').replace(/\s+/g, ' ').trim();
    const lower = text.toLowerCase();
    const filters = [];
    const interpretation = [];
    const warnings = [];
    const unsupported = '该自然语言本系统能力暂时不支持，建议用户自行定义搜索';
    let mode = 'related';

    const hasTicket = /工单|变更|事件|问题/.test(text) && /负责|未完成|已完成|状态|查找|查询|筛选|输出|查看/.test(text);
    const hasSoftware = Boolean(softwareType) && (lower.includes('软件') || /安装了?\s*[a-z0-9]/.test(lower)) && !lower.includes('业务');
    const hasBusiness = Boolean(businessType) && /业务/.test(text) && /承载|运行|关联|输出|查看/.test(text);
    const osName = extractOsName(text);
    const hasOsCondition = Boolean(osName) && /操作系统|OS/i.test(text);
    const hasOsOutput = Boolean(osType) && /操作系统/.test(text) && /安装|运行|输出/.test(text) && !hasOsCondition;
    const wantsMac = /mac|物理地址/i.test(text);

    const hostTargetTypes = () => {
      const wantsVm = /虚拟机|虚机/.test(text);
      const wantsServer = /服务器|物理机/.test(text);
      return (wantsVm && !wantsServer
        ? [vmType]
        : wantsServer && !wantsVm
          ? [serverType]
          : [serverType, vmType]).filter(Boolean);
    };

    const addTypeInterpretation = (typeIds) => {
      const names = typeIds.map((typeId) => types.find((type) => type.id === typeId)?.name).filter(Boolean).join('、');
      if (names) interpretation.push(`资产类型：${names}`);
    };

    if (hasTicket) {
      mode = 'ticket';
      const fields = ['ticket_no', 'title', 'type', 'status', 'assignee_name', 'priority', 'created_at'];
      const assignee = text.match(/(?:查找|查询|筛选|查看)?\s*([\u4e00-\u9fa5A-Za-z][\u4e00-\u9fa5A-Za-z0-9_.-]{0,19})\s*负责的/)?.[1]?.trim();
      if (assignee && !/^(所有|全部|哪些|哪个)$/.test(assignee)) {
        filters.push({ field: 'assignee_name', operator: 'contains', value: assignee });
        interpretation.push(`负责人包含 ${assignee}`);
      }
      if (/变更/.test(text)) {
        filters.push({ field: 'type', operator: 'equals', value: 'change' });
        interpretation.push('工单类型：变更');
      } else if (/事件/.test(text)) {
        filters.push({ field: 'type', operator: 'equals', value: 'incident' });
        interpretation.push('工单类型：事件');
      } else if (/问题/.test(text)) {
        filters.push({ field: 'type', operator: 'equals', value: 'problem' });
        interpretation.push('工单类型：问题');
      }
      if (/未完成|未关闭|处理中|待处理/.test(text)) {
        filters.push({ field: 'status', operator: 'in', value: 'new,in_progress,pending_approval' });
        interpretation.push('状态：未完成（新建/处理中/待审批）');
      } else if (/已完成|已关闭|已解决/.test(text)) {
        filters.push({ field: 'status', operator: 'in', value: 'resolved,closed' });
        interpretation.push('状态：已完成');
      }
      interpretation.unshift('查询流程工单');
      return {
        prompt,
        mode,
        query: { mode, source: 'ticket', fields, filters, ci_type_ids: [] },
        interpretation,
        warnings,
      };
    }

    if (hasSoftware) {
      mode = 'related';
      const sourceType = softwareType;
      const targetTypes = hostTargetTypes();
      if (!targetTypes.length) return reply.code(400).send({ message: unsupported });
      const softwareName = lower.match(/软件\s*(?:为|是|名称为|名称是|:|：)?\s*([a-z0-9][a-z0-9._@+\-/]*)/)?.[1]
        || lower.match(/安装了?\s*([a-z0-9][a-z0-9._@+\-/]*)\s*(?:软件)?\s*(?:的)?\s*(?:服务器|虚拟机|虚机|物理机|主机)/)?.[1]
        || lower.match(/安装了?\s*([a-z0-9][a-z0-9._@+\-/]*)\s*软件/)?.[1]
        || '';
      if (softwareName) {
        filters.push({ field: 'name', operator: 'contains', value: softwareName });
      }
      const version = parseVersionCondition(text);
      if (version?.unlimited) {
        interpretation.push('软件版本不限定');
      } else if (version) {
        const operatorLabel = { gt: '高于', gte: '不低于', lt: '低于', lte: '不高于', equals: '等于', not_equals: '不等于' }[version.operator] || '匹配';
        filters.push({ field: 'attr:version', operator: version.operator, value: version.value });
        interpretation.push(`软件版本${operatorLabel} ${version.value}`);
      }
      const targetCiIds = [];
      if (hasOsCondition) {
        const resolved = await resolveOsHostIds(osName);
        targetCiIds.push(...resolved.hostIds);
        interpretation.push(`主机操作系统 ${osName}`);
        if (!resolved.hostIds.length) warnings.push(`未找到操作系统为「${osName}」的主机，结果可能为空`);
      }
      interpretation.unshift(`筛选软件资产${softwareName ? `：名称包含 ${softwareName}` : ''}`);
      addTypeInterpretation(targetTypes.map((type) => type.id));
      return {
        prompt,
        mode,
        query: {
          mode,
          source_type_id: sourceType.id,
          filters,
          relation_code: 'software_installed',
          direction: 'incoming',
          target_type_id: targetTypes[0].id,
          target_type_ids: targetTypes.map((type) => type.id),
          ...(hasOsCondition ? { target_ci_ids: targetCiIds } : {}),
          output_mode: 'related',
          seed_fields: [],
          related_fields: defaultRelatedFieldsForTypes(targetTypes, customFields),
        },
        interpretation,
        warnings,
        source_type_name: sourceType.name,
        target_type_name: targetTypes.map((type) => type.name).join('、'),
        target_type_names: targetTypes.map((type) => type.name),
        relation_name: '安装软件',
      };
    }

    if (hasOsCondition || hasOsOutput) {
      mode = 'related';
      if (hasOsCondition) {
        const resolved = await resolveOsHostIds(osName);
        const targetTypes = hostTargetTypes();
        if (!targetTypes.length) return reply.code(400).send({ message: unsupported });
        interpretation.push(`操作系统名称包含 ${osName}`);
        if (!resolved.osIds.length) warnings.push(`未找到名称为「${osName}」的操作系统资产`);
        addTypeInterpretation(targetTypes.map((type) => type.id));
        return {
          prompt,
          mode,
          query: {
            mode,
            source_type_id: osType.id,
            filters: [],
            seed_ci_ids: resolved.osIds,
            relation_code: 'os_installed',
            direction: 'incoming',
            target_type_id: targetTypes[0].id,
            target_type_ids: targetTypes.map((type) => type.id),
            target_ci_ids: [],
            output_mode: 'related',
            seed_fields: [],
            related_fields: defaultRelatedFieldsForTypes(targetTypes, customFields),
          },
          interpretation,
          warnings,
          source_type_name: osType.name,
          target_type_name: targetTypes.map((type) => type.name).join('、'),
          target_type_names: targetTypes.map((type) => type.name),
          relation_name: '安装操作系统',
        };
      }
      const targetTypes = [osType].filter(Boolean);
      if (!targetTypes.length || !serverType) return reply.code(400).send({ message: unsupported });
      interpretation.push('输出服务器安装的操作系统');
      return {
        prompt,
        mode,
        query: {
          mode,
          source_type_id: serverType.id,
          filters,
          relation_code: 'os_installed',
          direction: 'outgoing',
          target_type_id: targetTypes[0].id,
          target_type_ids: targetTypes.map((type) => type.id),
          output_mode: 'related',
          seed_fields: [],
          related_fields: defaultRelatedFieldsForTypes(targetTypes, customFields),
        },
        interpretation,
        warnings,
        source_type_name: serverType.name,
        target_type_name: targetTypes.map((type) => type.name).join('、'),
        target_type_names: targetTypes.map((type) => type.name),
        relation_name: '安装操作系统',
      };
    }

    if (hasBusiness) {
      mode = 'related';
      const sourceType = serverType;
      const targetTypes = [businessType].filter(Boolean);
      if (!sourceType || !targetTypes.length) return reply.code(400).send({ message: unsupported });
      const model = text.match(/型号\s*(?:为|是|:|：)?\s*(.+?)\s*(?:的)?\s*服务器/)?.[1]?.trim().replace(/的$/, '');
      if (model) {
        filters.push({ field: 'model', operator: 'contains', value: model });
        interpretation.push(`服务器型号包含 ${model}`);
      }
      interpretation.unshift('筛选服务器资产');
      return {
        prompt,
        mode,
        query: {
          mode,
          source_type_id: sourceType.id,
          filters,
          relation_code: 'business_runs_on',
          direction: 'incoming',
          target_type_id: targetTypes[0].id,
          target_type_ids: targetTypes.map((type) => type.id),
          output_mode: 'related',
          seed_fields: [],
          related_fields: defaultRelatedFieldsForTypes(targetTypes, customFields),
        },
        interpretation,
        warnings,
        source_type_name: sourceType.name,
        target_type_name: targetTypes.map((type) => type.name).join('、'),
        target_type_names: targetTypes.map((type) => type.name),
        relation_name: '运行业务',
      };
    }

    mode = 'asset';
    const typeMatches = typesByText(types, text).filter((type) => !['software', 'business', 'os'].includes(type.code));
    let typeIds = normalizeTypeIds(typeMatches.map((type) => type.id));
    if (/主机/.test(text)) {
      typeIds = normalizeTypeIds([serverType?.id, vmType?.id]);
    } else {
      if (/服务器|物理机/.test(text)) typeIds.push(serverType?.id);
      if (/虚拟机|虚机/.test(text)) typeIds.push(vmType?.id);
    }
    const finalTypeIds = normalizeTypeIds(typeIds);
    const { filters: assetFilters, interpretation: assetInterpretation } = extractAssetConditions(text, finalTypeIds, customFields);
    filters.push(...assetFilters);
    interpretation.push(...assetInterpretation);
    const wantsAllAssets = /所有资产|全部资产|所有配置项|全部配置项/.test(text);
    if (!finalTypeIds.length && !filters.length && !wantsMac && !wantsAllAssets) {
      return reply.code(400).send({ message: unsupported });
    }

    const fields = ['asset_no', 'name', 'type_name', 'status', 'ip_address', 'model'];
    if (wantsMac) fields.push('mac_addresses');
    for (const filter of filters) {
      if (!fields.includes(filter.field) && !filter.field.startsWith('related:')) fields.push(filter.field);
    }
    if (finalTypeIds.length) addTypeInterpretation(finalTypeIds);
    else interpretation.push('资产类型：全部');
    interpretation.unshift(wantsMac ? '从资产清单输出主机 MAC 地址' : '查询资产清单');
    if (wantsMac) interpretation.push('MAC 地址取自资产网卡端口，可包含多块网卡');
    return {
      prompt,
      mode,
      query: { mode, source: 'asset', fields, filters, ci_type_ids: finalTypeIds },
      interpretation,
      warnings,
    };
  });
}
