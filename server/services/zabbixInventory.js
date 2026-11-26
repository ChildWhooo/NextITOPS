import crypto from 'node:crypto';
import { db } from '../db/index.js';
import { nowIso, parseJson } from '../lib/helpers.js';
import { zabbixRpc } from './zabbix.js';
import { syncPortSnapshot } from './ports.js';

const INVENTORY_CI_TYPES = ['server', 'vm'];
const SOFTWARE_PREFIX = 'SW-ZBX-';
const ITEM_PAGE_SIZE = 500;
const MAX_ITEM_PAGES = 40;
const TEXT_ITEM_LIMIT_BYTES = 65536;
const TEXT_ITEM_TRUNCATION_THRESHOLD = TEXT_ITEM_LIMIT_BYTES - 36;
const DB_CHUNK_SIZE = 80;
// Zabbix item.get can silently return a partial set when hundreds of hosts are
// requested at once (large request body / server-side limits). Diagnostics and
// sync must see the same complete data, so hosts are queried in bounded chunks.
const INVENTORY_HOST_CHUNK_SIZE = 64;
const LINK_COUNT_CHUNK_SIZE = 400;

function chunk(items, size = DB_CHUNK_SIZE) {
  const result = [];
  for (let index = 0; index < items.length; index += size) result.push(items.slice(index, index + size));
  return result;
}

function text(value, max = 200) {
  return String(value ?? '').trim().slice(0, max);
}

function parseRecordValue(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'object') return value;
  const raw = String(value).replace(/^\uFEFF/, '').trim();
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { /* Try concatenated JSON records below. */ }
  return null;
}

function extractObjects(raw) {
  const objects = [];
  let start = -1;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = 0; index < raw.length; index += 1) {
    const char = raw[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') { inString = true; continue; }
    if (char === '{') {
      if (depth === 0) start = index;
      depth += 1;
    } else if (char === '}') {
      depth -= 1;
      if (depth === 0 && start >= 0) {
        const candidate = parseRecordValue(raw.slice(start, index + 1));
        if (candidate) objects.push(candidate);
        start = -1;
      }
    }
  }
  return objects;
}

export function parseInventoryRecords(value) {
  const parsed = parseRecordValue(value);
  if (typeof parsed === 'string') return parseInventoryRecords(parsed);
  if (Array.isArray(parsed)) return parsed;
  if (parsed && typeof parsed === 'object') {
    if ('name' in parsed || 'DisplayName' in parsed || 'package' in parsed || 'Package' in parsed) return [parsed];
    for (const key of ['data', 'result', 'value']) {
      if (Array.isArray(parsed[key])) return parsed[key];
    }
    const values = Object.values(parsed).filter((item) => item && typeof item === 'object' && !Array.isArray(item));
    if (values.length && values.length === Object.keys(parsed).length) return values;
    return [parsed];
  }
  const raw = String(value ?? '').replace(/^\uFEFF/, '').trim();
  if (!raw) return [];
  const records = [];
  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const candidate = parseRecordValue(line.replace(/,\s*$/, ''));
    if (Array.isArray(candidate)) records.push(...candidate);
    else if (candidate && typeof candidate === 'object') records.push(candidate);
  }
  return records.length ? records : extractObjects(raw);
}

export function looksTruncatedJson(value) {
  const raw = String(value ?? '').replace(/^\uFEFF/, '').trim();
  if (!raw) return false;
  try {
    JSON.parse(raw);
    return false;
  } catch {
    // Check whether the failure is caused by an incomplete trailing object.
  }
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (const char of raw) {
    if (inString) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === '{' || char === '[') depth += 1;
    else if (char === '}' || char === ']') depth -= 1;
    if (depth < 0) return true;
  }
  return depth !== 0 || inString;
}

function itemRawValue(item) {
  return typeof item.lastvalue === 'string'
    ? item.lastvalue
    : item.lastvalue == null ? '' : JSON.stringify(item.lastvalue);
}

function itemLooksTruncated(item) {
  const raw = itemRawValue(item);
  return looksTruncatedJson(raw) || Buffer.byteLength(raw, 'utf8') >= TEXT_ITEM_TRUNCATION_THRESHOLD;
}

function softwareRecordFields(record) {
  if (!record || typeof record !== 'object') return { name: '', version: '' };
  return {
    name: text(record.name ?? record.Name ?? record.package ?? record.Package ?? record.display_name ?? record.DisplayName ?? record['{#NAME}'], 200),
    version: text(record.version ?? record.Version ?? record.DisplayVersion ?? record.package_version ?? record['{#VERSION}'], 100),
  };
}

export function normalizeSoftwareRecords(records) {
  const result = new Map();
  for (const record of Array.isArray(records) ? records : []) {
    const { name, version } = softwareRecordFields(record);
    if (!name) continue;
    const key = `${name.toLowerCase()}\u0000${version.toLowerCase()}`;
    if (!result.has(key)) result.set(key, { key, name, version });
  }
  return [...result.values()];
}

