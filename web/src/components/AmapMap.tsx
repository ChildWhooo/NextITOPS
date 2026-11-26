import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { MapPin } from 'lucide-react';
import { api } from '@/lib/api';

declare global {
  interface Window { AMap?: any; _AMapSecurityConfig?: { securityJsCode?: string } }
}

const STATUS_COLOR: Record<string, string> = { healthy: '#10b981', degraded: '#f59e0b', down: '#f43f5e', unknown: '#94a3b8' };
const STATUS_LABEL: Record<string, string> = { healthy: '网络正常', degraded: '链路异常', down: '网络中断', unknown: '暂无监控' };

function loadAmap(key: string, securityCode: string) {
  if (window.AMap) return Promise.resolve(window.AMap);
  if (securityCode) window._AMapSecurityConfig = { securityJsCode: securityCode };
  return new Promise<any>((resolve, reject) => {
    const existing = document.querySelector('script[data-nextitops-amap]') as HTMLScriptElement | null;
    if (existing) { existing.addEventListener('load', () => resolve(window.AMap)); existing.addEventListener('error', reject); return; }
    const script = document.createElement('script');
    script.dataset.nextitopsAmap = '1';
    script.src = `https://webapi.amap.com/maps?v=2.0&key=${encodeURIComponent(key)}&plugin=AMap.Scale,AMap.ToolBar`;
    script.async = true;
    script.onload = () => window.AMap ? resolve(window.AMap) : reject(new Error('高德 JS API 加载失败'));
    script.onerror = () => reject(new Error('无法加载高德 JS API，请检查网络或 Key'));
    document.head.appendChild(script);
  });
}

export function AmapMap({ datacenters, links, selectedId, onSelect }: { datacenters: any[]; links: any[]; selectedId?: number; onSelect: (id: number) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const markersRef = useRef<any[]>([]);
  const linesRef = useRef<any[]>([]);
  const [status, setStatus] = useState<'loading' | 'ready' | 'unconfigured' | 'error'>('loading');
  const [message, setMessage] = useState('');
  useEffect(() => {
    let active = true;
    api.get<{ data: { js_key: string; security_code: string; configured: boolean } }>('/api/system/amap-config').then(async (response) => {
      if (!response.data.configured || !response.data.js_key) {
        if (active) { setStatus('unconfigured'); setMessage('尚未配置高德 JS API Key'); }
        return;
      }
      try {
        const AMap = await loadAmap(response.data.js_key, response.data.security_code);
        if (!active || !ref.current) return;
        const map = new AMap.Map(ref.current, { zoom: 4, center: [104, 35], resizeEnable: true, viewMode: '2D' });
        map.addControl(new AMap.Scale({ position: { left: '16px', bottom: '16px' } }));
        map.addControl(new AMap.ToolBar({ position: { right: '16px', bottom: '48px' } }));
        mapRef.current = map;
        setStatus('ready');
      } catch (error: any) {
        if (active) { setStatus('error'); setMessage(error.message); }
      }
    }).catch((error) => { if (active) { setStatus('error'); setMessage(error.message); } });
    return () => { active = false; if (mapRef.current) { mapRef.current.destroy(); mapRef.current = null; } };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    const AMap = window.AMap;
    if (status !== 'ready' || !map || !AMap) return;
    for (const marker of markersRef.current) marker.setMap(null);
    for (const line of linesRef.current) line.setMap(null);
    const byId = new Map(datacenters.map((dc) => [dc.id, dc]));
    const lines = (links || []).map((link) => {
      const source = byId.get(link.source_dc_id);
      const target = byId.get(link.target_dc_id);
      if (!source || !target || !source.latitude || !target.latitude) return null;
      const status = link.effective_status || 'unknown';
      const line = new AMap.Polyline({
        path: [[Number(source.longitude), Number(source.latitude)], [Number(target.longitude), Number(target.latitude)]],
        strokeColor: status === 'up' ? '#34d399' : status === 'down' ? '#fb7185' : '#fbbf24',
        strokeWeight: 2,
        strokeOpacity: 0.9,
        strokeStyle: status === 'up' ? 'solid' : 'dashed',
        zIndex: 50,
      });
      return line;
    }).filter(Boolean);
    linesRef.current = lines;
    if (lines.length) map.add(lines);
    const markers = datacenters.filter((dc) => Number.isFinite(Number(dc.latitude)) && Number.isFinite(Number(dc.longitude))).map((dc) => {
      const color = STATUS_COLOR[dc.network_status] || STATUS_COLOR.unknown;
      const label = `${dc.city || dc.name} · ${STATUS_LABEL[dc.network_status] || '暂无监控'}`.replace(/[<>&"]/g, '');
      const content = `<div style="position:relative;width:28px;height:28px;border-radius:999px;border:2px solid rgba(255,255,255,.9);background:${color};display:flex;align-items:center;justify-content:center;color:white;font-size:12px;box-shadow:0 3px 12px rgba(0,0,0,.35)">◉<span style="position:absolute;left:50%;top:32px;transform:translateX(-50%);padding:2px 6px;border-radius:4px;background:rgba(15,31,51,.88);color:#e2e8f0;font-size:10px;white-space:nowrap">${label}</span></div>`;
      const marker = new AMap.Marker({ position: [Number(dc.longitude), Number(dc.latitude)], content, anchor: 'center', zIndex: dc.id === selectedId ? 120 : 100 });
      marker.on('click', () => onSelect(dc.id));
      return marker;
    });
    markersRef.current = markers;
    map.add(markers);
    if (markers.length) map.setFitView(markers, false, [60, 60, 60, 60], 10);
  }, [datacenters, links, status, selectedId, onSelect]);

  if (status === 'unconfigured' || status === 'error') {
    return <div className="flex h-[640px] min-h-[640px] flex-col items-center justify-center gap-2 rounded-xl bg-slate-900/40 text-center"><MapPin className="h-7 w-7 text-slate-500" /><p className="text-[11px] text-slate-300">{message}</p><Link to="/system/third-party" className="text-[10.5px] font-medium text-sky-400 hover:text-sky-300">前往系统设置 → API 配置</Link></div>;
  }
  return <div className="relative h-[640px] min-h-[640px] w-full"><div ref={ref} className="rounded-xl" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }} />{status === 'loading' ? <div className="absolute inset-0 flex items-center justify-center bg-slate-900/30 text-[11px] text-slate-300">正在加载高德地图…</div> : null}</div>;
}
