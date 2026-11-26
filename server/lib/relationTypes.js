import { insertReturningId } from '../db/index.js';
import { nowIso, parseJson } from './helpers.js';

export const RELATION_TYPE_DEFAULTS = [
  { code: 'installed_on', name: '安装于', reverse_name: '承载', color: '#4f6ef7', description: '设备或软件安装在目标对象上', from: null, to: null },
  { code: 'runs_on', name: '运行于', reverse_name: '承载', color: '#14b8a6', description: '虚拟机运行于虚拟化平台或虚拟化宿主机；可用服务器通过「承载」归属于物理服务器', from: null, to: null },
  { code: 'depends_on', name: '依赖于', reverse_name: '被依赖', color: '#f59e0b', description: '业务或配置项依赖目标对象', from: null, to: null },
  { code: 'connects_to', name: '连接至', reverse_name: '连接来自', color: '#06b6d4', description: '网络、安全、服务器、存储与工控设备之间的物理链路或逻辑连接', from: null, to: null },
  { code: 'member_of', name: '归属于', reverse_name: '包含', color: '#8b5cf6', description: '机柜、组织等归属关系', from: null, to: null },
  { code: 'hosts', name: '承载', reverse_name: '运行于', color: '#10b981', description: '物理服务器承载安装好操作系统的可用服务器或虚拟化宿主机', from: null, to: null },
  { code: 'os_installed', name: '安装操作系统', reverse_name: '被安装于', color: '#64748b', description: '服务器、虚拟机或虚拟化宿主机安装的操作系统', from: null, to: 'os' },
  { code: 'software_installed', name: '安装软件', reverse_name: '被安装于', color: '#d946ef', description: '服务器或虚拟机上运行的软件', from: null, to: 'software' },
  { code: 'composed_of', name: '由物理服务器组成', reverse_name: '属于虚拟化平台', color: '#7c3aed', description: '历史关系：虚拟化平台与物理服务器的组成；新版本请使用虚拟化宿主机', from: 'virtualization', to: 'server' },
  { code: 'platform_host', name: '由虚拟化宿主机组成', reverse_name: '属于虚拟化平台', color: '#7c3aed', description: '虚拟化平台由一台或多台虚拟化宿主机组成', from: 'virtualization', to: 'virtualization_host' },
  { code: 'contains_vm', name: '包含虚拟机', reverse_name: '运行于虚拟化平台', color: '#0ea5a4', description: '虚拟化平台承载的虚拟机实例；宿主机关系使用「运行于」', from: 'virtualization', to: 'vm' },
  { code: 'business_runs_on', name: '运行于', reverse_name: '承载业务', color: '#ec4899', description: '业务系统运行在可用服务器或虚拟机上', from: 'business', to: null },
  { code: 'stores_on', name: '数据存放于', reverse_name: '存储数据', color: '#0ea5e9', description: '业务数据或备份数据存放在存储设备上', from: null, to: null },
];

const BUSINESS_FIELDS = [
  { field_key: 'business_code', label: '业务编码', field_type: 'text', group_name: '业务信息', show_in_list: true },
  { field_key: 'business_owner', label: '业务负责人', field_type: 'text', group_name: '业务信息', show_in_list: true },
  { field_key: 'user_count', label: '用户数量', field_type: 'number', group_name: '业务信息' },
  { field_key: 'service_level', label: '服务等级', field_type: 'select', options: ['核心', '重要', '一般'], group_name: '服务信息' },
  { field_key: 'service_window', label: '服务时间', field_type: 'text', group_name: '服务信息' },
];

const DATACENTER_FIELDS = [
  { field_key: 'city', label: '城市', field_type: 'text', group_name: '地图定位', show_in_list: true },
  { field_key: 'latitude', label: '纬度', field_type: 'number', group_name: '地图定位' },
  { field_key: 'longitude', label: '经度', field_type: 'number', group_name: '地图定位' },
];

const PATCH_PANEL_FIELDS = [
  { field_key: 'port_count', label: '端口数量', field_type: 'number', group_name: '端口配置', show_in_list: true },
  { field_key: 'port_type', label: '端口类型', field_type: 'select', options: ['RJ45', 'SFP', 'SFP+'], group_name: '端口配置', show_in_list: true },
  { field_key: 'wiring_standard', label: '配线标准', field_type: 'select', options: ['T568A', 'T568B', '光纤'], group_name: '端口配置' },
];

async function ensureFields(db, type, fields) {
  if (!type) return;
  const existing = await db('ci_field_defs').where({ ci_type_id: type.id }).select('field_key');
  const existingKeys = new Set(existing.map((row) => row.field_key));
  let sortOrder = existing.length + 1;
  const ts = nowIso();
  for (const field of fields) {
    if (existingKeys.has(field.field_key)) continue;
    await insertReturningId(db('ci_field_defs'), {
      ci_type_id: type.id,
      ...field,
      options: JSON.stringify(field.options || []),
      placeholder: '',
      required: false,
      show_in_list: Boolean(field.show_in_list),
      sort_order: sortOrder++,
      created_at: ts,
    });
  }
}