function normalizeMac(value) {
  const raw = String(value ?? '').trim().replace(/-/g, ':').toUpperCase();
  if (!/^([0-9A-F]{2}:){5}[0-9A-F]{2}$/.test(raw)) return '';
  if (raw === '00:00:00:00:00:00' || raw === 'FF:FF:FF:FF:FF:FF') return '';
  return raw;
}

export function normalizeMacRecords(records) {
  const result = new Map();
  let index = 0;
  for (const record of Array.isArray(records) ? records : []) {
    if (!record || typeof record !== 'object') continue;
    const mac = normalizeMac(record.mac ?? record.MACAddress ?? record.mac_address);
    if (!mac) continue;
    const portName = text(record.interface ?? record.InterfaceDescription ?? record.name ?? record.adapter, 80) || `NIC-${index + 1}`;
    index += 1;
    if (!result.has(mac)) result.set(mac, { mac, interface: portName });
  }
  return [...result.values()];
}

function itemMatchesSoftware(item) {
  const key = String(item.key_ || '').toLowerCase();
  return key.includes('system.sw.packages.get') || (key.includes('registry.get[') && key.includes('uninstall'));
}

function itemMatchesMac(item) {
  const key = String(item.key_ || '').toLowerCase();
  return key.startsWith('system.hw.macaddr') || key.includes('win32_networkadapter');
}

async function hydrateItemValues(integration, items) {
  const missing = items.filter((item) => item.lastvalue === undefined || item.lastvalue === null || item.lastvalue === '');
  if (!missing.length) return;
  const groups = new Map();
  for (const item of missing) {
    const valueType = Number(item.value_type) || 4;
    if (!groups.has(valueType)) groups.set(valueType, []);
    groups.get(valueType).push(item);
  }
  // Text items can share one history bucket; a single global history.get limit
  // lets the busiest item consume the page and starves the rest. Query each
  // missing item separately (bounded concurrency) so every split item gets its
  // own latest value.
  for (const [valueType, typeItems] of groups) {
    for (const batch of chunk(typeItems, 8)) {
      await Promise.all(batch.map(async (item) => {
        try {
          const history = await zabbixRpc(integration, 'history.get', {
            output: 'extend',
            history: valueType,
            itemids: [item.itemid],
            sortfield: 'clock',
            sortorder: 'DESC',
            limit: 1,
          }, 10000);
          const value = history.result?.[0]?.value;
          if (value !== undefined && value !== null && value !== '') item.lastvalue = value;
        } catch {
          // Inventory items can be inaccessible or have history disabled; leave them empty.
        }
      }));
    }
  }
}

async function fetchInventoryItems(integration, hostIds, search) {
  const items = [];
  const seen = new Set();
  let offset = 0;
  for (let page = 0; page < MAX_ITEM_PAGES; page += 1) {
    const response = await zabbixRpc(integration, 'item.get', {
      output: ['itemid', 'hostid', 'key_', 'name', 'lastvalue', 'value_type'],
      hostids: hostIds,
      search: { key_: search },
      limit: ITEM_PAGE_SIZE,
      offset,
      sortfield: 'itemid',
      sortorder: 'ASC',
    }, 20000);
    const batch = Array.isArray(response.result) ? response.result : [];
    let added = 0;
    for (const item of batch) {
      const id = String(item.itemid || '');
      if (!id || seen.has(id)) continue;
      seen.add(id);
      items.push(item);
      added += 1;
    }
    if (batch.length < ITEM_PAGE_SIZE || added === 0) break;
    offset += batch.length;
  }
  return items;
}

async function loadInventoryItems(integration, hostIds) {
  const searches = ['system.sw.packages.get', 'Uninstall', 'system.hw.macaddr', 'Win32_NetworkAdapter'];
  const errors = [];
  const items = [];
  const seen = new Set();
  const uniqueHostIds = [...new Set(hostIds.map((id) => String(id || '')).filter(Boolean))];
  for (const hostBatch of chunk(uniqueHostIds, INVENTORY_HOST_CHUNK_SIZE)) {
    const settled = await Promise.allSettled(searches.map((search) => fetchInventoryItems(integration, hostBatch, search)));
    settled.forEach((response, index) => {
      if (response.status === 'rejected') {
        errors.push({
          search: searches[index],
          hosts: hostBatch.length,
          message: response.reason?.message || String(response.reason),
        });
        return;
      }
      for (const item of response.value) {
        const id = String(item.itemid || '');
        if (!id || seen.has(id)) continue;
        seen.add(id);
        items.push(item);
      }
    });
  }
  await hydrateItemValues(integration, items);
  const byHost = new Map();
  for (const item of items) {
    const hostId = String(item.hostid || '');
    if (!hostId) continue;
    if (!byHost.has(hostId)) byHost.set(hostId, { software: [], macs: [] });
    const bucket = byHost.get(hostId);
    if (itemMatchesSoftware(item)) bucket.software.push(item);
    if (itemMatchesMac(item)) bucket.macs.push(item);
  }
  byHost.errors = errors;
  return byHost;
}

