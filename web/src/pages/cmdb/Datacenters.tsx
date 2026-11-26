import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Activity,
  AlertTriangle,
  ArrowUpRight,
  Boxes,
  BriefcaseBusiness,
  Building2,
  CheckCircle2,
  ChevronRight,
  Clock3,
  Gauge,
  Layers3,
  Link2,
  MapPin,
  Network,
  RefreshCw,
  Server,
  ShieldAlert,
  Wifi,
} from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { usePageTitle } from '@/lib/hooks';
import { cn, formatDate, relativeTime, CI_STATUS_META, CRITICALITY_META } from '@/lib/utils';
import { CHINA_PROVINCE_LABELS } from '@/lib/chinaProvinceLabels';
import { AmapMap } from '@/components/AmapMap';
import type { RackPlacement } from '@/lib/types';
import {
  Badge,
  Button,
  EmptyState,
  Modal,
  PageHeader,
  Skeleton,
  SectionHeading,
} from '@/components/ui';

const STATUS_META: Record<string, { label: string; color: string; badge: string; dot: string; text: string }> = {
  healthy: { label: '网络正常', color: '#10b981', badge: 'bg-emerald-50 text-emerald-700 ring-emerald-600/15', dot: 'bg-emerald-500', text: 'text-emerald-700' },
  degraded: { label: '链路异常', color: '#f59e0b', badge: 'bg-amber-50 text-amber-700 ring-amber-600/15', dot: 'bg-amber-500', text: 'text-amber-700' },
  down: { label: '网络中断', color: '#f43f5e', badge: 'bg-rose-50 text-rose-700 ring-rose-600/15', dot: 'bg-rose-500', text: 'text-rose-700' },
  unknown: { label: '暂无监控', color: '#94a3b8', badge: 'bg-slate-100 text-slate-500 ring-slate-500/10', dot: 'bg-slate-400', text: 'text-slate-500' },
};

interface NetworkDevice {
  id: number;
  asset_no: string;
  name: string;
  type_name: string;
  status: string;
  ip_address: string;
  start_u: number;
  u_height: number;
  open_alerts: number;
  latest_alert?: { event_name: string; severity: string; received_at: string } | null;
}

interface Datacenter {
  id: number;
  asset_no: string;
  name: string;
  city: string;
  location: string;
  description: string;
  latitude: number;
  longitude: number;
  network_status: string;
  status_color: string;
  open_alerts: any[];
  zabbix_last_sync?: string | null;
  network_devices: NetworkDevice[];
  rack_count: number;
  device_count: number;
  network_device_count: number;
  business_count: number;
  criticality: string;
  available?: boolean;
}

interface Rack {
  ci_id: number;
  asset_no: string;
  name: string;
  capacity_u: number;
  used_u: number;
  devices: Array<RackPlacement & { businesses: any[] }>;
}

interface DatacenterDetail extends Datacenter {
  racks: Rack[];
}

const MAP_BOUNDS = {
  left: 73.502355,
  right: 135.09567,
  top: 53.563269,
  bottom: 3.39716187,
};

function mercator(latitude: number) {
  return Math.log(Math.tan(Math.PI / 4 + (latitude * Math.PI) / 360));
}

function project(latitude: number, longitude: number) {
  const x = ((longitude - MAP_BOUNDS.left) / (MAP_BOUNDS.right - MAP_BOUNDS.left)) * 100;
  const y = ((mercator(MAP_BOUNDS.top) - mercator(latitude)) / (mercator(MAP_BOUNDS.top) - mercator(MAP_BOUNDS.bottom))) * 100;
  return {
    left: Math.min(95, Math.max(5, x)),
    top: Math.min(93, Math.max(7, y)),
  };
}

