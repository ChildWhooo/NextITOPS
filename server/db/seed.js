import bcrypt from 'bcryptjs';
import { createSchema } from './schema.js';
import { insertReturningId, db as defaultDb } from './index.js';
import { ROLE_PERMISSIONS, NOTIFICATION_EVENT_CODES, DEFAULT_NOTIFICATION_CHANNELS } from '../config.js';

const now = () => new Date().toISOString();
const hoursAgo = (h) => new Date(Date.now() - h * 3600 * 1000).toISOString();
const daysAgo = (d) => new Date(Date.now() - d * 86400 * 1000).toISOString();
const daysAhead = (d) => new Date(Date.now() + d * 86400 * 1000).toISOString();
const yearsAgo = (y) => {
  const date = new Date();
  date.setFullYear(date.getFullYear() - y);
  return date.toISOString().slice(0, 10);
};
const yearsAhead = (y) => {
  const date = new Date();
  date.setFullYear(date.getFullYear() + y);
  return date.toISOString().slice(0, 10);
};

const ALL_PERMISSIONS = ROLE_PERMISSIONS.map((permission) => permission.code);

function permissionsFor(codes) {
  return JSON.stringify(codes);
}

export async function resetDatabase(db) {
  const tables = [
    'notification_logs',
    'notification_channels',
    'zabbix_events',
    'zabbix_integrations',
    'ticket_deletion_requests',
    'deletion_policies',
    'system_settings',
    'maintenance_notices',
    'ci_deletion_requests',
    'datacenter_links',
    'ticket_relations',
    'ticket_cis',
    'ticket_attachments',
    'rich_attachments',
    'ip_assets',
    'ip_subnets',
    'ip_assignment_history',
    'ticket_comments',
    'ticket_stage_history',
    'tickets',
    'workflow_stages',
    'workflows',
    'rack_placements',
    'rack_profiles',
    'ci_network_ports',
    'ci_relations',
    'ci_change_logs',
    'ci_acl',
    'ci_ips',
    'cis',
    'ci_field_defs',
    'ci_relation_types',
    'ci_types',
    'audit_logs',
    'users',
    'roles',
  ];
  for (const table of tables) {
    if (await db.schema.hasTable(table)) await db(table).del();
  }
  if (db.client.config.client === 'better-sqlite3') {
    try {
      await db.raw("DELETE FROM sqlite_sequence WHERE name IN ('roles','users','ci_types','ci_relation_types','ci_field_defs','cis','ci_relations','rack_profiles','rack_placements','ci_network_ports','workflows','workflow_stages','tickets','ticket_comments','ticket_attachments','rich_attachments','ip_assets','ip_subnets','ticket_stage_history','ticket_cis','ticket_relations','ticket_deletion_requests','deletion_policies','system_settings','maintenance_notices','ci_deletion_requests','datacenter_links','zabbix_integrations','zabbix_events','audit_logs','notification_channels','notification_logs','ci_change_logs','ci_acl','ci_ips')");
    } catch {
      // sqlite_sequence is absent on a brand-new database.
    }
  }
}