function inventoryItemStats(item, kind) {
  const raw = itemRawValue(item);
  const records = parseInventoryRecords(raw);
  const normalized = kind === 'mac' ? normalizeMacRecords(records) : normalizeSoftwareRecords(records);
  return {
    itemid: String(item.itemid || ''),
    name: text(item.name, 120),
    key: text(item.key_, 160),
    value_type: Number(item.value_type) || 0,
    lastvalue_length: raw.length,
    lastvalue_bytes: Buffer.byteLength(raw, 'utf8'),
    text_limit_bytes: TEXT_ITEM_LIMIT_BYTES,
    looks_truncated: itemLooksTruncated(item),
    records: records.length,
    normalized: normalized.length,
    empty_names: kind === 'software'
      ? records.filter((record) => !softwareRecordFields(record).name).length
      : 0,
    sample: normalized.slice(0, 5).map((record) => record.name || record.interface),
  };
}

function hostInventoryStats(ci, bucket) {
  const softwareItems = (bucket.software || []).map((item) => inventoryItemStats(item, 'software'));
  const macItems = (bucket.macs || []).map((item) => inventoryItemStats(item, 'mac'));
  return {
    ci_id: ci.id,
    asset_no: ci.asset_no,
    name: ci.name,
    type_code: ci.type_code || '',
    ip_address: ci.ip_address || '',
    zabbix_host_id: String(ci.zabbix_host_id || ''),
    software_items: softwareItems,
    mac_items: macItems,
    software_item_count: softwareItems.length,
    software_records: softwareItems.reduce((sum, item) => sum + item.records, 0),
    software_normalized: softwareItems.reduce((sum, item) => sum + item.normalized, 0),
    software_empty_names: softwareItems.reduce((sum, item) => sum + item.empty_names, 0),
    software_truncated_items: softwareItems.filter((item) => item.looks_truncated).length,
    mac_item_count: macItems.length,
    mac_records: macItems.reduce((sum, item) => sum + item.records, 0),
    mac_normalized: macItems.reduce((sum, item) => sum + item.normalized, 0),
    mac_truncated_items: macItems.filter((item) => item.looks_truncated).length,
  };
}

async function loadInventoryHosts(integration) {
  return db('cis')
    .join('ci_types', 'cis.ci_type_id', 'ci_types.id')
    .select('cis.*', 'ci_types.code as type_code')
    .where('cis.zabbix_integration_id', integration.id)
    .whereNot('cis.zabbix_host_id', '')
    .whereIn('ci_types.code', INVENTORY_CI_TYPES);
}

function diagnosticPageOptions(options = {}) {
  const page = Math.max(1, Math.floor(Number(options.page) || 1));
  const pageSize = Math.min(100, Math.max(1, Math.floor(Number(options.pageSize) || 20)));
  const q = text(options.q, 120).toLowerCase();
  const ciType = ['server', 'vm'].includes(String(options.ciType || '')) ? String(options.ciType) : '';
  const requestedIssue = String(options.issue || '').toLowerCase();
  const issue = ['truncated', 'missing', 'abnormal'].includes(requestedIssue) ? requestedIssue : '';
  return { page, pageSize, q, ciType, issue };
}

async function loadSoftwareLinkCounts(hostIds) {
  if (!hostIds.length) return new Map();
  const counts = new Map();
  for (const batch of chunk(hostIds, LINK_COUNT_CHUNK_SIZE)) {
    const rows = await db('ci_relations as relation')
      .join('cis as target', 'relation.target_ci_id', 'target.id')
      .join('ci_types as target_type', 'target.ci_type_id', 'target_type.id')
      .whereIn('relation.source_ci_id', batch)
      .where('relation.relation_type', 'software_installed')
      .where('target_type.code', 'software')
      .where('target.asset_no', 'like', `${SOFTWARE_PREFIX}%`)
      .groupBy('relation.source_ci_id')
      .select('relation.source_ci_id')
      .count({ count: '*' });
    for (const row of rows) {
      const id = Number(row.source_ci_id);
      counts.set(id, (counts.get(id) || 0) + (Number(row.count) || 0));
    }
  }
  return counts;
}

function decorateInventoryAssociations(detail, linkCounts) {
  return detail.map((host) => {
    const linked = Number(linkCounts.get(Number(host.ci_id)) || 0);
    const inventory = parseJson(host.attributes, {}).zabbix_inventory || {};
    return {
      ...host,
      software_linked: linked,
      software_missing: Math.max(0, Number(host.software_normalized || 0) - linked),
      software_sync_skipped: Boolean(inventory.software_sync_skipped),
      software_sync_error: inventory.software_sync_error || '',
      software_asset_errors: Array.isArray(inventory.software_asset_errors) ? inventory.software_asset_errors.slice(0, 5) : [],
    };
  });
}

