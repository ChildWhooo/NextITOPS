import { useEffect, useMemo, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { Link2, Network, Pencil, Plus, RefreshCw, Save, Waypoints, X, ZoomIn, ZoomOut } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { usePageTitle } from '@/lib/hooks';
import { Badge, Button, EmptyState, Field, Modal, PageHeader, Spinner } from '@/components/ui';
import { SearchSelect } from '@/components/SearchSelect';
import { findRelationRule, getRelationRules, relationTargetMatchesRule, relationTypeMatchesRule } from '@/lib/ciRelations';
import type { CI } from '@/lib/types';

const TYPE_ORDER = ['network', 'patch_panel', 'security', 'storage', 'server', 'industrial', 'virtualization_host', 'virtualization', 'vm', 'os', 'software', 'business', 'datacenter', 'rack'];
const TYPE_LABEL: Record<string, string> = {
  datacenter: '数据中心', rack: '机柜', network: '网络', patch_panel: '网络配线架', storage: '存储', security: '安全', server: '服务器', virtualization_host: '虚拟化宿主机', virtualization: '虚拟化平台',
  vm: '虚拟机', os: '操作系统', software: '软件', business: '业务系统', industrial: '工控设备',
};
const STATUS_LABEL: Record<string, string> = { green: '健康', yellow: '告警', red: '异常' };
const STATUS_COLOR: Record<string, string> = { green: '#10b981', yellow: '#f59e0b', red: '#ef4444' };

interface TopoNode { id: number; ci_type_id: number; asset_no: string; name: string; type_code: string; type_name: string; type_color: string; status: string; status_color: string; ip_address?: string; }
interface TopoEdge { id: number; source: number; target: number; relation_type: string; label: string; status: string; }
interface ManualMembership { add: number[]; remove: number[]; }
interface ManualNodes { global: ManualMembership; focus: Record<string, ManualMembership>; }

const EMPTY_MEMBERSHIP = (): ManualMembership => ({ add: [], remove: [] });
const normalizeManual = (value: any): ManualNodes => ({
  global: { add: Array.isArray(value?.global?.add) ? value.global.add.map(Number) : [], remove: Array.isArray(value?.global?.remove) ? value.global.remove.map(Number) : [] },
  focus: value?.focus && typeof value.focus === 'object' ? Object.fromEntries(Object.entries(value.focus).map(([key, membership]: [string, any]) => [key, {
    add: Array.isArray(membership?.add) ? membership.add.map(Number) : [],
    remove: Array.isArray(membership?.remove) ? membership.remove.map(Number) : [],
  }])) : {},
});
const manualFor = (value: ManualNodes, center: number | null): ManualMembership => center ? (value.focus[String(center)] || EMPTY_MEMBERSHIP()) : value.global;

export default function TopologyPage() {
  usePageTitle('资产拓扑');
  const [nodes, setNodes] = useState<TopoNode[]>([]);
  const [edges, setEdges] = useState<TopoEdge[]>([]);
  const [center, setCenter] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [options, setOptions] = useState<CI[]>([]);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [selectedNode, setSelectedNode] = useState<number | null>(null);
  const [overrides, setOverrides] = useState<Record<string, { x: number; y: number }>>({});
  const [savedOverrides, setSavedOverrides] = useState<Record<string, { x: number; y: number }>>({});
  const [globalPositions, setGlobalPositions] = useState<Record<string, { x: number; y: number }>>({});
  const [savedGlobalPositions, setSavedGlobalPositions] = useState<Record<string, { x: number; y: number }>>({});
  const [focusPositions, setFocusPositions] = useState<Record<string, Record<string, { x: number; y: number }>>>({});
  const [savedFocusPositions, setSavedFocusPositions] = useState<Record<string, Record<string, { x: number; y: number }>>>({});
  const [manualNodes, setManualNodes] = useState<ManualNodes>({ global: EMPTY_MEMBERSHIP(), focus: {} });
  const [savedManualNodes, setSavedManualNodes] = useState<ManualNodes>({ global: EMPTY_MEMBERSHIP(), focus: {} });
  const [addOpen, setAddOpen] = useState(false);
  const [addSearch, setAddSearch] = useState('');
  const [addOptions, setAddOptions] = useState<CI[]>([]);
  const [addSelected, setAddSelected] = useState<number[]>([]);
  const [edgeMetrics, setEdgeMetrics] = useState<Record<string, string>>({});
  const [savedEdgeMetrics, setSavedEdgeMetrics] = useState<Record<string, string>>({});
  const [nodeDrag, setNodeDrag] = useState<{ id: number; offsetX: number; offsetY: number } | null>(null);
  const [connectingFrom, setConnectingFrom] = useState<number | null>(null);
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);
  const [hoverNode, setHoverNode] = useState<number | null>(null);
  const [hoverEdge, setHoverEdge] = useState<number | null>(null);
  const [savingLayout, setSavingLayout] = useState(false);
  const [relationOpen, setRelationOpen] = useState(false);
  const [relationTypes, setRelationTypes] = useState<any[]>([]);
  const [relationType, setRelationType] = useState('connects_to');
  const [relationTarget, setRelationTarget] = useState('');
  const [relationDescription, setRelationDescription] = useState('');
  const [relationSearch, setRelationSearch] = useState('');
  const [relationOptions, setRelationOptions] = useState<CI[]>([]);
  const [savingRelation, setSavingRelation] = useState(false);
  const [collapsedHubs, setCollapsedHubs] = useState<number[]>([]);
  const [hiddenOpen, setHiddenOpen] = useState(false);
  const [hiddenTypes, setHiddenTypes] = useState<string[]>(['datacenter', 'rack', 'os']);
  const [allTypes, setAllTypes] = useState<any[]>([]);
  const [hiddenSaving, setHiddenSaving] = useState(false);

  const load = async (ciId?: number | null, extraIds: number[] = []) => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (ciId) params.set('ci_id', String(ciId));
      if (extraIds.length) params.set('extra_ids', [...new Set(extraIds)].slice(0, 100).join(','));
      const query = params.toString();
      const response = await api.get<{ data: { nodes: TopoNode[]; edges: TopoEdge[]; center: number | null } }>(`/api/topology${query ? `?${query}` : ''}`);
      setNodes(response.data.nodes);
      setEdges(response.data.edges);
      setCenter(response.data.center);
      setZoom(1);
      setPan({ x: 0, y: 0 });
    } catch (error: any) {
      toast.error(error.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);
  useEffect(() => {
    if (center) { setCollapsedHubs([]); return; }
    const degree = new Map<number, number>();
    for (const edge of edges) {
      degree.set(edge.source, (degree.get(edge.source) || 0) + 1);
      degree.set(edge.target, (degree.get(edge.target) || 0) + 1);
    }
    setCollapsedHubs([...degree.entries()].filter(([id, value]) => value > 6 && !nodes.find((node) => node.id === id)?.type_code?.includes('vm')).map(([id]) => id));
  }, [edges, nodes, center]);
  useEffect(() => {
    api.get<{ data: any }>('/api/topology/layout').then((response) => {
      const positions = response.data?.positions || {};
      const focus = response.data?.focus_positions || {};
      const metrics = response.data?.edge_metrics || {};
      const manual = normalizeManual(response.data?.manual_nodes);
      setGlobalPositions(positions);
      setSavedGlobalPositions(positions);
      setFocusPositions(focus);
      setSavedFocusPositions(focus);
      setOverrides(positions);
      setSavedOverrides(positions);
      setEdgeMetrics(metrics);
      setSavedEdgeMetrics(metrics);
      setManualNodes(manual);
      setSavedManualNodes(manual);
    }).catch(() => {});
    api.get<{ data: any[] }>('/api/ci-relation-types?enabled=true').then((response) => setRelationTypes(response.data)).catch(() => {});
    api.get<{ data: any[] }>('/api/ci-types').then((response) => setAllTypes(response.data)).catch(() => {});
    api.get<{ data: string[] }>('/api/topology/hidden-types').then((response) => setHiddenTypes(response.data || ['datacenter', 'rack', 'os'])).catch(() => {});
  }, []);
  useEffect(() => {
    const key = center ? String(center) : '';
    setOverrides(key ? focusPositions[key] || {} : globalPositions);
    setSavedOverrides(key ? savedFocusPositions[key] || {} : savedGlobalPositions);
  }, [center, globalPositions, focusPositions, savedGlobalPositions, savedFocusPositions]);
  useEffect(() => {
    if (!relationOpen) return;
    const sourceTypeCode = nodes.find((node) => node.id === selectedNode)?.type_code;
    const targetTypes = findRelationRule(getRelationRules(sourceTypeCode), relationType)?.targets || [];
    const typeQuery = targetTypes.length ? `&types=${encodeURIComponent(targetTypes.join(','))}` : '';
    let cancelled = false;
    const timer = setTimeout(() => {
      api.get<{ data: CI[] }>(`/api/cis/options?q=${encodeURIComponent(relationSearch)}&limit=500${typeQuery}`).then((response) => {
        if (!cancelled) setRelationOptions(response.data.filter((item) => item.id !== selectedNode));
      }).catch(() => {});
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [relationOpen, selectedNode, nodes, relationType, relationSearch]);
  useEffect(() => {
    const timer = setTimeout(() => {
      api.get<{ data: CI[] }>(`/api/cis/options?q=${encodeURIComponent(search)}`).then((response) => setOptions(response.data)).catch(() => {});
    }, 250);
    return () => clearTimeout(timer);
  }, [search]);
  useEffect(() => {
    if (!addOpen) return;
    const timer = setTimeout(() => {
      api.get<{ data: CI[] }>(`/api/cis/options?q=${encodeURIComponent(addSearch)}&limit=500`)
        .then((response) => setAddOptions(response.data.filter((item) => !nodes.some((node) => node.id === item.id))))
        .catch(() => {});
    }, 200);
    return () => clearTimeout(timer);
  }, [addOpen, addSearch, nodes]);

  const layout = useMemo(() => {
    const applyOverrides = (positions: Map<number, { x: number; y: number }>) => {
      for (const node of nodes) {
        const saved = overrides[String(node.id)];
        if (saved && Number.isFinite(saved.x) && Number.isFinite(saved.y)) positions.set(node.id, saved);
      }
      return positions;
    };
    const positions = new Map<number, { x: number; y: number }>();
    if (center) {
      const centerNode = nodes.find((node) => node.id === center) || nodes[0];
      if (!centerNode) return positions;
      positions.set(centerNode.id, { x: 600, y: 350 });
      const others = nodes.filter((node) => node.id !== centerNode.id);
      others.forEach((node, index) => {
        const angle = (Math.PI * 2 * index) / Math.max(1, others.length) - Math.PI / 2;
        const radius = index < 10 ? 250 : 400;
        positions.set(node.id, { x: 600 + Math.cos(angle) * radius, y: 350 + Math.sin(angle) * radius });
      });
      return applyOverrides(positions);
    }
    const groups = new Map<string, TopoNode[]>();
    for (const node of nodes) {
      const code = TYPE_ORDER.includes(node.type_code) ? node.type_code : 'server';
      if (!groups.has(code)) groups.set(code, []);
      groups.get(code)!.push(node);
    }
    const activeColumns = TYPE_ORDER.filter((code) => groups.get(code)?.length);
    activeColumns.forEach((code, columnIndex) => {
      const group = groups.get(code) || [];
      const x = 100 + columnIndex * (1000 / Math.max(1, activeColumns.length - 1));
      group.forEach((node, rowIndex) => {
        const gap = 500 / Math.max(1, group.length - 1);
        positions.set(node.id, { x, y: group.length === 1 ? 360 : 105 + rowIndex * gap });
      });
    });
    return applyOverrides(positions);
  }, [nodes, center, overrides]);

  const nodeMap = new Map(nodes.map((node) => [node.id, node]));
  const currentManual = manualFor(manualNodes, center);
  const adjacency = new Map<number, number[]>();
  for (const edge of edges) {
    adjacency.set(edge.source, [...(adjacency.get(edge.source) || []), edge.target]);
    adjacency.set(edge.target, [...(adjacency.get(edge.target) || []), edge.source]);
  }
  const hiddenNodes = new Set<number>();
  const collapsedCounts = new Map<number, number>();
  if (!editMode && !center) {
    for (const hub of collapsedHubs) {
      const neighbors = adjacency.get(hub) || [];
      const leaves = neighbors.filter((id) => (adjacency.get(id) || []).length <= 1);
      leaves.forEach((id) => hiddenNodes.add(id));
      if (leaves.length) collapsedCounts.set(hub, leaves.length);
    }
  }
  for (const id of currentManual.remove) if (id !== center) hiddenNodes.add(id);
  const visibleNodes = nodes.filter((node) => !hiddenNodes.has(node.id));
  const visibleEdges = edges.filter((edge) => !hiddenNodes.has(edge.source) && !hiddenNodes.has(edge.target));
  const statusCounts = visibleNodes.reduce<Record<string, number>>((counts, node) => ({ ...counts, [node.status]: (counts[node.status] || 0) + 1 }), {});

  const selectedTopoNode = selectedNode ? nodeMap.get(selectedNode) : undefined;
  const selectedTopoRules = getRelationRules(selectedTopoNode?.type_code);
  const compatibleTopoRelationTypes = relationTypes.filter((type) => relationTypeMatchesRule(type, findRelationRule(selectedTopoRules, type.code), selectedTopoNode?.ci_type_id || 0));
  const selectedTopoRule = findRelationRule(selectedTopoRules, relationType);
  const selectedTopoRelationType = relationTypes.find((type) => type.code === relationType);
  const compatibleTopoRelationTargets = relationOptions.filter((item) => relationTargetMatchesRule(selectedTopoRule, selectedTopoRelationType, item.ci_type_id, item.type_code));

  const openRelationFor = (nodeId: number) => {
    const node = nodeMap.get(nodeId);
    const rules = getRelationRules(node?.type_code);
    if (!rules.length) return toast.error('当前资产类型尚未配置可建立的关系');
    const available = relationTypes.filter((type) => relationTypeMatchesRule(type, findRelationRule(rules, type.code), node?.ci_type_id || 0));
    if (!available.length) return toast.error('当前资产类型没有可用的关系类型');
    setSelectedNode(nodeId);
    if (!available.some((type) => type.code === relationType)) setRelationType(available[0].code);
    setRelationTarget('');
    setRelationDescription('');
    setRelationSearch('');
    setRelationOpen(true);
  };

  const connectTo = (sourceId: number, targetId: number) => {
    const source = nodeMap.get(sourceId);
    const target = nodeMap.get(targetId);
    const rules = getRelationRules(source?.type_code);
    const available = relationTypes.filter((type) => relationTypeMatchesRule(type, findRelationRule(rules, type.code), source?.ci_type_id || 0));
    if (!available.length) return toast.error('当前资产类型没有可用的关系类型');
    const initialType = available.find((type) => type.code === relationType) || available[0];
    const rule = findRelationRule(rules, initialType.code);
    if (!target || !relationTargetMatchesRule(rule, initialType, target.ci_type_id, target.type_code)) {
      return toast.error('这两个资产之间不能建立当前类型的关系');
    }
    setSelectedNode(sourceId);
    setRelationType(initialType.code);
    setRelationTarget(String(targetId));
    setRelationDescription('');
    setRelationSearch('');
    setRelationOpen(true);
  };

  const updateCurrentManual = (updater: (membership: ManualMembership) => ManualMembership) => {
    setManualNodes((current) => {
      if (!center) return { ...current, global: updater(current.global) };
      const key = String(center);
      return { ...current, focus: { ...current.focus, [key]: updater(current.focus[key] || EMPTY_MEMBERSHIP()) } };
    });
  };

  const removeFromView = (nodeId: number) => {
    if (nodeId === center) return toast.error('聚焦资产是当前视图中心，不能从视图移除');
    const node = nodeMap.get(nodeId);
    updateCurrentManual((membership) => ({
      add: membership.add.filter((id) => id !== nodeId),
      remove: [...new Set([...membership.remove, nodeId])],
    }));
    setSelectedNode((current) => current === nodeId ? null : current);
    toast.success(`已从当前视图移除「${node?.name || node?.asset_no || '资产'}」，资产本身未删除；保存布局后生效`);
  };

  const addToView = async () => {
    if (!addSelected.length) return toast.error('请选择要添加的资产');
    const ids = [...addSelected];
    const nextAdd = [...new Set([...currentManual.add, ...ids])];
    updateCurrentManual((membership) => ({
      add: nextAdd,
      remove: membership.remove.filter((id) => !ids.includes(id)),
    }));
    setAddOpen(false);
    setAddSelected([]);
    setAddSearch('');
    toast.success(`已向当前视图添加 ${ids.length} 个资产`);
    await load(center, nextAdd);
  };

  const saveLayout = async () => {
    setSavingLayout(true);
    try {
      const key = center ? String(center) : '';
      const nextGlobal = key ? globalPositions : overrides;
      const nextFocus = key ? { ...focusPositions, [key]: overrides } : focusPositions;
      const membership = manualFor(manualNodes, center);
      const nextManual = center
        ? { ...manualNodes, focus: { ...manualNodes.focus, [key]: membership } }
        : { ...manualNodes, global: membership };
      await api.put('/api/topology/layout', { positions: nextGlobal, focus_positions: nextFocus, edge_metrics: edgeMetrics, manual_nodes: nextManual });
      setGlobalPositions(nextGlobal);
      setSavedGlobalPositions(nextGlobal);
      setFocusPositions(nextFocus);
      setSavedFocusPositions(nextFocus);
      setManualNodes(nextManual);
      setSavedManualNodes(nextManual);
      setSavedOverrides(overrides);
      setSavedEdgeMetrics(edgeMetrics);
      toast.success(key ? '当前资产的拓扑位置与视图成员已保存，不影响全局布局' : '全局拓扑布局与视图成员已保存');
      setEditMode(false);
      setSelectedNode(null);
      setConnectingFrom(null);
      await load(center);
    } catch (error: any) {
      toast.error(error.message);
    } finally {
      setSavingLayout(false);
    }
  };

  const toggleEditMode = () => {
    if (editMode) {
      setOverrides(savedOverrides);
      setEdgeMetrics(savedEdgeMetrics);
      setManualNodes(savedManualNodes);
      setConnectingFrom(null);
      setCursor(null);
      setSelectedNode(null);
      setEditMode(false);
      load(center);
    } else {
      setEditMode(true);
    }
  };

  const svgPointFrom = (svg: SVGSVGElement | null, clientX: number, clientY: number) => {
    if (!svg) return { x: 0, y: 0 };
    const point = svg.createSVGPoint();
    point.x = clientX;
    point.y = clientY;
    const matrix = svg.getScreenCTM();
    if (!matrix) return { x: 0, y: 0 };
    return point.matrixTransform(matrix.inverse());
  };

  const svgPoint = (event: ReactPointerEvent<SVGSVGElement>) => svgPointFrom(event.currentTarget, event.clientX, event.clientY);

  const saveHiddenTypes = async () => {
    setHiddenSaving(true);
    try {
      await api.put('/api/topology/hidden-types', { types: hiddenTypes });
      setHiddenOpen(false);
      toast.success('拓扑显示类型已保存');
      await load(center);
    } catch (error: any) {
      toast.error(error.message);
    } finally {
      setHiddenSaving(false);
    }
  };

  const saveRelation = async () => {
    if (!selectedNode || !relationTarget) return toast.error('请选择目标资产');
    if (!selectedTopoRule) return toast.error('当前资产类型不支持该关系');
    setSavingRelation(true);
    try {
      const sourceId = selectedTopoRule.reverse ? Number(relationTarget) : selectedNode;
      const targetId = selectedTopoRule.reverse ? selectedNode : Number(relationTarget);
      await api.post(`/api/cis/${sourceId}/relations`, { target_ci_id: targetId, relation_type: relationType, description: relationDescription });
      toast.success('连接关系已创建');
      setRelationOpen(false);
      setRelationTarget('');
      setRelationDescription('');
      await load(center, currentManual.add);
    } catch (error: any) {
      toast.error(error.message);
    } finally {
      setSavingRelation(false);
    }
  };

  const onSvgPointerMove = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (connectingFrom) {
      const point = svgPoint(event);
      setCursor({ x: point.x, y: point.y });
      return;
    }
    if (nodeDrag) {
      const point = svgPoint(event);
      const rawX = point.x - nodeDrag.offsetX;
      const rawY = point.y - nodeDrag.offsetY;
      const snap = (value: number, axis: 'x' | 'y') => {
        const neighbors = [...layout.entries()].filter(([id]) => id !== nodeDrag.id).map(([, position]) => position[axis]);
        const nearest = neighbors.reduce<number | null>((best, current) => Math.abs(current - value) < 12 && (best === null || Math.abs(current - value) < Math.abs(best - value)) ? current : best, null);
        return nearest ?? Math.round(value / 20) * 20;
      };
      setOverrides((current) => ({ ...current, [String(nodeDrag.id)]: { x: snap(rawX, 'x'), y: snap(rawY, 'y') } }));
      return;
    }
    if (!dragging) return;
    setPan((current) => ({ x: current.x + event.movementX, y: current.y + event.movementY }));
  };

  return (
    <div className="animate-enter">
      <PageHeader
        className="mb-2"
        eyebrow="Asset topology"
        title="资产拓扑"
        description="以资产为中心查看上下游关系，节点和连线按监控健康状态着色。"
        actions={<div className="flex items-center gap-2"><Button variant="secondary" size="sm" icon={Pencil} onClick={toggleEditMode}>{editMode ? '退出编辑' : '编辑拓扑'}</Button>{editMode ? <Button variant="secondary" size="sm" icon={Save} loading={savingLayout} onClick={saveLayout}>保存布局</Button> : <Button variant="secondary" size="sm" icon={RefreshCw} onClick={() => load(center)}>刷新</Button>}</div>}
      />
      <div className="card mb-2 flex flex-wrap items-center gap-2 p-2">
        <div className="w-full sm:w-[320px]">
          <SearchSelect
            className="h-10"
            value=""
            onChange={(value) => { if (value) { setSearch(''); load(Number(value)); } }}
            onQueryChange={setSearch}
            placeholder="搜索资产名称或编号…"
            options={options.map((ci) => ({ value: String(ci.id), label: `${ci.asset_no} · ${ci.name}`, description: ci.type_name || '' }))}
          />
        </div>
        {center ? <Button className="h-10" variant="secondary" size="sm" icon={Network} onClick={() => load(null)}>显示全局拓扑</Button> : null}
        <Button className="h-10" variant="secondary" size="sm" icon={Waypoints} onClick={() => setHiddenOpen(true)}>隐藏类型</Button>
        {editMode ? <>
          <Button className="h-10" variant="secondary" size="sm" icon={Plus} onClick={() => { setAddOpen(true); setAddSelected([]); setAddSearch(''); }}>添加资产</Button>
          <Button className="h-10" variant="secondary" size="sm" icon={X} disabled={!selectedNode || selectedNode === center} onClick={() => selectedNode && removeFromView(selectedNode)}>从视图移除</Button>
          <Button className="h-10" variant="secondary" size="sm" icon={Link2} disabled={!selectedNode} onClick={() => selectedNode && openRelationFor(selectedNode)}>新增连接</Button>
        </> : null}
        <div className="ml-auto flex items-center gap-3 text-[10px] text-slate-500">
          {(['green', 'yellow', 'red'] as const).map((status) => <span key={status} className="flex items-center gap-1"><span className="h-2 w-2 rounded-full" style={{ background: STATUS_COLOR[status] }} />{STATUS_LABEL[status]} {statusCounts[status] || 0}</span>)}
          <Badge className="bg-slate-100 text-slate-500 ring-slate-500/10">{visibleNodes.length} 节点 / {visibleEdges.length} 连线</Badge>
        </div>
      </div>

      <div className="card relative overflow-hidden p-0">
        {loading ? <div className="flex h-[640px] items-center justify-center"><Spinner /></div> : !visibleNodes.length ? (
          <EmptyState title="暂无拓扑数据" description="先在 CI 关系中建立资产关联，或选择一台资产查看周边关系。" icon={Waypoints} className="py-24" />
        ) : (
          <>
            <div className="pointer-events-none absolute left-4 top-3 z-10 text-[9px] text-slate-400">
              {center ? '点击节点继续以该资产为中心展开' : '默认按 网络 → 安全 → 存储 → 服务器 → 虚拟化宿主机 → 虚拟化平台 → 虚拟机 → 软件 / 业务 分层；点击节点聚焦'}
            </div>
            <div className="absolute right-4 top-3 z-10 flex items-center gap-1">
              <button onClick={() => setZoom((value) => { const next = Math.max(0.5, value - 0.15); setPan((current) => ({ x: 600 - (600 - current.x) * (next / value), y: 360 - (360 - current.y) * (next / value) })); return next; })} className="rounded-lg border border-slate-200 bg-white p-1.5 text-slate-500 shadow-sm transition hover:border-brand-300 hover:text-brand-600" title="缩小"><ZoomOut className="h-3.5 w-3.5" /></button>
              <span className="w-10 text-center text-[9px] text-slate-400">{Math.round(zoom * 100)}%</span>
              <button onClick={() => setZoom((value) => { const next = Math.min(2.5, value + 0.15); setPan((current) => ({ x: 600 - (600 - current.x) * (next / value), y: 360 - (360 - current.y) * (next / value) })); return next; })} className="rounded-lg border border-slate-200 bg-white p-1.5 text-slate-500 shadow-sm transition hover:border-brand-300 hover:text-brand-600" title="放大"><ZoomIn className="h-3.5 w-3.5" /></button>
              <button onClick={() => { setZoom(1); setPan({ x: 0, y: 0 }); }} className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-[9px] text-slate-500 shadow-sm transition hover:border-brand-300 hover:text-brand-600">复位</button>
            </div>
            <svg
              viewBox="0 0 1200 720"
              className="h-[calc(100vh-250px)] min-h-[520px] w-full cursor-grab active:cursor-grabbing"
              role="img"
              aria-label="资产拓扑图"
              onWheel={(event) => { event.preventDefault(); setZoom((value) => { const next = Math.min(2.5, Math.max(0.5, value - event.deltaY * 0.001)); setPan((current) => ({ x: 600 - (600 - current.x) * (next / value), y: 360 - (360 - current.y) * (next / value) })); return next; }); }}
              onPointerDown={(event) => { if (event.button !== 0) return; if ((event.target as Element).closest('[data-node-id]')) return; if (editMode && (event.target as Element).closest('[data-edge-id]')) return; setDragging(true); event.currentTarget.setPointerCapture(event.pointerId); }}
              onPointerMove={onSvgPointerMove}
              onPointerUp={() => { if (connectingFrom) { setConnectingFrom(null); setCursor(null); } setDragging(false); setNodeDrag(null); }}
              onPointerLeave={() => { setDragging(false); setNodeDrag(null); }}
            >
              <defs>
                <pattern id="topology-grid" width="20" height="20" patternUnits="userSpaceOnUse"><path d="M 20 0 L 0 0 0 20" fill="none" stroke="#eef2f7" strokeWidth="1" /></pattern>
                <marker id="arrow-green" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 Z" fill={STATUS_COLOR.green} /></marker>
                <marker id="arrow-yellow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 Z" fill={STATUS_COLOR.yellow} /></marker>
                <marker id="arrow-red" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 Z" fill={STATUS_COLOR.red} /></marker>
              </defs>
              <g transform={`translate(${pan.x}, ${pan.y}) scale(${zoom})`}>
              {editMode ? <rect x="-600" y="-360" width="2400" height="1440" fill="url(#topology-grid)" opacity="0.75" /> : null}
              {visibleEdges.map((edge) => {
                const from = layout.get(edge.source);
                const to = layout.get(edge.target);
                if (!from || !to) return null;
                return <g key={edge.id} data-edge-id={edge.id} className={editMode ? 'cursor-pointer' : ''} onPointerDown={(event) => { if (editMode) event.stopPropagation(); }} onPointerEnter={() => setHoverEdge(edge.id)} onPointerLeave={() => setHoverEdge((current) => current === edge.id ? null : current)} onClick={() => {
                  if (!editMode) return;
                  if (!window.confirm(`删除连接「${edge.label}」并取消两端资产的关联关系？`)) return;
                  api.delete(`/api/cis/${edge.source}/relations/${edge.id}`).then(() => {
                    toast.success('连接关系已删除');
                    load(center);
                  }).catch((error: any) => toast.error(error.message));
                }} onContextMenu={(event) => {
                  if (!editMode) return;
                  event.preventDefault();
                  const value = window.prompt('该连接的 Zabbix 监控项 Key（留空清除）', edgeMetrics[String(edge.id)] || '');
                  if (value !== null) setEdgeMetrics((current) => ({ ...current, [String(edge.id)]: value }));
                }}>
                  <title>{editMode ? `点击删除连接：${edge.label}` : edge.label}</title>
                  <line x1={from.x} y1={from.y} x2={to.x} y2={to.y} stroke="#ffffff" strokeOpacity="0" strokeWidth="16" pointerEvents="stroke" />
                  <line x1={from.x} y1={from.y} x2={to.x} y2={to.y} stroke={STATUS_COLOR[edge.status]} strokeWidth={hoverEdge === edge.id && editMode ? 2.6 : 1.4} strokeOpacity={hoverEdge === edge.id && editMode ? 0.95 : 0.55} markerEnd={`url(#arrow-${edge.status})`} />
                  {(edges.length <= 30 || edgeMetrics[String(edge.id)]) ? <text x={(from.x + to.x) / 2} y={(from.y + to.y) / 2 - 4} textAnchor="middle" fontSize="8" fill={edgeMetrics[String(edge.id)] ? '#4f6ef7' : '#94a3b8'}>{edgeMetrics[String(edge.id)] || edge.label}</text> : null}
                  {editMode && hoverEdge === edge.id ? <><circle cx={from.x + (to.x - from.x) * 0.68} cy={from.y + (to.y - from.y) * 0.68} r="7" fill="#fff" stroke="#ef4444" strokeWidth="1.4" pointerEvents="none" /><path d={`M ${from.x + (to.x - from.x) * 0.68 - 2.5} ${from.y + (to.y - from.y) * 0.68 - 2.5} L ${from.x + (to.x - from.x) * 0.68 + 2.5} ${from.y + (to.y - from.y) * 0.68 + 2.5} M ${from.x + (to.x - from.x) * 0.68 + 2.5} ${from.y + (to.y - from.y) * 0.68 - 2.5} L ${from.x + (to.x - from.x) * 0.68 - 2.5} ${from.y + (to.y - from.y) * 0.68 + 2.5}`} stroke="#ef4444" strokeWidth="1.4" pointerEvents="none" /></> : null}
                </g>;
              })}
              {connectingFrom && cursor && layout.get(connectingFrom) ? <line x1={layout.get(connectingFrom)!.x} y1={layout.get(connectingFrom)!.y} x2={cursor.x} y2={cursor.y} stroke="#4f6ef7" strokeWidth="1.2" strokeDasharray="5 4" /> : null}
              {connectingFrom && cursor ? <g transform={`translate(${cursor.x}, ${cursor.y})`} className="pointer-events-none"><line x1="-4" y1="-4" x2="4" y2="4" stroke="#0f172a" strokeWidth="1.5" /><line x1="-4" y1="4" x2="4" y2="-4" stroke="#0f172a" strokeWidth="1.5" /></g> : null}
              {visibleNodes.map((node) => {
                const position = layout.get(node.id);
                if (!position) return null;
                return <g key={node.id} data-node-id={node.id} transform={`translate(${position.x}, ${position.y})`} className={editMode ? 'cursor-move' : 'cursor-pointer'} onClick={() => {
                  if (editMode) setSelectedNode(node.id);
                  else load(node.id);
                }} onPointerUp={(event) => {
                  if (!editMode || !connectingFrom || connectingFrom === node.id) return;
                  event.stopPropagation();
                  connectTo(connectingFrom, node.id);
                  setConnectingFrom(null);
                  setCursor(null);
                }} onPointerEnter={() => setHoverNode(node.id)} onPointerLeave={() => setHoverNode((current) => current === node.id ? null : current)} onPointerDown={(event) => {
                  if (!editMode) return;
                  event.stopPropagation();
                  if (connectingFrom) return;
                  const point = svgPointFrom(event.currentTarget.ownerSVGElement, event.clientX, event.clientY);
                  setSelectedNode(node.id);
                  setNodeDrag({ id: node.id, offsetX: point.x - position.x, offsetY: point.y - position.y });
                  event.currentTarget.setPointerCapture(event.pointerId);
                }}>
                  {editMode && (selectedNode === node.id || (connectingFrom && hoverNode === node.id)) ? <rect x="-72" y="-29" width="144" height="58" rx="12" fill={connectingFrom && hoverNode === node.id ? 'var(--theme-primary-light)' : 'none'} stroke="var(--theme-primary)" strokeWidth="2" strokeDasharray="4 3" /> : null}
                  {editMode ? <g transform="translate(70, -20)" className="cursor-crosshair" onClick={(event) => { event.stopPropagation(); setConnectingFrom(null); setCursor(null); openRelationFor(node.id); }} onPointerDown={(event) => { event.stopPropagation(); setConnectingFrom(node.id); setCursor(position); setSelectedNode(node.id); }}><circle r="7" fill="transparent" /><line x1="-4" y1="0" x2="4" y2="0" stroke="#0f172a" strokeWidth="2" /><line x1="0" y1="-4" x2="0" y2="4" stroke="#0f172a" strokeWidth="2" /></g> : null}
                  <rect x="-68" y="-25" width="136" height="50" rx="9" fill="#fff" stroke={node.id === center ? 'var(--theme-primary)' : '#e2e8f0'} strokeWidth={node.id === center ? 2.5 : 1} />
                  <circle cx="-52" cy="-13" r="5" fill={node.status_color} />
                  <text x="-42" y="-9" fontSize="8.5" fill="#94a3b8">{node.type_name || TYPE_LABEL[node.type_code] || node.type_code}</text>
                  <text x="-58" y="6" fontSize="9.5" fontWeight="600" fill="#334155">{node.name.length > 13 ? `${node.name.slice(0, 13)}…` : node.name}</text>
                  <text x="-58" y="18" fontSize="7.5" fill="#94a3b8">{node.asset_no}</text>
                  {node.ip_address ? <text x="58" y="18" textAnchor="end" fontSize="7" fill="#cbd5e1">{node.ip_address}</text> : null}
                  {editMode && node.id !== center ? <g transform="translate(-61, -20)" className="cursor-pointer" onClick={(event) => { event.stopPropagation(); removeFromView(node.id); }} onPointerDown={(event) => event.stopPropagation()} onPointerUp={(event) => event.stopPropagation()}><circle r="6.5" fill="#ef4444" /><path d="M -2.5 -2.5 L 2.5 2.5 M 2.5 -2.5 L -2.5 2.5" stroke="#fff" strokeWidth="1.4" /></g> : null}
                  {collapsedCounts.get(node.id) ? <g transform="translate(58, -22)" onClick={(event) => { event.stopPropagation(); setCollapsedHubs((current) => current.filter((id) => id !== node.id)); }} className="cursor-pointer"><circle r="8" fill="#0f172a" /><text y="3" textAnchor="middle" fontSize="8" fontWeight="700" fill="#fff">+{collapsedCounts.get(node.id)}</text></g> : null}
                </g>;
              })}
              </g>
            </svg>
          </>
        )}
      </div>
      <p className="mt-2 text-[9.5px] text-slate-400">性能保护：单次最多加载 120 个节点，默认取 80 个；聚焦资产时只展开两跳关系。编辑模式下可拖动节点、点击连线删除关系、右键连线设置 Zabbix 监控项 Key；可通过“添加资产”或节点左上角减号调整当前视图成员，仅影响显示、不删除资产，保存布局后持久化。聚焦资产时保存的位置和视图成员单独记录，不会改变全局拓扑布局。</p>
      <Modal
        open={hiddenOpen}
        onClose={() => setHiddenOpen(false)}
        title="拓扑隐藏的资产类型"
        description="全局设置拓扑中不显示的资产类型；默认隐藏数据中心、机柜、操作系统。"
        icon={Waypoints}
        size="md"
        resizable={false}
        footer={<><Button variant="secondary" size="sm" onClick={() => setHiddenOpen(false)}>取消</Button><Button size="sm" loading={hiddenSaving} onClick={saveHiddenTypes}>保存</Button></>}
      >
        <div className="grid grid-cols-2 gap-2">
          {allTypes.map((type) => (
            <label key={type.code} className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2">
              <input type="checkbox" checked={hiddenTypes.includes(type.code)} onChange={() => setHiddenTypes((current) => current.includes(type.code) ? current.filter((code) => code !== type.code) : [...current, type.code])} className="h-3.5 w-3.5 rounded border-slate-300" />
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: type.color || '#94a3b8' }} />
              <span className="text-[11px] text-slate-600">{type.name}</span>
            </label>
          ))}
        </div>
      </Modal>

      <Modal
        open={relationOpen}
        onClose={() => setRelationOpen(false)}
        title="新增资产连接"
        description="根据当前资产的类型选择符合关系模型的目标资产。"
        icon={Link2}
        size="lg"
        resizable={false}
        footer={<><Button variant="secondary" size="sm" onClick={() => setRelationOpen(false)}>取消</Button><Button size="sm" loading={savingRelation} disabled={!selectedTopoRule || !relationTarget || compatibleTopoRelationTypes.length === 0} onClick={saveRelation}>建立连接</Button></>}
      >
        <div className="space-y-3">
          <Field label="关系类型" hint={selectedTopoRule?.hint}>
            <select className="input-base" value={relationType} onChange={(event) => { setRelationType(event.target.value); setRelationTarget(''); }}>
              {compatibleTopoRelationTypes.map((type) => <option key={type.code} value={type.code}>{findRelationRule(selectedTopoRules, type.code)?.label || type.name}</option>)}
            </select>
          </Field>
          <Field label={selectedTopoRule?.reverse ? '源资产' : '目标资产'} required hint="输入名称或编号搜索；列表已按关系方向过滤">
            <input className="input-base" value={relationSearch} onChange={(event) => setRelationSearch(event.target.value)} placeholder="搜索资产名称或编号…" />
            <div className="custom-scroll mt-2 max-h-[360px] min-h-[220px] overflow-y-auto rounded-xl border border-slate-200 bg-white p-1">
              {compatibleTopoRelationTargets.length ? compatibleTopoRelationTargets.map((ci) => (
                <button key={ci.id} type="button" onClick={() => setRelationTarget(String(ci.id))} className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left transition ${relationTarget === String(ci.id) ? 'bg-brand-50 ring-1 ring-brand-200' : 'hover:bg-slate-50'}`}>
                  <span className="h-6 w-6 shrink-0 rounded-md" style={{ background: ci.type_color || '#4f6ef7' }} />
                  <span className="min-w-0 flex-1"><span className="block truncate text-[11.5px] font-medium text-slate-700">{ci.name}</span><span className="block font-mono text-[9px] text-slate-400">{ci.asset_no} · {ci.type_name || ''}</span></span>
                  {relationTarget === String(ci.id) ? <span className="text-[10px] text-brand-600">已选</span> : null}
                </button>
              )) : <p className="px-3 py-6 text-center text-[10px] text-slate-400">没有符合当前关系方向的资产</p>}
            </div>
          </Field>
          <Field label="关系说明" hint="可选；用于描述这条路径或连接用途">
            <input className="input-base" value={relationDescription} onChange={(event) => setRelationDescription(event.target.value)} placeholder={selectedTopoRule?.hint || '例如：上联核心交换机'} />
          </Field>
        </div>
      </Modal>

      <Modal
        open={addOpen}
        onClose={() => { setAddOpen(false); setAddSelected([]); setAddSearch(''); }}
        title="添加资产到拓扑视图"
        description="只调整当前拓扑视图的显示成员，不会新增或删除 CI 资产。保存布局后持久化。"
        icon={Plus}
        size="md"
        resizable={false}
        footer={<><Button variant="secondary" size="sm" onClick={() => setAddOpen(false)}>取消</Button><Button size="sm" disabled={!addSelected.length} onClick={addToView}>添加 {addSelected.length || ''} 个资产</Button></>}
      >
        <div className="space-y-3">
          <input className="input-base" value={addSearch} onChange={(event) => setAddSearch(event.target.value)} placeholder="搜索资产名称或编号…" />
          <div className="custom-scroll max-h-[380px] min-h-[220px] overflow-y-auto rounded-xl border border-slate-200 bg-white p-1">
            {addOptions.length ? addOptions.map((ci) => {
              const checked = addSelected.includes(ci.id);
              return <button key={ci.id} type="button" onClick={() => setAddSelected((current) => checked ? current.filter((id) => id !== ci.id) : [...current, ci.id])} className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left transition ${checked ? 'bg-brand-50 ring-1 ring-brand-200' : 'hover:bg-slate-50'}`}>
                <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${checked ? 'border-brand-500 bg-brand-500 text-white' : 'border-slate-300'}`}>{checked ? '✓' : ''}</span>
                <span className="h-6 w-6 shrink-0 rounded-md" style={{ background: ci.type_color || '#4f6ef7' }} />
                <span className="min-w-0 flex-1"><span className="block truncate text-[11.5px] font-medium text-slate-700">{ci.name}</span><span className="block font-mono text-[9px] text-slate-400">{ci.asset_no} · {ci.type_name || ''}</span></span>
              </button>;
            }) : <p className="px-3 py-6 text-center text-[10px] text-slate-400">没有可添加的资产</p>}
          </div>
        </div>
      </Modal>
    </div>
  );
}
