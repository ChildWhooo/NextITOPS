export interface RelationRule {
  code: string;
  label: string;
  targets: string[];
  hint?: string;
  /** 当前 CI 作为目标，选择的 CI 作为源；用于 OS / 软件等反向建立关系。 */
  reverse?: boolean;
}

const PHYSICAL_TARGETS = ['network', 'patch_panel', 'security', 'server', 'storage', 'industrial', 'ics', 'ot', 'plc'];

export const RELATION_RULES: Record<string, RelationRule[]> = {
  datacenter: [
    { code: 'member_of', label: '包含机柜', targets: ['rack'], hint: '数据中心包含的机柜空间' },
  ],
  rack: [
    { code: 'member_of', label: '归属于数据中心', targets: ['datacenter'], hint: '选择机柜所在的数据中心/机房' },
  ],
  server: [
    { code: 'installed_on', label: '安装于机柜', targets: ['rack'], hint: '物理服务器上架的机柜位置' },
    { code: 'connects_to', label: '物理连接', targets: PHYSICAL_TARGETS, hint: 'DAS 可直连存储；SAN/NAS 可经 IP 或 FC 交换机连接；也可连接网络、安全与工控设备' },
    { code: 'hosts', label: '承载可用服务器 / 虚拟化宿主机', targets: ['server', 'virtualization_host'], hint: '仅物理服务器（带外管理）选择：安装好操作系统的可用服务器，或安装虚拟化操作系统后的宿主机' },
    { code: 'runs_on', label: '运行于物理服务器（可用服务器）', targets: ['server'], hint: '仅可用服务器（Agent 监控）选择：它运行在哪台带外管理的物理服务器上' },
    { code: 'os_installed', label: '安装操作系统（Linux / Windows）', targets: ['os'], hint: '选择该服务器安装的操作系统；物理服务器安装 OS 后应同时存在一台可用服务器资产' },
    { code: 'software_installed', label: '安装软件（可用服务器）', targets: ['software'], hint: '选择运行在该可用服务器上的软件' },
    { code: 'business_runs_on', label: '承载业务系统（可用服务器）', targets: ['business'], reverse: true, hint: '选择运行在该可用服务器上的业务系统；关系以业务系统为源建立' },
  ],
  network: [
    { code: 'installed_on', label: '安装于机柜', targets: ['rack'], hint: '网络设备上架的机柜位置' },
    { code: 'connects_to', label: '物理连接', targets: PHYSICAL_TARGETS, hint: '交换机/路由器上联、下联或旁路连接；可连接服务器、存储、安全与工控设备' },
  ],
  patch_panel: [
    { code: 'installed_on', label: '安装于机柜', targets: ['rack'], hint: '配线架上架的机柜位置' },
    { code: 'connects_to', label: '物理连接', targets: PHYSICAL_TARGETS, hint: '通过 RJ45 / SFP / SFP+ 端口连接网络设备、服务器、安全设备或另一台配线架' },
  ],
  security: [
    { code: 'installed_on', label: '安装于机柜', targets: ['rack'], hint: '安全设备上架的机柜位置' },
    { code: 'connects_to', label: '物理连接', targets: PHYSICAL_TARGETS, hint: '串接或旁路部署的物理链路；可连接网络、服务器、存储与工控设备' },
  ],
  storage: [
    { code: 'installed_on', label: '安装于机柜', targets: ['rack'], hint: '存储设备上架的机柜位置' },
    { code: 'connects_to', label: '物理连接', targets: ['server', 'network', 'security', 'storage'], hint: 'DAS / SAN / NAS 的物理链路，或经 IP / FC 交换机连接服务器与存储' },
    { code: 'stores_on', label: '承载业务数据', targets: ['business'], reverse: true, hint: '选择将数据存放在该存储上的业务系统；关系以业务系统为源建立' },
  ],
  virtualization: [
    { code: 'platform_host', label: '由虚拟化宿主机组成', targets: ['virtualization_host'], hint: '选择组成该虚拟化平台的一台或多台虚拟化宿主机；关系以平台为源建立' },
    { code: 'contains_vm', label: '承载虚拟机', targets: ['vm'], hint: '选择该平台承载的虚拟机实例；虚拟机也可通过「运行于」建立关系' },
    { code: 'connects_to', label: '连接到网络/存储', targets: ['network', 'security', 'storage'], hint: '虚拟化平台的业务网络、管理网络或共享存储链路' },
  ],
  virtualization_host: [
    { code: 'hosts', label: '运行于物理服务器', targets: ['server'], reverse: true, hint: '选择安装该虚拟化操作系统的带外物理服务器；关系以物理服务器为源建立' },
    { code: 'os_installed', label: '安装虚拟化操作系统', targets: ['os'], hint: '选择该宿主机安装的 ESXi、Hyper-V、KVM 等虚拟化操作系统' },
    { code: 'platform_host', label: '加入虚拟化平台', targets: ['virtualization'], reverse: true, hint: '平台级宿主机选择所属虚拟化平台；独立宿主机不建立此关系' },
    { code: 'runs_on', label: '承载虚拟机', targets: ['vm'], reverse: true, hint: '选择运行在该宿主机上的虚拟机；关系以虚拟机为源建立' },
    { code: 'connects_to', label: '连接到网络/存储', targets: ['network', 'security', 'storage'], hint: '宿主机的管理网络、业务网络或共享存储链路' },
  ],
  vm: [
    { code: 'runs_on', label: '运行于虚拟化平台 / 宿主机', targets: ['virtualization', 'virtualization_host'], hint: '选择承载该虚拟机的虚拟化平台，或独立/平台内的虚拟化宿主机' },
    { code: 'connects_to', label: '连接到网络/存储', targets: ['network', 'security', 'storage'], hint: '虚拟机的虚拟网络、安全策略或存储链路' },
    { code: 'os_installed', label: '安装操作系统', targets: ['os'], hint: '选择该虚拟机安装的操作系统' },
    { code: 'software_installed', label: '安装软件', targets: ['software'], hint: '选择运行在该虚拟机上的软件' },
    { code: 'business_runs_on', label: '承载业务系统', targets: ['business'], reverse: true, hint: '选择运行在该虚拟机上的业务系统；关系以业务系统为源建立' },
  ],
  os: [
    { code: 'os_installed', label: '安装在服务器/虚拟机/宿主机上', targets: ['server', 'vm', 'virtualization_host'], reverse: true, hint: '选择安装该操作系统的服务器、虚拟机或虚拟化宿主机；关系以计算资源为源建立' },
  ],
  software: [
    { code: 'software_installed', label: '安装在服务器/虚拟机上', targets: ['server', 'vm'], reverse: true, hint: '选择运行该软件的物理服务器或虚拟机；关系以服务器/虚拟机为源建立' },
  ],
  business: [
    { code: 'business_runs_on', label: '承载于可用服务器/虚拟机', targets: ['server', 'vm'], hint: '选择承载该业务系统的可用服务器或虚拟机；虚拟化平台本身不直接承载业务' },
    { code: 'depends_on', label: '依赖软件/其他业务', targets: ['software', 'business', 'vm', 'server'], hint: '业务系统运行所依赖的软件、其他业务或基础设施' },
    { code: 'stores_on', label: '数据存放于存储', targets: ['storage'], hint: '选择保存业务数据的 SAN / NAS / 分布式存储设备' },
  ],
  industrial: [
    { code: 'installed_on', label: '安装于机柜', targets: ['rack'], hint: '工控设备上架的机柜位置' },
    { code: 'connects_to', label: '物理连接', targets: PHYSICAL_TARGETS, hint: '工控设备与网络、安全、服务器或存储之间的物理链路' },
  ],
  ics: [],
  ot: [],
  plc: [],
};