function matchesDiagnosticIssue(host, issue) {
  if (issue === 'truncated') return Number(host.software_truncated_items || 0) > 0 || Number(host.mac_truncated_items || 0) > 0;
  if (issue === 'missing') return Number(host.software_missing || 0) > 0;
  if (issue === 'abnormal') return Number(host.software_missing || 0) > 0 || Number(host.software_truncated_items || 0) > 0 || Number(host.mac_truncated_items || 0) > 0;
  return true;
}

export async function diagnoseZabbixInventory(integration, options = {}) {
  const cis = await loadInventoryHosts(integration);
  const { page: requestedPage, pageSize, q, ciType, issue } = diagnosticPageOptions(options);
  const filtered = cis.filter((ci) => {
    if (ciType && ci.type_code !== ciType) return false;
    if (!q) return true;
    return [ci.asset_no, ci.name, ci.ip_address, ci.zabbix_host_id]
      .some((value) => String(value || '').toLowerCase().includes(q));
  });
  const zeroTotals = {
    software_items: 0, software_records: 0, software_normalized: 0,
    mac_items: 0, mac_records: 0, mac_normalized: 0,
    software_linked: 0, software_missing: 0,
  };
  if (!filtered.length) {
    return {
      hosts: cis.length, hosts_matched: 0, hosts_page: 0, page: 1, page_size: pageSize, pages: 1,
      issue, ...zeroTotals, search_errors: [], hosts_detail: [],
    };
  }
  const hostIds = [...new Set(filtered.map((ci) => String(ci.zabbix_host_id)).filter(Boolean))];
  try {
    const byHost = await loadInventoryItems(integration, hostIds);
    const allDetail = filtered.map((ci) => hostInventoryStats(ci, byHost.get(String(ci.zabbix_host_id)) || { software: [], macs: [] }));
    let linkCounts = new Map();
    let associationError = '';
    try {
      linkCounts = await loadSoftwareLinkCounts(filtered.map((ci) => Number(ci.id)));
    } catch (error) {
      associationError = error.message || '关联数量查询失败';
    }
    const decorated = decorateInventoryAssociations(allDetail, linkCounts);
    const visible = issue ? decorated.filter((host) => matchesDiagnosticIssue(host, issue)) : decorated;
    const pages = Math.max(1, Math.ceil(visible.length / pageSize));
    const page = Math.min(requestedPage, pages);
    const pageHosts = visible.slice((page - 1) * pageSize, page * pageSize);
    const totals = visible.reduce((result, host) => ({
      software_items: result.software_items + host.software_item_count,
      software_records: result.software_records + host.software_records,
      software_normalized: result.software_normalized + host.software_normalized,
      mac_items: result.mac_items + host.mac_item_count,
      mac_records: result.mac_records + host.mac_records,
      mac_normalized: result.mac_normalized + host.mac_normalized,
      software_linked: result.software_linked + host.software_linked,
      software_missing: result.software_missing + host.software_missing,
    }), zeroTotals);
    return {
      hosts: cis.length,
      hosts_matched: visible.length,
      hosts_page: pageHosts.length,
      page,
      page_size: pageSize,
      pages,
      issue,
      ...totals,
      search_errors: byHost.errors || [],
      ...(associationError ? { association_error: associationError } : {}),
      hosts_detail: pageHosts,
    };
  } catch (error) {
    return {
      hosts: cis.length, hosts_matched: 0, hosts_page: 0, page: 1, page_size: pageSize, pages: 1,
      issue, ...zeroTotals,
      search_errors: [{ search: 'inventory', message: error.message }],
      hosts_detail: [],
    };
  }
}

function softwareAssetNo(name, version) {
  const hex = crypto.createHash('sha1').update(`${name}\u0000${version}`.toLowerCase()).digest('hex').slice(0, 12).toUpperCase();
  const slug = name.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 44) || 'PKG';
  return `${SOFTWARE_PREFIX}${slug}-${hex}`.slice(0, 80);
}

function assetKey(assetNo) {
  return String(assetNo || '').trim().toLowerCase();
}

function pushAssetError(counts, record, message) {
  if (!Array.isArray(counts.asset_errors)) counts.asset_errors = [];
  if (counts.asset_errors.length >= 50) return;
  counts.asset_errors.push({
    asset_no: record.assetNo,
    name: record.name,
    host_ci_id: record.hostCiId ? Number(record.hostCiId) : null,
    host_asset_no: record.hostAssetNo || '',
    message: String(message || '').slice(0, 300),
  });
}

