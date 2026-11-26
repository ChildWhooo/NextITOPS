import { api } from '@/lib/api';

export const BASIC_FIELDS = [
  ['asset_no', '资产编号'], ['name', '资产名称'], ['ci_type_id', 'CI 类型'], ['status', '状态'], ['criticality', '重要性'],
  ['environment', '环境'], ['owner_id', '负责人'], ['department', '部门'], ['location', '位置'], ['vendor', '品牌/厂商'],
  ['model', '型号'], ['serial_no', '序列号'], ['ip_address', 'IP 地址'], ['mac_address', 'MAC 地址'], ['bmc_address', 'BMC 管理地址'], ['os_name', '操作系统'], ['cpu', 'CPU'],
  ['memory', '内存'], ['disk', '磁盘'], ['purchase_date', '购买日期'], ['warranty_end', '保修到期'], ['cost', '资产价值'], ['description', '资产说明'],
] as const;

export type BasicFieldConfig = Record<string, { label: string; hidden: boolean; list?: boolean }>;

const DEFAULT_LIST_FIELDS = new Set(['status', 'criticality', 'owner_id', 'location']);

let remoteConfig: Record<string, BasicFieldConfig> = {};
let loaded = false;

export function defaultsFor(): BasicFieldConfig {
  return Object.fromEntries(BASIC_FIELDS.map(([key, label]) => [key, { label, hidden: false }]));
}

export async function loadBasicFields() {
  const response = await api.get<{ data: Record<string, BasicFieldConfig> }>('/api/system/ci-basic-fields');
  remoteConfig = response.data || {};
  loaded = true;
  window.dispatchEvent(new Event('nextitops:ci-basic-fields-changed'));
  return remoteConfig;
}

export async function saveBasicFields(typeCode: string, config: BasicFieldConfig) {
  const response = await api.put<{ data: Record<string, BasicFieldConfig> }>('/api/system/ci-basic-fields', { typeCode, config });
  remoteConfig = response.data || { ...remoteConfig, [typeCode]: config };
  loaded = true;
  window.dispatchEvent(new Event('nextitops:ci-basic-fields-changed'));
}

export function getBasicFieldConfig(typeCode?: string): BasicFieldConfig {
  const stored = typeCode ? remoteConfig[typeCode] : undefined;
  return Object.fromEntries(BASIC_FIELDS.map(([key, label]) => [key, { label: stored?.[key]?.label || label, hidden: Boolean(stored?.[key]?.hidden), list: stored?.[key]?.list ?? DEFAULT_LIST_FIELDS.has(key) }]));
}

export function basicFieldVisible(typeCode: string | undefined, key: string) {
  return !getBasicFieldConfig(typeCode)[key]?.hidden;
}

export function basicFieldLabel(typeCode: string | undefined, key: string, fallback: string) {
  return getBasicFieldConfig(typeCode)[key]?.label || fallback;
}

export function basicFieldsLoaded() {
  return loaded;
}
