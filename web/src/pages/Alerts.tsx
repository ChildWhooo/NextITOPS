import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowRight,
  BellRing,
  CheckCircle2,
  ChevronRight,
  Clock3,
  ExternalLink,
  Filter,
  Radar,
  RefreshCw,
  Search,
  Server,
  ShieldCheck,
  Sparkles,
  Trash2,
  Zap,
} from 'lucide-react';
import { toast } from 'sonner';
import { api, buildQuery } from '@/lib/api';
import { usePageTitle, useDebounce } from '@/lib/hooks';
import { useSidebarThemeMode } from '@/lib/useSidebarTheme';
import { usePageSize } from '@/lib/pageSize';
import { useAuth } from '@/context/AuthContext';
import { SEVERITY_META, cn, formatDate, relativeTime } from '@/lib/utils';
import type { ZabbixEvent } from '@/lib/types';
import {
  Badge,
  Button,
  EmptyState,
  Modal,
  PageHeader,
  PageSizeSelect,
  Pagination,
  SearchInput,
  Skeleton,
} from '@/components/ui';

const PROCESSING_META: Record<string, { label: string; className: string }> = {
  received: { label: '处理中', className: 'bg-sky-50 text-sky-700 ring-sky-600/15' },
  ticket_created: { label: '已建单', className: 'bg-emerald-50 text-emerald-700 ring-emerald-600/15' },
  deduplicated: { label: '已去重', className: 'bg-blue-50 text-blue-700 ring-blue-600/15' },
  ignored: { label: '已忽略', className: 'bg-slate-100 text-slate-500 ring-slate-500/10' },
  recovery_notice: { label: '恢复通知', className: 'bg-teal-50 text-teal-700 ring-teal-600/15' },
  recovery_unmatched: { label: '恢复未匹配', className: 'bg-amber-50 text-amber-700 ring-amber-600/15' },
};

const SEVERITY_ORDER = ['disaster', 'high', 'average', 'warning', 'information', 'not_classified'];