const CORE_CI_TYPES = [
  {
    code: 'storage',
    name: '存储设备',
    icon: 'Database',
    color: '#0ea5e9',
    description: 'SAN、NAS、DAS、分布式存储与备份存储',
    sort_order: 12,
    rackable: true,
  },
  {
    code: 'industrial',
    name: '工控设备',
    icon: 'Cpu',
    color: '#f97316',
    description: 'PLC、DCS、SCADA、采集网关等特殊工业控制设备',
    sort_order: 13,
    rackable: true,
  },
  {
    code: 'virtualization_host',
    name: '虚拟化宿主机',
    icon: 'MonitorCog',
    color: '#8b5cf6',
    description: '物理服务器安装 ESXi、Hyper-V、KVM 等虚拟化操作系统后形成的宿主机，可独立运行或加入虚拟化平台',
    sort_order: 14,
    rackable: false,
  },
  {
    code: 'patch_panel',
    name: '网络配线架',
    icon: 'Cable',
    color: '#14b8a6',
    description: 'RJ45、SFP、SFP+ 网络配线架，可上架机柜并连接网络链路',
    sort_order: 15,
    rackable: true,
  },
];

const VIRTUALIZATION_HOST_FIELDS = [
  { field_key: 'hypervisor_type', label: '虚拟化软件', field_type: 'select', options: ['VMware ESXi', 'Microsoft Hyper-V', 'KVM', 'Xen', 'FusionCompute'], group_name: '虚拟化信息', show_in_list: true },
  { field_key: 'hypervisor_version', label: '虚拟化版本', field_type: 'text', group_name: '虚拟化信息' },
  { field_key: 'deployment_mode', label: '部署模式', field_type: 'select', options: ['加入虚拟化平台', '独立宿主机'], group_name: '虚拟化信息', show_in_list: true },
  { field_key: 'cluster_name', label: '所属集群/平台', field_type: 'text', group_name: '虚拟化信息' },
  { field_key: 'cpu_cores', label: 'CPU 核心数', field_type: 'number', group_name: '资源信息' },
  { field_key: 'memory_gb', label: '内存 (GB)', field_type: 'number', group_name: '资源信息' },
];

async function ensureCoreType(db, definition) {
  let type = await db('ci_types').where({ code: definition.code }).first();
  if (type) return type;
  const ts = nowIso();
  const id = await insertReturningId(db('ci_types'), {
    ...definition,
    builtin: true,
    enabled: true,
    created_at: ts,
    updated_at: ts,
  });
  return db('ci_types').where({ id }).first();
}

async function ensureBusinessType(db) {
  let type = await db('ci_types').where({ code: 'business' }).first();
  if (!type) {
    const ts = nowIso();
    const id = await insertReturningId(db('ci_types'), {
      code: 'business',
      name: '业务系统',
      icon: 'BriefcaseBusiness',
      color: '#ec4899',
      description: '由用户自定义的业务服务及其承载关系',
      sort_order: 10,
      rackable: false,
      builtin: true,
      enabled: true,
      created_at: ts,
      updated_at: ts,
    });
    type = await db('ci_types').where({ id }).first();
  }
  await ensureFields(db, type, BUSINESS_FIELDS);
  return type;
}

const VM_LINK_FIELDS = [
  { field_key: 'cluster', label: '集群', field_type: 'ci_ref', options: ['virtualization'], group_name: '平台信息' },
  { field_key: 'host_ci_id', label: '宿主机', field_type: 'ci_ref', options: ['virtualization_host'], group_name: '平台信息' },
];

function referenceLookup(rows, extraKey) {
  const lookup = new Map();
  for (const row of rows) {
    const attrs = parseJson(row.attributes, {});
    const keys = [row.asset_no, row.name, extraKey ? attrs[extraKey] : null]
      .map((value) => String(value || '').trim().toLowerCase())
      .filter(Boolean);
    for (const key of keys) if (!lookup.has(key)) lookup.set(key, row.id);
  }
  return lookup;
}

