import { db, insertReturningId } from '../db/index.js';
import { parseJson } from '../lib/helpers.js';
import { zabbixRpc } from './zabbix.js';
import { getOsRules, kernelFrom, mapOperatingSystem } from './osMapping.js';

const CPU_KEYS = [
  'system.cpu.num',
  'system.cpu.cores',
  'wmi.get[root/cimv2,"Select NumberOfLogicalProcessors from Win32_ComputerSystem"]',
];
const MEMORY_KEYS = ['vm.memory.size[total]'];
const OS_KEYS = ['system.sw.os', 'system.sw.os[name]', 'system.uname'];
const PSEUDO_FS = /(^|\/)(boot|swap|tmpfs|devtmpfs|proc|sysfs|cgroup|overlay|squashfs)(\/|$)/i;

function isDiskItem(item) {
  const key = String(item.key_ || '');
  if (!key.endsWith(',total]')) return false;
  if (!key.startsWith('vfs.fs.dependent.size[') && !key.startsWith('vfs.fs.size[')) return false;
  const mount = key.replace(/^vfs\.fs\.(dependent\.)?size\[/, '').replace(/,total\]$/, '');
  return !PSEUDO_FS.test(mount);
}


function numberValue(value) {
  const parsed = Number(String(value ?? '').replace(',', '.').trim());
  return Number.isFinite(parsed) ? parsed : null;
}

function valueInBytes(value, units) {
  const parsed = numberValue(value);
  if (parsed === null) return null;
  const unit = String(units || '').trim().toUpperCase();
  if (['KB', 'KIB'].includes(unit)) return parsed * 1024;
  if (['MB', 'MIB'].includes(unit)) return parsed * 1024 ** 2;
  if (['GB', 'GIB'].includes(unit)) return parsed * 1024 ** 3;
  if (['TB', 'TIB'].includes(unit)) return parsed * 1024 ** 4;
  return parsed;
}

const MEMORY_OPTIONS = [4, 8, 12, 16, 32, 48, 64, 96, 128, 384, 480, 520, 1024];

function nearestMemory(bytes) {
  const gb = bytes / 1024 ** 3;
  return MEMORY_OPTIONS.reduce((best, value) => Math.abs(value - gb) < Math.abs(best - gb) ? value : best, MEMORY_OPTIONS[0]);
}

function nearestDisk(bytes) {
  const gb = bytes / 1024 ** 3;
  return Math.max(10, Math.round(gb / 10) * 10);
}


function pickItem(items, keys) {
  for (const key of keys) {
    const item = items.find((entry) => String(entry.key_) === key);
    if (item) return item;
  }
  return null;
}

async function ensureOsAsset(ci, osName, kernel, raw, cache = {}) {
  if (!osName) return null;
  if (!cache.osType) cache.osType = await db('ci_types').where({ code: 'os' }).first();
  if (!cache.osType) return null;
  const normalizedName = String(osName).trim().toLowerCase();
  const normalizedKernel = String(kernel || '').trim();
  const key = `${normalizedName}|${normalizedKernel.toLowerCase()}`;
  if (!cache.assets) cache.assets = new Map();
  let osId = cache.assets.get(key);
  if (!osId) {
    const rows = await db('cis')
      .join('ci_types', 'cis.ci_type_id', 'ci_types.id')
      .select('cis.*')
      .where('ci_types.code', 'os');
    const matching = rows.find((row) => {
      const attrs = parseJson(row.attributes, {});
      return String(row.name || '').trim().toLowerCase() === normalizedName
        && String(attrs.kernel_version || '').trim().toLowerCase() === normalizedKernel.toLowerCase();
    });
    if (matching) osId = matching.id;
    else {
      let assetNo = `OS-ZBX-${String(osName).replace(/[^a-zA-Z0-9_.-]/g, '-').slice(0, 48)}`;
      if (normalizedKernel) assetNo += `-${normalizedKernel.replace(/[^a-zA-Z0-9_.-]/g, '-').slice(0, 28)}`;
      let suffix = 1;
      const baseAssetNo = assetNo;
      while (await db('cis').where({ asset_no: assetNo }).first()) assetNo = `${baseAssetNo}-${suffix++}`;
      const ts = new Date().toISOString();
      osId = await insertReturningId(db('cis'), {
        asset_no: assetNo,
        name: osName,
        ci_type_id: cache.osType.id,
        status: 'in_use',
        criticality: 'medium',
        environment: ci.environment || 'production',
        os_name: osName,
        attributes: JSON.stringify({
          kernel_version: normalizedKernel,
          zabbix_os_raw: raw || '',
          zabbix_synced: true,
        }),
        created_at: ts,
        updated_at: ts,
      });
    }
    cache.assets.set(key, osId);
  }

  const current = await db('cis').where({ id: osId }).first();
  const attributes = {
    ...parseJson(current?.attributes, {}),
    kernel_version: normalizedKernel || parseJson(current?.attributes, {}).kernel_version || '',
    zabbix_os_raw: raw || parseJson(current?.attributes, {}).zabbix_os_raw || '',
    zabbix_synced: true,
  };
  await db('cis').where({ id: osId }).update({
    name: osName,
    os_name: osName,
    attributes: JSON.stringify(attributes),
    updated_at: new Date().toISOString(),
  });
  const relation = await db('ci_relations')
    .where({ source_ci_id: ci.id, relation_type: 'os_installed' })
    .first();
  if (relation) {
    if (Number(relation.target_ci_id) !== Number(osId)) {
      await db('ci_relations').where({ id: relation.id }).update({ target_ci_id: osId, description: 'Zabbix 自动识别操作系统' });
    }
  } else {
    await insertReturningId(db('ci_relations'), {
      source_ci_id: ci.id,
      target_ci_id: osId,
      relation_type: 'os_installed',
      description: 'Zabbix 自动识别操作系统',
      created_at: new Date().toISOString(),
    });
  }
  return osId;
}