function softwareAssetRecords(records, ci) {
  return records.map((record) => ({
    ...record,
    // cis.name is varchar(200) in production; a longer package name would make
    // the whole row fail on MySQL strict mode. Keep the identity hash based on
    // the original name, but store a safe display name.
    name: String(record.name || '').slice(0, 200),
    assetNo: softwareAssetNo(record.name, record.version),
    environment: ci.environment || 'production',
    hostCiId: Number(ci.id),
    hostAssetNo: ci.asset_no,
  }));
}

function fallbackAssetNo(record) {
  const hash = crypto.createHash('sha1').update(`${record.name}\u0000${record.version}`.toLowerCase()).digest('hex').slice(0, 12).toUpperCase();
  return `${SOFTWARE_PREFIX}UNKNOWN-${hash}`.slice(0, 80);
}

async function createFallbackSoftwareAsset(record, softwareType, cache, counts, reason) {
  const assetNo = fallbackAssetNo(record);
  let row = await db('cis').where({ asset_no: assetNo }).first('id', 'asset_no', 'name');
  if (!row) {
    const ts = nowIso();
    const fallbackName = `未知软件包 ${assetNo.slice(-12)}`;
    try {
      const ids = await db('cis').insert({
        asset_no: assetNo,
        name: fallbackName,
        ci_type_id: softwareType.id,
        status: 'in_use',
        criticality: 'medium',
        environment: record.environment || 'production',
        description: 'Zabbix 软件清单同步的占位资产；原始记录无法直接创建，已在属性中保留原始名称与版本。',
        attributes: JSON.stringify({
          version: record.version,
          original_name: record.name,
          original_version: record.version,
          inventory_source: 'zabbix',
          zabbix_synced: true,
          zabbix_software_key: record.key,
          zabbix_fallback: true,
          zabbix_fallback_reason: String(reason || '').slice(0, 300),
          zabbix_first_seen_at: ts,
          zabbix_last_seen_at: ts,
        }),
        created_at: ts,
        updated_at: ts,
      });
      row = { id: Number(ids[0]), asset_no: assetNo, name: fallbackName };
    } catch (error) {
      pushAssetError(counts, record, `创建占位资产失败：${error?.message || '未知错误'}`);
      return null;
    }
  }
  const asset = { id: Number(row.id), assetNo, name: row.name, version: record.version || '', created: true, fallback: true };
  cache.assets.set(record.assetNo, asset);
  cache.assets.set(assetNo, asset);
  if (!counts.software_fallback) counts.software_fallback = 0;
  counts.software_fallback += 1;
  if (!counts.asset_errors) counts.asset_errors = [];
  if (counts.asset_errors.length < 50) {
    counts.asset_errors.push({
      asset_no: assetNo,
      name: record.name,
      host_ci_id: record.hostCiId ? Number(record.hostCiId) : null,
      host_asset_no: record.hostAssetNo || '',
      message: `已使用占位资产：${String(reason || '原资产创建失败').slice(0, 240)}`,
    });
  }
  return asset;
}

async function loadSoftwareAssets(records, cache, counts = null) {
  const missing = records.filter((record) => !cache.assets.has(record.assetNo));
  if (!missing.length) return;
  const softwareType = await db('ci_types').where({ code: 'software' }).first();
  for (const batch of chunk(missing)) {
    const rows = await db('cis')
      .join('ci_types', 'cis.ci_type_id', 'ci_types.id')
      .whereIn('cis.asset_no', batch.map((record) => record.assetNo))
      .select('cis.id', 'cis.asset_no', 'cis.name', 'ci_types.code as type_code');
    // A SW-ZBX asset must be visible in both the software asset list and the
    // CI software tab. Older syncs could leave it under another CI type even
    // though the relation existed, which made the sync report success while
    // the detail page showed fewer packages. Normalize the type before reuse.
    if (softwareType) {
      const wrongTypeIds = rows.filter((row) => row.type_code !== 'software').map((row) => Number(row.id));
      for (const ids of chunk(wrongTypeIds)) {
        await db('cis').whereIn('id', ids).update({ ci_type_id: softwareType.id, updated_at: nowIso() });
      }
      if (counts && wrongTypeIds.length) counts.software_retyped = (counts.software_retyped || 0) + wrongTypeIds.length;
    }
    const byKey = new Map(rows.map((row) => [assetKey(row.asset_no), row]));
    for (const record of batch) {
      const row = byKey.get(assetKey(record.assetNo));
      if (!row) continue;
      const asset = { id: Number(row.id), assetNo: record.assetNo, name: row.name, version: record.version || '', created: false };
      cache.assets.set(record.assetNo, asset);
      if (row.asset_no !== record.assetNo) cache.assets.set(row.asset_no, asset);
    }
  }
}