const AMAP_ZOOM = 4;
const lonToTile = (longitude: number) => ((longitude + 180) / 360) * 2 ** AMAP_ZOOM;
const latToTile = (latitude: number) => {
  const radians = (latitude * Math.PI) / 180;
  return ((1 - Math.log(Math.tan(radians) + 1 / Math.cos(radians)) / Math.PI) / 2) * 2 ** AMAP_ZOOM;
};
const AMAP_GRID: { minX: number; maxX: number; minY: number; maxY: number; width: number; height: number } = {
  minX: Math.floor(lonToTile(MAP_BOUNDS.left)),
  maxX: Math.floor(lonToTile(MAP_BOUNDS.right)),
  minY: Math.floor(latToTile(MAP_BOUNDS.top)),
  maxY: Math.floor(latToTile(MAP_BOUNDS.bottom)),
  width: 0,
  height: 0,
};
AMAP_GRID.width = (AMAP_GRID.maxX - AMAP_GRID.minX + 1) * 256;
AMAP_GRID.height = (AMAP_GRID.maxY - AMAP_GRID.minY + 1) * 256;

function projectAmap(latitude: number, longitude: number) {
  const x = ((lonToTile(longitude) * 256 - AMAP_GRID.minX * 256) / AMAP_GRID.width) * 100;
  const y = ((latToTile(latitude) * 256 - AMAP_GRID.minY * 256) / AMAP_GRID.height) * 100;
  return { left: Math.min(95, Math.max(5, x)), top: Math.min(93, Math.max(7, y)) };
}

function AmapTiles() {
  const tiles = [];
  for (let x = AMAP_GRID.minX; x <= AMAP_GRID.maxX; x += 1) {
    for (let y = AMAP_GRID.minY; y <= AMAP_GRID.maxY; y += 1) {
      tiles.push({
        x,
        y,
        left: ((x - AMAP_GRID.minX) * 256 / AMAP_GRID.width) * 100,
        top: ((y - AMAP_GRID.minY) * 256 / AMAP_GRID.height) * 100,
        width: (256 / AMAP_GRID.width) * 100,
        height: (256 / AMAP_GRID.height) * 100,
        url: `https://webrd0${(x + y) % 4 + 1}.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=7&x=${x}&y=${y}&z=${AMAP_ZOOM}`,
      });
    }
  }
  return (
    <div className="absolute inset-0 overflow-hidden">
      {tiles.map((tile) => (
        <img key={`${tile.x}-${tile.y}`} src={tile.url} alt="" loading="eager" className="absolute max-w-none select-none" style={{ left: `${tile.left}%`, top: `${tile.top}%`, width: `${tile.width}%`, height: `${tile.height}%` }} />
      ))}
    </div>
  );
}