export default function AlertsPage() {
  usePageTitle('告警中心');
  const { can, user } = useAuth();
  const navigate = useNavigate();
  const dark = useSidebarThemeMode() === 'dark';
  const [events, setEvents] = useState<ZabbixEvent[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = usePageSize('alerts');
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<any>(null);
  const [severity, setSeverity] = useState('');
  const [status, setStatus] = useState('');
  const [processing, setProcessing] = useState('');
  const [search, setSearch] = useState('');
  const debounced = useDebounce(search, 300);
  const [detail, setDetail] = useState<ZabbixEvent | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  const loadStats = () => api.get<any>('/api/integrations/zabbix/events/stats').then(setStats).catch(() => {});

  useEffect(() => {
    loadStats();
  }, []);

  useEffect(() => {
    let active = true;
    setLoading(true);
    api
      .get<{ data: ZabbixEvent[]; pagination: { total: number } }>(
        `/api/integrations/zabbix/events${buildQuery({
          severity,
          status,
          processing_status: processing,
          q: debounced,
          page,
          pageSize,
        })}`,
      )
      .then((response) => {
        if (!active) return;
        setEvents(response.data);
        setTotal(response.pagination.total);
      })
      .catch((error) => active && toast.error(error.message))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [severity, status, processing, debounced, page, pageSize, refreshKey]);

  useEffect(() => {
    setPage(1);
  }, [severity, status, processing, debounced]);

  const openDetail = async (event: ZabbixEvent) => {
    setDetail(event);
    setDetailLoading(true);
    try {
      const response = await api.get<{ data: ZabbixEvent }>(`/api/integrations/zabbix/events/${event.id}`);
      setDetail(response.data);
    } catch (error: any) {
      toast.error(error.message);
    } finally {
      setDetailLoading(false);
    }
  };

  const deleteEvent = async () => {
    if (!detail || !window.confirm('确定删除这条告警记录吗？此操作不可恢复。')) return;
    try {
      await api.delete(`/api/integrations/zabbix/events/${detail.id}`);
      toast.success('告警记录已删除');
      setDetail(null);
      loadStats();
      setPage(1);
      setRefreshKey((value) => value + 1);
    } catch (error: any) {
      toast.error(error.message);
    }
  };

  const bySeverity = stats?.by_severity || {};
  const maxSeverity = Math.max(1, ...Object.values(bySeverity).map((value) => Number(value)));

  return (
    <div className="animate-enter">
      <PageHeader
        eyebrow="Monitoring signal"
        title="告警中心"
        description="汇总 Zabbix 7 监控告警，追踪从告警接收、条件过滤到自动建单的全过程。"
        actions={
          <>
            <Button variant="secondary" size="sm" icon={RefreshCw} onClick={() => { loadStats(); setRefreshKey((value) => value + 1); }}>刷新</Button>
            {can('integration.manage') ? <Button size="sm" icon={Radar} onClick={() => navigate('/integrations/zabbix')}>集成配置</Button> : null}
          </>
        }
      />

      <div
        className={cn('relative mb-3.5 overflow-hidden rounded-lg border p-5 sm:p-6', dark ? 'border-white/10' : 'border-[#e5e6eb] bg-white')}
        style={dark ? { background: 'var(--sidebar-bg)', borderColor: 'var(--sidebar-border)' } : undefined}
      >
        <div className={cn('pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_92%_0%,var(--theme-primary-light),transparent_48%)]', dark ? 'opacity-25' : 'opacity-70')} />
        <div className="relative flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className={cn('flex items-center gap-2 text-[9.5px] font-semibold uppercase tracking-[0.18em]', dark ? 'text-rose-300' : 'text-rose-600')}>
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full rounded-full bg-rose-500 opacity-60 pulse-dot" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-rose-500" />
              </span>
              Live monitoring feed
            </div>
            <h2
              className={cn('mt-2 text-[24px] font-semibold tracking-[-0.025em]', dark ? 'text-white' : 'text-[#1f2329]')}
              style={dark ? { color: 'var(--sidebar-text)' } : undefined}
            >
              告警态势一览
            </h2>
            <p
              className={cn('mt-1 max-w-lg text-[11px] leading-relaxed', dark ? 'text-slate-400' : 'text-[#4e5969]')}
              style={dark ? { color: 'var(--sidebar-muted)' } : undefined}
            >
              最近 24 小时接收 <span className={cn('font-semibold', dark ? 'text-slate-200' : 'text-[#1f2329]')}>{stats?.last24h || 0}</span> 条告警，自动创建 <span className={cn('font-semibold', dark ? 'text-emerald-400' : 'text-emerald-600')}>{stats?.tickets_created || 0}</span> 张事件工单。
            </p>
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <div className={cn('flex items-center gap-2 rounded-md border px-3 py-2', dark ? 'border-white/10 bg-white/[0.05]' : 'border-[#e5e6eb] bg-white')}>
                <ShieldCheck className={cn('h-3.5 w-3.5', dark ? 'text-emerald-400' : 'text-emerald-600')} />
                <span className={cn('text-[10px]', dark ? 'text-slate-300' : 'text-[#4e5969]')}>Zabbix 7 已接入</span>
              </div>
              <div className={cn('flex items-center gap-2 rounded-md border px-3 py-2', dark ? 'border-white/10 bg-white/[0.05]' : 'border-[#e5e6eb] bg-white')}>
                <Zap className="h-3.5 w-3.5 text-brand-500" />
                <span className={cn('text-[10px]', dark ? 'text-slate-300' : 'text-[#4e5969]')}>条件化自动建单</span>
              </div>
            </div>
          </div>
          <div
            className={cn('w-full max-w-sm rounded-lg border p-3.5', dark ? 'border-white/10' : 'border-[#e5e6eb] bg-[#fafafa]')}
            style={dark ? { background: 'var(--sidebar-panel)', borderColor: 'var(--sidebar-border)' } : undefined}
          >
            <div className="mb-2.5 flex items-center justify-between">
              <span className={cn('text-[9.5px] font-medium uppercase tracking-wider', dark ? 'text-slate-300' : 'text-[#4e5969]')}>严重级别分布</span>
              <span className={cn('text-[9.5px]', dark ? 'text-slate-500' : 'text-[#86909c]')}>全部告警</span>
            </div>
            <div className="space-y-1.5">
              {SEVERITY_ORDER.slice(0, 5).map((key) => {
                const meta = SEVERITY_META[key];
                const value = Number(bySeverity[key] || 0);
                return (
                  <div key={key} className="flex items-center gap-2">
                    <span className={cn('w-12 text-[9px]', dark ? 'text-slate-400' : 'text-[#4e5969]')}>{meta.label}</span>
                    <div className={cn('h-1.5 flex-1 overflow-hidden rounded-full', dark ? 'bg-white/10' : 'bg-[#e5e6eb]')}>
                      <div className={cn('h-full rounded-full', meta.dot)} style={{ width: `${(value / maxSeverity) * 100}%` }} />
                    </div>
                    <span className={cn('w-5 text-right font-mono text-[9px]', dark ? 'text-slate-500' : 'text-[#86909c]')}>{value}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      <div className="mb-3.5 grid grid-cols-2 gap-2.5 lg:grid-cols-4">
        {[
          { label: '告警总数', value: stats?.total || 0, icon: BellRing, tone: 'text-slate-700 bg-slate-100' },
          { label: '最近 24 小时', value: stats?.last24h || 0, icon: Clock3, tone: 'text-brand-600 bg-brand-50' },
          { label: '自动建单', value: stats?.tickets_created || 0, icon: CheckCircle2, tone: 'text-emerald-600 bg-emerald-50' },
          { label: '过滤忽略', value: stats?.ignored || 0, icon: Filter, tone: 'text-amber-600 bg-amber-50' },
        ].map((item) => (
          <div key={item.label} className="card flex items-center gap-3 p-3.5">
            <span className={cn('flex h-9 w-9 items-center justify-center rounded-xl', item.tone)}><item.icon className="h-4 w-4" /></span>
            <div><p className="text-[19px] font-semibold leading-none text-slate-900">{item.value}</p><p className="mt-1 text-[9.5px] text-slate-400">{item.label}</p></div>
          </div>
        ))}
      </div>

      <div className="card overflow-hidden">
        <div className="flex flex-col gap-3 border-b border-[#eef1f6] p-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-[13px] font-semibold text-slate-800">事件流水</h3>
              <p className="mt-0.5 text-[10px] text-slate-400">共 {total} 条记录 · 点击查看原始 Payload</p>
            </div>
            <span className="flex items-center gap-1.5 rounded-full bg-emerald-50 px-2 py-1 text-[9px] font-medium text-emerald-700"><span className="h-1.5 w-1.5 rounded-full bg-emerald-500 pulse-dot" />实时接收</span>
          </div>
          <div className="flex flex-col gap-2 lg:flex-row">
            <SearchInput value={search} onChange={setSearch} placeholder="搜索告警名称、主机或事件 ID…" className="w-full lg:w-[330px]" />
            <select className="input-base h-9 w-auto min-w-[115px] text-[12px]" value={severity} onChange={(event) => setSeverity(event.target.value)}>
              <option value="">全部级别</option>
              {SEVERITY_ORDER.map((value) => <option key={value} value={value}>{SEVERITY_META[value].label}</option>)}
            </select>
            <select className="input-base h-9 w-auto min-w-[110px] text-[12px]" value={status} onChange={(event) => setStatus(event.target.value)}>
              <option value="">全部状态</option>
              <option value="PROBLEM">PROBLEM</option>
              <option value="RECOVERY">RECOVERY</option>
            </select>
            <select className="input-base h-9 w-auto min-w-[130px] text-[12px]" value={processing} onChange={(event) => setProcessing(event.target.value)}>
              <option value="">全部处理结果</option>
              {Object.entries(PROCESSING_META).map(([value, item]) => <option key={value} value={value}>{item.label}</option>)}
            </select>
          </div>
        </div>

        {loading ? (
          <div className="space-y-2 p-4">{[1, 2, 3, 4].map((item) => <Skeleton key={item} className="h-16 w-full" />)}</div>
        ) : events.length ? (
          <>
            <div className="divide-y divide-[#f0f2f7]">
              {events.map((event) => {
                const meta = SEVERITY_META[event.severity] || SEVERITY_META.warning;
                const processMeta = PROCESSING_META[event.processing_status] || PROCESSING_META.received;
                return (
                  <div key={event.id} onClick={() => openDetail(event)} className="group relative flex cursor-pointer items-start gap-3.5 px-5 py-3.5 transition hover:bg-[#fafbff]">
                    <span className={cn('absolute inset-y-3 left-0 w-0.5 rounded-full', meta.dot)} />
                    <span className="relative mt-1 flex h-2.5 w-2.5 shrink-0">
                      <span className={cn('absolute inline-flex h-full w-full rounded-full opacity-40 pulse-dot', meta.dot)} />
                      <span className={cn('relative inline-flex h-2.5 w-2.5 rounded-full', meta.dot)} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="max-w-[560px] truncate text-[12px] font-medium text-slate-700 group-hover:text-brand-700">{event.event_name}</p>
                        <Badge className={meta.className}>{meta.label}</Badge>
                        <Badge className={processMeta.className}>{processMeta.label}</Badge>
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[9.5px] text-slate-400">
                        <span className="flex items-center gap-1"><Server className="h-2.5 w-2.5" />{event.host_name || '未知主机'}{event.host_ip ? ` · ${event.host_ip}` : ''}</span>
                        <span>#{event.event_id}</span>
                        <span>{event.event_status}</span>
                        <span>{relativeTime(event.received_at)}</span>
                        {event.tags?.slice(0, 2).map((tag, index) => <span key={index} className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[8.5px] text-slate-500">{tag.tag}{tag.value ? `=${tag.value}` : ''}</span>)}
                      </div>
                    </div>
                    {event.ticket_no ? (
                      <Link onClick={(clickEvent) => clickEvent.stopPropagation()} to={`/tickets/incident/${event.ticket_id}`} className="hidden shrink-0 items-center gap-1 self-center rounded-lg border border-brand-100 bg-brand-50 px-2 py-1 font-mono text-[9px] font-medium text-brand-600 hover:bg-brand-100 sm:flex">
                        {event.ticket_no} <ArrowRight className="h-2.5 w-2.5" />
                      </Link>
                    ) : <ChevronRight className="mt-1 h-3.5 w-3.5 shrink-0 text-slate-300" />}
                  </div>
                );
              })}
            </div>
            <div className="flex flex-col items-center justify-between gap-2 border-t border-[#eef1f6] px-4 py-2 sm:flex-row"><PageSizeSelect value={pageSize} onChange={setPageSize} /><Pagination page={page} pageSize={pageSize} total={total} onChange={setPage} /></div>
          </>
        ) : (
          <EmptyState title="暂无告警事件" description="当 Zabbix 触发告警或手动模拟后，事件将在这里出现。" icon={BellRing} className="py-16" />
        )}
      </div>

      <Modal
        open={Boolean(detail)}
        onClose={() => setDetail(null)}
        title={detail?.event_name || '告警详情'}
        description={detail ? `事件 #${detail.event_id} · ${detail.host_name || '未知主机'}` : ''}
        icon={AlertTriangle}
        size="lg"
        footer={<>{user?.role?.code === 'admin' ? <Button variant="danger" size="sm" icon={Trash2} onClick={deleteEvent}>删除告警记录</Button> : null}<Button variant="secondary" size="sm" onClick={() => setDetail(null)}>关闭</Button></>}
      >
        {detailLoading ? <div className="space-y-2"><Skeleton className="h-20 w-full" /><Skeleton className="h-44 w-full" /></div> : detail ? (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <Badge className={SEVERITY_META[detail.severity]?.className} dot={SEVERITY_META[detail.severity]?.dot}>{SEVERITY_META[detail.severity]?.label}</Badge>
              <Badge className={PROCESSING_META[detail.processing_status]?.className || PROCESSING_META.received.className}>{PROCESSING_META[detail.processing_status]?.label || detail.processing_status}</Badge>
              {detail.ticket_no ? <Link to={`/tickets/incident/${detail.ticket_id}`} className="ml-auto flex items-center gap-1 font-mono text-[10.5px] font-medium text-brand-600">查看 {detail.ticket_no} <ExternalLink className="h-3 w-3" /></Link> : null}
            </div>
            <div className="rounded-xl border border-slate-100 bg-slate-50/70 p-3.5">
              <p className="text-[9px] font-medium uppercase tracking-wider text-slate-400">处理说明</p>
              <p className="mt-1 text-[11px] leading-relaxed text-slate-600">{detail.processing_note || '—'}</p>
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <DetailField label="主机" value={detail.host_name || '—'} />
              <DetailField label="IP 地址" value={detail.host_ip || '—'} mono />
              <DetailField label="触发 ID" value={detail.trigger_id || '—'} mono />
              <DetailField label="接收时间" value={formatDate(detail.received_at)} />
            </div>
            {detail.tags?.length ? (
              <div>
                <p className="mb-1.5 text-[10px] font-medium text-slate-400">标签</p>
                <div className="flex flex-wrap gap-1.5">
                  {detail.tags.map((tag, index) => <span key={index} className="rounded-md bg-slate-100 px-2 py-1 font-mono text-[9.5px] text-slate-600">{tag.tag}{tag.value ? `=${tag.value}` : ''}</span>)}
                </div>
              </div>
            ) : null}
            <div>
              <p className="mb-1.5 text-[10px] font-medium text-slate-400">原始 Payload</p>
              <pre className="custom-scroll max-h-72 overflow-auto rounded-xl bg-ink-900 p-3.5 font-mono text-[9.5px] leading-relaxed text-slate-300">{JSON.stringify(detail.payload || {}, null, 2)}</pre>
            </div>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}

function DetailField({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <p className="text-[9px] font-medium uppercase tracking-wider text-slate-400">{label}</p>
      <p className={cn('mt-1 text-[11px] text-slate-600', mono && 'font-mono')}>{value}</p>
    </div>
  );
}