async function repairSoftwareAssetTypes(hostIds, counts) {
  if (!hostIds.length) return 0;
  const softwareType = await db('ci_types').where({ code: 'software' }).first('id');
  if (!softwareType) return 0;
  const repaired = new Set();
  for (const batch of chunk(hostIds, LINK_COUNT_CHUNK_SIZE)) {
    const rows = await db('ci_relations as relation')
      .join('cis as target', 'relation.target_ci_id', 'target.id')
      .join('ci_types as target_type', 'target.ci_type_id', 'target_type.id')
      .whereIn('relation.source_ci_id', batch)
      .where('relation.relation_type', 'software_installed')
      .where('target.asset_no', 'like', `${SOFTWARE_PREFIX}%`)
      .whereNot('target_type.code', 'software')
      .select('target.id');
    for (const row of rows) repaired.add(Number(row.id));
  }
  const ids = [...repaired].filter(Boolean);
  for (const batch of chunk(ids)) {
    await db('cis').whereIn('id', batch).update({ ci_type_id: softwareType.id, updated_at: nowIso() });
  }
  if (counts && ids.length) counts.software_retyped = (counts.software_retyped || 0) + ids.length;
  return ids.length;
}

async function createSoftwareAssets(records, cache, counts) {
  const softwareType = await db('ci_types').where({ code: 'software' }).first();
  if (!softwareType) return null;
  const missing = records.filter((record) => !cache.assets.has(record.assetNo));
  if (!missing.length) return softwareType;
  const ts = nowIso();
  for (const batch of chunk(missing)) {
    const rows = batch.map((record) => ({
      asset_no: record.assetNo,
      name: record.name,
      ci_type_id: softwareType.id,
      status: 'in_use',
      criticality: 'medium',
      environment: record.environment || 'production',
      description: '由 Zabbix Agent 软件清单自动发现，可在资产清单中查看关联主机。',
      attributes: JSON.stringify({
        version: record.version,
        inventory_source: 'zabbix',
        zabbix_synced: true,
        zabbix_software_key: record.key,
        zabbix_first_seen_at: ts,
        zabbix_last_seen_at: ts,
      }),
      created_at: ts,
      updated_at: ts,
    }));
    const insertErrors = new Map();
    try {
      await db('cis').insert(rows);
    } catch {
      // A concurrent sync may have created some rows; retry individually so
      // the rest of the batch is not lost to one duplicate asset_no.
      for (let index = 0; index < rows.length; index += 1) {
        try {
          await db('cis').insert(rows[index]);
        } catch (error) {
          insertErrors.set(assetKey(batch[index].assetNo), error?.message || '创建软件资产失败');
        }
      }
    }
    const saved = await db('cis').whereIn('asset_no', batch.map((record) => record.assetNo)).select('id', 'asset_no', 'name');
    const byKey = new Map(saved.map((row) => [assetKey(row.asset_no), row]));
    for (const record of batch) {
      if (cache.assets.has(record.assetNo)) continue;
      const row = byKey.get(assetKey(record.assetNo));
      if (!row) {
        const reason = insertErrors.get(assetKey(record.assetNo)) || '创建后未能读取软件资产';
        // A single malformed package should not block the other 1,000+
        // packages of the same host. Retry with a sanitized name and a
        // deterministic placeholder asset_no; the original name/version stay
        // in attributes for later repair.
        await createFallbackSoftwareAsset(record, softwareType, cache, counts, reason);
        continue;
      }
      const asset = {
        id: Number(row.id),
        assetNo: record.assetNo,
        name: row.name,
        version: record.version || '',
        created: true,
      };
      cache.assets.set(record.assetNo, asset);
      if (row.asset_no !== record.assetNo) cache.assets.set(row.asset_no, asset);
      counts.software_created += 1;
    }
  }
  return softwareType;
}

async function loadSoftwareLinks(ciId) {
  return db('ci_relations as relation')
    .join('cis as target', 'relation.target_ci_id', 'target.id')
    .join('ci_types as target_type', 'target.ci_type_id', 'target_type.id')
    .select('relation.id as relation_id', 'relation.target_ci_id as target_id')
    .where('relation.source_ci_id', ciId)
    .where('relation.relation_type', 'software_installed')
    .where('target_type.code', 'software')
    .where('target.asset_no', 'like', `${SOFTWARE_PREFIX}%`);
}

async function insertSoftwareLinks(ciId, targetIds, counts) {
  if (!targetIds.length) return;
  const ts = nowIso();
  for (const batch of chunk(targetIds)) {
    const rows = batch.map((targetId) => ({
      source_ci_id: ciId,
      target_ci_id: targetId,
      relation_type: 'software_installed',
      description: 'Zabbix Agent 软件清单同步',
      created_at: ts,
    }));
    try {
      await db('ci_relations').insert(rows);
      counts.software_linked += rows.length;
    } catch {
      // Keep a bad row from discarding the rest of this host's software.
      for (const row of rows) {
        try {
          await db('ci_relations').insert(row);
          counts.software_linked += 1;
        } catch { /* already linked by another sync */ }
      }
    }
  }
}