export default function DatacentersPage() {
  usePageTitle('数据中心分布');
  const [datacenters, setDatacenters] = useState<Datacenter[]>([]);
  const [stats, setStats] = useState<Record<string, number>>({});
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [detail, setDetail] = useState<DatacenterDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [deviceTarget, setDeviceTarget] = useState<(RackPlacement & { businesses: any[] }) | null>(null);
  const [zoom, setZoom] = useState(1);
  const [mapSource, setMapSource] = useState<'standard' | 'amap'>('amap');
  const [amapConfigured, setAmapConfigured] = useState<boolean | null>(null);
  useEffect(() => {
    api.get<{ data: { configured: boolean } }>('/api/system/amap-config').then((response) => setAmapConfigured(Boolean(response.data.configured))).catch(() => setAmapConfigured(false));
  }, []);
  const [links, setLinks] = useState<any[]>([]);
  const [mapUrl, setMapUrl] = useState('/china-provinces.svg');
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const dragRef = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null);
  const mapRef = useRef<HTMLDivElement>(null);
  const [mapDragging, setMapDragging] = useState(false);

  const selected = datacenters.find((item) => item.id === selectedId) || null;
  const networkMeta = STATUS_META[detail?.network_status || selected?.network_status || 'unknown'] || STATUS_META.unknown;

  const load = async (preferredId?: number) => {
    setLoading(true);
    try {
      const response = await api.get<{ data: Datacenter[]; stats: Record<string, number> }>('/api/datacenters');
      setDatacenters(response.data);
      setStats(response.stats || {});
      const nextId = preferredId && response.data.some((item) => item.id === preferredId)
        ? preferredId
        : selectedId && response.data.some((item) => item.id === selectedId)
          ? selectedId
          : response.data[0]?.id || null;
      setSelectedId(nextId);
    } catch (error: any) {
      toast.error(error.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const element = mapRef.current;
    if (!element) return;
    const handleWheel = (event: WheelEvent) => {
      event.preventDefault();
      setZoom((value) => Math.min(5, Math.max(1, Number((value + (event.deltaY > 0 ? -0.25 : 0.25)).toFixed(2)))));
    };
    element.addEventListener('wheel', handleWheel, { passive: false });
    return () => element.removeEventListener('wheel', handleWheel);
  }, [mapSource]);

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    api.get<{ data: any }>('/api/system/map').then((response) => setMapUrl(response.data.map_url)).catch(() => {});
    api.get<{ data: any[] }>('/api/datacenter-links').then((response) => setLinks(response.data)).catch(() => {});
  }, []);

  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      return;
    }
    let active = true;
    setDetailLoading(true);
    api.get<{ data: DatacenterDetail }>(`/api/datacenters/${selectedId}`)
      .then((response) => active && setDetail(response.data))
      .catch((error) => active && toast.error(error.message))
      .finally(() => active && setDetailLoading(false));
    return () => { active = false; };
  }, [selectedId]);

  const markers = useMemo(() => {
    const projection = mapSource === 'amap' ? projectAmap : project;
    return datacenters.map((item) => ({ ...item, ...projection(item.latitude, item.longitude) }));
  }, [datacenters, mapSource]);
  const projection = mapSource === 'amap' ? projectAmap : project;
  const mapAspect = mapSource === 'amap' ? `${AMAP_GRID.width} / ${AMAP_GRID.height}` : '1000 / 979';
  const provinceLabels = useMemo(() => CHINA_PROVINCE_LABELS.map((label) => ({ ...label, ...projection(label.latitude, label.longitude) })), [projection]);
  const linkLines = useMemo(() => {
    const byId = new Map(datacenters.map((item) => [item.id, { ...item, ...((mapSource === 'amap' ? projectAmap : project)(item.latitude, item.longitude)) }]));
    return links.map((link) => {
      const source = byId.get(link.source_dc_id);
      const target = byId.get(link.target_dc_id);
      if (!source || !target) return null;
      return { ...link, x1: source.left, y1: source.top, x2: target.left, y2: target.top };
    }).filter(Boolean);
  }, [links, datacenters, mapSource]);

  const startDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest('button, select')) return;
    dragRef.current = { x: event.clientX, y: event.clientY, panX: pan.x, panY: pan.y };
    setMapDragging(true);
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };
  const moveDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return;
    setPan({ x: dragRef.current.panX + event.clientX - dragRef.current.x, y: dragRef.current.panY + event.clientY - dragRef.current.y });
  };
  const endDrag = () => {
    dragRef.current = null;
    setMapDragging(false);
  };

  return (
    <div className="animate-enter">
      <PageHeader
        eyebrow="Datacenter map"
        title="数据中心分布"
        description="在地图上查看数据中心位置、网络连接状态与机柜承载。点击数据中心查看机柜和设备，点击服务器可查看其承载的业务。"
        actions={<div className="flex items-center gap-2"><Link to="/system/map-settings"><Button variant="secondary" size="sm" icon={MapPin}>地理位置配置</Button></Link><Button variant="secondary" size="sm" icon={RefreshCw} loading={loading} onClick={() => load(selectedId || undefined)}>刷新状态</Button></div>}
      />

      <div className="mb-3.5 grid grid-cols-2 gap-2.5 lg:grid-cols-4">
        {[
          { label: '数据中心', value: stats.datacenter_count || datacenters.length, icon: Building2, tone: 'text-violet-600 bg-violet-50', href: '/cmdb/datacenters' },
          { label: '机柜总数', value: stats.rack_count || 0, icon: Layers3, tone: 'text-amber-600 bg-amber-50', href: '/cmdb/racks' },
          { label: '在架设备', value: stats.device_count || 0, icon: Server, tone: 'text-brand-600 bg-brand-50', href: '/cmdb?type=server' },
          { label: '业务系统', value: stats.business_count || 0, icon: BriefcaseBusiness, tone: 'text-pink-600 bg-pink-50', href: '/cmdb?type=business' },
        ].map((item) => (
          <Link key={item.label} to={item.href} className="card flex items-center gap-3 p-3.5 transition hover:border-brand-200 hover:shadow-sm">
            <span className={cn('flex h-9 w-9 items-center justify-center rounded-xl', item.tone)}><item.icon className="h-4 w-4" /></span>
            <div><p className="text-[20px] font-semibold leading-none text-slate-900">{item.value}</p><p className="mt-1 text-[9.5px] text-slate-400">{item.label}</p></div>
          </Link>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-3.5 xl:grid-cols-12">
        <div className="card flex flex-col overflow-hidden xl:col-span-7">
          <div className="flex items-center justify-between border-b border-[#eef1f6] px-4 py-3">
            <div>
              <h2 className="flex items-center gap-1.5 text-[13px] font-semibold text-slate-800"><MapPin className="h-3.5 w-3.5 text-brand-500" /> 全国数据中心分布</h2>
              <p className="mt-0.5 text-[10px] text-slate-400">标记颜色代表网络链路状态，数据来自 Zabbix 监控</p>
            </div>
            <div className="flex items-center gap-2.5 text-[9.5px] text-slate-500">
              <select value={mapSource} onChange={(event) => setMapSource(event.target.value as 'standard' | 'amap')} className="h-7 rounded-md border border-slate-200 bg-white px-1.5 text-[9.5px] text-slate-600 outline-none">
                <option value="standard">中国标准地图</option>
                <option value="amap">高德在线地图</option>
              </select>
              {mapSource === 'amap' && amapConfigured !== null ? <span className={cn('rounded px-1.5 py-0.5 text-[8.5px] font-medium', amapConfigured ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700')}>{amapConfigured ? 'API 已配置' : 'API 未配置'}</span> : null}
              <span className="flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />正常</span>
              <span className="flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full bg-amber-500" />异常</span>
              <span className="flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full bg-rose-500" />中断</span>
            </div>
          </div>
          <div className={cn('relative flex-1 overflow-hidden bg-[#0b1425]', mapSource === 'amap' ? 'min-h-[640px] p-0' : 'p-4')}>
            <div className="map-grid absolute inset-0 opacity-30" />
            {mapSource === 'amap' ? (
              <AmapMap datacenters={datacenters} links={links} selectedId={selectedId} onSelect={setSelectedId} />
            ) : (
            <div
              ref={mapRef}
              className={cn('relative mx-auto w-full max-w-[580px] touch-none select-none', mapDragging ? 'cursor-grabbing' : 'cursor-grab')}
              style={{ aspectRatio: mapAspect, maxHeight: 620 }}
              onPointerDown={startDrag}
              onPointerMove={moveDrag}
              onPointerUp={endDrag}
              onPointerLeave={endDrag}
            >
              <div className="absolute inset-0 origin-center transition-transform duration-150" style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }}>
              <img draggable={false} onDragStart={(event) => event.preventDefault()} src={mapUrl} alt="中国标准地图" className="absolute inset-0 h-full w-full select-none object-contain p-3 opacity-90" style={{ filter: 'brightness(1.45)' }} />
              <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="pointer-events-none absolute inset-0 z-[8] h-full w-full">
                {linkLines.map((line) => {
                  const color = line.effective_status === 'up' ? '#34d399' : line.effective_status === 'down' ? '#fb7185' : '#fbbf24';
                  return <line key={line.id} x1={line.x1} y1={line.y1} x2={line.x2} y2={line.y2} stroke={color} strokeWidth="0.55" strokeDasharray={line.effective_status === 'up' ? '0' : '1.8 1.2'} opacity="0.8" vectorEffect="non-scaling-stroke"><title>{`${line.name} · ${line.carrier} · ${line.bandwidth_mbps}M · ${line.effective_status}`}</title></line>;
                })}
              </svg>
              <div className="pointer-events-none absolute inset-0 z-[9]">
                {zoom >= 2 ? provinceLabels.filter((label) => !['海南省', '台湾省'].includes(label.name)).map((label) => (
                  <span key={label.name} className="absolute -translate-x-1/2 -translate-y-1/2 whitespace-nowrap text-[7px] font-medium text-slate-300/80" style={{ left: `${label.left}%`, top: `${label.top}%`, transform: `translate(-50%, -50%) scale(${Math.max(0.5, 1 / zoom)})` }}>{label.name.replace(/省|市|自治区|特别行政区/g, '')}</span>
                )) : null}
              </div>
              {markers.map((marker) => {
                const meta = STATUS_META[marker.network_status] || STATUS_META.unknown;
                const active = marker.id === selectedId;
                return (
                  <button
                    key={marker.id}
                    onClick={() => setSelectedId(marker.id)}
                    className="group absolute z-10 transition"
                    style={{ left: `${marker.left}%`, top: `${marker.top}%`, transform: `translate(-50%, -50%) scale(${(active ? 1.08 : 1) * (zoom > 1.01 ? Math.max(0.12, 0.75 / zoom) : 1)})` }}
                    title={`${marker.name} · ${meta.label}`}
                  >
                    <span className="relative flex h-10 w-10 items-center justify-center">
                      <span className="absolute inset-0 rounded-full opacity-20 pulse-dot" style={{ background: meta.color }} />
                      <span className={cn('relative flex h-7 w-7 items-center justify-center rounded-full border-2 border-white/90 text-white shadow-[0_2px_12px_rgba(0,0,0,0.45)]', active && 'ring-4 ring-white/20')} style={{ background: meta.color }}>
                        <Building2 className="h-3.5 w-3.5" />
                      </span>
                    </span>
                    <span className={cn('absolute left-1/2 top-[38px] -translate-x-1/2 whitespace-nowrap rounded-md border px-1.5 py-0.5 text-[9px] font-medium shadow-sm', active ? 'border-white/20 bg-white text-slate-800' : 'border-white/10 bg-[#101c31]/90 text-slate-200')}>
                      {marker.city} · {meta.label}
                    </span>
                  </button>
                );
              })}
              </div>
              <div className="absolute right-3 top-3 z-20 flex items-center gap-1 rounded-lg border border-white/10 bg-[#101c31]/90 p-1 shadow-sm">
                <button onClick={() => setZoom((value) => Math.max(1, Number((value - 0.5).toFixed(2))))} className="flex h-7 w-7 items-center justify-center rounded-md text-slate-300 hover:bg-white/10" aria-label="缩小地图">−</button>
                <span className="w-9 text-center text-[9px] text-slate-400">{Math.round(zoom * 100)}%</span>
                <button onClick={() => setZoom((value) => Math.min(5, Number((value + 0.5).toFixed(2))))} className="flex h-7 w-7 items-center justify-center rounded-md text-slate-300 hover:bg-white/10" aria-label="放大地图">+</button>
                <button onClick={() => { setZoom(1); setPan({ x: 0, y: 0 }); }} className="ml-0.5 rounded-md px-1.5 py-1 text-[8.5px] text-slate-400 hover:bg-white/10 hover:text-slate-200">重置</button>
              </div>
            </div>
            )}
          </div>
        </div>

        <div className="space-y-3.5 xl:col-span-5">
          <div className="card overflow-hidden">
            <div className="border-b border-[#eef1f6] px-4 py-3">
              <div className="flex items-center justify-between">
                <h2 className="text-[13px] font-semibold text-slate-800">数据中心状态</h2>
                <Badge className="bg-slate-100 text-slate-500 ring-slate-500/10">{datacenters.length} 个</Badge>
              </div>
            </div>
            {loading ? <div className="space-y-2 p-3">{[1, 2, 3].map((item) => <Skeleton key={item} className="h-16" />)}</div> : (
              <div className="divide-y divide-[#f0f2f7]">
                {datacenters.map((item) => {
                  const meta = STATUS_META[item.network_status] || STATUS_META.unknown;
                  return (
                    <button key={item.id} onClick={() => setSelectedId(item.id)} className={cn('flex w-full items-center gap-3 px-4 py-3 text-left transition', item.id === selectedId ? 'bg-brand-50/50' : 'hover:bg-slate-50')}>
                      <span className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-xl', item.id === selectedId ? 'bg-brand-100 text-brand-700' : 'bg-slate-100 text-slate-500')}><Building2 className="h-4 w-4" /></span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-1.5"><span className="truncate text-[11.5px] font-medium text-slate-700">{item.name}</span><span className={cn('h-1.5 w-1.5 rounded-full', meta.dot)} /></span>
                        <span className="mt-0.5 block text-[9px] text-slate-400">{item.city} · {item.rack_count} 机柜 · {item.device_count} 设备 · {item.business_count} 业务</span>
                      </span>
                      <span className={cn('shrink-0 text-[9.5px]', meta.text)}>{meta.label}</span>
                      <ChevronRight className="h-3.5 w-3.5 shrink-0 text-slate-300" />
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {detailLoading || !detail ? <div className="card p-4"><Skeleton className="h-56 w-full" /></div> : (
            <div className="card overflow-hidden">
              <div className="border-b border-[#eef1f6] px-4 py-3">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-[9px] font-semibold uppercase tracking-[0.14em] text-brand-500">Selected datacenter</p>
                    <h2 className="mt-1 text-[14px] font-semibold text-slate-900">{detail.name}</h2>
                    <p className="mt-0.5 flex items-center gap-1 text-[9.5px] text-slate-400"><MapPin className="h-3 w-3" /> {detail.location}</p>
                  </div>
                  <Badge className={networkMeta.badge} dot={networkMeta.dot}>{networkMeta.label}</Badge>
                </div>
                <div className="mt-3 grid grid-cols-4 gap-1.5">
                  {[
                    { label: '机柜', value: detail.rack_count },
                    { label: '设备', value: detail.device_count },
                    { label: '网络设备', value: detail.network_device_count },
                    { label: '业务', value: detail.business_count },
                  ].map((item) => <div key={item.label} className="rounded-lg bg-slate-50 px-1.5 py-1.5 text-center"><p className="text-[15px] font-semibold text-slate-800">{item.value}</p><p className="text-[8.5px] text-slate-400">{item.label}</p></div>)}
                </div>
              </div>
              <div className="p-4">
                <div className="mb-2 flex items-center justify-between">
                  <span className="flex items-center gap-1 text-[10px] font-medium text-slate-600"><Activity className="h-3 w-3" /> 网络连接状态</span>
                  <span className="flex items-center gap-1 text-[8.5px] text-slate-400"><span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> Zabbix{detail.zabbix_last_sync ? ` · ${relativeTime(detail.zabbix_last_sync)}` : ''}</span>
                </div>
                {detail.network_devices.length ? (
                  <div className="space-y-1">
                    {detail.network_devices.slice(0, 4).map((device) => {
                      const meta = STATUS_META[device.status] || STATUS_META.unknown;
                      return (
                        <div key={device.id} className="flex items-center gap-2 rounded-lg border border-slate-100 px-2 py-1.5">
                          <Network className="h-3 w-3 shrink-0 text-cyan-600" />
                          <span className="min-w-0 flex-1 truncate font-mono text-[9.5px] text-slate-600">{device.asset_no}</span>
                          <span className="truncate text-[9px] text-slate-400">{device.latest_alert?.event_name || '链路正常'}</span>
                          <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', meta.dot)} />
                        </div>
                      );
                    })}
                  </div>
                ) : <p className="rounded-lg bg-slate-50 px-3 py-2 text-[10px] text-slate-400">该数据中心暂无纳管网络设备</p>}
                {detail.open_alerts.length ? (
                  <p className="mt-2 flex items-start gap-1.5 rounded-lg bg-amber-50 px-2.5 py-2 text-[9.5px] leading-relaxed text-amber-700"><AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />{detail.open_alerts[0].event_name} · {formatDate(detail.open_alerts[0].received_at, 'MM-DD HH:mm')}</p>
                ) : null}
                {links.filter((link) => link.source_dc_id === detail.id || link.target_dc_id === detail.id).length ? (
                  <div className="mt-3 border-t border-slate-100 pt-2">
                    <p className="mb-1.5 flex items-center gap-1 text-[9.5px] font-medium text-slate-500"><Link2 className="h-3 w-3" /> 数据中心互联线路</p>
                    <div className="space-y-1">
                      {links.filter((link) => link.source_dc_id === detail.id || link.target_dc_id === detail.id).map((link) => {
                        const color = link.effective_status === 'up' ? 'bg-emerald-500' : link.effective_status === 'down' ? 'bg-rose-500' : 'bg-amber-500';
                        return <div key={link.id} className="flex items-center gap-2 text-[9px] text-slate-500"><span className={cn('h-1.5 w-1.5 rounded-full', color)} /><span className="min-w-0 flex-1 truncate">{link.name} · {link.carrier}</span><span className="shrink-0 font-mono text-slate-400">{link.bandwidth_mbps ? `${link.bandwidth_mbps}M` : '—'}</span></div>;
                      })}
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="mt-3.5 card overflow-hidden">
        <SectionHeading
          title="机柜与设备"
          description={detail ? `${detail.name} · ${detail.racks.length} 个机柜 · 点击设备查看承载业务` : '选择数据中心查看机柜'}
          action={detail?.racks.length ? <Link to={`/cmdb/racks?rack=${detail.racks[0].ci_id}`} className="flex items-center gap-1 text-[10px] font-medium text-brand-600 hover:text-brand-700">打开机柜视图 <ArrowUpRight className="h-3 w-3" /></Link> : null}
        />
        {detailLoading ? <div className="grid gap-3 p-4 md:grid-cols-2">{[1, 2].map((item) => <Skeleton key={item} className="h-48" />)}</div> : detail?.racks.length ? (
          <div className="grid gap-3 p-4 md:grid-cols-2">
            {detail.racks.map((rack) => (
              <div key={rack.ci_id} className="rounded-xl border border-slate-200 bg-white p-3">
                <div className="flex items-center gap-2.5 border-b border-slate-100 pb-2.5">
                  <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-50 text-amber-600"><Layers3 className="h-4 w-4" /></span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[11.5px] font-semibold text-slate-700">{rack.asset_no} · {rack.name}</p>
                    <p className="mt-0.5 text-[9px] text-slate-400">{rack.capacity_u}U · 已用 {rack.used_u}U · {rack.devices.length} 台设备</p>
                  </div>
                  <Link to={`/cmdb/racks?rack=${rack.ci_id}`} className="rounded-md p-1 text-slate-400 hover:bg-slate-50 hover:text-brand-600"><ArrowUpRight className="h-3.5 w-3.5" /></Link>
                </div>
                {rack.devices.length ? (
                  <div className="mt-2 grid grid-cols-2 gap-1.5">
                    {rack.devices.map((device) => (
                      <button key={device.id} onClick={() => setDeviceTarget(device)} className="flex items-center gap-2 rounded-lg border border-slate-100 px-2 py-1.5 text-left transition hover:border-brand-200 hover:bg-brand-50/40">
                        <span className="h-5 w-1 shrink-0 rounded-full" style={{ background: device.type_color || '#4f6ef7' }} />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[9.5px] font-medium text-slate-600">{device.name}</span>
                          <span className="block font-mono text-[8px] text-slate-400">{device.start_u}U · {device.asset_no}</span>
                        </span>
                        {device.businesses?.length ? <span className="shrink-0 rounded bg-pink-50 px-1 py-0.5 text-[8px] text-pink-600">{device.businesses.length} 业务</span> : null}
                      </button>
                    ))}
                  </div>
                ) : <p className="py-4 text-center text-[10px] text-slate-400">暂无设备</p>}
              </div>
            ))}
          </div>
        ) : <EmptyState title="该数据中心尚未纳管机柜" description="可在机柜视图中为数据中心创建机柜并上架设备。" icon={Layers3} className="py-14" />}
      </div>

      <Modal
        open={Boolean(deviceTarget)}
        onClose={() => setDeviceTarget(null)}
        title={deviceTarget ? `${deviceTarget.asset_no} · ${deviceTarget.name}` : '设备详情'}
        description={deviceTarget ? `${deviceTarget.type_name} · ${detail?.name} · ${deviceTarget.start_u}U${deviceTarget.u_height > 1 ? `-${deviceTarget.start_u + deviceTarget.u_height - 1}U` : ''}` : ''}
        icon={Server}
        size="md"
        footer={<Link to={`/cmdb/${deviceTarget?.ci_id}`}><Button size="sm" variant="secondary" icon={ArrowUpRight}>查看资产详情</Button></Link>}
      >
        {deviceTarget ? (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3 rounded-xl border border-slate-100 bg-slate-50/70 p-3">
              <div><p className="text-[9px] text-slate-400">业务地址</p><p className="mt-0.5 font-mono text-[11px] text-slate-600">{deviceTarget.ip_address || '—'}</p></div>
              <div><p className="text-[9px] text-slate-400">BMC 管理地址</p><p className="mt-0.5 font-mono text-[11px] text-slate-600">{deviceTarget.bmc_address || '—'}</p></div>
              <div><p className="text-[9px] text-slate-400">设备状态</p><p className="mt-0.5 text-[11px] text-slate-600">{CI_STATUS_META[deviceTarget.status]?.label || deviceTarget.status}</p></div>
              <div><p className="text-[9px] text-slate-400">业务数量</p><p className="mt-0.5 text-[11px] text-slate-600">{deviceTarget.businesses?.length || 0} 个</p></div>
            </div>
            <div>
              <p className="mb-1.5 flex items-center gap-1 text-[10.5px] font-medium text-slate-600"><BriefcaseBusiness className="h-3.5 w-3.5 text-pink-500" /> 承载业务</p>
              {deviceTarget.businesses?.length ? (
                <div className="space-y-1.5">
                  {deviceTarget.businesses.map((business) => (
                    <Link key={business.id} to={`/cmdb/${business.id}`} className="flex items-center gap-2.5 rounded-lg border border-pink-100 bg-pink-50/40 px-3 py-2 transition hover:border-pink-200">
                      <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-pink-100 text-pink-600"><BriefcaseBusiness className="h-3.5 w-3.5" /></span>
                      <span className="min-w-0 flex-1"><span className="block truncate text-[11px] font-medium text-slate-700">{business.name}</span><span className="block text-[9px] text-slate-400">{business.asset_no} · {CRITICALITY_META[business.criticality]?.label || business.criticality || '—'}</span></span>
                      <ChevronRight className="h-3 w-3 text-pink-300" />
                    </Link>
                  ))}
                </div>
              ) : (
                <p className="rounded-lg border border-dashed border-slate-200 px-3 py-4 text-center text-[10px] text-slate-400">该设备尚未关联业务系统。可在 CI 关系模型中使用「运行于」关系建立业务承载。</p>
              )}
            </div>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