export async function seedDatabase(db = defaultDb, { reset = false } = {}) {
  await createSchema(db);
  if (reset) await resetDatabase(db);

  const existing = await db('users').count({ count: '*' }).first();
  if (Number(existing?.count || 0) > 0) {
    console.log('[seed] users already exist, skip seeding');
    return;
  }

  const ts = now();
  const adminHash = bcrypt.hashSync('admin123', 10);
  const demoHash = bcrypt.hashSync('demo123', 10);

  const roleRows = [
    {
      code: 'admin',
      name: '系统管理员',
      description: '拥有平台全部管理权限，可配置模型、流程与集成。',
      permissions: permissionsFor(ALL_PERMISSIONS),
      is_system: true,
    },
    {
      code: 'ops',
      name: 'IT 运维工程师',
      description: '负责资产维护、事件处理、问题分析与变更实施。',
      permissions: permissionsFor([
        'dashboard.view',
        'cmdb.view',
        'cmdb.edit',
        'cmdb.import',
        'itsm.view',
        'itsm.create',
        'itsm.edit',
      ]),
      is_system: true,
    },
    {
      code: 'approver',
      name: '变更审批人',
      description: '负责 CAB 审批与发布风险把关。',
      permissions: permissionsFor(['dashboard.view', 'cmdb.view', 'itsm.view', 'itsm.approve']),
      is_system: true,
    },
    {
      code: 'auditor',
      name: '审计管理员',
      description: '仅可查看审计日志，不具备业务编辑权限。',
      permissions: permissionsFor(['system.audit_view']),
      is_system: true,
    },
    {
      code: 'employee',
      name: '普通员工',
      description: '自助提交事件、查看本人相关工单。',
      permissions: permissionsFor(['dashboard.view', 'cmdb.view', 'itsm.view', 'itsm.create']),
      is_system: true,
    },
  ];
  const roleIds = {};
  for (const role of roleRows) {
    roleIds[role.code] = await insertReturningId(db('roles'), {
      ...role,
      created_at: ts,
      updated_at: ts,
    });
  }

  await insertReturningId(db('deletion_policies'), {
    approver_role_ids: JSON.stringify([roleIds.approver]),
    updated_by: null,
    updated_at: ts,
  });

  const userRows = [
    {
      username: 'admin',
      password_hash: adminHash,
      name: '林奕辰',
      email: 'admin@nextitops.local',
      phone: '138-0000-0001',
      department: '信息技术部',
      title: 'ITSM 平台管理员',
      role_id: roleIds.admin,
      avatar_color: '#4f6ef7',
      last_login_at: daysAgo(1),
    },
    {
      username: 'zhangwei',
      password_hash: demoHash,
      name: '张伟',
      email: 'zhangwei@nextitops.local',
      phone: '138-0000-0012',
      department: 'IT 运维中心',
      title: '高级运维工程师',
      role_id: roleIds.ops,
      avatar_color: '#0ea5a4',
      last_login_at: daysAgo(2),
    },
    {
      username: 'lina',
      password_hash: demoHash,
      name: '李娜',
      email: 'lina@nextitops.local',
      phone: '138-0000-0023',
      department: '信息技术部',
      title: 'IT 服务经理 / CAB',
      role_id: roleIds.approver,
      avatar_color: '#8b5cf6',
      last_login_at: daysAgo(1),
    },
    {
      username: 'wangqiang',
      password_hash: demoHash,
      name: '王强',
      email: 'wangqiang@nextitops.local',
      phone: '138-0000-0034',
      department: '财务部',
      title: '财务共享中心主管',
      role_id: roleIds.employee,
      avatar_color: '#f59e0b',
      last_login_at: daysAgo(3),
    },
    {
      username: 'chenjing',
      password_hash: demoHash,
      name: '陈静',
      email: 'chenjing@nextitops.local',
      phone: '138-0000-0045',
      department: '人力资源部',
      title: 'HRBP',
      role_id: roleIds.employee,
      avatar_color: '#ec4899',
    },
    {
      username: 'liuyang',
      password_hash: demoHash,
      name: '刘洋',
      email: 'liuyang@nextitops.local',
      phone: '138-0000-0056',
      department: 'IT 运维中心',
      title: '网络与安全工程师',
      role_id: roleIds.ops,
      avatar_color: '#10b981',
    },
    {
      username: 'auditor',
      password_hash: demoHash,
      name: '审计专员',
      email: 'auditor@nextitops.local',
      phone: '138-0000-0067',
      department: '信息安全部',
      title: '审计管理员',
      role_id: roleIds.auditor,
      avatar_color: '#64748b',
    },
  ];
  const userIds = {};
  for (const user of userRows) {
    userIds[user.username] = await insertReturningId(db('users'), {
      ...user,
      status: 'active',
      password_changed_at: ts,
      created_at: ts,
      updated_at: ts,
    });
  }

  const typeRows = [
    { code: 'server', name: '服务器', icon: 'Server', color: '#4f6ef7', description: '物理服务器、小型机与关键计算节点', sort_order: 1, rackable: true },
    { code: 'network', name: '网络设备', icon: 'Network', color: '#06b6d4', description: '交换机、路由器、负载均衡与无线设备', sort_order: 2, rackable: true },
    { code: 'security', name: '信息安全设备', icon: 'ShieldCheck', color: '#f43f5e', description: '防火墙、WAF、堡垒机与审计设备', sort_order: 3, rackable: true },
    { code: 'datacenter', name: '数据中心', icon: 'Building2', color: '#8b5cf6', description: '生产与灾备数据中心、机房空间', sort_order: 4, rackable: false },
    { code: 'rack', name: '机柜', icon: 'Grid3X3', color: '#f59e0b', description: '机柜容量、U 位编排与设备上架信息', sort_order: 5, rackable: false },
    { code: 'vm', name: '虚拟机', icon: 'Boxes', color: '#14b8a6', description: '虚拟化平台上的计算实例', sort_order: 6, rackable: false },
    { code: 'os', name: '操作系统', icon: 'MonitorCog', color: '#64748b', description: '操作系统许可证与补丁基线', sort_order: 7, rackable: false },
    { code: 'software', name: '软件', icon: 'AppWindow', color: '#d946ef', description: '商业软件、许可证与自研应用', sort_order: 8, rackable: false },
    { code: 'virtualization', name: '虚拟化平台', icon: 'Layers3', color: '#7c3aed', description: 'vSphere、FusionCompute、KVM 等虚拟化集群/平台，不对应单台宿主机', sort_order: 9, rackable: false },
    { code: 'business', name: '业务系统', icon: 'BriefcaseBusiness', color: '#ec4899', description: '由用户自定义的业务服务及其承载关系', sort_order: 10, rackable: false },
    { code: 'ip', name: '网络IP资产', icon: 'Network', color: '#0ea5e9', description: '按网段自动登记的 IP 地址台账', sort_order: 11, rackable: false },
    { code: 'storage', name: '存储设备', icon: 'Database', color: '#0ea5e9', description: 'SAN、NAS、DAS 等集中式或直连存储', sort_order: 12, rackable: true },
    { code: 'industrial', name: '工控设备', icon: 'Cpu', color: '#f97316', description: '工业控制、OT、PLC 等特殊生产设备', sort_order: 13, rackable: true },
    { code: 'virtualization_host', name: '虚拟化宿主机', icon: 'MonitorCog', color: '#8b5cf6', description: '物理服务器安装虚拟化操作系统后形成的宿主机，可独立运行或加入虚拟化平台', sort_order: 14, rackable: false },
    { code: 'patch_panel', name: '网络配线架', icon: 'Cable', color: '#14b8a6', description: 'RJ45、SFP、SFP+ 网络配线架，可上架机柜并连接网络链路', sort_order: 15, rackable: true },
  ];
  const typeIds = {};
  for (const row of typeRows) {
    typeIds[row.code] = await insertReturningId(db('ci_types'), {
      ...row,
      builtin: true,
      enabled: true,
      created_at: ts,
      updated_at: ts,
    });
  }

  const fieldDefs = {
    server: [
      { field_key: 'cpu_arch', label: 'CPU 架构', field_type: 'select', options: ['x86_64', 'ARM64', 'POWER'], group_name: '硬件配置', show_in_list: true },
      { field_key: 'rack_unit', label: '机架规格 (U)', field_type: 'select', options: ['1U', '2U', '4U', '8U'], group_name: '硬件配置' },
      { field_key: 'power_watts', label: '额定功率 (W)', field_type: 'number', group_name: '硬件配置' },
      { field_key: 'backup_policy', label: '备份策略', field_type: 'select', options: ['每日全量', '每日增量', '每周全量', '无'], group_name: '运维信息' },
      { field_key: 'is_virtualization_host', label: '虚拟化宿主机', field_type: 'select', options: ['是', '否'], group_name: '运维信息', show_in_list: true },
    ],
    network: [
      { field_key: 'port_count', label: '端口数量', field_type: 'number', group_name: '端口与链路' },
      { field_key: 'firmware_version', label: '固件版本', field_type: 'text', group_name: '设备信息' },
      { field_key: 'uplink', label: '上联链路', field_type: 'text', group_name: '端口与链路' },
      { field_key: 'is_core', label: '是否核心节点', field_type: 'select', options: ['是', '否'], group_name: '设备信息', show_in_list: true },
    ],
    security: [
      { field_key: 'license_end', label: '特征库 / 授权到期', field_type: 'date', group_name: '授权信息' },
      { field_key: 'rule_count', label: '安全策略条数', field_type: 'number', group_name: '运行信息' },
      { field_key: 'ha_mode', label: '高可用模式', field_type: 'select', options: ['主备', '双主', '单机'], group_name: '运行信息' },
      { field_key: 'security_zone', label: '安全区域', field_type: 'text', group_name: '运行信息' },
    ],
    datacenter: [
      { field_key: 'city', label: '城市', field_type: 'text', group_name: '地图定位', show_in_list: true },
      { field_key: 'latitude', label: '纬度', field_type: 'number', group_name: '地图定位' },
      { field_key: 'longitude', label: '经度', field_type: 'number', group_name: '地图定位' },
      { field_key: 'area_sqm', label: '机房面积 (㎡)', field_type: 'number', group_name: '机房资源' },
      { field_key: 'power_capacity', label: '供电容量 (kVA)', field_type: 'number', group_name: '机房资源' },
      { field_key: 'cooling', label: '制冷方式', field_type: 'select', options: ['行级空调', '房间级精密空调', '液冷'], group_name: '机房资源' },
      { field_key: 'tier_level', label: '机房等级', field_type: 'select', options: ['Tier III', 'Tier IV', '企业标准'], group_name: '合规信息' },
    ],
    rack: [
      { field_key: 'capacity_u', label: '机柜容量 (U)', field_type: 'number', group_name: '容量信息', show_in_list: true },
      { field_key: 'used_u', label: '已用 U 数', field_type: 'number', group_name: '容量信息' },
      { field_key: 'power_phase', label: '供电制式', field_type: 'select', options: ['单相 32A', '三相 32A', '三相 63A'], group_name: '电气信息' },
      { field_key: 'max_power_kw', label: '最大功率 (kW)', field_type: 'number', group_name: '电气信息' },
    ],
    vm: [
      { field_key: 'vcpu', label: 'vCPU 核数', field_type: 'number', group_name: '虚拟资源', show_in_list: true },
      { field_key: 'memory_gb', label: '内存 (GB)', field_type: 'number', group_name: '虚拟资源' },
      { field_key: 'hypervisor', label: '虚拟化平台', field_type: 'select', options: ['VMware vSphere', 'Northstar iECS', 'KVM', 'Hyper-V'], group_name: '平台信息' },
      { field_key: 'cluster', label: '集群', field_type: 'ci_ref', options: ['virtualization'], group_name: '平台信息' },
      { field_key: 'host_ci_id', label: '宿主机', field_type: 'ci_ref', options: ['virtualization_host'], group_name: '平台信息' },
    ],
    os: [
      { field_key: 'kernel_version', label: '内核版本', field_type: 'text', group_name: '系统基线' },
      { field_key: 'license_type', label: '授权类型', field_type: 'select', options: ['订阅', '永久授权', '开源'], group_name: '授权信息' },
      { field_key: 'patch_level', label: '补丁基线', field_type: 'text', group_name: '系统基线' },
      { field_key: 'eol_date', label: 'EOL 日期', field_type: 'date', group_name: '生命周期' },
    ],
    software: [
      { field_key: 'version', label: '软件版本', field_type: 'text', group_name: '版本与授权', show_in_list: true },
      { field_key: 'license_type', label: '授权模式', field_type: 'select', options: ['按用户', '按设备', '订阅', '开源'], group_name: '版本与授权' },
      { field_key: 'license_count', label: '授权数量', field_type: 'number', group_name: '版本与授权' },
      { field_key: 'license_end', label: '授权到期', field_type: 'date', group_name: '版本与授权' },
      { field_key: 'vendor_url', label: '厂商支持地址', field_type: 'text', group_name: '支持信息' },
    ],
    virtualization: [
      { field_key: 'platform_type', label: '平台类型', field_type: 'select', options: ['VMware vSphere', 'Northstar iECS', 'KVM', 'Hyper-V', 'Nutanix AHV'], group_name: '平台信息', show_in_list: true },
      { field_key: 'version', label: '平台版本', field_type: 'text', group_name: '平台信息' },
      { field_key: 'cluster_name', label: '集群名称', field_type: 'text', group_name: '平台信息' },
      { field_key: 'ha_enabled', label: 'HA 高可用', field_type: 'select', options: ['已启用', '未启用'], group_name: '运行状态' },
      { field_key: 'host_count', label: '物理主机数量', field_type: 'number', group_name: '运行状态' },
    ],
    virtualization_host: [
      { field_key: 'hypervisor_type', label: '虚拟化软件', field_type: 'select', options: ['VMware ESXi', 'Microsoft Hyper-V', 'KVM', 'Xen', 'FusionCompute'], group_name: '虚拟化信息', show_in_list: true },
      { field_key: 'hypervisor_version', label: '虚拟化版本', field_type: 'text', group_name: '虚拟化信息' },
      { field_key: 'deployment_mode', label: '部署模式', field_type: 'select', options: ['加入虚拟化平台', '独立宿主机'], group_name: '虚拟化信息', show_in_list: true },
      { field_key: 'cluster_name', label: '所属集群/平台', field_type: 'text', group_name: '虚拟化信息' },
      { field_key: 'cpu_cores', label: 'CPU 核心数', field_type: 'number', group_name: '资源信息' },
      { field_key: 'memory_gb', label: '内存 (GB)', field_type: 'number', group_name: '资源信息' },
    ],
    patch_panel: [
      { field_key: 'port_count', label: '端口数量', field_type: 'number', group_name: '端口配置', show_in_list: true },
      { field_key: 'port_type', label: '端口类型', field_type: 'select', options: ['RJ45', 'SFP', 'SFP+'], group_name: '端口配置', show_in_list: true },
      { field_key: 'wiring_standard', label: '配线标准', field_type: 'select', options: ['T568A', 'T568B', '光纤'], group_name: '端口配置' },
    ],
    business: [
      { field_key: 'business_code', label: '业务编码', field_type: 'text', group_name: '业务信息', show_in_list: true },
      { field_key: 'business_owner', label: '业务负责人', field_type: 'text', group_name: '业务信息', show_in_list: true },
      { field_key: 'user_count', label: '用户数量', field_type: 'number', group_name: '业务信息' },
      { field_key: 'service_level', label: '服务等级', field_type: 'select', options: ['核心', '重要', '一般'], group_name: '服务信息' },
      { field_key: 'service_window', label: '服务时间', field_type: 'text', group_name: '服务信息' },
    ],
    ip: [
      { field_key: 'subnet', label: '所属网段', field_type: 'text', group_name: '网络信息', show_in_list: true },
      { field_key: 'gateway', label: '网关', field_type: 'text', group_name: '网络信息' },
      { field_key: 'vlan', label: 'VLAN', field_type: 'text', group_name: '网络信息', show_in_list: true },
      { field_key: 'ip_status', label: '地址状态', field_type: 'select', options: ['已使用', '空闲', '保留', '冲突'], group_name: '地址信息', show_in_list: true },
      { field_key: 'mac_address', label: '绑定 MAC', field_type: 'text', group_name: '地址信息' },
    ],
  };
  for (const [code, fields] of Object.entries(fieldDefs)) {
    let index = 1;
    for (const field of fields) {
      await insertReturningId(db('ci_field_defs'), {
        ci_type_id: typeIds[code],
        ...field,
        options: JSON.stringify(field.options || []),
        placeholder: field.placeholder || '',
        required: false,
        show_in_list: field.show_in_list || false,
        sort_order: index++,
        created_at: ts,
      });
    }
  }

  const ciRows = [
    // Servers
    { asset_no: 'SRV-PROD-001', name: '核心业务应用服务器', type: 'server', status: 'in_use', criticality: 'critical', env: 'production', owner: 'zhangwei', department: 'IT 运维中心', location: '上海张江 · A01-18U', vendor: 'Northstar', model: 'NX-2000', serial: 'SN-NX2000-001', ip: '10.20.1.11', os: 'Red Hat Enterprise Linux 9.3', cpu: '2 × 64C 通用处理器', memory: '256 GB', disk: '2 × 1.92 TB NVMe RAID1', buy: yearsAgo(2), warranty: yearsAhead(1), cost: 128000, attrs: { cpu_arch: 'x86_64', rack_unit: '2U', power_watts: 800, backup_policy: '每日增量' }, desc: 'ERP 与订单核心应用集群节点，承载生产流量。' },
    { asset_no: 'SRV-DB-001', name: '核心数据库主服务器', type: 'server', status: 'in_use', criticality: 'critical', env: 'production', owner: 'zhangwei', department: 'IT 运维中心', location: '上海张江 · A01-20U', vendor: 'Northstar', model: 'NX-2100', serial: 'SN-NX2100-001', ip: '10.20.1.21', os: 'Oracle Linux 8.9', cpu: '2 × 96C 通用处理器', memory: '512 GB', disk: '4 × 3.84 TB SSD RAID10', buy: yearsAgo(1), warranty: yearsAhead(2), cost: 268000, attrs: { cpu_arch: 'x86_64', rack_unit: '2U', power_watts: 1100, backup_policy: '每日全量' }, desc: 'Oracle 19c RAC 主节点，核心交易数据库。' },
    { asset_no: 'SRV-DB-002', name: '核心数据库备服务器', type: 'server', status: 'in_use', criticality: 'critical', env: 'production', owner: 'zhangwei', department: 'IT 运维中心', location: '上海张江 · A01-22U', vendor: 'Northstar', model: 'NX-2100', serial: 'SN-NX2100-002', ip: '10.20.1.22', os: 'Oracle Linux 8.9', cpu: '2 × 96C 通用处理器', memory: '512 GB', disk: '4 × 3.84 TB SSD RAID10', buy: yearsAgo(1), warranty: yearsAhead(2), cost: 268000, attrs: { cpu_arch: 'x86_64', rack_unit: '2U', power_watts: 1100, backup_policy: '每日全量' }, desc: 'Oracle 19c RAC 备节点，Data Guard 实时同步。' },
    { asset_no: 'SRV-MON-001', name: '统一监控平台服务器', type: 'server', status: 'in_use', criticality: 'high', env: 'production', owner: 'liuyang', department: 'IT 运维中心', location: '上海张江 · A02-08U', vendor: 'Northstar', model: 'NX-2300', serial: 'SN-NX2300-001', ip: '10.20.2.31', os: 'Ubuntu Server 24.04 LTS', cpu: '2 × 24C 通用处理器', memory: '128 GB', disk: '2 × 960 GB SSD RAID1', buy: yearsAgo(1), warranty: yearsAhead(2), cost: 72000, attrs: { cpu_arch: 'x86_64', rack_unit: '2U', power_watts: 560, backup_policy: '每周全量' }, desc: 'Zabbix 7 与日志采集平台，纳管全网设备。' },
    { asset_no: 'SRV-FILE-001', name: '企业文件共享服务器', type: 'server', status: 'maintenance', criticality: 'medium', env: 'production', owner: 'zhangwei', department: 'IT 运维中心', location: '上海张江 · A02-10U', vendor: 'Northstar', model: 'NX-2200', serial: 'SN-NX2200-001', ip: '10.20.2.41', os: 'Windows Server 2022', cpu: '2 × 24C 通用处理器', memory: '64 GB', disk: '8 × 4 TB SAS RAID6', buy: yearsAgo(4), warranty: yearsAgo(1), cost: 88000, attrs: { cpu_arch: 'x86_64', rack_unit: '2U', power_watts: 650, backup_policy: '每日增量' }, desc: '部门共享盘与项目资料归档，计划扩容。' },
    { asset_no: 'SRV-BACKUP-001', name: '备份一体机', type: 'server', status: 'in_use', criticality: 'high', env: 'production', owner: 'liuyang', department: 'IT 运维中心', location: '上海张江 · B01-12U', vendor: 'Northstar', model: 'NX-STOR-100', serial: 'SN-NXSTOR-001', ip: '10.20.3.51', os: 'Northstar Backup OS 4.1', cpu: '2 × 24C 通用处理器', memory: '128 GB', disk: '96 TB 可用', buy: yearsAgo(2), warranty: yearsAhead(1), cost: 360000, attrs: { cpu_arch: 'x86_64', rack_unit: '4U', power_watts: 1200, backup_policy: '每日全量' }, desc: '核心系统本地备份与异地复制。' },
    // Network
    { asset_no: 'NET-CORE-01', name: '数据中心核心交换机 A', type: 'network', status: 'in_use', criticality: 'critical', env: 'production', owner: 'liuyang', department: 'IT 运维中心', location: '上海张江 · A01-01U', vendor: 'Aeris', model: 'AN-8000', serial: 'SN-AN8000-001', ip: '10.20.0.2', os: 'AerisOS 8.0', cpu: '', memory: '32 GB', disk: '', buy: yearsAgo(3), warranty: yearsAhead(1), cost: 185000, attrs: { port_count: 52, firmware_version: 'V800R023', uplink: '2 × 100G 上行至核心', is_core: '是' }, desc: '生产区核心交换节点，堆叠组主设备。' },
    { asset_no: 'NET-CORE-02', name: '数据中心核心交换机 B', type: 'network', status: 'in_use', criticality: 'critical', env: 'production', owner: 'liuyang', department: 'IT 运维中心', location: '上海张江 · A01-02U', vendor: 'Aeris', model: 'AN-8000', serial: 'SN-AN8000-002', ip: '10.20.0.3', os: 'AerisOS 8.0', cpu: '', memory: '32 GB', disk: '', buy: yearsAgo(3), warranty: yearsAhead(1), cost: 185000, attrs: { port_count: 52, firmware_version: 'V800R023', uplink: '2 × 100G 上行至核心', is_core: '是' }, desc: '生产区核心交换节点，堆叠组备设备。' },
    { asset_no: 'NET-ACCESS-01', name: '办公区汇聚交换机', type: 'network', status: 'in_use', criticality: 'high', env: 'production', owner: 'liuyang', department: 'IT 运维中心', location: '上海张江 · A02-01U', vendor: 'Aeris', model: 'AN-5500', serial: 'SN-AN5500-001', ip: '10.20.0.11', os: 'AerisOS 7.1', cpu: '', memory: '4 GB', disk: '', buy: yearsAgo(2), warranty: yearsAhead(1), cost: 42000, attrs: { port_count: 54, firmware_version: '7.1.070', uplink: '2 × 40G 上行', is_core: '否' }, desc: '办公区 1-3 层有线接入汇聚。' },
    { asset_no: 'NET-LB-01', name: '应用负载均衡器', type: 'network', status: 'in_use', criticality: 'high', env: 'production', owner: 'zhangwei', department: 'IT 运维中心', location: '上海张江 · A01-06U', vendor: 'Aeris', model: 'ALB-1000', serial: 'SN-ALB1000-001', ip: '10.20.0.21', os: 'AerisLB 7.0', cpu: '', memory: '32 GB', disk: '', buy: yearsAgo(2), warranty: yearsAhead(1), cost: 210000, attrs: { port_count: 8, firmware_version: '7.0', uplink: '2 × 40G', is_core: '是' }, desc: '门户与 ERP 应用七层负载均衡。' },
    { asset_no: 'NET-WLC-01', name: '无线控制器', type: 'network', status: 'in_use', criticality: 'medium', env: 'production', owner: 'liuyang', department: 'IT 运维中心', location: '深圳南山 · SZ-A01-20U', vendor: 'Aeris', model: 'AW-500', serial: 'SN-AW500-001', ip: '10.20.0.31', os: 'AerisOS 6.2', cpu: '', memory: '16 GB', disk: '', buy: yearsAgo(1), warranty: yearsAhead(2), cost: 68000, attrs: { port_count: 12, firmware_version: 'V200R023', uplink: '2 × 10G', is_core: '否' }, desc: '园区 86 台 AP 的集中管理与认证。' },
    { asset_no: 'NET-BJ-01', name: '北京灾备核心交换机', type: 'network', status: 'in_use', criticality: 'high', env: 'dr', owner: 'liuyang', department: 'IT 运维中心', location: '北京亦庄 · BJ-A01-22U', vendor: 'Aeris', model: 'AN-5500', serial: 'SN-AN5500-002', ip: '10.30.0.2', os: 'AerisOS 7.1', cpu: '', memory: '8 GB', disk: '', buy: yearsAgo(2), warranty: yearsAhead(2), cost: 56000, attrs: { port_count: 30, firmware_version: '7.1.070', uplink: '2 × 40G', is_core: '是' }, desc: '灾备中心核心交换与跨站互联节点。' },
    // Security
    { asset_no: 'SEC-FW-01', name: '边界下一代防火墙', type: 'security', status: 'in_use', criticality: 'critical', env: 'production', owner: 'liuyang', department: '信息安全部', location: '上海张江 · A01-04U', vendor: 'Aegis', model: 'AG-FW-2000', serial: 'SN-AGFW-001', ip: '10.20.0.251', os: 'AegisOS 8.0', cpu: '', memory: '64 GB', disk: '', buy: yearsAgo(2), warranty: yearsAhead(1), cost: 420000, attrs: { license_end: yearsAhead(1), rule_count: 386, ha_mode: '主备', security_zone: 'Trust / Untrust / DMZ' }, desc: '互联网边界主动-被动高可用集群。' },
    { asset_no: 'SEC-WAF-01', name: 'Web 应用防火墙', type: 'security', status: 'in_use', criticality: 'high', env: 'production', owner: 'liuyang', department: '信息安全部', location: '上海张江 · A01-08U', vendor: 'Aegis', model: 'AG-WAF-1000', serial: 'SN-AGWAF-001', ip: '10.20.0.252', os: 'AegisWAF 7.0', cpu: '', memory: '32 GB', disk: '', buy: yearsAgo(2), warranty: yearsAhead(1), cost: 180000, attrs: { license_end: yearsAhead(1), rule_count: 128, ha_mode: '主备', security_zone: 'DMZ' }, desc: '对外 Web 业务防护与 Bot 管理。' },
    { asset_no: 'SEC-BASTION-01', name: '运维堡垒机', type: 'security', status: 'in_use', criticality: 'high', env: 'production', owner: 'liuyang', department: '信息安全部', location: '上海张江 · A02-05U', vendor: 'Aegis', model: 'AG-SDP-1000', serial: 'SN-AGSDP-001', ip: '10.20.0.253', os: 'AegisSDP 5.6', cpu: '', memory: '16 GB', disk: '2 TB', buy: yearsAgo(2), warranty: yearsAhead(1), cost: 96000, attrs: { license_end: yearsAhead(1), rule_count: 42, ha_mode: '主备', security_zone: '运维区' }, desc: '运维人员双因子认证与操作审计入口。' },
    { asset_no: 'SEC-IDS-01', name: '入侵检测与流量分析', type: 'security', status: 'maintenance', criticality: 'medium', env: 'production', owner: 'liuyang', department: '信息安全部', location: '北京亦庄 · BJ-A01-20U', vendor: 'Aegis', model: 'AG-SOC-200', serial: 'SN-AGSOC-001', ip: '10.20.0.254', os: 'AegisSOC 6.0', cpu: '', memory: '32 GB', disk: '8 TB', buy: yearsAgo(3), warranty: yearsAgo(1), cost: 150000, attrs: { license_end: daysAhead(35).slice(0, 10), rule_count: 9210, ha_mode: '单机', security_zone: '核心区旁路' }, desc: '东西向流量检测与威胁情报联动，特征库即将到期。' },
    // Datacenter
    { asset_no: 'DC-SH-01', name: '上海张江主数据中心', type: 'datacenter', status: 'in_use', criticality: 'critical', env: 'production', owner: 'zhangwei', department: 'IT 基础设施部', location: '上海市浦东新区张江高科技园区', vendor: '自建', model: '自建 A 级机房', serial: '', ip: '10.20.0.0/16', os: '', cpu: '', memory: '', disk: '', buy: yearsAgo(6), warranty: '', cost: 0, attrs: { city: '上海', latitude: 31.2304, longitude: 121.4737, area_sqm: 1200, power_capacity: 1600, cooling: '行级空调', tier_level: 'Tier III' }, desc: '承载核心生产系统，双路市电与 2N UPS。' },
    { asset_no: 'DC-BJ-01', name: '北京亦庄灾备中心', type: 'datacenter', status: 'in_use', criticality: 'high', env: 'dr', owner: 'zhangwei', department: 'IT 基础设施部', location: '北京市大兴区亦庄经济开发区', vendor: '自建', model: '自建 B 级机房', serial: '', ip: '10.30.0.0/16', os: '', cpu: '', memory: '', disk: '', buy: yearsAgo(4), warranty: '', cost: 0, attrs: { city: '北京', latitude: 39.9042, longitude: 116.4074, area_sqm: 680, power_capacity: 800, cooling: '房间级精密空调', tier_level: 'Tier III' }, desc: '核心系统异地灾备，RTO 4 小时。' },
    { asset_no: 'DC-SZ-01', name: '深圳南山数据中心', type: 'datacenter', status: 'in_use', criticality: 'high', env: 'production', owner: 'liuyang', department: 'IT 基础设施部', location: '深圳市南山区科技园', vendor: '自建', model: '自建 A 级机房', serial: '', ip: '10.40.0.0/16', os: '', cpu: '', memory: '', disk: '', buy: yearsAgo(3), warranty: '', cost: 0, attrs: { city: '深圳', latitude: 22.5431, longitude: 114.0579, area_sqm: 520, power_capacity: 600, cooling: '行级空调', tier_level: 'Tier III' }, desc: '华南区域业务接入节点，承载园区网络与边缘安全设备。' },
    // Racks
    { asset_no: 'RACK-SH-A01', name: '张江 A01 生产机柜', type: 'rack', status: 'in_use', criticality: 'high', env: 'production', owner: 'zhangwei', department: 'IT 基础设施部', location: '上海张江 · A 区', vendor: 'Vertex', model: 'VR-47U', serial: 'RACK-A01', ip: '', os: '', cpu: '', memory: '', disk: '', buy: yearsAgo(5), warranty: '', cost: 12000, attrs: { capacity_u: 47, used_u: 31, power_phase: '三相 32A', max_power_kw: 12 }, desc: '核心服务器机柜，冷通道封闭。' },
    { asset_no: 'RACK-SH-A02', name: '张江 A02 生产机柜', type: 'rack', status: 'in_use', criticality: 'high', env: 'production', owner: 'zhangwei', department: 'IT 基础设施部', location: '上海张江 · A 区', vendor: 'Vertex', model: 'VR-47U', serial: 'RACK-A02', ip: '', os: '', cpu: '', memory: '', disk: '', buy: yearsAgo(5), warranty: '', cost: 12000, attrs: { capacity_u: 47, used_u: 22, power_phase: '三相 32A', max_power_kw: 12 }, desc: '监控、接入与运维设备机柜。' },
    { asset_no: 'RACK-SH-B01', name: '张江 B01 存储机柜', type: 'rack', status: 'in_use', criticality: 'medium', env: 'production', owner: 'zhangwei', department: 'IT 基础设施部', location: '上海张江 · B 区', vendor: 'Vertex', model: 'VR-47U', serial: 'RACK-B01', ip: '', os: '', cpu: '', memory: '', disk: '', buy: yearsAgo(4), warranty: '', cost: 15000, attrs: { capacity_u: 47, used_u: 28, power_phase: '三相 63A', max_power_kw: 18 }, desc: '备份与存储设备机柜。' },
    { asset_no: 'RACK-BJ-A01', name: '北京 BJ-A01 灾备机柜', type: 'rack', status: 'in_use', criticality: 'high', env: 'dr', owner: 'zhangwei', department: 'IT 基础设施部', location: '北京亦庄 · A 区', vendor: 'Vertex', model: 'VR-47U', serial: 'RACK-BJ-A01', ip: '', os: '', cpu: '', memory: '', disk: '', buy: yearsAgo(4), warranty: '', cost: 12000, attrs: { capacity_u: 47, used_u: 8, power_phase: '三相 32A', max_power_kw: 10 }, desc: '灾备核心网络与安全设备机柜。' },
    { asset_no: 'RACK-SZ-A01', name: '深圳 SZ-A01 接入机柜', type: 'rack', status: 'in_use', criticality: 'medium', env: 'production', owner: 'liuyang', department: 'IT 基础设施部', location: '深圳南山 · A 区', vendor: 'Vertex', model: 'VR-47U', serial: 'RACK-SZ-A01', ip: '', os: '', cpu: '', memory: '', disk: '', buy: yearsAgo(3), warranty: '', cost: 11000, attrs: { capacity_u: 47, used_u: 6, power_phase: '单相 32A', max_power_kw: 8 }, desc: '华南接入网络与无线控制设备机柜。' },
    // VMs
    { asset_no: 'VM-ERP-APP01', name: 'ERP 应用节点 01', type: 'vm', status: 'in_use', criticality: 'critical', env: 'production', owner: 'zhangwei', department: 'IT 运维中心', location: 'VMware Cluster PROD-01', vendor: 'VMware', model: 'vSphere VM', serial: '4210a1b2-1c3d', ip: '10.20.10.11', os: 'RHEL 9.3', cpu: '8 vCPU', memory: '32 GB', disk: '500 GB', buy: yearsAgo(1), warranty: '', cost: 0, attrs: { vcpu: 8, memory_gb: 32, hypervisor: 'VMware vSphere', cluster: 'PROD-01' }, desc: 'ERP 应用集群无状态节点，位于核心业务服务器。' },
    { asset_no: 'VM-ERP-APP02', name: 'ERP 应用节点 02', type: 'vm', status: 'in_use', criticality: 'critical', env: 'production', owner: 'zhangwei', department: 'IT 运维中心', location: 'VMware Cluster PROD-01', vendor: 'VMware', model: 'vSphere VM', serial: '4210a1b2-1c3e', ip: '10.20.10.12', os: 'RHEL 9.3', cpu: '8 vCPU', memory: '32 GB', disk: '500 GB', buy: yearsAgo(1), warranty: '', cost: 0, attrs: { vcpu: 8, memory_gb: 32, hypervisor: 'VMware vSphere', cluster: 'PROD-01' }, desc: 'ERP 应用集群节点，参与负载均衡。' },
    { asset_no: 'VM-OA-01', name: '协同办公平台', type: 'vm', status: 'in_use', criticality: 'high', env: 'production', owner: 'zhangwei', department: 'IT 运维中心', location: 'VMware Cluster PROD-02', vendor: 'VMware', model: 'vSphere VM', serial: '4210c3d4-2e5f', ip: '10.20.10.31', os: 'Windows Server 2022', cpu: '8 vCPU', memory: '24 GB', disk: '300 GB', buy: yearsAgo(2), warranty: '', cost: 0, attrs: { vcpu: 8, memory_gb: 24, hypervisor: 'VMware vSphere', cluster: 'PROD-02' }, desc: 'OA 与流程审批平台。' },
    { asset_no: 'VM-CMDB-01', name: 'CMDB 与 ITSM 平台', type: 'vm', status: 'in_use', criticality: 'high', env: 'production', owner: 'admin', department: '信息技术部', location: 'VMware Cluster PROD-02', vendor: 'VMware', model: 'vSphere VM', serial: '4210c3d4-2e60', ip: '10.20.10.40', os: 'Ubuntu Server 24.04', cpu: '8 vCPU', memory: '16 GB', disk: '200 GB', buy: yearsAgo(1), warranty: '', cost: 0, attrs: { vcpu: 8, memory_gb: 16, hypervisor: 'VMware vSphere', cluster: 'PROD-02' }, desc: 'NextITOps 本系统运行节点。' },
    { asset_no: 'VM-DEV-01', name: '研发测试环境', type: 'vm', status: 'idle', criticality: 'low', env: 'test', owner: 'zhangwei', department: '研发中心', location: 'VMware Cluster DEV-01', vendor: 'VMware', model: 'vSphere VM', serial: '4210d5e6-3f70', ip: '10.20.20.15', os: 'Ubuntu Server 22.04', cpu: '4 vCPU', memory: '8 GB', disk: '160 GB', buy: yearsAgo(1), warranty: '', cost: 0, attrs: { vcpu: 4, memory_gb: 8, hypervisor: 'VMware vSphere', cluster: 'DEV-01' }, desc: '研发联调环境，按需开机。' },
    // OS
    { asset_no: 'OS-RHEL-001', name: 'RHEL 9 数据中心订阅', type: 'os', status: 'in_use', criticality: 'high', env: 'production', owner: 'zhangwei', department: 'IT 运维中心', location: '生产服务器', vendor: 'Red Hat', model: 'RHEL Server', serial: 'RH-ENT-2024-018', ip: '', os: 'Red Hat Enterprise Linux 9', cpu: '', memory: '', disk: '', buy: yearsAgo(2), warranty: yearsAhead(1), cost: 56000, attrs: { kernel_version: '5.14.0-427', license_type: '订阅', patch_level: '2026-Q3 基线', eol_date: '2032-05-31' }, desc: '核心服务器操作系统订阅，覆盖 12 套实例。' },
    { asset_no: 'OS-WIN-001', name: 'Windows Server 2022 Datacenter', type: 'os', status: 'in_use', criticality: 'medium', env: 'production', owner: 'zhangwei', department: 'IT 运维中心', location: '生产服务器', vendor: 'Microsoft', model: 'Windows Server Datacenter', serial: 'WIN-DC-2022-004', ip: '', os: 'Windows Server 2022', cpu: '', memory: '', disk: '', buy: yearsAgo(2), warranty: yearsAhead(1), cost: 78000, attrs: { kernel_version: '10.0.20348', license_type: '永久授权', patch_level: '2026-10 累积更新', eol_date: '2031-10-14' }, desc: '文件服务与 OA 系统 Windows 授权池。' },
    { asset_no: 'OS-UBUNTU-001', name: 'Ubuntu Server 24.04 LTS', type: 'os', status: 'in_use', criticality: 'medium', env: 'production', owner: 'liuyang', department: 'IT 运维中心', location: '监控与平台节点', vendor: 'Canonical', model: 'Ubuntu LTS', serial: 'UBUNTU-2404-011', ip: '', os: 'Ubuntu Server 24.04 LTS', cpu: '', memory: '', disk: '', buy: yearsAgo(1), warranty: yearsAhead(4), cost: 0, attrs: { kernel_version: '6.8.0-51', license_type: '开源', patch_level: '2026-10 安全更新', eol_date: '2029-04-25' }, desc: '监控、容器与运维工具标准操作系统。' },
    // Software
    { asset_no: 'SW-ERP-001', name: 'SAP S/4HANA 企业资源计划', type: 'software', status: 'in_use', criticality: 'critical', env: 'production', owner: 'wangqiang', department: '财务部', location: '上海张江', vendor: 'SAP', model: 'S/4HANA 2023 FPS02', serial: 'SAP-S4-2023-001', ip: '', os: '', cpu: '', memory: '', disk: '', buy: yearsAgo(2), warranty: yearsAhead(1), cost: 1680000, attrs: { version: '2023 FPS02', license_type: '按用户', license_count: 500, license_end: yearsAhead(1), vendor_url: 'https://support.sap.com' }, desc: '集团财务与供应链核心系统。' },
    { asset_no: 'SW-OA-001', name: '协同办公系统', type: 'software', status: 'in_use', criticality: 'high', env: 'production', owner: 'chenjing', department: '信息技术部', location: '上海张江', vendor: '致远互联', model: 'A8+ 协同管理', serial: 'OA-A8P-2024', ip: '', os: '', cpu: '', memory: '', disk: '', buy: yearsAgo(2), warranty: yearsAhead(1), cost: 320000, attrs: { version: 'A8+ 8.2', license_type: '按用户', license_count: 1200, license_end: yearsAhead(1), vendor_url: 'https://www.seeyon.com' }, desc: '全员协同办公、流程与知识管理。' },
    { asset_no: 'SW-ZBX-001', name: 'Zabbix 企业级监控平台', type: 'software', status: 'in_use', criticality: 'high', env: 'production', owner: 'liuyang', department: 'IT 运维中心', location: '上海张江', vendor: 'Zabbix', model: 'Zabbix Enterprise', serial: 'ZBX-ENT-7', ip: '', os: '', cpu: '', memory: '', disk: '', buy: yearsAgo(1), warranty: yearsAhead(1), cost: 85000, attrs: { version: '7.0 LTS', license_type: '订阅', license_count: 1, license_end: yearsAhead(1), vendor_url: 'https://www.zabbix.com' }, desc: '全网基础设施与业务可用性监控。' },
    { asset_no: 'SW-DB-001', name: 'Oracle Database 19c', type: 'software', status: 'in_use', criticality: 'critical', env: 'production', owner: 'zhangwei', department: 'IT 运维中心', location: '上海张江', vendor: 'Oracle', model: 'Oracle Database Enterprise', serial: 'ORA-19C-ENT-001', ip: '', os: '', cpu: '', memory: '', disk: '', buy: yearsAgo(2), warranty: yearsAhead(2), cost: 960000, attrs: { version: '19.23', license_type: '按设备', license_count: 2, license_end: yearsAhead(2), vendor_url: 'https://support.oracle.com' }, desc: '核心交易库企业版授权，RAC 双节点。' },
    { asset_no: 'SW-BACKUP-001', name: 'Veritas NetBackup', type: 'software', status: 'in_use', criticality: 'high', env: 'production', owner: 'liuyang', department: 'IT 运维中心', location: '上海张江', vendor: 'Veritas', model: 'NetBackup 10.4', serial: 'NBU-104-ENT', ip: '', os: '', cpu: '', memory: '', disk: '', buy: yearsAgo(2), warranty: yearsAhead(1), cost: 260000, attrs: { version: '10.4', license_type: '按设备', license_count: 40, license_end: yearsAhead(1), vendor_url: 'https://www.veritas.com' }, desc: '核心系统备份与恢复管理。' },
    { asset_no: 'VIRT-PROD-01', name: 'VMware vSphere 生产平台 PROD-01', type: 'virtualization', status: 'in_use', criticality: 'critical', env: 'production', owner: 'zhangwei', department: 'IT 运维中心', location: '上海张江 · 生产虚拟化集群', vendor: 'VMware', model: 'vSphere 8.0 U3', serial: 'VSP-PROD-01', ip: '10.20.1.5', os: 'VMware ESXi 8.0 U3', cpu: '2 × 64C 通用处理器', memory: '512 GB', disk: '8 × 1.92TB NVMe', buy: yearsAgo(2), warranty: yearsAhead(1), cost: 0, attrs: { platform_type: 'VMware vSphere', version: '8.0 U3', cluster_name: 'PROD-01', ha_enabled: '已启用', host_count: 1 }, desc: '生产虚拟化平台，承载 ERP 应用、OA 与 ITSM 等虚拟机。' },
    { asset_no: 'VHOST-PROD-01', name: 'PROD-01 虚拟化宿主机 01', type: 'virtualization_host', status: 'in_use', criticality: 'critical', env: 'production', owner: 'zhangwei', department: 'IT 运维中心', location: '上海张江 · 生产虚拟化集群', vendor: 'VMware', model: 'ESXi 8.0 U3', serial: 'ESXI-PROD-01', ip: '10.20.1.11', os: 'VMware ESXi 8.0 U3', cpu: '2 × 64C 通用处理器', memory: '512 GB', disk: '8 × 1.92TB NVMe', buy: yearsAgo(2), warranty: yearsAhead(1), cost: 0, attrs: { hypervisor_type: 'VMware ESXi', hypervisor_version: '8.0 U3', deployment_mode: '加入虚拟化平台', cluster_name: 'PROD-01', cpu_cores: 64, memory_gb: 512 }, desc: '生产虚拟化平台成员宿主机，由带外物理服务器承载。' },
    { asset_no: 'SRV-SPARE-001', name: '待上架备件服务器', type: 'server', status: 'idle', criticality: 'low', env: 'test', owner: 'zhangwei', department: 'IT 运维中心', location: '上海张江 · 待上架区', vendor: 'Northstar', model: 'NX-2500', serial: 'SN-NX2500-001', ip: '10.20.9.10', os: '未安装', cpu: '2 × 64C 通用处理器', memory: '64 GB', disk: '2 × 960 GB SSD', buy: yearsAgo(1), warranty: yearsAhead(2), cost: 58000, attrs: { cpu_arch: 'x86_64', rack_unit: '2U', power_watts: 500, backup_policy: '无' }, desc: '备用服务器，等待分配机柜与业务。' },
    // Business services
    { asset_no: 'BIZ-ERP', name: 'ERP 企业资源计划', type: 'business', status: 'in_use', criticality: 'critical', env: 'production', owner: 'wangqiang', department: '财务部', location: '上海张江', vendor: 'SAP', model: 'S/4HANA', serial: 'BIZ-ERP-001', ip: '', os: '', cpu: '', memory: '', disk: '', buy: yearsAgo(2), warranty: '', cost: 0, attrs: { business_code: 'ERP', business_owner: '王强', user_count: 860, service_level: '核心', service_window: '7×24' }, desc: '集团财务、采购与供应链核心业务。' },
    { asset_no: 'BIZ-OA', name: 'OA 协同办公', type: 'business', status: 'in_use', criticality: 'high', env: 'production', owner: 'chenjing', department: '信息技术部', location: '上海张江', vendor: '致远互联', model: 'A8+', serial: 'BIZ-OA-001', ip: '', os: '', cpu: '', memory: '', disk: '', buy: yearsAgo(2), warranty: '', cost: 0, attrs: { business_code: 'OA', business_owner: '陈静', user_count: 1200, service_level: '重要', service_window: '7×24' }, desc: '全员协同办公、流程审批与知识管理。' },
    { asset_no: 'BIZ-CRM', name: 'CRM 客户关系管理', type: 'business', status: 'in_use', criticality: 'high', env: 'production', owner: 'wangqiang', department: '市场部', location: '上海张江', vendor: '销售易', model: 'Neocrm', serial: 'BIZ-CRM-001', ip: '', os: '', cpu: '', memory: '', disk: '', buy: yearsAgo(1), warranty: '', cost: 0, attrs: { business_code: 'CRM', business_owner: '王强', user_count: 320, service_level: '重要', service_window: '08:00-22:00' }, desc: '销售线索、商机与客户服务主业务。' },
  ];

  const bmcAddresses = {
    'SRV-PROD-001': '10.30.1.11',
    'SRV-DB-001': '10.30.1.21',
    'SRV-DB-002': '10.30.1.22',
    'SRV-MON-001': '10.30.1.31',
    'SRV-FILE-001': '10.30.1.41',
    'SRV-BACKUP-001': '10.30.1.51',
    'NET-CORE-01': '10.30.0.11',
    'NET-CORE-02': '10.30.0.12',
    'NET-ACCESS-01': '10.30.0.21',
    'NET-BJ-01': '10.30.0.31',
    'SEC-FW-01': '10.30.0.61',
    'SEC-WAF-01': '10.30.0.62',
    'SEC-BASTION-01': '10.30.0.63',
  };
  for (const row of ciRows) {
    row.bmc = bmcAddresses[row.asset_no] || '';
    if (row.type === 'server') {
      row.attrs = {
        ...(row.attrs || {}),
        is_virtualization_host: row.asset_no === 'SRV-PROD-001' ? '是' : '否',
      };
    }
  }

  const ciIds = {};
  for (const row of ciRows) {
    const id = await insertReturningId(db('cis'), {
      asset_no: row.asset_no,
      name: row.name,
      ci_type_id: typeIds[row.type],
      status: row.status,
      criticality: row.criticality,
      environment: row.env,
      owner_id: userIds[row.owner] || userIds.zhangwei,
      department: row.department,
      location: row.location,
      vendor: row.vendor,
      model: row.model,
      serial_no: row.serial,
      ip_address: row.ip,
      mac_address: '',
      bmc_address: row.bmc || '',
      os_name: row.os,
      cpu: row.cpu,
      memory: row.memory,
      disk: row.disk,
      purchase_date: row.buy,
      warranty_end: row.warranty,
      cost: row.cost,
      description: row.desc,
      attributes: JSON.stringify(row.attrs),
      created_by: userIds.admin,
      created_at: daysAgo(Math.floor(Math.random() * 400) + 20),
      updated_at: daysAgo(Math.floor(Math.random() * 30)),
    });
    ciIds[row.asset_no] = id;
  }

  const relationTypeDefs = [
    { code: 'installed_on', name: '安装于', reverse_name: '承载', color: '#4f6ef7', description: '设备或软件安装在目标对象上', from_type_id: null, to_type_id: null },
    { code: 'runs_on', name: '运行于', reverse_name: '承载', color: '#14b8a6', description: '虚拟机运行于虚拟化平台或虚拟化宿主机；可用服务器通过「承载」归属于物理服务器', from_type_id: null, to_type_id: null },
    { code: 'depends_on', name: '依赖于', reverse_name: '被依赖', color: '#f59e0b', description: '业务或配置项依赖目标对象', from_type_id: null, to_type_id: null },
    { code: 'connects_to', name: '连接至', reverse_name: '连接来自', color: '#06b6d4', description: '网络或链路连接关系', from_type_id: null, to_type_id: null },
    { code: 'member_of', name: '归属于', reverse_name: '包含', color: '#8b5cf6', description: '机柜、人员、组织等归属关系', from_type_id: null, to_type_id: null },
    { code: 'hosts', name: '承载', reverse_name: '运行于', color: '#10b981', description: '物理服务器承载安装好操作系统的可用服务器或虚拟化宿主机', from_type_id: null, to_type_id: null },
    { code: 'os_installed', name: '安装操作系统', reverse_name: '被安装于', color: '#64748b', description: '服务器或虚拟机安装的操作系统', from_type_id: null, to_type_id: typeIds.os },
    { code: 'software_installed', name: '安装软件', reverse_name: '被安装于', color: '#d946ef', description: '服务器或虚拟机上运行的软件', from_type_id: null, to_type_id: typeIds.software },
    { code: 'composed_of', name: '由物理服务器组成', reverse_name: '属于虚拟化平台', color: '#7c3aed', description: '历史关系：虚拟化平台与物理服务器的组成；新版本请使用虚拟化宿主机', from_type_id: typeIds.virtualization, to_type_id: typeIds.server },
    { code: 'platform_host', name: '由虚拟化宿主机组成', reverse_name: '属于虚拟化平台', color: '#7c3aed', description: '虚拟化平台由一台或多台虚拟化宿主机组成', from_type_id: typeIds.virtualization, to_type_id: typeIds.virtualization_host },
    { code: 'contains_vm', name: '包含虚拟机', reverse_name: '运行于虚拟化平台', color: '#0ea5a4', description: '虚拟化平台承载的虚拟机实例；宿主机关系使用「运行于」', from_type_id: typeIds.virtualization, to_type_id: typeIds.vm },
    { code: 'business_runs_on', name: '运行于', reverse_name: '承载业务', color: '#ec4899', description: '业务系统运行在可用服务器或虚拟机上', from_type_id: typeIds.business, to_type_id: null },
  ];
  for (const [index, relationType] of relationTypeDefs.entries()) {
    await insertReturningId(db('ci_relation_types'), {
      ...relationType,
      builtin: true,
      enabled: true,
      sort_order: index + 1,
      created_at: ts,
      updated_at: ts,
    });
  }

  const relationRows = [
    ['SRV-PROD-001', 'RACK-SH-A01', 'installed_on', '标准 2U 上架'],
    ['SRV-DB-001', 'RACK-SH-A01', 'installed_on', '核心数据库机架位'],
    ['SRV-DB-002', 'RACK-SH-A01', 'installed_on', '核心数据库机架位'],
    ['SRV-MON-001', 'RACK-SH-A02', 'installed_on', '监控节点上架'],
    ['SRV-FILE-001', 'RACK-SH-A02', 'installed_on', '文件服务器上架'],
    ['SRV-BACKUP-001', 'RACK-SH-B01', 'installed_on', '备份一体机'],
    ['NET-CORE-01', 'RACK-SH-A01', 'installed_on', '核心网络区'],
    ['NET-CORE-02', 'RACK-SH-A01', 'installed_on', '核心网络区'],
    ['NET-ACCESS-01', 'RACK-SH-A02', 'installed_on', '接入汇聚'],
    ['SEC-FW-01', 'RACK-SH-A01', 'installed_on', '边界安全区'],
    ['SEC-WAF-01', 'RACK-SH-A01', 'installed_on', 'DMZ 安全区'],
    ['SEC-BASTION-01', 'RACK-SH-A02', 'installed_on', '运维安全区'],
    ['RACK-SH-A01', 'DC-SH-01', 'member_of', 'A 区生产机柜'],
    ['RACK-SH-A02', 'DC-SH-01', 'member_of', 'A 区生产机柜'],
    ['RACK-SH-B01', 'DC-SH-01', 'member_of', 'B 区存储机柜'],
    ['RACK-BJ-A01', 'DC-BJ-01', 'member_of', '北京灾备机柜'],
    ['RACK-SZ-A01', 'DC-SZ-01', 'member_of', '深圳接入机柜'],
    ['NET-BJ-01', 'RACK-BJ-A01', 'installed_on', '灾备核心交换上架'],
    ['SEC-IDS-01', 'RACK-BJ-A01', 'installed_on', '灾备安全设备上架'],
    ['NET-WLC-01', 'RACK-SZ-A01', 'installed_on', '华南无线控制上架'],
    ['VM-ERP-APP01', 'VIRT-PROD-01', 'runs_on', '运行于生产虚拟化平台'],
    ['VM-ERP-APP02', 'VIRT-PROD-01', 'runs_on', '运行于生产虚拟化平台'],
    ['VM-ERP-APP01', 'NET-LB-01', 'depends_on', '由负载均衡分发流量'],
    ['VM-OA-01', 'VIRT-PROD-01', 'runs_on', '运行于生产虚拟化平台'],
    ['VM-CMDB-01', 'VIRT-PROD-01', 'runs_on', '运行于生产虚拟化平台'],
    ['VM-DEV-01', 'VIRT-PROD-01', 'runs_on', '运行于测试虚拟化集群'],
    ['SW-ERP-001', 'VM-ERP-APP01', 'installed_on', 'ERP 应用部署'],
    ['SW-OA-001', 'VM-OA-01', 'installed_on', 'OA 应用部署'],
    ['SW-ZBX-001', 'SRV-MON-001', 'installed_on', 'Zabbix 服务端'],
    ['SW-DB-001', 'SRV-DB-001', 'installed_on', 'Oracle RAC 主节点'],
    ['SW-BACKUP-001', 'SRV-BACKUP-001', 'installed_on', '备份软件服务端'],
    ['OS-RHEL-001', 'SRV-PROD-001', 'depends_on', '操作系统订阅覆盖'],
    ['OS-WIN-001', 'SRV-FILE-001', 'depends_on', 'Windows 授权覆盖'],
    ['NET-ACCESS-01', 'NET-CORE-01', 'connects_to', '双上行至核心'],
    ['SEC-FW-01', 'NET-CORE-01', 'connects_to', '边界互联'],
    ['SRV-PROD-001', 'OS-RHEL-001', 'os_installed', '核心业务服务器操作系统订阅'],
    ['VM-ERP-APP01', 'OS-RHEL-001', 'os_installed', 'ERP 虚拟机操作系统基线'],
    ['VM-OA-01', 'OS-WIN-001', 'os_installed', 'OA 虚拟机 Windows 基线'],
    ['VM-ERP-APP01', 'SW-ERP-001', 'software_installed', 'ERP 应用部署'],
    ['VM-OA-01', 'SW-OA-001', 'software_installed', 'OA 应用部署'],
    ['SRV-PROD-001', 'VHOST-PROD-01', 'hosts', '物理服务器承载虚拟化宿主机'],
    ['VIRT-PROD-01', 'VHOST-PROD-01', 'platform_host', '虚拟化平台由宿主机组成'],
    ['VIRT-PROD-01', 'VM-ERP-APP01', 'contains_vm', '生产虚拟化平台中的 ERP 节点'],
    ['VIRT-PROD-01', 'VM-ERP-APP02', 'contains_vm', '生产虚拟化平台中的 ERP 节点'],
    ['VIRT-PROD-01', 'VM-OA-01', 'contains_vm', '生产虚拟化平台中的 OA 节点'],
    ['VIRT-PROD-01', 'VM-CMDB-01', 'contains_vm', '生产虚拟化平台中的 ITSM 节点'],
    ['BIZ-ERP', 'SRV-PROD-001', 'business_runs_on', 'ERP 应用服务器'],
    ['BIZ-ERP', 'SRV-DB-001', 'business_runs_on', 'ERP 核心数据库主节点'],
    ['BIZ-ERP', 'SRV-DB-002', 'business_runs_on', 'ERP 核心数据库备节点'],
    ['BIZ-OA', 'SRV-PROD-001', 'business_runs_on', 'OA 应用服务器'],
    ['BIZ-CRM', 'SRV-PROD-001', 'business_runs_on', 'CRM 应用服务器'],
    ['BIZ-CRM', 'SRV-DB-002', 'business_runs_on', 'CRM 数据库节点'],
  ];
  for (const [source, target, type, desc] of relationRows) {
    if (!ciIds[source] || !ciIds[target]) continue;
    await insertReturningId(db('ci_relations'), {
      source_ci_id: ciIds[source],
      target_ci_id: ciIds[target],
      relation_type: type,
      description: desc,
      created_at: daysAgo(10),
    });
  }

  const rackProfiles = [
    { rack: 'RACK-SH-A01', datacenter: 'DC-SH-01', capacity: 47, numbering: 'bottom_up' },
    { rack: 'RACK-SH-A02', datacenter: 'DC-SH-01', capacity: 47, numbering: 'bottom_up' },
    { rack: 'RACK-SH-B01', datacenter: 'DC-SH-01', capacity: 47, numbering: 'top_down' },
    { rack: 'RACK-BJ-A01', datacenter: 'DC-BJ-01', capacity: 47, numbering: 'bottom_up' },
    { rack: 'RACK-SZ-A01', datacenter: 'DC-SZ-01', capacity: 47, numbering: 'bottom_up' },
  ];
  for (const profile of rackProfiles) {
    await insertReturningId(db('rack_profiles'), {
      ci_id: ciIds[profile.rack],
      datacenter_id: ciIds[profile.datacenter],
      capacity_u: profile.capacity,
      numbering: profile.numbering,
      notes: profile.numbering === 'top_down' ? '1U 位于机柜顶部，向下递增' : '1U 位于机柜底部，向上递增',
      created_at: ts,
      updated_at: ts,
    });
  }

  const placementRows = [
    ['SRV-PROD-001', 'RACK-SH-A01', 20, 2],
    ['SRV-DB-001', 'RACK-SH-A01', 24, 2],
    ['SRV-DB-002', 'RACK-SH-A01', 27, 2],
    ['NET-CORE-01', 'RACK-SH-A01', 38, 1],
    ['NET-CORE-02', 'RACK-SH-A01', 40, 1],
    ['SEC-FW-01', 'RACK-SH-A01', 34, 2],
    ['SEC-WAF-01', 'RACK-SH-A01', 32, 1],
    ['NET-LB-01', 'RACK-SH-A01', 36, 1],
    ['SRV-MON-001', 'RACK-SH-A02', 20, 2],
    ['SRV-FILE-001', 'RACK-SH-A02', 24, 2],
    ['NET-ACCESS-01', 'RACK-SH-A02', 30, 1],
    ['SEC-BASTION-01', 'RACK-SH-A02', 32, 1],
    ['SRV-BACKUP-001', 'RACK-SH-B01', 10, 4],
    ['NET-BJ-01', 'RACK-BJ-A01', 22, 1],
    ['SEC-IDS-01', 'RACK-BJ-A01', 20, 1],
    ['NET-WLC-01', 'RACK-SZ-A01', 20, 1],
  ];
  for (const [ci, rack, startU, height] of placementRows) {
    if (!ciIds[ci] || !ciIds[rack]) continue;
    await insertReturningId(db('rack_placements'), {
      rack_id: ciIds[rack],
      ci_id: ciIds[ci],
      start_u: startU,
      u_height: height,
      side: 'front',
      notes: '',
      created_at: daysAgo(20),
      updated_at: daysAgo(5),
    });
  }

  const portRows = [
    { ci: 'SRV-PROD-001', name: 'eth0', type: 'ethernet', mac: '00:1A:2B:3C:01:10', speed: 10000, current: 10000, switch: 'NET-CORE-01', switchPort: 'GE1/0/1', status: 'up', source: 'zabbix' },
    { ci: 'SRV-PROD-001', name: 'eth1', type: 'fiber', mac: '00:1A:2B:3C:01:11', speed: 10000, current: 10000, switch: 'NET-CORE-02', switchPort: 'GE1/0/1', status: 'up', source: 'zabbix' },
    { ci: 'SRV-PROD-001', name: 'eth2', type: 'ethernet', mac: '00:1A:2B:3C:01:12', speed: 1000, current: 0, switch: 'NET-ACCESS-01', switchPort: 'GE1/0/12', status: 'down', source: 'zabbix' },
    { ci: 'SRV-PROD-001', name: 'BMC0', type: 'bmc', mac: '00:1A:2B:3C:01:1A', speed: 1000, current: 1000, switch: 'NET-ACCESS-01', switchPort: 'GE1/0/24', status: 'up', source: 'zabbix' },
    { ci: 'SRV-DB-001', name: 'eno1', type: 'ethernet', mac: 'D0:67:E5:11:22:01', speed: 10000, current: 10000, switch: 'NET-CORE-01', switchPort: 'GE1/0/11', status: 'up', source: 'zabbix' },
    { ci: 'SRV-DB-001', name: 'eno2', type: 'fiber', mac: 'D0:67:E5:11:22:02', speed: 10000, current: 10000, switch: 'NET-CORE-02', switchPort: 'GE1/0/11', status: 'up', source: 'zabbix' },
    { ci: 'SRV-MON-001', name: 'eno1', type: 'ethernet', mac: '6C:92:BF:33:44:01', speed: 10000, current: 10000, switch: 'NET-ACCESS-01', switchPort: 'XGE1/0/28', status: 'up', source: 'zabbix' },
    { ci: 'SEC-FW-01', name: 'ethernet1/1', type: 'fiber', mac: '00:1B:17:AA:BB:01', speed: 10000, current: 10000, switch: 'NET-CORE-01', switchPort: 'GE1/0/20', status: 'up', source: 'zabbix' },
    { ci: 'SEC-FW-01', name: 'ethernet1/2', type: 'fiber', mac: '00:1B:17:AA:BB:02', speed: 10000, current: 10000, switch: 'NET-CORE-02', switchPort: 'GE1/0/20', status: 'up', source: 'zabbix' },
    { ci: 'SEC-FW-01', name: 'mgmt', type: 'management', mac: '00:1B:17:AA:BB:10', speed: 1000, current: 1000, switch: 'NET-ACCESS-01', switchPort: 'GE1/0/30', status: 'up', source: 'zabbix' },
    { ci: 'SEC-WAF-01', name: 'mgmt', type: 'management', mac: '00:0C:29:CC:DD:01', speed: 1000, current: 1000, switch: 'NET-ACCESS-01', switchPort: 'GE1/0/31', status: 'up', source: 'manual' },
    { ci: 'NET-CORE-01', name: 'mgmt0', type: 'management', mac: 'F0:9E:63:11:00:01', speed: 1000, current: 1000, switch: 'NET-ACCESS-01', switchPort: 'GE1/0/48', status: 'up', source: 'manual' },
    { ci: 'NET-ACCESS-01', name: 'mgmt0', type: 'management', mac: 'F0:9E:63:22:00:01', speed: 1000, current: 1000, switch: 'NET-CORE-01', switchPort: 'GE1/0/48', status: 'up', source: 'manual' },
  ];
  for (const port of portRows) {
    if (!ciIds[port.ci]) continue;
    await insertReturningId(db('ci_network_ports'), {
      ci_id: ciIds[port.ci],
      port_name: port.name,
      port_type: port.type,
      mac_address: port.mac,
      speed_mbps: port.speed,
      current_speed_mbps: port.current,
      connected_switch_id: ciIds[port.switch] || null,
      connected_switch_port: port.switchPort,
      link_status: port.status,
      source: port.source,
      last_synced_at: port.source === 'zabbix' ? hoursAgo(0.5) : null,
      notes: '',
      created_at: daysAgo(30),
      updated_at: hoursAgo(0.5),
    });
  }

  for (const [settingKey, settingValue] of [
    ['system_name', 'NextITOps'],
    ['system_logo', '/logo.svg'],
    ['system_description', '让配置、告警与服务流程在一个清晰的工作台里协同运转。'],
    ['system_subtitle', 'SERVICE INTELLIGENCE'],
    ['login_headline', '让每一次变更，都有据可依。'],
    ['login_background', ''],
    ['login_gradient', 'aurora'],
    ['login_copyright', ''],
    ['login_status_text', ''],
    ['default_sidebar_theme', 'ink'],
    ['ticket_sources', JSON.stringify([
      { value: 'portal', label: '服务门户' },
      { value: 'im', label: 'IM 报障' },
      { value: 'phone', label: '电话' },
      { value: 'email', label: '邮件' },
      { value: 'monitoring', label: '监控系统' },
      { value: 'zabbix', label: 'Zabbix' },
      { value: 'inspection', label: '巡检' },
      { value: 'admin', label: '管理员创建' },
    ])],
    ['base_data', ''],
    ['syslog_config', JSON.stringify({ enabled: false, host: '', port: 514, protocol: 'udp', facility: 1 })],
    ['third_party_config', JSON.stringify({ amap_web_key: '', amap_js_key: '', amap_security_code: '' })],
    ['login_security', JSON.stringify({ max_failures: 8, lock_minutes: 15, ip_whitelist: '', ip_blacklist: '' })],
    ['custom_privacy', ''],
    ['nav_labels', '{}'],
    ['password_policy', JSON.stringify({ min_length: 10, require_upper: true, require_lower: true, require_number: true, require_symbol: true, expire_days: 90, notify_user: true })],
    ['custom_map_svg', ''],
    ['sidebar_collapsed_width', '104'],
  ]) {
    await insertReturningId(db('system_settings'), {
      setting_key: settingKey,
      setting_value: settingValue,
      updated_at: ts,
    });
  }

  await insertReturningId(db('maintenance_notices'), {
    title: '核心数据库平台例行维护',
    content: '计划对本系统核心数据库执行补丁升级与容量扩展。维护期间 CMDB 查询与工单审批可能出现短暂中断，请提前保存工作内容。',
    start_at: daysAhead(2),
    end_at: daysAhead(2.1),
    status: 'planned',
    notify_users: false,
    notified_at: null,
    created_by: userIds.admin,
    created_at: ts,
    updated_at: ts,
  });

  const datacenterLinkRows = [
    { source: 'DC-SH-01', target: 'DC-BJ-01', name: '上海—北京灾备专线', carrier: '中国电信', bandwidth: 1000, status: 'up', sourceType: 'manual', metric: '' },
    { source: 'DC-SH-01', target: 'DC-SZ-01', name: '上海—深圳生产专线', carrier: '中国移动', bandwidth: 1000, status: 'degraded', sourceType: 'zabbix', zabbixCi: 'NET-CORE-02', metric: 'net.if.status[ifOperStatus]' },
    { source: 'DC-BJ-01', target: 'DC-SZ-01', name: '北京—深圳灾备专线', carrier: '中国联通', bandwidth: 500, status: 'up', sourceType: 'manual', metric: '' },
  ];
  for (const link of datacenterLinkRows) {
    await insertReturningId(db('datacenter_links'), {
      source_dc_id: ciIds[link.source],
      target_dc_id: ciIds[link.target],
      name: link.name,
      carrier: link.carrier,
      bandwidth_mbps: link.bandwidth,
      status: link.status,
      source: link.sourceType,
      zabbix_ci_id: link.zabbixCi ? ciIds[link.zabbixCi] : null,
      zabbix_metric: link.metric,
      notes: '',
      created_at: ts,
      updated_at: ts,
    });
  }

  const workflowDefs = [
    {
      name: '标准事件处理流程',
      code: 'INC-STD',
      type: 'incident',
      description: '面向最终用户的标准事件受理、诊断与恢复流程。',
      default: true,
      stages: [
        { key: 'triage', name: '事件受理', type: 'start', seq: 1, color: '#0ea5e9', desc: '登记事件、判断影响与优先级', sla: 1, assignee: 'ops' },
        { key: 'diagnose', name: '诊断处理', type: 'task', seq: 2, color: '#4f6ef7', desc: '一线/二线协作定位并恢复服务', sla: 4, assignee: 'ops' },
        { key: 'resolve', name: '解决确认', type: 'task', seq: 3, color: '#8b5cf6', desc: '与用户确认恢复情况，补充解决方案', sla: 8, assignee: 'ops' },
        { key: 'close', name: '关闭归档', type: 'end', seq: 4, color: '#10b981', desc: '记录知识并关闭事件', sla: 24, assignee: 'ops' },
      ],
    },
    {
      name: '标准问题管理流程',
      code: 'PRB-STD',
      type: 'problem',
      description: '从问题登记、根因分析到变更方案与验证关闭。',
      default: true,
      stages: [
        { key: 'identify', name: '问题登记', type: 'start', seq: 1, color: '#0ea5e9', desc: '聚合重复事件，明确问题范围', sla: 4, assignee: 'ops' },
        { key: 'analyze', name: '根因分析', type: 'task', seq: 2, color: '#4f6ef7', desc: '完成 RCA 与影响面分析', sla: 24, assignee: 'ops' },
        { key: 'plan', name: '变更方案审批', type: 'approval', seq: 3, color: '#f59e0b', desc: '评审根因解决与变更方案', sla: 24, assignee: 'ops', approver: 'approver' },
        { key: 'resolve', name: '解决验证', type: 'task', seq: 4, color: '#8b5cf6', desc: '实施方案并验证问题不再复现', sla: 48, assignee: 'ops' },
        { key: 'close', name: '关闭归档', type: 'end', seq: 5, color: '#10b981', desc: '更新知识库并关闭问题', sla: 24, assignee: 'ops' },
      ],
    },
    {
      name: '标准变更管理流程',
      code: 'CHG-STD',
      type: 'change',
      description: '标准变更从申请、评估、CAB 审批到实施验证的完整闭环。',
      default: true,
      stages: [
        { key: 'draft', name: '提交变更', type: 'start', seq: 1, color: '#0ea5e9', desc: '填写变更方案、影响范围与回退计划', sla: 4, assignee: 'ops' },
        { key: 'assess', name: '变更评估', type: 'task', seq: 2, color: '#4f6ef7', desc: '评估风险、CI 影响与资源窗口', sla: 8, assignee: 'ops' },
        { key: 'cab', name: 'CAB 审批', type: 'approval', seq: 3, color: '#f59e0b', desc: '变更咨询委员会审批与授权', sla: 24, assignee: 'ops', approver: 'approver' },
        { key: 'implement', name: '变更实施', type: 'task', seq: 4, color: '#8b5cf6', desc: '按方案实施并记录执行结果', sla: 8, assignee: 'ops' },
        { key: 'verify', name: '验证关闭', type: 'end', seq: 5, color: '#10b981', desc: '业务验证、更新 CMDB 并关闭', sla: 24, assignee: 'ops' },
      ],
    },
    {
      name: '紧急变更快速通道',
      code: 'CHG-EMERGENCY',
      type: 'change',
      description: '适用于重大故障修复的紧急变更，事后补录 CAB 审批。',
      default: false,
      stages: [
        { key: 'emergency', name: '紧急受理', type: 'start', seq: 1, color: '#ef4444', desc: '值班经理确认紧急变更必要性', sla: 0.5, assignee: 'ops' },
        { key: 'implement', name: '紧急实施', type: 'task', seq: 2, color: '#f97316', desc: '在故障窗口内快速实施', sla: 2, assignee: 'ops' },
        { key: 'review', name: '事后评审', type: 'approval', seq: 3, color: '#f59e0b', desc: '24 小时内补录 CAB 评审', sla: 24, assignee: 'ops', approver: 'approver' },
        { key: 'close', name: '关闭归档', type: 'end', seq: 4, color: '#10b981', desc: '补充变更记录与改进项', sla: 24, assignee: 'ops' },
      ],
    },
  ];

  const workflowIds = {};
  const stageMap = {};
  for (const workflow of workflowDefs) {
    const workflowId = await insertReturningId(db('workflows'), {
      name: workflow.name,
      code: workflow.code,
      ticket_type: workflow.type,
      description: workflow.description,
      is_default: workflow.default,
      is_active: true,
      version: 1,
      created_by: userIds.admin,
      created_at: daysAgo(120),
      updated_at: daysAgo(10),
    });
    workflowIds[workflow.code] = workflowId;
    stageMap[workflow.code] = {};
    for (const stage of workflow.stages) {
      const id = await insertReturningId(db('workflow_stages'), {
        workflow_id: workflowId,
        stage_key: stage.key,
        name: stage.name,
        stage_type: stage.type,
        seq: stage.seq,
        color: stage.color,
        description: stage.desc,
        sla_hours: stage.sla,
        assignee_role_id: roleIds[stage.assignee] || null,
        approver_role_id: stage.approver ? roleIds[stage.approver] : null,
        created_at: daysAgo(120),
      });
      stageMap[workflow.code][stage.key] = { id, ...stage };
    }
  }

  const ticketDefs = [
    {
      type: 'incident', no: 'INC', title: 'ERP 系统登录响应缓慢，部分用户无法进入', priority: 'high', impact: 'high', urgency: 'high', status: 'in_progress',
      category: '应用系统', requester: 'wangqiang', assignee: 'zhangwei', workflow: 'INC-STD', stage: 'diagnose', source: 'portal', ci: ['VM-ERP-APP01', 'SW-ERP-001'], created: hoursAgo(3),
      desc: '财务共享中心多名用户反馈 ERP 登录页面加载超过 30 秒，部分会话超时。已确认网络正常，应用节点 CPU 偏高。',
      comments: [{ user: 'zhangwei', body: '已登录应用节点检查，发现连接池等待明显，正在抓取线程栈。', hours: 1.2 }],
    },
    {
      type: 'incident', no: 'INC', title: '订单提交失败，数据库连接池耗尽', priority: 'critical', impact: 'high', urgency: 'critical', status: 'in_progress',
      category: '数据库', requester: 'zhangwei', assignee: 'zhangwei', workflow: 'INC-STD', stage: 'resolve', source: 'monitoring', ci: ['SRV-DB-001', 'SRV-PROD-001'], created: hoursAgo(8),
      desc: '监控告警订单服务错误率超过 15%，应用日志出现 ORA-00020 连接数超限。已临时扩容连接池并重启一个应用节点。',
      comments: [{ user: 'zhangwei', body: '连接池上限由 300 调整到 500，错误率已回落至 1% 以下。等待业务方确认。', hours: 0.8 }],
    },
    {
      type: 'incident', no: 'INC', title: '办公区 3 楼无线网络频繁掉线', priority: 'medium', impact: 'medium', urgency: 'medium', status: 'new',
      category: '网络', requester: 'chenjing', assignee: null, workflow: 'INC-STD', stage: 'triage', source: 'portal', ci: ['NET-WLC-01'], created: hoursAgo(5),
      desc: '3 楼东侧会议室与工位无线信号频繁断开，重连后短暂恢复。影响约 30 名同事的日常办公。',
      comments: [],
    },
    {
      type: 'incident', no: 'INC', title: 'Zabbix 告警：核心业务服务器 CPU 使用率持续超过 90%', priority: 'high', impact: 'high', urgency: 'high', status: 'in_progress',
      category: '监控告警', requester: 'admin', assignee: 'zhangwei', workflow: 'INC-STD', stage: 'diagnose', source: 'zabbix', ci: ['SRV-PROD-001', 'VM-ERP-APP01'], created: hoursAgo(2.4),
      desc: 'Zabbix 触发 High 级别告警：CPU utilization is too high on SRV-PROD-001，持续 5 分钟超过 90%。',
      comments: [{ user: 'zhangwei', body: '已确认由 ERP 批量报表任务引起，正在协调延后执行。', hours: 0.5 }], zabbix: true,
    },
    {
      type: 'incident', no: 'INC', title: 'OA 系统附件上传失败（>10MB）', priority: 'low', impact: 'low', urgency: 'medium', status: 'resolved',
      category: '应用系统', requester: 'chenjing', assignee: 'zhangwei', workflow: 'INC-STD', stage: 'resolve', source: 'portal', ci: ['VM-OA-01', 'SW-OA-001'], created: daysAgo(2),
      desc: 'OA 流程附件超过 10MB 时提示上传失败，小于 5MB 正常。',
      comments: [{ user: 'zhangwei', body: '已调整反向代理与 OA 附件大小限制为 50MB，验证通过，待用户确认关闭。', hours: 30 }],
      resolved: true,
    },
    {
      type: 'incident', no: 'INC', title: '出差员工 VPN 无法连接', priority: 'high', impact: 'medium', urgency: 'high', status: 'closed',
      category: '网络', requester: 'wangqiang', assignee: 'liuyang', workflow: 'INC-STD', stage: 'close', source: 'phone', ci: ['SEC-FW-01'], created: daysAgo(5),
      desc: '多名出差员工反馈 VPN 客户端报 691/809 错误，无法建立隧道。',
      comments: [{ user: 'liuyang', body: '根因为防火墙 IKE 会话表满，已清理并优化超时参数，观察 24 小时无复现。', hours: 100 }],
      resolved: true, closed: true,
    },
    {
      type: 'incident', no: 'INC', title: '财务共享中心打印服务不可用', priority: 'low', impact: 'low', urgency: 'low', status: 'resolved',
      category: '办公终端', requester: 'wangqiang', assignee: 'zhangwei', workflow: 'INC-STD', stage: 'resolve', source: 'portal', ci: [], created: daysAgo(4),
      desc: '共享打印机队列堵塞，所有打印任务停留在“正在打印”。',
      comments: [{ user: 'zhangwei', body: '清理 Print Spooler 队列并更新驱动，已恢复打印。', hours: 92 }],
      resolved: true,
    },
    {
      type: 'incident', no: 'INC', title: '堡垒机双因子认证短信延迟', priority: 'medium', impact: 'medium', urgency: 'medium', status: 'in_progress',
      category: '信息安全', requester: 'liuyang', assignee: 'liuyang', workflow: 'INC-STD', stage: 'diagnose', source: 'monitoring', ci: ['SEC-BASTION-01'], created: hoursAgo(26),
      desc: '运维人员反馈堡垒机短信验证码延迟 2-5 分钟，影响紧急登录。',
      comments: [],
    },
    {
      type: 'problem', no: 'PRB', title: 'ERP 月度结账期间性能瓶颈根因分析', priority: 'high', impact: 'high', urgency: 'medium', status: 'in_progress',
      category: '性能问题', requester: 'zhangwei', assignee: 'zhangwei', workflow: 'PRB-STD', stage: 'analyze', source: 'portal', ci: ['VM-ERP-APP01', 'SRV-DB-001', 'SW-ERP-001'], created: daysAgo(6),
      desc: '每月结账窗口 ERP 报表查询响应时间超过 20 分钟，需分析数据库执行计划、索引与批处理任务并发策略。',
      comments: [{ user: 'zhangwei', body: '初步发现 3 条报表 SQL 缺失复合索引，正在与 ERP 厂商确认补丁。', hours: 20 }],
    },
    {
      type: 'problem', no: 'PRB', title: '核心交换机偶发端口震荡（ flap ）', priority: 'medium', impact: 'medium', urgency: 'medium', status: 'pending_approval',
      category: '网络稳定性', requester: 'liuyang', assignee: 'liuyang', workflow: 'PRB-STD', stage: 'plan', source: 'monitoring', ci: ['NET-CORE-01', 'NET-CORE-02'], created: daysAgo(4),
      desc: '核心交换机 XGE1/0/49 端口在过去 7 天出现 6 次 link flap，疑似光模块老化。拟更换光模块并升级 VRP。',
      comments: [{ user: 'liuyang', body: '备件已到货，变更方案与回退步骤已补充，提交审批。', hours: 8 }],
    },
    {
      type: 'problem', no: 'PRB', title: '数据库连接池泄漏导致周期性连接耗尽', priority: 'high', impact: 'high', urgency: 'high', status: 'resolved',
      category: '数据库', requester: 'zhangwei', assignee: 'zhangwei', workflow: 'PRB-STD', stage: 'resolve', source: 'monitoring', ci: ['SRV-DB-001', 'SW-DB-001'], created: daysAgo(10),
      desc: '应用连接池在高峰后未正确释放，导致 T+1 日早高峰连接耗尽。',
      comments: [{ user: 'zhangwei', body: '已修复连接未关闭的代码路径，并增加连接池监控，观察 7 天正常。', hours: 48 }],
      resolved: true,
    },
    {
      type: 'problem', no: 'PRB', title: '无线认证延迟与漫游中断问题', priority: 'low', impact: 'medium', urgency: 'low', status: 'new',
      category: '网络稳定性', requester: 'chenjing', assignee: null, workflow: 'PRB-STD', stage: 'identify', source: 'portal', ci: ['NET-WLC-01'], created: daysAgo(3),
      desc: '近期多起无线掉线事件，初步判断与认证服务器响应时间和 AP 漫游策略相关。',
      comments: [],
    },
    {
      type: 'change', no: 'CHG', title: '核心数据库主备切换演练', priority: 'high', impact: 'high', urgency: 'medium', status: 'in_progress',
      category: '数据库变更', requester: 'zhangwei', assignee: 'zhangwei', workflow: 'CHG-STD', stage: 'implement', source: 'portal', ci: ['SRV-DB-001', 'SRV-DB-002', 'SW-DB-001'], created: daysAgo(7),
      desc: '验证 Data Guard 切换能力，演练 RTO/RPO 指标，确保灾备接管流程有效。',
      comments: [{ user: 'lina', body: 'CAB 已审批通过，风险可控。要求 22:00 后执行并同步业务值守。', hours: 24 }],
      change: { risk: 'high', changeType: 'normal', planStart: daysAhead(2), planEnd: daysAhead(2), outage: true, implementation: '1. 停止应用写入；2. 切换 Data Guard 主备；3. 验证监听与业务连接；4. 回切或保持新主库。', rollback: '若切换后业务验证失败，立即执行 switchover 回原主库，预计 15 分钟。', test: '核心交易、报表、批量任务各抽测 10 笔。' },
    },
    {
      type: 'change', no: 'CHG', title: 'ERP 应用服务器内核安全补丁升级', priority: 'medium', impact: 'medium', urgency: 'medium', status: 'pending_approval',
      category: '系统变更', requester: 'zhangwei', assignee: 'zhangwei', workflow: 'CHG-STD', stage: 'cab', source: 'portal', ci: ['VM-ERP-APP01', 'VM-ERP-APP02', 'OS-RHEL-001'], created: daysAgo(2),
      desc: '修复 CVE-2026-38021 内核提权漏洞，需滚动重启两台 ERP 应用节点。',
      comments: [{ user: 'zhangwei', body: '已完成测试环境验证，业务无感知。申请周六 00:00-02:00 窗口。', hours: 6 }],
      change: { risk: 'medium', changeType: 'normal', planStart: daysAhead(3), planEnd: daysAhead(3), outage: false, implementation: '1. 摘除节点流量；2. 打补丁并重启；3. 健康检查后重新加入负载均衡；4. 重复第二台。', rollback: '使用快照回滚至升级前状态，预计 20 分钟。', test: '登录、订单查询、报表导出回归测试。' },
    },
    {
      type: 'change', no: 'CHG', title: '边界防火墙策略收敛与僵尸规则清理', priority: 'high', impact: 'medium', urgency: 'medium', status: 'pending_approval',
      category: '安全变更', requester: 'liuyang', assignee: 'liuyang', workflow: 'CHG-STD', stage: 'cab', source: 'portal', ci: ['SEC-FW-01', 'NET-CORE-01'], created: daysAgo(3),
      desc: '清理 90 天零命中的 37 条策略，收敛临时放通规则，降低攻击面。',
      comments: [{ user: 'liuyang', body: '已在预发布环境验证策略，业务访问矩阵复核完成。', hours: 12 }],
      change: { risk: 'high', changeType: 'normal', planStart: daysAhead(1), planEnd: daysAhead(1), outage: false, implementation: '导出配置备份，分批删除零命中策略，逐批观察会话与日志。', rollback: '导入变更前配置快照，5 分钟内恢复。', test: '外网门户、VPN、邮件与第三方接口连通性。' },
    },
    {
      type: 'change', no: 'CHG', title: 'Zabbix 监控平台升级至 7.2', priority: 'medium', impact: 'low', urgency: 'low', status: 'new',
      category: '监控变更', requester: 'liuyang', assignee: null, workflow: 'CHG-STD', stage: 'draft', source: 'portal', ci: ['SRV-MON-001', 'SW-ZBX-001'], created: hoursAgo(18),
      desc: '将 Zabbix 7.0 升级至 7.2，验证新告警流水线与 Webhook 媒体类型。',
      comments: [],
      change: { risk: 'low', changeType: 'standard', planStart: daysAhead(10), planEnd: daysAhead(10), outage: false, implementation: '', rollback: '', test: '' },
    },
    {
      type: 'change', no: 'CHG', title: '办公网核心交换机固件升级', priority: 'high', impact: 'medium', urgency: 'medium', status: 'closed',
      category: '网络变更', requester: 'liuyang', assignee: 'liuyang', workflow: 'CHG-STD', stage: 'verify', source: 'portal', ci: ['NET-ACCESS-01'], created: daysAgo(15),
      desc: '升级接入交换机固件至最新稳定版，修复已知 BGP 抖动问题。',
      comments: [{ user: 'liuyang', body: '升级完成，业务验证正常，CMDB 固件字段已更新。', hours: 300 }],
      change: { risk: 'medium', changeType: 'normal', planStart: daysAgo(8), planEnd: daysAgo(8), outage: true, implementation: '主备倒换后逐台升级。', rollback: '使用备用镜像回退。', test: '办公网连通性、无线、VPN。' },
      resolved: true, closed: true,
    },
    {
      type: 'change', no: 'CHG', title: '备份存储容量扩容 48TB', priority: 'low', impact: 'low', urgency: 'low', status: 'resolved',
      category: '存储变更', requester: 'zhangwei', assignee: 'zhangwei', workflow: 'CHG-STD', stage: 'verify', source: 'portal', ci: ['SRV-BACKUP-001'], created: daysAgo(20),
      desc: '新增 4 块 16TB 硬盘并扩展备份存储池，满足 90 天保留策略。',
      comments: [{ user: 'zhangwei', body: '扩容完成，备份任务验证通过。', hours: 260 }],
      change: { risk: 'low', changeType: 'standard', planStart: daysAgo(12), planEnd: daysAgo(12), outage: false, implementation: '在线扩容存储池。', rollback: '保留原存储池配置。', test: '全量备份与恢复演练。' },
      resolved: true,
    },
  ];

  const year = new Date().getFullYear();
  const yearMonth = `${year}${String(new Date().getMonth() + 1).padStart(2, '0')}`;
  const prefixCounter = { INC: 0, PRB: 0, CHG: 0 };
  const ticketIds = [];
  const workflowCache = {};

  for (const def of ticketDefs) {
    prefixCounter[def.no] += 1;
    const created = def.created;
    const workflow = workflowDefs.find((item) => item.code === def.workflow);
    if (!workflowCache[def.workflow]) {
      const stages = await db('workflow_stages').where({ workflow_id: workflowIds[def.workflow] }).orderBy('seq');
      workflowCache[def.workflow] = stages;
    }
    const stages = workflowCache[def.workflow];
    const current = stages.find((stage) => stage.stage_key === def.stage) || stages[0];
    const currentIndex = stages.findIndex((stage) => stage.id === current.id);
    const status =
      def.status ||
      (current.stage_type === 'approval'
        ? 'pending_approval'
        : current.stage_type === 'end'
          ? 'resolved'
          : currentIndex === 0
            ? 'new'
            : 'in_progress');

    const planStart = def.change?.planStart || '';
    const planEnd = def.change?.planEnd || '';
    const ticketId = await insertReturningId(db('tickets'), {
      ticket_no: `${def.no}-${yearMonth}-${String(prefixCounter[def.no]).padStart(4, '0')}`,
      type: def.type,
      title: def.title,
      description: def.desc,
      status,
      priority: def.priority,
      impact: def.impact,
      urgency: def.urgency,
      category: def.category,
      source: def.source,
      requester_id: userIds[def.requester] || userIds.wangqiang,
      assignee_id: def.assignee ? userIds[def.assignee] : null,
      workflow_id: workflowIds[def.workflow],
      current_stage_id: current.id,
      resolution: def.resolved ? '已完成处置并经用户验证，服务恢复正常。' : '',
      sla_due_at: new Date(new Date(created).getTime() + Number(current.sla_hours) * 3600 * 1000).toISOString(),
      resolved_at: def.resolved ? hoursAgo(Math.max(1, Math.round((Date.now() - new Date(created).getTime()) / 3600000) - 2)) : null,
      closed_at: def.closed ? hoursAgo(1) : null,
      risk: def.change?.risk || 'medium',
      change_type: def.change?.changeType || 'normal',
      planned_start: planStart,
      planned_end: planEnd,
      implementation_plan: def.change?.implementation || '',
      rollback_plan: def.change?.rollback || '',
      test_plan: def.change?.test || '',
      cab_date: def.change ? daysAhead(1) : '',
      outage_required: def.change?.outage || false,
      zabbix_event_id: null,
      created_at: created,
      updated_at: hoursAgo(Math.random() * 3),
    });
    ticketIds.push({ id: ticketId, def, current, stages, status });

    for (let i = 0; i < currentIndex; i += 1) {
      const stage = stages[i];
      await insertReturningId(db('ticket_stage_history'), {
        ticket_id: ticketId,
        stage_id: stage.id,
        stage_name: stage.name,
        action: i === 0 ? 'created' : stage.stage_type === 'approval' ? 'approved' : 'advanced',
        actor_id: userIds[def.assignee] || userIds.zhangwei,
        comment: i === 0 ? '工单已创建' : `进入「${stages[i + 1]?.name || '下一阶段'}」`,
        created_at: new Date(new Date(created).getTime() + i * 2 * 3600 * 1000).toISOString(),
      });
    }
    if (currentIndex === 0) {
      await insertReturningId(db('ticket_stage_history'), {
        ticket_id: ticketId,
        stage_id: current.id,
        stage_name: current.name,
        action: 'created',
        actor_id: userIds[def.requester] || userIds.wangqiang,
        comment: '工单已创建，进入当前阶段',
        created_at: created,
      });
    }

    for (const [i, comment] of (def.comments || []).entries()) {
      await insertReturningId(db('ticket_comments'), {
        ticket_id: ticketId,
        user_id: userIds[comment.user] || userIds.zhangwei,
        body: comment.body,
        is_internal: false,
        created_at: hoursAgo(comment.hours ?? i + 1),
      });
    }

    for (const assetNo of def.ci || []) {
      if (!ciIds[assetNo]) continue;
      await insertReturningId(db('ticket_cis'), {
        ticket_id: ticketId,
        ci_id: ciIds[assetNo],
        created_at: created,
      });
    }
  }

  const deletionCandidate = ticketIds.find((item) => item.def.title.includes('VPN 无法连接'));
  if (deletionCandidate) {
    const deletionTicket = await db('tickets').where({ id: deletionCandidate.id }).first();
    await insertReturningId(db('ticket_deletion_requests'), {
      ticket_id: deletionCandidate.id,
      ticket_no: deletionTicket.ticket_no,
      ticket_type: deletionCandidate.def.type,
      ticket_title: deletionCandidate.def.title,
      requested_by: userIds.zhangwei,
      reason: '该事件已关闭且确认为重复记录，申请删除以保持历史数据整洁。',
      status: 'pending',
      reviewed_by: null,
      review_comment: '',
      created_at: hoursAgo(6),
      reviewed_at: null,
    });
  }

  // Link the monitoring incident to the seed Zabbix event.
  const monitoringTicket = ticketIds.find((item) => item.def.zabbix);
  let integrationId = null;
  integrationId = await insertReturningId(db('zabbix_integrations'), {
    name: '生产环境 Zabbix 7',
    base_url: 'http://zabbix.nextitops.local',
    api_token: '',
    webhook_secret: 'zbx_to_itsm',
    enabled: true,
    workflow_id: workflowIds['INC-STD'],
    default_assignee_id: userIds.zhangwei,
    severity_threshold: 'average',
    conditions: JSON.stringify([
      { field: 'event_name', operator: 'not_contains', value: 'Test' },
    ]),
    create_only_on_problem: true,
    reopen_resolved: true,
    mapping: JSON.stringify({ priority: 'severity', category: '监控告警' }),
    last_sync_at: null,
    last_test_at: null,
    last_test_status: null,
    created_at: daysAgo(40),
    updated_at: daysAgo(2),
  });

  if (monitoringTicket) {
    const seededEventId = await insertReturningId(db('zabbix_events'), {
      integration_id: integrationId,
      event_id: '48291',
      trigger_id: '31870',
      host_name: 'SRV-PROD-001',
      host_ip: '10.20.1.11',
      severity: 'high',
      event_name: 'CPU utilization is too high on SRV-PROD-001',
      event_status: 'PROBLEM',
      tags: JSON.stringify([{ tag: 'service', value: 'erp' }, { tag: 'scope', value: 'capacity' }]),
      payload: JSON.stringify({
        event: { id: '48291', name: 'CPU utilization is too high on SRV-PROD-001', severity: 'High', status: 'PROBLEM' },
        host: { host: 'SRV-PROD-001', ip: '10.20.1.11' },
        trigger: { triggerid: '31870' },
      }),
      ticket_id: monitoringTicket.id,
      processing_status: 'ticket_created',
      processing_note: '已自动创建事件',
      dedupe_key: 'zbx:48291:PROBLEM',
      received_at: hoursAgo(2.4),
    });
    await db('tickets').where({ id: monitoringTicket.id }).update({ zabbix_event_id: seededEventId });
  }

  await insertReturningId(db('zabbix_events'), {
    integration_id: integrationId,
    event_id: '48305',
    trigger_id: '31902',
    host_name: 'NET-CORE-02',
    host_ip: '10.20.0.3',
    severity: 'average',
    event_name: 'Interface GE1/0/12 link down on NET-CORE-02',
    event_status: 'PROBLEM',
    tags: JSON.stringify([{ tag: 'scope', value: 'network' }, { tag: 'site', value: 'shanghai' }]),
    payload: JSON.stringify({
      event: { id: '48305', name: 'Interface GE1/0/12 link down on NET-CORE-02', severity: 'Average', status: 'PROBLEM' },
      host: { host: 'NET-CORE-02', ip: '10.20.0.3' },
      trigger: { triggerid: '31902' },
    }),
    ticket_id: null,
    processing_status: 'received',
    processing_note: '网络链路告警，等待值班确认',
    dedupe_key: 'zbx:48305:PROBLEM',
    received_at: hoursAgo(1.2),
  });

  const auditRows = [
    { action: 'auth.login', entity_type: 'user', entity_id: String(userIds.admin), summary: '管理员登录平台', actor: '林奕辰', created: hoursAgo(1) },
    { action: 'ci.update', entity_type: 'ci', entity_id: String(ciIds['SRV-FILE-001']), summary: '更新文件共享服务器状态为维护中', actor: '张伟', created: hoursAgo(2.5) },
    { action: 'ticket.approve', entity_type: 'ticket', entity_id: String(ticketIds.find((t) => t.def.title.includes('数据库主备'))?.id || 0), summary: 'CAB 审批通过：核心数据库主备切换演练', actor: '李娜', created: hoursAgo(24) },
    { action: 'zabbix.event_received', entity_type: 'integration', entity_id: String(integrationId), summary: '接收 Zabbix 告警并自动创建事件 INC', actor: '系统', created: hoursAgo(2.4) },
    { action: 'workflow.update', entity_type: 'workflow', entity_id: String(workflowIds['CHG-EMERGENCY']), summary: '更新紧急变更快速通道流程', actor: '林奕辰', created: daysAgo(3) },
  ];
  for (const row of auditRows) {
    await insertReturningId(db('audit_logs'), {
      user_id: userIds.admin,
      actor_name: row.actor,
      action: row.action,
      entity_type: row.entity_type,
      entity_id: row.entity_id,
      summary: row.summary,
      detail: '{}',
      ip: '127.0.0.1',
      created_at: row.created,
    });
  }

  for (const channel of DEFAULT_NOTIFICATION_CHANNELS) {
    await insertReturningId(db('notification_channels'), {
      type: channel.type,
      name: channel.name,
      enabled: false,
      events: JSON.stringify(NOTIFICATION_EVENT_CODES),
      config: JSON.stringify(channel.config),
      last_test_at: null,
      last_test_status: null,
      created_at: ts,
      updated_at: ts,
    });
  }

  console.log(`[seed] ready: ${userRows.length} users, ${ciRows.length} CIs, ${ticketDefs.length} tickets, ${workflowDefs.length} workflows`);
}

const isMain = process.argv[1] && new URL(import.meta.url).pathname.endsWith(process.argv[1].replaceAll('\\', '/').split('/').pop());
if (isMain) {
  const { db } = await import('./index.js');
  await seedDatabase(db, { reset: process.argv.includes('--reset') });
  await db.destroy();
}
