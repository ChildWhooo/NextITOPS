import { db } from '../db/index.js';
import { authenticate, requirePermission } from '../lib/auth.js';
import { getSetting, setSetting } from '../lib/systemSettings.js';
import { audit } from '../lib/audit.js';

const STATUS_COLOR = { green: '#10b981', yellow: '#f59e0b', red: '#ef4444' };
const TYPE_ORDER = ['network', 'patch_panel', 'security', 'storage', 'server', 'industrial', 'virtualization_host', 'virtualization', 'vm', 'os', 'software', 'business', 'datacenter', 'rack'];
const DEFAULT_HIDDEN = ['datacenter', 'rack', 'os', 'patch_panel', 'software'];
const MAX_NODES = 120;
const PATCH_PANEL_HIDDEN_MIGRATION = 'topology_patch_panel_hidden_v1';
const SOFTWARE_HIDDEN_MIGRATION = 'topology_software_hidden_v1';

function nodeStatus(ci) {
  const status = String(ci.status || '').toLowerCase();
  if (['offline', 'down', 'error', 'failed'].includes(status)) return 'red';
  if (['maintenance', 'degraded', 'warning', 'retired'].includes(status)) return 'yellow';
  return 'green';
}

function edgeStatus(a, b) {
  if (a === 'red' || b === 'red') return 'red';
  if (a === 'yellow' || b === 'yellow') return 'yellow';
  return 'green';
}

function mapNode(row) {
  const status = nodeStatus(row);
  return {
    id: row.id,
    ci_type_id: row.ci_type_id,
    asset_no: row.asset_no,
    name: row.name,
    type_code: row.type_code,
    type_name: row.type_name,
    type_color: row.type_color || '#4f6ef7',
    status,
    status_color: STATUS_COLOR[status],
    criticality: row.criticality,
    environment: row.environment,
    ip_address: row.ip_address,
  };
}

function cleanIds(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map(Number).filter((id) => Number.isInteger(id) && id > 0))].slice(0, 500);
}

function cleanMembership(value) {
  return { add: cleanIds(value?.add), remove: cleanIds(value?.remove) };
}

function normalizeManualNodes(value) {
  const result = { global: cleanMembership(value?.global), focus: {} };
  const focus = value?.focus;
  if (focus && typeof focus === 'object' && !Array.isArray(focus)) {
    for (const [key, membership] of Object.entries(focus).slice(0, 200)) {
      if (/^\d+$/.test(key)) result.focus[key] = cleanMembership(membership);
    }
  }
  return result;
}

async function readLayout() {
  try { return JSON.parse(await getSetting('topology_layout', '{}')) || {}; } catch { return {}; }
}

async function ensureHiddenDefault(typeCode, migrationKey) {
  try {
    if (await getSetting(migrationKey, '')) return;
    let types = DEFAULT_HIDDEN;
    try {
      const stored = JSON.parse(await getSetting('topology_hidden_types', JSON.stringify(DEFAULT_HIDDEN)));
      if (Array.isArray(stored)) types = stored;
    } catch { types = DEFAULT_HIDDEN; }
    if (Array.isArray(types) && !types.includes(typeCode)) {
      await setSetting('topology_hidden_types', JSON.stringify([...types, typeCode]));
    }
    await setSetting(migrationKey, '1');
  } catch {
    // 拓扑隐藏类型迁移失败不阻断页面加载，下一次启动会重试。
  }
}

async function ensurePatchPanelHiddenDefault() {
  await ensureHiddenDefault('patch_panel', PATCH_PANEL_HIDDEN_MIGRATION);
}

async function ensureSoftwareHiddenDefault() {
  await ensureHiddenDefault('software', SOFTWARE_HIDDEN_MIGRATION);
}

async function fetchCis(ids) {
  if (!ids.length) return [];
  return db('cis')
    .join('ci_types', 'cis.ci_type_id', 'ci_types.id')
    .select('cis.id', 'cis.ci_type_id', 'cis.asset_no', 'cis.name', 'cis.status', 'cis.criticality', 'cis.environment', 'cis.ip_address', 'ci_types.code as type_code', 'ci_types.name as type_name', 'ci_types.color as type_color')
    .whereIn('cis.id', ids);
}

