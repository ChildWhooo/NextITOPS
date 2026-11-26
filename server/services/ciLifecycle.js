import { db } from '../db/index.js';
import { nowIso } from '../lib/helpers.js';

const HOST_TYPE_CODES = new Set(['server', 'vm']);
const LINKED_RELATION_TYPES = ['os_installed', 'software_installed'];
const LINKED_ASSET_TYPE_CODES = new Set(['os', 'software']);

async function loadLinkedAssets(hostId, conn = db) {
  return conn('ci_relations as relation')
    .join('cis as asset', 'relation.target_ci_id', 'asset.id')
    .join('ci_types as asset_type', 'asset.ci_type_id', 'asset_type.id')
    .where('relation.source_ci_id', hostId)
    .whereIn('relation.relation_type', LINKED_RELATION_TYPES)
    .whereIn('asset_type.code', [...LINKED_ASSET_TYPE_CODES])
    .select(
      'asset.id',
      'asset.asset_no',
      'asset.name',
      'asset.status',
      'asset_type.code as type_code',
    );
}

async function hasOnlineHost(assetId, conn = db) {
  const row = await conn('ci_relations as relation')
    .join('cis as host', 'relation.source_ci_id', 'host.id')
    .join('ci_types as host_type', 'host.ci_type_id', 'host_type.id')
    .where('relation.target_ci_id', assetId)
    .whereIn('relation.relation_type', LINKED_RELATION_TYPES)
    .whereIn('host_type.code', [...HOST_TYPE_CODES])
    .where('host.status', 'in_use')
    .first('host.id');
  return Boolean(row);
}

/**
 * Keep OS/software assets aligned with their host lifecycle.
 *
 * A linked asset stays in use while at least one online host still references
 * it. When the last online host goes offline the asset becomes offline. On host
 * deletion, an asset with no remaining online host is removed as well.
 */
export async function reconcileLinkedAssetsForHost(hostId, { deleteOrphans = false, conn = db } = {}) {
  const host = await conn('cis').where({ id: hostId }).first('id', 'ci_type_id');
  if (!host) return { updated: 0, deleted: 0 };

  const hostType = await conn('ci_types').where({ id: host.ci_type_id }).first('code');
  if (!hostType || !HOST_TYPE_CODES.has(hostType.code)) return { updated: 0, deleted: 0 };

  const assets = await loadLinkedAssets(hostId, conn);
  let updated = 0;
  let deleted = 0;

  for (const asset of assets) {
    const online = await hasOnlineHost(asset.id, conn);
    if (online) {
      if (asset.status !== 'in_use') {
        await conn('cis').where({ id: asset.id }).update({ status: 'in_use', updated_at: nowIso() });
        updated += 1;
      }
      continue;
    }

    if (deleteOrphans) {
      await conn('cis').where({ id: asset.id }).del();
      deleted += 1;
      continue;
    }

    if (asset.status !== 'offline') {
      await conn('cis').where({ id: asset.id }).update({ status: 'offline', updated_at: nowIso() });
      updated += 1;
    }
  }

  return { updated, deleted };
}

/**
 * Delete a CI and automatically remove its relations. For host assets, any
 * linked OS/software asset that no longer has an online host is deleted too.
 */
export async function deleteCIWithLinkedAssets(ciId) {
  return db.transaction(async (trx) => {
    const host = await trx('cis').where({ id: ciId }).first('id', 'ci_type_id');
    if (!host) return { deleted: false, linked_deleted: 0 };

    const hostType = await trx('ci_types').where({ id: host.ci_type_id }).first('code');
    const linkedAssets = hostType && HOST_TYPE_CODES.has(hostType.code)
      ? await loadLinkedAssets(ciId, trx)
      : [];

    await trx('ci_relations')
      .where('source_ci_id', ciId)
      .orWhere('target_ci_id', ciId)
      .del();
    await trx('cis').where({ id: ciId }).del();

    let linkedDeleted = 0;
    const seen = new Set();
    for (const asset of linkedAssets) {
      if (seen.has(asset.id)) continue;
      seen.add(asset.id);
      if (await hasOnlineHost(asset.id, trx)) continue;
      const exists = await trx('cis').where({ id: asset.id }).first('id');
      if (!exists) continue;
      await trx('ci_relations')
        .where('source_ci_id', asset.id)
        .orWhere('target_ci_id', asset.id)
        .del();
      await trx('cis').where({ id: asset.id }).del();
      linkedDeleted += 1;
    }

    return { deleted: true, linked_deleted: linkedDeleted };
  });
}