export async function syncZabbixHostSpecs(integration, { force = true } = {}) {
  const cis = await db('cis')
    .where({ zabbix_integration_id: integration.id })
    .whereNot('zabbix_host_id', '');
  if (!cis.length) return { hosts: 0, updated: 0, skipped: 0 };
  const osRules = await getOsRules();

  const hostIds = [...new Set(cis.map((ci) => String(ci.zabbix_host_id)).filter(Boolean))];
  const allKeys = [...CPU_KEYS, ...MEMORY_KEYS, ...OS_KEYS];
  const items = await zabbixRpc(integration, 'item.get', {
    output: ['itemid', 'hostid', 'key_', 'lastvalue', 'units', 'value_type'],
    hostids: hostIds,
    filter: { key_: allKeys },
  });
  const macItems = await zabbixRpc(integration, 'item.get', {
    output: ['itemid', 'hostid', 'key_', 'lastvalue', 'units', 'value_type'],
    hostids: hostIds,
    search: { key_: 'system.hw.macaddr[' },
  });
  const diskItems = await zabbixRpc(integration, 'item.get', {
    output: ['itemid', 'hostid', 'key_', 'lastvalue', 'units', 'value_type'],
    hostids: hostIds,
    search: { key_: 'vfs.fs.dependent.size[' },
  });
  const legacyDiskItems = await zabbixRpc(integration, 'item.get', {
    output: ['itemid', 'hostid', 'key_', 'lastvalue', 'units', 'value_type'],
    hostids: hostIds,
    search: { key_: 'vfs.fs.size[' },
  });

  const rows = [
    ...(Array.isArray(items.result) ? items.result : []),
    ...(Array.isArray(macItems.result) ? macItems.result : []),
    ...(Array.isArray(diskItems.result) ? diskItems.result : []),
    ...(Array.isArray(legacyDiskItems.result) ? legacyDiskItems.result : []),
  ];
  const missing = rows.filter((item) => item.lastvalue === undefined || item.lastvalue === null || item.lastvalue === '');
  if (missing.length) {
    const itemids = missing.map((item) => item.itemid);
    const valueTypes = [...new Set(missing.map((item) => Number(item.value_type)))];
    for (const valueType of valueTypes) {
      const typeItems = missing.filter((item) => Number(item.value_type) === valueType);
      try {
        const history = await zabbixRpc(integration, 'history.get', {
          output: 'extend',
          history: valueType,
          itemids: typeItems.map((item) => item.itemid),
          sortfield: 'clock',
          sortorder: 'DESC',
          limit: Math.min(5000, typeItems.length * 3),
        });
        const latest = new Map();
        for (const entry of history.result || []) {
          const id = String(entry.itemid);
          if (!latest.has(id)) latest.set(id, entry.value);
        }
        for (const item of typeItems) item.lastvalue = latest.get(String(item.itemid));
      } catch {
        // Item history may be disabled or inaccessible; skip those values.
      }
    }
  }

  const byHost = new Map();
  for (const item of rows) {
    const hostId = String(item.hostid);
    if (!byHost.has(hostId)) byHost.set(hostId, []);
    byHost.get(hostId).push(item);
  }

  let updated = 0;
  let skipped = 0;
  const osAssetCache = {};
  for (const ci of cis) {
    const hostItems = byHost.get(String(ci.zabbix_host_id)) || [];
    const attributes = parseJson(ci.attributes, {});
    const previous = attributes.zabbix_specs || {};
    const storedOsName = ci.os_name || previous.os_name || '';
    const storedKernel = previous.kernel_version || attributes.kernel_version || '';
    const storedRaw = previous.os_raw || '';
    if (!hostItems.length) {
      if (storedOsName) {
        try { await ensureOsAsset(ci, storedOsName, storedKernel, storedRaw, osAssetCache); }
        catch (error) { console.error('[zabbix] OS asset sync failed', ci.asset_no, error.message); }
      }
      skipped += 1;
      continue;
    }
    const cpuItem = pickItem(hostItems, CPU_KEYS);
    const memoryItem = pickItem(hostItems, MEMORY_KEYS);
    const osItem = pickItem(hostItems, OS_KEYS);
    const macItem = hostItems.find((item) => String(item.key_ || '').startsWith('system.hw.macaddr[') && !/loopback|00:00:00:00:00:00/i.test(String(item.lastvalue || '')));
    const diskTotal = hostItems
      .filter(isDiskItem)
      .map((item) => valueInBytes(item.lastvalue, item.units))
      .filter((value) => value !== null)
      .reduce((sum, value) => sum + value, 0);
    const cpu = cpuItem ? numberValue(cpuItem.lastvalue) : null;
    const memory = memoryItem ? valueInBytes(memoryItem.lastvalue, memoryItem.units) : null;
    const disk = diskTotal > 0 ? diskTotal : null;
    const osName = osItem ? mapOperatingSystem(osItem.lastvalue, osRules).name : '';
    const kernel = osItem ? kernelFrom(osItem.lastvalue) : '';
    const effectiveOsName = osName || storedOsName;
    const effectiveKernel = kernel || storedKernel;
    const effectiveRaw = osItem ? String(osItem.lastvalue || '') : storedRaw;
    if (effectiveOsName) {
      try { await ensureOsAsset(ci, effectiveOsName, effectiveKernel, effectiveRaw, osAssetCache); }
      catch (error) { console.error('[zabbix] OS asset sync failed', ci.asset_no, error.message); }
    }
    const macAddress = macItem ? String(macItem.lastvalue || '').trim() : '';
    if (cpu === null && memory === null && disk === null && !osName && !macAddress) { skipped += 1; continue; }

    const update = {};
    if (cpu !== null && (force || !ci.cpu || ci.cpu === previous.cpu)) update.cpu = `${Math.round(cpu)} 核`;
    if (memory !== null && (force || !ci.memory || ci.memory === previous.memory)) update.memory = `${nearestMemory(memory)} GB`;
    if (disk !== null && (force || !ci.disk || ci.disk === previous.disk)) update.disk = `${nearestDisk(disk)} GB`;
    if (osName && (force || !ci.os_name || ci.os_name === previous.os_name)) update.os_name = osName;
    if (macAddress && !ci.mac_address) update.mac_address = macAddress;
    if (!Object.keys(update).length) { skipped += 1; continue; }
    attributes.zabbix_specs = {
      cpu: update.cpu || previous.cpu || '',
      memory: update.memory || previous.memory || '',
      disk: update.disk || previous.disk || '',
      os_name: update.os_name || previous.os_name || '',
      os_raw: osItem ? String(osItem.lastvalue || '') : (previous.os_raw || ''),
      kernel_version: kernel || previous.kernel_version || '',
      mac_address: update.mac_address || previous.mac_address || '',
      synced_at: new Date().toISOString(),
    };
    if (kernel && !attributes.kernel_version) attributes.kernel_version = kernel;
    await db('cis').where({ id: ci.id }).update({ ...update, attributes: JSON.stringify(attributes), updated_at: new Date().toISOString() });
    updated += 1;
  }

  // Remove orphaned Zabbix-generated OS assets left by the old per-host strategy.
  const usedOsIds = new Set([...(osAssetCache.assets?.values() || [])].map((id) => Number(id)));
  const linkedOsIds = new Set((await db('ci_relations').where({ relation_type: 'os_installed' }).select('target_ci_id')).map((row) => Number(row.target_ci_id)));
  const generatedOs = await db('cis')
    .join('ci_types', 'cis.ci_type_id', 'ci_types.id')
    .select('cis.id', 'cis.attributes')
    .where('ci_types.code', 'os')
    .where('cis.asset_no', 'like', 'OS-ZBX-%');
  for (const os of generatedOs) {
    if (usedOsIds.has(Number(os.id)) || linkedOsIds.has(Number(os.id))) continue;
    if (parseJson(os.attributes, {}).zabbix_synced) await db('cis').where({ id: os.id }).del();
  }
  return { hosts: cis.length, updated, skipped };
}