export default async function topologyRoutes(app) {
  await ensurePatchPanelHiddenDefault();
  await ensureSoftwareHiddenDefault();

  app.get('/api/topology/layout', { preHandler: authenticate }, async () => {
    try { return { data: JSON.parse(await getSetting('topology_layout', '{}')) }; } catch { return { data: {} }; }
  });

  app.put('/api/topology/layout', { preHandler: [authenticate, requirePermission('cmdb.edit')] }, async (request) => {
    const body = request.body || {};
    const positions = body.positions && typeof body.positions === 'object' ? body.positions : {};
    const edgeMetrics = body.edge_metrics && typeof body.edge_metrics === 'object' ? body.edge_metrics : {};
    const existing = await readLayout();
    const focusPositions = body.focus_positions !== undefined
      ? (body.focus_positions && typeof body.focus_positions === 'object' && !Array.isArray(body.focus_positions) ? body.focus_positions : {})
      : (existing.focus_positions || {});
    const manualNodes = body.manual_nodes !== undefined
      ? normalizeManualNodes(body.manual_nodes)
      : normalizeManualNodes(existing.manual_nodes);
    await setSetting('topology_layout', JSON.stringify({ positions, edge_metrics: edgeMetrics, focus_positions: focusPositions, manual_nodes: manualNodes }));
    await audit(request, { action: 'topology.layout', entityType: 'system', summary: '更新资产拓扑布局' });
    return { data: { positions, edge_metrics: edgeMetrics, focus_positions: focusPositions, manual_nodes: manualNodes } };
  });

  app.get('/api/topology/hidden-types', { preHandler: authenticate }, async () => {
    let types = DEFAULT_HIDDEN;
    try { const stored = JSON.parse(await getSetting('topology_hidden_types', JSON.stringify(DEFAULT_HIDDEN))); if (Array.isArray(stored)) types = stored; } catch { types = DEFAULT_HIDDEN; }
    return { data: types };
  });

  app.put('/api/topology/hidden-types', { preHandler: [authenticate, requirePermission('cmdb.edit')] }, async (request) => {
    const types = Array.isArray(request.body?.types) ? [...new Set(request.body.types.map(String))].slice(0, 50) : [];
    await setSetting('topology_hidden_types', JSON.stringify(types));
    await audit(request, { action: 'topology.hidden_types', entityType: 'system', summary: `更新拓扑隐藏类型：${types.join(',') || '无'}` });
    return { data: types };
  });

  app.get('/api/topology', { preHandler: [authenticate, requirePermission('cmdb.view')] }, async (request) => {
    const limit = Math.min(MAX_NODES, Math.max(20, Number(request.query.limit) || 80));
    let hiddenTypes = DEFAULT_HIDDEN;
    try { const stored = JSON.parse(await getSetting('topology_hidden_types', JSON.stringify(DEFAULT_HIDDEN))); if (Array.isArray(stored)) hiddenTypes = stored; } catch { hiddenTypes = DEFAULT_HIDDEN; }
    const hidden = new Set(hiddenTypes);
    const centerId = Number(request.query.ci_id) || null;
    const layout = await readLayout();
    const manualNodes = normalizeManualNodes(layout.manual_nodes);
    const scope = centerId ? (manualNodes.focus[String(centerId)] || { add: [], remove: [] }) : manualNodes.global;
    const extraIds = cleanIds(String(request.query.extra_ids || '').split(',').map((value) => Number(value)));
    const explicit = new Set([...scope.add, ...extraIds].slice(0, 100));
    const removed = new Set(scope.remove.filter((id) => id !== centerId && !explicit.has(id)));
    const selected = new Map();

    if (centerId) {
      const center = await fetchCis([centerId]);
      if (!center.length) return { data: { nodes: [], edges: [], center: null } };
      selected.set(center[0].id, center[0]);
      let frontier = [center[0].id];
      for (let depth = 0; depth < 2 && selected.size < limit; depth += 1) {
        if (!frontier.length) break;
        const relations = await db('ci_relations')
          .whereIn('source_ci_id', frontier)
          .orWhereIn('target_ci_id', frontier);
        const next = [];
        for (const relation of relations) {
          for (const id of [relation.source_ci_id, relation.target_ci_id]) {
            if (!selected.has(id) && selected.size < limit) next.push(id);
          }
        }
        if (next.length) {
          const rows = await fetchCis(next);
          for (const row of rows) selected.set(row.id, row);
        }
        frontier = next;
      }
    } else {
      const rows = await db('cis')
        .join('ci_types', 'cis.ci_type_id', 'ci_types.id')
        .select('cis.id', 'cis.ci_type_id', 'cis.asset_no', 'cis.name', 'cis.status', 'cis.criticality', 'cis.environment', 'cis.ip_address', 'ci_types.code as type_code', 'ci_types.name as type_name', 'ci_types.color as type_color')
        .whereIn('ci_types.code', TYPE_ORDER)
        .whereNotIn('ci_types.code', hiddenTypes)
        .orderBy('ci_types.code')
        .orderBy('cis.asset_no')
        .limit(limit);
      for (const row of rows) selected.set(row.id, row);
    }

    const missing = [...explicit].filter((id) => !selected.has(id)).slice(0, Math.max(0, MAX_NODES - selected.size));
    if (missing.length) {
      const rows = await fetchCis(missing);
      for (const row of rows) selected.set(row.id, row);
    }

    for (const [id, row] of [...selected]) {
      if (removed.has(id)) { selected.delete(id); continue; }
      if (id === centerId || explicit.has(id)) continue;
      if (hidden.has(row.type_code)) selected.delete(id);
    }

    const ids = [...selected.keys()];
    if (!ids.length) return { data: { nodes: [], edges: [], center: centerId } };
    const relationRows = await db('ci_relations').whereIn('source_ci_id', ids).whereIn('target_ci_id', ids);
    const relationTypes = await db('ci_relation_types').select('code', 'name', 'reverse_name');
    const typeMap = Object.fromEntries(relationTypes.map((row) => [row.code, row]));
    const nodes = [...selected.values()].map(mapNode);
    const nodeMap = new Map(nodes.map((node) => [node.id, node]));
    const edges = relationRows.map((row) => ({
      id: row.id,
      source: row.source_ci_id,
      target: row.target_ci_id,
      relation_type: row.relation_type,
      label: typeMap[row.relation_type]?.name || row.relation_type,
      status: edgeStatus(nodeMap.get(row.source_ci_id)?.status || 'green', nodeMap.get(row.target_ci_id)?.status || 'green'),
    }));
    return { data: { nodes, edges, center: centerId } };
  });
}