async function ensureVmLinkFields(db) {
  const vmType = await db('ci_types').where({ code: 'vm' }).first();
  if (!vmType) return;
  const ts = nowIso();
  for (const [index, definition] of VM_LINK_FIELDS.entries()) {
    const existing = await db('ci_field_defs').where({ ci_type_id: vmType.id, field_key: definition.field_key }).first();
    if (existing) {
      await db('ci_field_defs').where({ id: existing.id }).update({
        label: definition.label,
        field_type: definition.field_type,
        options: JSON.stringify(definition.options),
        group_name: definition.group_name,
      });
    } else {
      const count = await db('ci_field_defs').where({ ci_type_id: vmType.id }).count({ count: '*' }).first();
      await insertReturningId(db('ci_field_defs'), {
        ci_type_id: vmType.id,
        ...definition,
        options: JSON.stringify(definition.options),
        required: false,
        show_in_list: false,
        sort_order: Number(count?.count || 0) + index + 1,
        created_at: ts,
      });
    }
  }

  const platformRows = await db('cis')
    .join('ci_types', 'cis.ci_type_id', 'ci_types.id')
    .select('cis.id', 'cis.asset_no', 'cis.name', 'cis.attributes')
    .where('ci_types.code', 'virtualization');
  const hostRows = await db('cis')
    .join('ci_types', 'cis.ci_type_id', 'ci_types.id')
    .select('cis.id', 'cis.asset_no', 'cis.name', 'cis.attributes')
    .where('ci_types.code', 'virtualization_host');
  const platformLookup = referenceLookup(platformRows, 'cluster_name');
  const hostLookup = referenceLookup(hostRows);
  const platformIds = new Set(platformRows.map((row) => row.id));
  const hostIds = new Set(hostRows.map((row) => row.id));
  const vms = await db('cis').where({ ci_type_id: vmType.id }).select('id', 'attributes');

  for (const vm of vms) {
    const attrs = parseJson(vm.attributes, {});
    let changed = false;
    for (const [fieldKey, ids, lookup] of [
      ['cluster', platformIds, platformLookup],
      ['host_ci_id', hostIds, hostLookup],
    ]) {
      if (attrs[fieldKey] === undefined || attrs[fieldKey] === null || attrs[fieldKey] === '') continue;
      const legacyKey = `${fieldKey}_legacy`;
      const numeric = Number(attrs[fieldKey]);
      if (Number.isInteger(numeric) && ids.has(numeric)) {
        if (attrs[fieldKey] !== numeric) {
          attrs[fieldKey] = numeric;
          changed = true;
        }
        if (Object.prototype.hasOwnProperty.call(attrs, legacyKey)) {
          delete attrs[legacyKey];
          changed = true;
        }
        continue;
      }
      const raw = String(attrs[fieldKey]).trim();
      const matched = lookup.get(raw.toLowerCase());
      if (matched) {
        attrs[fieldKey] = matched;
        if (Object.prototype.hasOwnProperty.call(attrs, legacyKey)) delete attrs[legacyKey];
        changed = true;
      } else {
        if (!Object.prototype.hasOwnProperty.call(attrs, legacyKey)) attrs[legacyKey] = raw;
        delete attrs[fieldKey];
        changed = true;
      }
    }
    if (changed) await db('cis').where({ id: vm.id }).update({ attributes: JSON.stringify(attrs) });
  }
}

export async function ensureRelationTypes(db) {
  await ensureBusinessType(db);
  for (const definition of CORE_CI_TYPES) {
    const type = await ensureCoreType(db, definition);
    if (definition.code === 'virtualization_host') await ensureFields(db, type, VIRTUALIZATION_HOST_FIELDS);
    if (definition.code === 'patch_panel') await ensureFields(db, type, PATCH_PANEL_FIELDS);
  }
  const datacenterType = await db('ci_types').where({ code: 'datacenter' }).first();
  await ensureFields(db, datacenterType, DATACENTER_FIELDS);
  await ensureVmLinkFields(db);
  const types = await db('ci_types').select('id', 'code');
  const typeMap = Object.fromEntries(types.map((type) => [type.code, type.id]));
  const existing = await db('ci_relation_types').select('code');
  const existingCodes = new Set(existing.map((row) => row.code));
  const ts = nowIso();
  for (const [index, relation] of RELATION_TYPE_DEFAULTS.entries()) {
    if (existingCodes.has(relation.code)) continue;
    await insertReturningId(db('ci_relation_types'), {
      code: relation.code,
      name: relation.name,
      reverse_name: relation.reverse_name,
      from_type_id: relation.from ? typeMap[relation.from] || null : null,
      to_type_id: relation.to ? typeMap[relation.to] || null : null,
      color: relation.color,
      description: relation.description,
      builtin: true,
      enabled: true,
      sort_order: index + 1,
      created_at: ts,
      updated_at: ts,
    });
  }
  const hostsDefinition = RELATION_TYPE_DEFAULTS.find((item) => item.code === 'hosts');
  const composedDefinition = RELATION_TYPE_DEFAULTS.find((item) => item.code === 'composed_of');
  if (hostsDefinition) {
    await db('ci_relation_types').where({ code: 'hosts', builtin: true }).update({ description: hostsDefinition.description });
  }
  if (composedDefinition) {
    await db('ci_relation_types').where({ code: 'composed_of', builtin: true }).update({ description: composedDefinition.description });
  }
  const runsOnDefinition = RELATION_TYPE_DEFAULTS.find((item) => item.code === 'runs_on');
  if (runsOnDefinition) {
    await db('ci_relation_types').where({ code: 'runs_on', builtin: true }).update({ description: runsOnDefinition.description });
  }
}