async function cleanupSoftwareLinks(keepIds, counts, links) {
  const stale = links.filter((link) => !keepIds.has(Number(link.target_id)));
  if (!stale.length) return;
  for (const batch of chunk(stale)) {
    await db('ci_relations').whereIn('id', batch.map((link) => link.relation_id)).del();
    counts.software_removed += batch.length;
  }
  const staleTargetIds = [...new Set(stale.map((link) => Number(link.target_id)).filter(Boolean))];
  const referenced = new Set();
  for (const batch of chunk(staleTargetIds)) {
    const rows = await db('ci_relations')
      .whereIn('target_ci_id', batch)
      .orWhereIn('source_ci_id', batch)
      .select('source_ci_id', 'target_ci_id');
    for (const row of rows) {
      referenced.add(Number(row.source_ci_id));
      referenced.add(Number(row.target_ci_id));
    }
  }
  const orphanTargets = staleTargetIds.filter((id) => !referenced.has(id));
  for (const batch of chunk(orphanTargets)) {
    const assets = await db('cis').whereIn('id', batch).select('id', 'attributes');
    const removable = assets.filter((asset) => parseJson(asset.attributes, {}).zabbix_synced).map((asset) => asset.id);
    for (const ids of chunk(removable)) await db('cis').whereIn('id', ids).del();
  }
}