RELATION_RULES.ics = RELATION_RULES.industrial;
RELATION_RULES.ot = RELATION_RULES.industrial;
RELATION_RULES.plc = RELATION_RULES.industrial;

export function getRelationRules(typeCode?: string | null): RelationRule[] {
  if (!typeCode) return [];
  return RELATION_RULES[typeCode] || RELATION_RULES[typeCode.toLowerCase()] || [];
}

export function findRelationRule(rules: RelationRule[], code?: string | null) {
  return rules.find((rule) => rule.code === code);
}

export function relationTypeMatchesRule(
  type: { from_type_id?: number | null; to_type_id?: number | null },
  rule: RelationRule | undefined,
  ciTypeId: number,
) {
  if (!rule) return false;
  if (rule.reverse) return !type.to_type_id || type.to_type_id === ciTypeId;
  return !type.from_type_id || type.from_type_id === ciTypeId;
}

export function relationTargetMatchesRule(
  rule: RelationRule | undefined,
  type: { from_type_id?: number | null; to_type_id?: number | null } | undefined,
  targetTypeId: number,
  targetTypeCode?: string | null,
) {
  if (!rule || !rule.targets.includes(targetTypeCode || '')) return false;
  if (!type) return true;
  return rule.reverse
    ? !type.from_type_id || type.from_type_id === targetTypeId
    : !type.to_type_id || type.to_type_id === targetTypeId;
}
