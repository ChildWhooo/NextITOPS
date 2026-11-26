import { useEffect, useState } from 'react';
import { Activity, AlertTriangle, CheckCircle2, Cpu, HardDrive, MemoryStick, RefreshCw, Server, ShieldAlert } from 'lucide-react';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import { Button, Modal, Skeleton } from '@/components/ui';

export function formatUptime(seconds: number) {
  const totalMinutes = Math.floor(Math.max(0, Number(seconds) || 0) / 60);
  if (totalMinutes < 60) return `${totalMinutes} 分钟`;
  const totalHours = Math.floor(totalMinutes / 60);
  if (totalHours < 24) return `${totalHours} 小时 ${totalMinutes % 60} 分钟`;
  const totalDays = Math.floor(totalHours / 24);
  if (totalDays < 30) return `${totalDays} 天 ${totalHours % 24} 小时`;
  const totalMonths = Math.floor(totalDays / 30);
  if (totalMonths < 12) return `${totalMonths} 个月 ${totalDays % 30} 天`;
  return `${Math.floor(totalMonths / 12)} 年 ${totalMonths % 12} 个月 ${totalDays % 30} 天`;
}

export default function SystemStatusModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const load = async () => {
    setLoading(true);
    try { const response = await api.get<{ data: any }>('/api/system/runtime-status'); setData(response.data); }
    catch { setData(null); }
    finally { setLoading(false); }
  };
  useEffect(() => {
    if (!open) return;
    load();
    const timer = window.setInterval(load, 30000);
    return () => window.clearInterval(timer);
  }, [open]);

  const statusColor = data?.status === 'healthy' ? 'bg-emerald-500' : 'bg-amber-500';
  const percent = (value: number) => Math.min(100, Math.max(0, Number(value || 0)));
  return (
    <Modal open={open} onClose={onClose} title="平台运行状态" description="查看服务性能、容量与核心组件状态；异常详情仅系统管理员可见。" icon={Activity} size="lg" footer={<><Button variant="secondary" size="sm" onClick={onClose}>关闭</Button><Button size="sm" icon={RefreshCw} loading={loading} onClick={load}>刷新状态</Button></>}>
      {!data ? <div className="space-y-2"><Skeleton className="h-20" /><Skeleton className="h-28" /><Skeleton className="h-20" /></div> : (
        <div className="space-y-3">
          <div className="flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50/70 px-4 py-3">
            <div className="flex items-center gap-2"><span className={cn('h-2.5 w-2.5 rounded-full', statusColor)} /><div><p className="text-[12px] font-semibold text-slate-800">{data.status === 'healthy' ? '平台运行正常' : '平台存在异常'}</p><p className="mt-0.5 text-[10px] text-slate-400">已运行 {formatUptime(data.uptime_seconds || 0)} · {data.host?.platform} {data.host?.arch}</p></div></div>
            <span className={cn('rounded-full px-2 py-1 text-[9.5px] font-medium', data.status === 'healthy' ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700')}>{data.services?.filter((item: any) => item.status === 'down').length ? '需处理' : '健康'}</span>
          </div>
          <div className="grid grid-cols-3 gap-2.5">
            {[
              { label: 'CPU 负载', value: `${data.cpu_percent || 0}%`, icon: Cpu, detail: `${data.host?.cpu_count || 0} 核 · 进程 ${data.process_cpu_percent || 0}%`, percent: data.cpu_percent },
              { label: '内存使用', value: `${data.memory?.used_percent || 0}%`, icon: MemoryStick, detail: `${Math.round((data.memory?.free || 0) / 1024 / 1024 / 1024 * 10) / 10}GB 可用`, percent: data.memory?.used_percent },
              { label: '磁盘容量', value: `${data.disk?.used_percent ?? '—'}%`, icon: HardDrive, detail: data.disk ? `${Math.round((data.disk.free || 0) / 1024 / 1024 / 1024)}GB 可用` : '不可用', percent: data.disk?.used_percent || 0 },
            ].map((item) => (
              <div key={item.label} className="rounded-xl border border-slate-200 p-3">
                <div className="flex items-center justify-between"><span className="text-[10px] text-slate-400">{item.label}</span><item.icon className="h-3.5 w-3.5 text-slate-400" /></div>
                <p className="mt-1.5 text-[20px] font-semibold text-slate-900">{item.value}</p>
                <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-slate-100"><div className={cn('h-full rounded-full', percent(item.percent) > 90 ? 'bg-rose-500' : percent(item.percent) > 75 ? 'bg-amber-500' : 'bg-emerald-500')} style={{ width: `${percent(item.percent)}%` }} /></div>
                <p className="mt-1 text-[9px] text-slate-400">{item.detail}</p>
              </div>
            ))}
          </div>
          <div className="rounded-xl border border-slate-200">
            <div className="flex items-center justify-between border-b border-slate-100 px-3.5 py-2.5"><p className="text-[11px] font-semibold text-slate-700">应用服务状态</p><span className="text-[9px] text-slate-400">{data.checked_at ? new Date(data.checked_at).toLocaleTimeString('zh-CN') : ''}</span></div>
            <div className="grid grid-cols-1 gap-1 p-2 sm:grid-cols-2">
              {data.services?.map((service: any) => (
                <div key={service.key} className="flex items-center gap-2 rounded-lg px-2 py-2 hover:bg-slate-50">
                  <span className={cn('h-1.5 w-1.5 rounded-full', service.status === 'up' ? 'bg-emerald-500' : service.status === 'busy' ? 'bg-amber-500' : service.status === 'down' ? 'bg-rose-500' : 'bg-slate-300')} />
                  <span className="min-w-0 flex-1 text-[10.5px] text-slate-600">{service.name}</span>
                  <span className="text-[9px] text-slate-400">{service.detail}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="rounded-xl border border-slate-200">
            <div className="flex items-center justify-between border-b border-slate-100 px-3.5 py-2.5"><p className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-700"><AlertTriangle className="h-3.5 w-3.5 text-amber-500" /> 异常与容量告警</p>{data.anomaly_details_restricted ? <span className="text-[9px] text-slate-400">仅系统管理员可见详情</span> : null}</div>
            <div className="space-y-1 p-2">
              {data.anomalies?.length ? data.anomalies.map((item: any, index: number) => (
                <div key={`${item.service}-${index}`} className={cn('rounded-lg px-2.5 py-2 text-[10px] leading-relaxed', item.severity === 'critical' ? 'bg-rose-50 text-rose-700' : 'bg-amber-50 text-amber-700')}>
                  <span className="font-semibold">{item.service}</span> · {item.detail}
                </div>
              )) : <p className="flex items-center gap-1.5 px-2 py-3 text-[10px] text-emerald-600"><CheckCircle2 className="h-3.5 w-3.5" /> 暂无异常，容量与服务状态正常。</p>}
              {data.anomaly_details_restricted ? <p className="flex items-center gap-1.5 px-2 py-2 text-[9.5px] text-slate-400"><ShieldAlert className="h-3.5 w-3.5" /> 异常堆栈与详细信息仅向系统管理员展示。</p> : null}
            </div>
          </div>
          <p className="flex items-center gap-1 text-[9px] text-slate-400"><Server className="h-3 w-3" /> 数据库延迟 {data.database?.latency_ms ?? '—'}ms · 进程内存 {Math.round((data.memory?.process_rss || 0) / 1024 / 1024)}MB</p>
        </div>
      )}
    </Modal>
  );
}