export async function syncZabbixInventory(integration, options = {}) {
  const cis = await loadInventoryHosts(integration);
  if (!cis.length) return { hosts: 0, updated: 0, skipped: 0, truncated: 0, truncated_hosts: [], failed_hosts: [], software_linked: 0, software_created: 0, software_removed: 0, software_expected: 0, software_verified: 0, software_missing: 0, software_fallback: 0, software_retyped: 0, macs: 0, errors: [], warnings: [], asset_errors: [], search_errors: [] };

  const hostIds = [...new Set(cis.map((ci) => String(ci.zabbix_host_id)).filter(Boolean))];
  let byHost = new Map();
  try {
    byHost = await loadInventoryItems(integration, hostIds);
  } catch (error) {
    return { hosts: cis.length, updated: 0, skipped: cis.length, truncated: 0, truncated_hosts: [], failed_hosts: [], software_linked: 0, software_created: 0, software_removed: 0, software_expected: 0, software_verified: 0, software_missing: 0, software_fallback: 0, software_retyped: 0, macs: 0, errors: [error.message], warnings: [], asset_errors: [], search_errors: [] };
  }

  const counts = {
    hosts: cis.length, updated: 0, skipped: 0, truncated: 0, truncated_hosts: [], failed_hosts: [], software_linked: 0,
    software_created: 0, software_removed: 0, software_expected: 0, software_verified: 0, software_missing: 0, software_fallback: 0, software_retyped: 0,
    macs: 0, errors: [], warnings: [], asset_errors: [],
    search_errors: byHost.errors || [],
  };
  if (options.diagnostics) {
    counts.diagnostics = cis.map((ci) => hostInventoryStats(ci, byHost.get(String(ci.zabbix_host_id)) || { software: [], macs: [] }));
  }

  // Existing relations may point at SW-ZBX assets that were created under a
  // non-software CI type by older versions. The detail page filters by the
  // target's type while the sync used to count only the relation, which made
  // sync report success while the software tab stayed incomplete.
  try {
    await repairSoftwareAssetTypes(cis.map((ci) => Number(ci.id)), counts);
  } catch (error) {
    counts.errors.push(`software asset type repair: ${error.message}`);
  }

  const plans = [];
  const allAssets = new Map();
  for (const ci of cis) {
    const bucket = byHost.get(String(ci.zabbix_host_id)) || { software: [], macs: [] };
    const truncatedSoftware = (bucket.software || []).some(itemLooksTruncated);
    const softwareRecords = truncatedSoftware
      ? []
      : softwareAssetRecords(normalizeSoftwareRecords(bucket.software.flatMap((item) => parseInventoryRecords(item.lastvalue))), ci);
    const macRecords = normalizeMacRecords(bucket.macs.flatMap((item) => parseInventoryRecords(item.lastvalue)));
    for (const record of softwareRecords) {
      if (!allAssets.has(record.assetNo)) allAssets.set(record.assetNo, record);
    }
    plans.push({ ci, bucket, truncatedSoftware, softwareRecords, macRecords });
  }

  const cache = { assets: new Map() };
  if (allAssets.size) {
    try {
      await loadSoftwareAssets([...allAssets.values()], cache, counts);
      await createSoftwareAssets([...allAssets.values()], cache, counts);
    } catch (error) {
      counts.errors.push(`software assets: ${error.message}`);
    }
  }

  for (const { ci, bucket, truncatedSoftware, softwareRecords, macRecords } of plans) {
    if (truncatedSoftware) {
      counts.truncated += 1;
      counts.truncated_hosts.push(ci.asset_no);
      const maxBytes = Math.max(0, ...bucket.software.filter(itemLooksTruncated).map((item) => Buffer.byteLength(itemRawValue(item), 'utf8')));
      counts.warnings.push(`${ci.asset_no}: 软件清单超过 Zabbix 64KB 文本上限（约 ${Math.round(maxBytes / 1024)}KB），已跳过软件同步且不会删除已有关系；请缩短或拆分监控项`);
    }
    if (!softwareRecords.length && !macRecords.length) {
      counts.skipped += 1;
      continue;
    }
    try {
      let softwareSkipped = false;
      if (!truncatedSoftware && softwareRecords.length) {
        const keepIds = new Set();
        for (const record of softwareRecords) {
          const asset = cache.assets.get(record.assetNo);
          if (asset?.id) keepIds.add(Number(asset.id));
        }
        const allResolved = softwareRecords.every((record) => cache.assets.has(record.assetNo));
        if (!allResolved) {
          // Keep this host's existing relations untouched and continue with
          // the remaining hosts. A single invalid/long package must not make
          // the whole inventory run look partially successful.
          softwareSkipped = true;
          counts.failed_hosts.push(ci.asset_no);
          counts.errors.push(`${ci.asset_no}: 部分软件资产未能创建，已跳过该主机软件更新并保留原有关系；其他主机继续，请查看软件资产错误或重试`);
        } else {
          const links = await loadSoftwareLinks(ci.id);
          const existingTargets = new Set(links.map((link) => Number(link.target_id)));
          const missing = [...keepIds].filter((id) => !existingTargets.has(id));
          await insertSoftwareLinks(ci.id, missing, counts);
          await cleanupSoftwareLinks(keepIds, counts, links);
          counts.software_expected += softwareRecords.length;
          const verifiedLinks = await loadSoftwareLinks(ci.id);
          const verifiedTargets = new Set(verifiedLinks.map((link) => Number(link.target_id)));
          const verified = [...keepIds].filter((id) => verifiedTargets.has(id)).length;
          counts.software_verified += verified;
          const stillMissing = Math.max(0, softwareRecords.length - verified);
          if (stillMissing > 0) {
            counts.software_missing += stillMissing;
            counts.errors.push(`${ci.asset_no}: 软件清单应有 ${softwareRecords.length} 条，实际关联 ${verified} 条，缺少 ${stillMissing} 条；请重试同步`);
          }
        }
      }

      const hostAssetErrors = counts.asset_errors
        .filter((error) => Number(error.host_ci_id) === Number(ci.id))
        .slice(0, 5);
      const hostErrorText = softwareSkipped
        ? (hostAssetErrors[0]?.message || '部分软件资产未能创建，已保留原有软件关系')
        : '';

      if (macRecords.length) {
        await syncPortSnapshot({
          ciId: ci.id,
          host: ci.asset_no,
          hostIp: ci.ip_address,
          source: 'zabbix-agent',
          ports: macRecords.map((record) => ({
            port_name: record.interface,
            port_type: 'ethernet',
            mac_address: record.mac,
          })),
        });
        counts.macs += macRecords.length;
        const primaryMac = macRecords[0]?.mac || '';
        const previousInventory = parseJson(ci.attributes, {}).zabbix_inventory || {};
        const attributes = {
          ...parseJson(ci.attributes, {}),
          zabbix_inventory: {
            macs: macRecords,
            software_count: (truncatedSoftware || softwareSkipped) ? (previousInventory.software_count || 0) : softwareRecords.length,
            truncated: truncatedSoftware,
            software_sync_skipped: softwareSkipped,
            software_sync_error: hostErrorText,
            software_asset_errors: hostAssetErrors,
            synced_at: nowIso(),
          },
        };
        await db('cis').where({ id: ci.id }).update({
          mac_address: primaryMac || ci.mac_address || '',
          attributes: JSON.stringify(attributes),
          updated_at: nowIso(),
        });
      } else if (softwareRecords.length) {
        const previousInventory = parseJson(ci.attributes, {}).zabbix_inventory || {};
        const attributes = {
          ...parseJson(ci.attributes, {}),
          zabbix_inventory: {
            ...previousInventory,
            software_count: softwareSkipped ? (previousInventory.software_count || 0) : softwareRecords.length,
            truncated: false,
            software_sync_skipped: softwareSkipped,
            software_sync_error: hostErrorText,
            software_asset_errors: hostAssetErrors,
            synced_at: nowIso(),
          },
        };
        await db('cis').where({ id: ci.id }).update({ attributes: JSON.stringify(attributes), updated_at: nowIso() });
      }
      counts.updated += 1;
    } catch (error) {
      counts.errors.push(`${ci.asset_no}: ${error.message}`);
    }
  }

  await db('zabbix_integrations').where({ id: integration.id }).update({
    last_inventory_sync_at: nowIso(),
    updated_at: nowIso(),
  });
  return counts;
}
