import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import {
  ArrowDownUp,
  ArrowLeft,
  Ban,
  Boxes,
  Building2,
  ChevronLeft,
  ChevronRight,
  CircuitBoard,
  GripVertical,
  Layers3,
  Move,
  Network,
  Plus,
  RefreshCw,
  Ruler,
  Server,
  Settings2,
  Trash2,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { usePageTitle, useDebounce } from '@/lib/hooks';
import { useAuth } from '@/context/AuthContext';
import { cn, relativeTime } from '@/lib/utils';
import type { CI, RackPlacement } from '@/lib/types';
import {
  Badge,
  Button,
  ConfirmDialog,
  EmptyState,
  Field,
  IconButton,
  Input,
  Modal,
  PageHeader,
  SearchInput,
  Skeleton,
  Toggle,
} from '@/components/ui';

const UNIT_HEIGHT = 23;

function uLabel(start: number, height = 1) {
  return height > 1 ? `${start}U-${start + height - 1}U` : `${start}U`;
}

interface RackLite {
  id: number;
  asset_no: string;
  name: string;
  location: string;
  profile?: { capacity_u: number; numbering: string; datacenter_id?: number | null };
  device_count?: number;
  type_color?: string;
}

interface InfraData {
  datacenters: Array<{ id: number; name: string; asset_no: string; location: string; racks: RackLite[] }>;
  unassigned: RackLite[];
  stats: { rack_count: number; datacenter_count: number; placed_devices: number; unplaced_devices: number };
}

interface RackBlankUnit {
  id: number;
  rack_id: number;
  start_u: number;
  u_height: number;
  notes?: string;
}

interface RackLayout {
  id: number;
  asset_no: string;
  name: string;
  location: string;
  profile: { capacity_u: number; numbering: 'bottom_up' | 'top_down'; datacenter_id?: number | null; notes?: string };
  datacenter?: { id: number; name: string; asset_no: string } | null;
  placements: RackPlacement[];
  blanks?: RackBlankUnit[];
  occupied_units?: number[];
  stats: { capacity_u: number; used_u: number; free_u: number; device_count: number; blank_u?: number };
}

export default function RacksPage() {
  usePageTitle('机柜');
  const { can, user } = useAuth();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [infra, setInfra] = useState<InfraData | null>(null);
  const [dcOrder, setDcOrder] = useState<number[]>([]);
  const [rackId, setRackId] = useState<number | null>(() => Number(searchParams.get('rack')) || null);
  const [layout, setLayout] = useState<RackLayout | null>(null);
  const [overview, setOverview] = useState<Record<number, RackLayout>>({});
  const [overviewLoading, setOverviewLoading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [layoutLoading, setLayoutLoading] = useState(false);
  const [devices, setDevices] = useState<any[]>([]);
  const [deviceSearch, setDeviceSearch] = useState('');
  const debouncedSearch = useDebounce(deviceSearch, 250);
  const [devicesLoading, setDevicesLoading] = useState(false);
  const [hoverU, setHoverU] = useState<number | null>(null);
  const [dragUHeight, setDragUHeight] = useState(1);
  const [dragging, setDragging] = useState(false);

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsForm, setSettingsForm] = useState<Record<string, any>>({});
  const [savingSettings, setSavingSettings] = useState(false);

  const [placeOpen, setPlaceOpen] = useState(false);
  const [placeDevice, setPlaceDevice] = useState<any>(null);
  const [placeForm, setPlaceForm] = useState<Record<string, any>>({ start_u: 1, u_height: 1, side: 'front', notes: '' });
  const [placing, setPlacing] = useState(false);
  const [detailPlacement, setDetailPlacement] = useState<RackPlacement | null>(null);
  const [removeTarget, setRemoveTarget] = useState<RackPlacement | null>(null);
  const [removing, setRemoving] = useState(false);
  const [blankOpen, setBlankOpen] = useState(false);
  const [blankStart, setBlankStart] = useState(1);
  const [blankHeight, setBlankHeight] = useState(1);
  const [blankSaving, setBlankSaving] = useState(false);
  const [blankToRemove, setBlankToRemove] = useState<RackBlankUnit | null>(null);
  const [blankRemoving, setBlankRemoving] = useState(false);

  const canEdit = can('cmdb.edit');

  const allRacks = useMemo(
    () => [...(infra?.datacenters.flatMap((dc) => dc.racks) || []), ...(infra?.unassigned || [])],
    [infra],
  );
  const selectedRack = allRacks.find((rack) => rack.id === rackId);

  const loadInfra = async () => {
    setLoading(true);
    setOverviewLoading(true);
    try {
      const response = await api.get<InfraData>('/api/infrastructure');
      setInfra(response);
      const orderResponse = await api.get<{ data: number[] }>('/api/system/datacenter-order').catch(() => ({ data: [] }));
      setDcOrder(orderResponse.data || []);
      const racks = response.datacenters.flatMap((dc) => dc.racks).concat(response.unassigned);
      const requested = Number(searchParams.get('rack'));
      if (requested && racks.some((rack) => rack.id === requested)) setRackId(requested);
      else if (rackId && !racks.some((rack) => rack.id === rackId)) setRackId(null);
      const details = await Promise.all(racks.map((rack) => api.get<{ data: RackLayout }>(`/api/racks/${rack.id}`).then((item) => item.data).catch(() => null)));
      setOverview(Object.fromEntries(details.filter(Boolean).map((item) => [item!.id, item!])));
    } catch (error: any) {
      toast.error(error.message);
    } finally {
      setLoading(false);
      setOverviewLoading(false);
    }
  };

  const loadLayout = async (id: number) => {
    setLayoutLoading(true);
    try {
      const response = await api.get<{ data: RackLayout }>(`/api/racks/${id}`);
      setLayout(response.data);
    } catch (error: any) {
      toast.error(error.message);
      setLayout(null);
    } finally {
      setLayoutLoading(false);
    }
  };

  const loadDevices = async (id: number) => {
    setDevicesLoading(true);
    try {
      const response = await api.get<{ data: any[] }>(`/api/racks/${id}/unplaced?q=${encodeURIComponent(debouncedSearch)}`);
      setDevices(response.data);
    } catch (error: any) {
      toast.error(error.message);
    } finally {
      setDevicesLoading(false);
    }
  };

  useEffect(() => {
    loadInfra();
  }, []);

  useEffect(() => {
    if (!rackId) {
      setLayout(null);
      if (searchParams.get('rack')) {
        const next = new URLSearchParams(searchParams);
        next.delete('rack');
        setSearchParams(next, { replace: true });
      }
      return;
    }
    const next = new URLSearchParams(searchParams);
    next.set('rack', String(rackId));
    setSearchParams(next, { replace: true });
    loadLayout(rackId);
    loadDevices(rackId);
  }, [rackId]);

  useEffect(() => {
    if (rackId) loadDevices(rackId);
  }, [debouncedSearch]);

  const refreshAll = async () => {
    await loadInfra();
    if (rackId) {
      await Promise.all([loadLayout(rackId), loadDevices(rackId)]);
    }
  };

  const labels = useMemo(() => {
    if (!layout) return [];
    return Array.from({ length: layout.profile.capacity_u }, (_, index) =>
      layout.profile.numbering === 'top_down' ? index + 1 : layout.profile.capacity_u - index,
    );
  }, [layout]);

  const labelIndex = (label: number) => {
    if (!layout) return 0;
    return layout.profile.numbering === 'top_down' ? label - 1 : layout.profile.capacity_u - label;
  };

  const openSettings = () => {
    if (!layout) return;
    setSettingsForm({
      capacity_u: layout.profile.capacity_u,
      numbering: layout.profile.numbering,
      datacenter_id: layout.profile.datacenter_id || '',
      notes: layout.profile.notes || '',
    });
    setSettingsOpen(true);
  };

  const saveSettings = async () => {
    if (!rackId) return;
    setSavingSettings(true);
    try {
      await api.put(`/api/racks/${rackId}/profile`, {
        capacity_u: Number(settingsForm.capacity_u),
        numbering: settingsForm.numbering,
        datacenter_id: settingsForm.datacenter_id ? Number(settingsForm.datacenter_id) : null,
        notes: settingsForm.notes || '',
      });
      toast.success('机柜配置已更新');
      setSettingsOpen(false);
      await refreshAll();
    } catch (error: any) {
      toast.error(error.message);
    } finally {
      setSavingSettings(false);
    }
  };

  const openPlace = (device: any) => {
    if (!layout) return;
    setPlaceDevice(device);
    setPlaceForm({
      start_u: 1,
      u_height: Number(device.default_u_height || 1),
      side: 'front',
      notes: '',
    });
    setPlaceOpen(true);
  };

  const placeDeviceAt = async (ciId: number, startU: number, uHeight: number) => {
    if (!rackId) return;
    try {
      await api.post(`/api/racks/${rackId}/placements`, { ci_id: ciId, start_u: startU, u_height: uHeight, side: 'front', notes: '' });
      toast.success(`设备已上架到 ${uLabel(startU, uHeight)}`);
      await refreshAll();
    } catch (error: any) {
      toast.error(error.message);
    }
  };

  const submitPlace = async () => {
    if (!placeDevice) return;
    setPlacing(true);
    try {
      await placeDeviceAt(placeDevice.id, Number(placeForm.start_u), Number(placeForm.u_height));
      setPlaceOpen(false);
      setPlaceDevice(null);
    } finally {
      setPlacing(false);
    }
  };

  const removePlacement = async () => {
    if (!removeTarget || !rackId) return;
    setRemoving(true);
    try {
      await api.delete(`/api/racks/${rackId}/placements/${removeTarget.id}`);
      toast.success('设备已下架');
      setRemoveTarget(null);
      setDetailPlacement(null);
      await refreshAll();
    } catch (error: any) {
      toast.error(error.message);
    } finally {
      setRemoving(false);
    }
  };

  const openBlank = () => {
    if (!layout) return;
    const occupied = new Set(layout.occupied_units || []);
    let unit = 1;
    while (unit <= layout.profile.capacity_u && occupied.has(unit)) unit += 1;
    setBlankStart(Math.min(unit, layout.profile.capacity_u));
    setBlankHeight(1);
    setBlankOpen(true);
  };

  const saveBlank = async () => {
    if (!rackId) return;
    setBlankSaving(true);
    try {
      const height = Math.max(1, Number(blankHeight) || 1);
      await api.post(`/api/racks/${rackId}/blanks`, { start_u: Number(blankStart), u_height: height });
      toast.success(`已在 ${uLabel(Number(blankStart), height)} 安装 ${height}U 空挡板`);
      setBlankOpen(false);
      await refreshAll();
    } catch (error: any) {
      toast.error(error.message);
    } finally {
      setBlankSaving(false);
    }
  };

  const removeBlank = async () => {
    if (!blankToRemove || !rackId) return;
    setBlankRemoving(true);
    try {
      await api.delete(`/api/racks/${rackId}/blanks/${blankToRemove.id}`);
      toast.success('空挡板已移除');
      setBlankToRemove(null);
      await refreshAll();
    } catch (error: any) {
      toast.error(error.message);
    } finally {
      setBlankRemoving(false);
    }
  };

  const dragPayload = (event: React.DragEvent, ciId: number, uHeight: number, placementId?: number) => {
    event.dataTransfer.setData('text/plain', JSON.stringify({ ciId, uHeight, placementId: placementId || null }));
    event.dataTransfer.effectAllowed = 'move';
    setDragUHeight(Math.max(1, Number(uHeight) || 1));
    setDragging(true);
  };

  const dragBlank = (event: React.DragEvent, blank: RackBlankUnit) => {
    event.dataTransfer.setData('text/plain', JSON.stringify({ kind: 'blank', blankId: blank.id, uHeight: blank.u_height }));
    event.dataTransfer.effectAllowed = 'move';
    setDragUHeight(Math.max(1, Number(blank.u_height) || 1));
    setDragging(true);
  };

  const moveBlank = async (blankId: number, startU: number, uHeight: number) => {
    if (!rackId) return;
    try {
      await api.put(`/api/racks/${rackId}/blanks/${blankId}`, { start_u: startU, u_height: uHeight });
      toast.success(`空挡板已移动到 ${uLabel(startU, uHeight)}`);
      await refreshAll();
    } catch (error: any) {
      toast.error(error.message);
    }
  };

  const dropAt = async (event: React.DragEvent) => {
    event.preventDefault();
    if (!rackId) return;
    const raw = event.dataTransfer.getData('text/plain');
    const label = hoverU;
    setHoverU(null);
    setDragging(false);
    setDragUHeight(1);
    if (!raw || !label) return;
    try {
      const payload = JSON.parse(raw);
      if (payload.kind === 'blank') {
        await moveBlank(Number(payload.blankId), label, Number(payload.uHeight) || 1);
      } else {
        await placeDeviceAt(payload.ciId, label, payload.uHeight || 1);
      }
    } catch {
      toast.error('无法识别拖拽的数据');
    }
  };

  const dropToPending = async (event: React.DragEvent) => {
    event.preventDefault();
    const raw = event.dataTransfer.getData('text/plain');
    setDragging(false);
    if (!raw || !rackId) return;
    try {
      const payload = JSON.parse(raw);
      if (!payload.placementId) return;
      await api.delete(`/api/racks/${rackId}/placements/${payload.placementId}`);
      toast.success('设备已移回待上架区域');
      await Promise.all([loadInfra(), loadLayout(rackId), loadDevices(rackId)]);
    } catch (error: any) {
      toast.error(error.message);
    }
  };

  const updateHoverFromEvent = (event: React.DragEvent<HTMLDivElement>) => {
    if (!layout) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const index = Math.max(0, Math.min(layout.profile.capacity_u - 1, Math.floor((event.clientY - rect.top) / UNIT_HEIGHT)));
    const pointerLabel = layout.profile.numbering === 'top_down' ? index + 1 : layout.profile.capacity_u - index;
    const span = Math.max(1, Math.min(dragUHeight, layout.profile.capacity_u));
    const start = layout.profile.numbering === 'top_down'
      ? Math.min(pointerLabel, layout.profile.capacity_u - span + 1)
      : Math.max(1, pointerLabel - span + 1);
    setHoverU(start);
  };

  const datacenterOptions = useMemo(() => {
    const source = infra?.datacenters || [];
    return [...source].sort((a, b) => {
      const ai = dcOrder.indexOf(a.id);
      const bi = dcOrder.indexOf(b.id);
      return (ai < 0 ? 9999 : ai) - (bi < 0 ? 9999 : bi);
    });
  }, [infra, dcOrder]);

  const moveDatacenter = async (id: number, direction: -1 | 1) => {
    const ids = datacenterOptions.map((dc) => dc.id);
    const index = ids.indexOf(id);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= ids.length) return;
    [ids[index], ids[target]] = [ids[target], ids[index]];
    setDcOrder(ids);
    try {
      await api.put('/api/system/datacenter-order', { ids });
    } catch (error: any) {
      toast.error(error.message);
    }
  };

  return (
    <div className="animate-enter">
      <PageHeader
        eyebrow="Rack overview"
        title={rackId ? (layout?.asset_no || '机柜') : '机柜'}
        description={rackId ? `${layout?.name || ''} · ${layout?.datacenter?.name || '未分配数据中心'} · 点击设备可查看详情与业务承载` : '以缩放视图总览全部机柜容量与设备分布；点击任一机柜进入 U 位配置与上架操作。'}
        actions={
          <>
            <Button variant="secondary" size="sm" icon={RefreshCw} onClick={refreshAll} loading={layoutLoading || overviewLoading}>刷新</Button>
            {rackId ? <Button variant="ghost" size="sm" icon={ArrowLeft} onClick={() => setRackId(null)}>返回机柜总览</Button> : null}
            {canEdit && layout ? <Button variant="secondary" size="sm" icon={Ban} onClick={openBlank}>空挡板</Button> : null}
            {canEdit && layout ? <Button variant="secondary" size="sm" icon={Settings2} onClick={openSettings}>机柜设置</Button> : null}
          </>
        }
      />

      <div className="mb-3.5 grid grid-cols-2 gap-2.5 lg:grid-cols-4">
        {[
          { label: '数据中心', value: infra?.stats.datacenter_count || 0, icon: Building2, tone: 'text-violet-600 bg-violet-50', href: '/cmdb/datacenters' },
          { label: '机柜数量', value: infra?.stats.rack_count || 0, icon: Layers3, tone: 'text-amber-600 bg-amber-50', href: '/cmdb/racks' },
          { label: '已上架设备', value: infra?.stats.placed_devices || 0, icon: Server, tone: 'text-emerald-600 bg-emerald-50', href: '/cmdb?type=server' },
          { label: '待上架设备', value: infra?.stats.unplaced_devices || 0, icon: Boxes, tone: 'text-brand-600 bg-brand-50', href: '/cmdb?type=server' },
        ].map((item) => {
          const content = <>
            <span className={cn('flex h-9 w-9 items-center justify-center rounded-xl', item.tone)}><item.icon className="h-4 w-4" /></span>
            <div><p className="text-[20px] font-semibold leading-none text-slate-900">{item.value}</p><p className="mt-1 text-[9.5px] text-slate-400">{item.label}</p></div>
          </>;
          return <Link key={item.label} to={item.href} className="card flex items-center gap-3 p-3.5 transition hover:border-brand-200 hover:shadow-sm">{content}</Link>;
        })}
      </div>

      {rackId ? (
      <div className="grid grid-cols-1 gap-3.5 xl:grid-cols-12">
        <div className="card overflow-hidden xl:col-span-3">
          <div className="border-b border-[#eef1f6] px-4 py-3">
            <h2 className="text-[13px] font-semibold text-slate-800">机房与机柜</h2>
            <p className="mt-0.5 text-[10px] text-slate-400">选择机柜查看正视图</p>
          </div>
          {loading ? <div className="space-y-2 p-3">{[1, 2, 3].map((item) => <Skeleton key={item} className="h-12" />)}</div> : (
            <div className="space-y-4 p-3">
              {datacenterOptions.map((datacenter) => (
                <div key={datacenter.id}>
                  <div className="mb-1.5 flex items-center gap-1.5 px-1 text-[9.5px] font-semibold uppercase tracking-wider text-slate-400">
                    <Building2 className="h-3 w-3" /> {datacenter.name}
                  </div>
                  <div className="space-y-1">
                    {datacenter.racks.map((rack) => (
                      <button
                        key={rack.id}
                        onClick={() => setRackId(rack.id)}
                        className={cn('flex w-full items-center gap-2 rounded-lg border px-2.5 py-2 text-left transition', rackId === rack.id ? 'border-brand-200 bg-brand-50/60' : 'border-transparent hover:bg-slate-50')}
                      >
                        <span className="flex h-7 w-7 items-center justify-center rounded-md bg-amber-50 text-amber-600"><Layers3 className="h-3.5 w-3.5" /></span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[11px] font-medium text-slate-700">{rack.asset_no}</span>
                          <span className="block truncate text-[9px] text-slate-400">{rack.name}</span>
                        </span>
                        <span className="text-[9px] text-slate-400">{rack.device_count || 0} 台</span>
                      </button>
                    ))}
                  </div>
                </div>
              ))}
              {!datacenterOptions.length ? <EmptyState title="暂无数据中心" icon={Building2} className="py-8" /> : null}
            </div>
          )}
        </div>

        <div className="xl:col-span-6">
          {layoutLoading || !layout ? (
            <div className="card p-5"><Skeleton className="h-[620px] w-full" /></div>
          ) : (
            <div className="card flex flex-col overflow-hidden">
              <div className="flex flex-col gap-3 border-b border-[#eef1f6] p-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center gap-3">
                  <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-50 text-amber-600"><Layers3 className="h-5 w-5" /></span>
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-[15px] font-semibold text-slate-900">{layout.asset_no}</h2>
                      <Badge className="bg-slate-100 text-slate-600 ring-slate-500/10">{layout.profile.capacity_u}U</Badge>
                      <Badge className="bg-white text-brand-700 ring-brand-200">{layout.profile.numbering === 'top_down' ? '1U 从顶部开始' : '1U 从底部开始'}</Badge>
                    </div>
                    <p className="mt-0.5 text-[10px] text-slate-400">{layout.name} · {layout.datacenter?.name || '未分配数据中心'} · 已用 {layout.stats.used_u}U / 空闲 {layout.stats.free_u}U{layout.stats.blank_u ? ` · 空挡 ${layout.stats.blank_u}U` : ''}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2 text-[10px] text-slate-500">
                  <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-emerald-500" />使用中</span>
                  <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-amber-400" />维护中</span>
                  <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-slate-300" />空闲</span>
                  <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-slate-600 ring-1 ring-slate-400" />空挡板</span>
                </div>
              </div>

              <div className="p-4">
                <div className="mb-2 flex items-center justify-between text-[9.5px] text-slate-400">
                  <span className="flex items-center gap-1"><ArrowDownUp className="h-3 w-3" /> {layout.profile.numbering === 'top_down' ? 'U 位从上到下递增' : 'U 位从下到上递增'}</span>
                  <span>{dragging ? '松开鼠标放置设备或空挡板' : canEdit ? '拖拽设备或空挡板到 U 位' : '只读视图'}</span>
                </div>
                <div className="rounded-xl">
                <div className="overflow-hidden rounded-xl border-4 border-slate-800 bg-slate-900 p-1.5 shadow-inner">
                  <div className="flex">
                    <div className="w-9 shrink-0">
                      {labels.map((label) => (
                        <div key={label} className="flex items-center justify-end pr-1.5 font-mono text-[8.5px] text-slate-500" style={{ height: UNIT_HEIGHT }}>
                          {label}U
                        </div>
                      ))}
                    </div>
                    <div
                      className="relative flex-1 rounded-sm bg-[repeating-linear-gradient(to_bottom,#1b2740_0,#1b2740_22px,#111a2c_22px,#111a2c_23px)]"
                      style={{ height: layout.profile.capacity_u * UNIT_HEIGHT }}
                      data-testid="rack-canvas"
                      onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; updateHoverFromEvent(event); }}
                      onDragLeave={() => setHoverU(null)}
                      onDrop={dropAt}
                    >
                      {labels.map((label, index) => (
                        <div
                          key={label}
                          className={cn('absolute left-0 right-0 border-b border-white/[0.035]', hoverU !== null && index >= Math.min(labelIndex(hoverU), labelIndex(hoverU + dragUHeight - 1)) && index <= Math.max(labelIndex(hoverU), labelIndex(hoverU + dragUHeight - 1)) && 'bg-brand-400/25 ring-1 ring-inset ring-brand-400/60')}
                          style={{ top: index * UNIT_HEIGHT, height: UNIT_HEIGHT }}
                        />
                      ))}
                      {(layout.blanks || []).map((blank) => {
                        const top = labelIndex(blank.start_u) * UNIT_HEIGHT;
                        return (
                          <div
                            key={`blank-${blank.id}`}
                            draggable={canEdit}
                            data-testid={`blank-${blank.id}`}
                            onDragStart={(event) => dragBlank(event, blank)}
                            onDragEnd={() => { setDragging(false); setHoverU(null); setDragUHeight(1); }}
                            onClick={(event) => { event.stopPropagation(); setBlankToRemove(blank); }}
                            className="absolute left-1 right-1 z-10 cursor-grab overflow-hidden rounded-md border border-slate-400/70 px-2 py-1 text-slate-100 shadow-[0_2px_6px_rgba(0,0,0,0.28)] transition hover:brightness-110 active:cursor-grabbing"
                            style={{
                              top: top + 1,
                              height: blank.u_height * UNIT_HEIGHT - 2,
                              background: 'repeating-linear-gradient(135deg, #475569 0, #475569 6px, #334155 6px, #334155 12px)',
                            }}
                            title={`空挡板 · ${uLabel(blank.start_u, blank.u_height)} · 该 U 位不可上架，可拖拽移动`}
                          >
                            <div className="flex h-full items-center gap-1.5">
                              <GripVertical className="h-3 w-3 shrink-0 opacity-60" />
                              <Ban className="h-3 w-3 shrink-0 opacity-80" />
                              <p className="truncate text-[9px] font-semibold leading-tight">空挡板 · 不可上架</p>
                              <span className="ml-auto shrink-0 font-mono text-[8px] text-slate-200">{blank.u_height}U</span>
                            </div>
                          </div>
                        );
                      })}
                      {layout.placements.map((placement) => {
                        const startIndex = labelIndex(placement.start_u);
                        const endIndex = labelIndex(placement.start_u + placement.u_height - 1);
                        const top = Math.min(startIndex, endIndex) * UNIT_HEIGHT;
                        const blockHeight = placement.u_height * UNIT_HEIGHT - 2;
                        const color = placement.type_color || '#4f6ef7';
                        return (
                          <div
                            key={placement.id}
                            draggable={canEdit}
                            data-testid={`placement-${placement.id}`}
                            onDragStart={(event) => dragPayload(event, placement.ci_id, placement.u_height, placement.id)}
                            onDragEnd={() => { setDragging(false); setHoverU(null); setDragUHeight(1); }}
                            onClick={(event) => { event.stopPropagation(); setDetailPlacement(placement); }}
                            className="absolute left-1 right-1 z-10 cursor-pointer overflow-hidden rounded-md border px-2 py-1 text-white shadow-[0_2px_6px_rgba(0,0,0,0.28)] transition hover:brightness-110"
                            style={{ top: top + 1, height: blockHeight, background: `linear-gradient(135deg, ${color}, ${color}cc)`, borderColor: `${color}` }}
                            title={`${placement.asset_no} · ${placement.name} · ${uLabel(placement.start_u, placement.u_height)}`}
                          >
                            <div className="flex h-full items-center gap-1.5">
                              <GripVertical className="h-3 w-3 shrink-0 opacity-60" />
                              <div className="min-w-0 flex-1">
                                <p className="truncate text-[9.5px] font-semibold leading-tight">{placement.name || placement.asset_no}</p>
                                {placement.u_height >= 2 ? <p className="mt-0.5 truncate text-[8px] leading-tight text-white/75">{placement.asset_no}</p> : null}
                              </div>
                              <span className="shrink-0 font-mono text-[8px] text-white/80">{placement.u_height}U</span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
                </div>
                <div className="mt-3 flex items-center justify-between text-[9.5px] text-slate-400">
                  <span>拖拽已上架设备或空挡板可调整 U 位；上下架会同步维护 `installed_on` 关系。空挡板仅占用 U 位，不是资产 CI。</span>
                  <span>{layout.stats.device_count} 台设备{layout.stats.blank_u ? ` · ${layout.stats.blank_u} 个空挡板` : ''}</span>
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="flex flex-col space-y-3.5 xl:col-span-3 xl:self-stretch">
          <div className="card flex min-h-0 flex-1 flex-col overflow-hidden">
            <div className="border-b border-[#eef1f6] px-4 py-3">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-[13px] font-semibold text-slate-800">待上架设备</h2>
                  <p className="mt-0.5 text-[10px] text-slate-400">拖拽卡片到左侧 U 位</p>
                </div>
                <Badge className="bg-white text-brand-700 ring-brand-200">{devices.length}</Badge>
              </div>
              <SearchInput value={deviceSearch} onChange={setDeviceSearch} placeholder="搜索设备…" className="mt-2" />
            </div>
            <div
              className="custom-scroll min-h-0 flex-1 space-y-1.5 overflow-y-auto p-2 max-h-[70vh] xl:max-h-none"
              onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; }}
              onDrop={dropToPending}
            >
              {devicesLoading ? [1, 2, 3].map((item) => <Skeleton key={item} className="h-16" />) : devices.length ? devices.map((device) => (
                <div
                  key={device.id}
                  draggable={canEdit}
                  data-testid={`unplaced-${device.id}`}
                  onDragStart={(event) => dragPayload(event, device.id, device.default_u_height || 1)}
                  onDragEnd={() => { setDragging(false); setHoverU(null); setDragUHeight(1); }}
                  className="group cursor-grab rounded-xl border border-slate-200 bg-white p-2.5 transition hover:border-brand-200 hover:bg-brand-50/30 active:cursor-grabbing"
                >
                  <div className="flex items-start gap-2">
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-white" style={{ background: device.type_color || '#4f6ef7' }}>
                      {device.type_code === 'network' ? <Network className="h-3.5 w-3.5" /> : <Server className="h-3.5 w-3.5" />}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[10.5px] font-medium text-slate-700">{device.name}</p>
                      <p className="mt-0.5 font-mono text-[8.5px] text-slate-400">{device.asset_no} · {device.type_name}</p>
                      <div className="mt-1 flex items-center gap-1.5">
                        <span className="rounded bg-slate-100 px-1 py-0.5 text-[8px] text-slate-500">{device.default_u_height || 1}U</span>
                        <span className={cn('rounded px-1 py-0.5 text-[8px]', device.criticality === 'critical' ? 'bg-rose-50 text-rose-600' : 'bg-slate-50 text-slate-400')}>{device.criticality === 'critical' ? '核心' : device.type_name}</span>
                      </div>
                    </div>
                    {canEdit ? <IconButton icon={Move} label="手工上架" onClick={(event) => { event.stopPropagation(); openPlace(device); }} /> : null}
                  </div>
                </div>
              )) : (
                <EmptyState title="没有待上架设备" description="所有可上架设备都已放入机柜，或未开启类型的「可上架设备」属性。" icon={Boxes} className="py-10" />
              )}
            </div>
          </div>
          <div className="rounded-xl border border-dashed border-slate-200 bg-white/60 p-3 text-[9.5px] leading-relaxed text-slate-400">
            <div className="mb-1 flex items-center gap-1 font-medium text-slate-500"><CircuitBoard className="h-3 w-3" /> 2D 机柜正视图</div>
            U 位编号方向、容量由管理员自定义。上架时系统会校验 U 位重叠与机柜容量，并同步更新资产详情中的机柜位置。
          </div>
        </div>
      </div>
      ) : (
        <RackOverview groups={[...datacenterOptions, { id: 0, name: '未分配数据中心', asset_no: '', location: '', racks: infra?.unassigned || [] }]} layouts={overview} loading={loading || overviewLoading} onOpen={(id) => setRackId(id)} canReorder={user?.role?.code === 'admin'} onMove={moveDatacenter} />
      )}

      <Modal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        title="机柜配置"
        description="自定义机柜容量与 U 位编号方向，变更会立即反映到机柜正视图。"
        icon={Settings2}
        size="md"
        footer={<><Button variant="secondary" size="sm" onClick={() => setSettingsOpen(false)}>取消</Button><Button size="sm" loading={savingSettings} onClick={saveSettings}>保存配置</Button></>}
      >
        <div className="space-y-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="U 位高度" required hint="默认 47U，范围 1-60"><Input type="number" min="1" max="60" value={settingsForm.capacity_u || 47} onChange={(event) => setSettingsForm((current) => ({ ...current, capacity_u: event.target.value }))} /></Field>
            <Field label="U 位编号方向">
              <select className="input-base" value={settingsForm.numbering || 'bottom_up'} onChange={(event) => setSettingsForm((current) => ({ ...current, numbering: event.target.value }))}>
                <option value="bottom_up">从下到上：底部为 1U</option>
                <option value="top_down">从上到下：顶部为 1U</option>
              </select>
            </Field>
          </div>
          <Field label="所属数据中心" hint="选择后自动建立机柜归属数据中心关系">
            <select className="input-base" value={settingsForm.datacenter_id || ''} onChange={(event) => setSettingsForm((current) => ({ ...current, datacenter_id: event.target.value }))}>
              <option value="">未分配</option>
              {datacenterOptions.map((dc) => <option key={dc.id} value={dc.id}>{dc.name}</option>)}
            </select>
          </Field>
          <Field label="备注"><Input value={settingsForm.notes || ''} onChange={(event) => setSettingsForm((current) => ({ ...current, notes: event.target.value }))} placeholder="机柜位置、配电或维护说明" /></Field>
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-[9.5px] text-amber-700">缩小容量前请确认新容量不小于已上架设备占用的最高 U 位，否则保存会被拒绝。</p>
        </div>
      </Modal>

      <Modal
        open={blankOpen}
        onClose={() => setBlankOpen(false)}
        title="安装空挡板"
        description="空挡板仅占用机柜 U 位，表示该位置不可上架；不会创建资产 CI。"
        icon={Ban}
        size="sm"
        footer={<><Button variant="secondary" size="sm" onClick={() => setBlankOpen(false)}>取消</Button><Button size="sm" loading={blankSaving} onClick={saveBlank}>安装空挡板</Button></>}
      >
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Field label="起始 U 位" required>
              <Input type="number" min="1" max={Math.max(1, (layout?.profile.capacity_u || 42) - Number(blankHeight) + 1)} value={blankStart} onChange={(event) => setBlankStart(Number(event.target.value))} />
            </Field>
            <Field label="高度 (U)" required hint="可安装多 U 空挡板">
              <Input
                type="number"
                min="1"
                max={Math.max(1, (layout?.profile.capacity_u || 42) - Number(blankStart) + 1)}
                value={blankHeight}
                onChange={(event) => {
                  const nextHeight = Math.max(1, Number(event.target.value) || 1);
                  setBlankHeight(nextHeight);
                  setBlankStart((current) => Math.min(current, Math.max(1, (layout?.profile.capacity_u || 42) - nextHeight + 1)));
                }}
              />
            </Field>
          </div>
          <p className="rounded-lg bg-slate-50 px-3 py-2 text-[9.5px] leading-relaxed text-slate-500">
            当前机柜 {layout?.profile.capacity_u || 0}U，将占用 <span className="font-mono font-medium text-slate-700">{uLabel(Number(blankStart), Number(blankHeight))}</span>。安装后显示为灰黑斜纹挡板，设备上架与拖拽都会被拒绝；可直接拖拽挡板调整 U 位，点击挡板可移除。
          </p>
        </div>
      </Modal>

      <Modal
        open={placeOpen}
        onClose={() => setPlaceOpen(false)}
        title={`上架设备${placeDevice ? ` · ${placeDevice.asset_no}` : ''}`}
        description="指定起始 U 位与设备高度，系统会自动校验容量和重叠。"
        icon={Server}
        size="sm"
        footer={<><Button variant="secondary" size="sm" onClick={() => setPlaceOpen(false)}>取消</Button><Button size="sm" loading={placing} onClick={submitPlace}>确认上架</Button></>}
      >
        <div className="space-y-3">
          <Field label="设备"><Input value={placeDevice?.name || ''} disabled /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="起始 U 位" required><Input type="number" min="1" max={layout?.profile.capacity_u || 42} value={placeForm.start_u} onChange={(event) => setPlaceForm((current) => ({ ...current, start_u: event.target.value }))} /></Field>
            <Field label="设备高度 (U)"><Input type="number" min="1" max="20" value={placeForm.u_height} onChange={(event) => setPlaceForm((current) => ({ ...current, u_height: event.target.value }))} /></Field>
          </div>
          <p className="text-[9.5px] text-slate-400">当前机柜 {layout?.profile.capacity_u}U，编号方向为{layout?.profile.numbering === 'top_down' ? '从上到下' : '从下到上'}。</p>
        </div>
      </Modal>

      <Modal
        open={Boolean(detailPlacement)}
        onClose={() => setDetailPlacement(null)}
        title={detailPlacement ? `${detailPlacement.asset_no} · ${detailPlacement.name}` : '设备上架信息'}
        description={detailPlacement ? `${detailPlacement.type_name} · ${uLabel(detailPlacement.start_u, detailPlacement.u_height)}` : ''}
        icon={Server}
        size="sm"
        footer={
          <>
            <Link to={`/cmdb/${detailPlacement?.ci_id}`}><Button variant="secondary" size="sm">查看资产详情</Button></Link>
            {canEdit ? <Button variant="danger" size="sm" icon={Trash2} onClick={() => setRemoveTarget(detailPlacement)}>下架</Button> : null}
          </>
        }
      >
        {detailPlacement ? (
          <div className="space-y-3 text-[11px]">
            <div className="rounded-xl border border-slate-100 bg-slate-50/70 p-3">
              <p className="text-[9px] text-slate-400">所在位置</p>
              <p className="mt-1 font-medium text-slate-700">{layout?.datacenter?.name || '未分配数据中心'} · {layout?.asset_no} · {layout?.name}</p>
              <p className="mt-1 font-mono text-[10px] text-brand-700">{detailPlacement.start_u}U – {detailPlacement.start_u + detailPlacement.u_height - 1}U（{detailPlacement.u_height}U）</p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <InfoLine label="业务地址" value={detailPlacement.ip_address || '—'} />
              <InfoLine label="BMC 地址" value={detailPlacement.bmc_address || '—'} />
              <InfoLine label="状态" value={detailPlacement.status} />
              <InfoLine label="上架时间" value={relativeTime(detailPlacement.created_at)} />
            </div>
          </div>
        ) : null}
      </Modal>

      <ConfirmDialog
        open={Boolean(removeTarget)}
        onClose={() => setRemoveTarget(null)}
        onConfirm={removePlacement}
        loading={removing}
        title="设备下架"
        confirmText="确认下架"
        description={<>确定将「{removeTarget?.asset_no}」从机柜下架吗？资产不会被删除，只会移除上架位置和 installed_on 关系。</>}
      />

      <ConfirmDialog
        open={Boolean(blankToRemove)}
        onClose={() => setBlankToRemove(null)}
        onConfirm={removeBlank}
        loading={blankRemoving}
        title="移除空挡板"
        confirmText="确认移除"
        description={<>确定移除 <span className="font-mono">{blankToRemove ? uLabel(blankToRemove.start_u, blankToRemove.u_height) : ''}</span> 的 {blankToRemove?.u_height || 1}U 空挡板吗？移除后该 U 位可重新上架设备。</>}
      />
    </div>
  );
}

function RackOverview({ groups, layouts, loading, onOpen, canReorder, onMove }: { groups: Array<{ id: number; name: string; asset_no: string; location: string; racks: RackLite[] }>; layouts: Record<number, RackLayout>; loading: boolean; onOpen: (id: number) => void; canReorder?: boolean; onMove?: (id: number, direction: -1 | 1) => void }) {
  const [datacenterFilter, setDatacenterFilter] = useState('');
  const [query, setQuery] = useState('');
  if (loading) {
    return <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">{[1, 2, 3, 4, 5, 6].map((item) => <Skeleton key={item} className="h-80" />)}</div>;
  }
  const visibleGroups = groups
    .filter((group) => group.racks.length && (!datacenterFilter || String(group.id) === datacenterFilter))
    .map((group) => ({ ...group, racks: group.racks.filter((rack) => !query || `${rack.asset_no} ${rack.name}`.toLowerCase().includes(query.toLowerCase())) }))
    .filter((group) => group.racks.length);
  if (!groups.some((group) => group.racks.length)) return <div className="card"><EmptyState title="暂无纳管机柜" description="请先在 CI 模型中创建机柜类型的资产。" icon={Layers3} className="py-16" /></div>;
  return (
    <div className="space-y-4">
      <div className="card flex flex-wrap items-center justify-between gap-2 p-3">
        <div className="flex flex-wrap items-center gap-2">
          <select className="input-base h-8 w-auto text-[10.5px]" value={datacenterFilter} onChange={(event) => setDatacenterFilter(event.target.value)}><option value="">全部数据中心</option>{groups.filter((group) => group.racks.length).map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}</select>
          <span className="text-[9.5px] text-slate-400">共 {visibleGroups.reduce((sum, group) => sum + group.racks.length, 0)} 个机柜</span>
        </div>
        <SearchInput value={query} onChange={setQuery} placeholder="搜索机柜编号或名称…" className="w-full sm:w-[240px]" />
      </div>
      {visibleGroups.map((group) => (
        <section key={group.id}>
          <div className="mb-2 flex items-center justify-between px-0.5">
            <Link to="/cmdb/datacenters" className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-600 hover:text-brand-600"><Building2 className="h-3.5 w-3.5 text-brand-500" /> {group.name}<ChevronRight className="h-3 w-3 text-slate-300" /></Link>
            <div className="flex items-center gap-1">
              {canReorder && group.id ? <><button onClick={() => onMove?.(group.id, -1)} className="rounded p-1 text-slate-400 hover:bg-white hover:text-slate-700" title="上移数据中心"><ChevronLeft className="h-3 w-3 rotate-90" /></button><button onClick={() => onMove?.(group.id, 1)} className="rounded p-1 text-slate-400 hover:bg-white hover:text-slate-700" title="下移数据中心"><ChevronRight className="h-3 w-3 rotate-90" /></button></> : null}
              <span className="text-[9px] text-slate-400">{group.racks.length} 个机柜</span>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
            {group.racks.map((rack) => {
              const detail = layouts[rack.id];
              const capacity = detail?.profile.capacity_u || rack.profile?.capacity_u || 47;
              const numbering = detail?.profile.numbering || rack.profile?.numbering || 'bottom_up';
              const unit = Math.max(4, Math.min(6, Math.floor(290 / capacity)));
              const used = detail?.stats.used_u || 0;
              const deviceCount = detail?.placements?.length || rack.device_count || 0;
              return (
                <button key={rack.id} onClick={() => onOpen(rack.id)} className="group card overflow-hidden p-0 text-left transition hover:-translate-y-0.5 hover:border-brand-200">
                  <div className="border-b border-[#eef1f6] px-3 py-2.5">
                    <p className="truncate text-[11px] font-semibold text-slate-800">{rack.asset_no}</p>
                    <p className="mt-0.5 truncate text-[8.5px] text-slate-400">{rack.name}</p>
                  </div>
                  <div className="flex gap-2 p-2.5">
                    <div className="relative w-[66%] shrink-0 rounded-md border-2 border-slate-700 bg-[#111a2c] p-1" style={{ height: Math.max(300, capacity * unit + 6) }}>
                      {detail?.placements?.map((placement) => {
                        const indexOf = (label: number) => numbering === 'top_down' ? label - 1 : capacity - label;
                        const top = Math.min(indexOf(placement.start_u), indexOf(placement.start_u + placement.u_height - 1)) * unit;
                        return <span key={placement.id} title={`${placement.asset_no} · ${placement.name}`} className="absolute block rounded-[2px] opacity-90" style={{ left: 4, right: 4, top: top + 1, height: Math.max(2, placement.u_height * unit - 1), background: placement.type_color || '#4f6ef7' }} />;
                      })}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-col gap-1">
                        <span className="rounded bg-slate-50 px-1 py-1 text-[7.5px] text-slate-500"><strong className="text-[12px] text-slate-800">{deviceCount}</strong> 台设备</span>
                        <span className="rounded bg-slate-50 px-1 py-1 text-[7.5px] text-slate-500"><strong className="text-[12px] text-slate-800">{used}U</strong> 已用</span>
                      </div>
                      <p className="mt-2 text-[8px] leading-4 text-slate-400">{capacity}U<br />{numbering === 'top_down' ? '上→下' : '下→上'}</p>
                      <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-amber-400" style={{ width: `${Math.min(100, (used / capacity) * 100)}%` }} /></div>
                      <p className="mt-3 flex items-center gap-0.5 text-[8.5px] font-medium text-brand-600">配置 <ChevronRight className="h-2.5 w-2.5" /></p>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </section>
      ))}
      {!visibleGroups.length ? <div className="card"><EmptyState title="没有匹配的机柜" description="调整数据中心或搜索条件后再试。" icon={Layers3} className="py-12" /></div> : null}
    </div>
  );
}

function InfoLine({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[9px] text-slate-400">{label}</p>
      <p className="mt-0.5 font-mono text-[10.5px] text-slate-600">{value}</p>
    </div>
  );
}
