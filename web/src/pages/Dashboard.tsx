import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  ArrowUpRight,
  CalendarClock,
  CheckCircle2,
  Clock3,
  Database,
  GitPullRequest,
  Plus,
  RefreshCw,
  SearchCheck,
  Server,
  ShieldAlert,
  Sparkles,
  TimerReset,
  TrendingUp,
  Zap,
} from 'lucide-react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { useAuth } from '@/context/AuthContext';
import { api } from '@/lib/api';
import {
  cn,
  formatDate,
  formatNumber,
  PRIORITY_META,
  relativeTime,
  SEVERITY_META,
  TICKET_STATUS_META,
  TICKET_TYPE_META,
} from '@/lib/utils';
import { DATA_CHANGED_EVENT } from '@/lib/refresh';
import { Avatar, Badge, Button, EmptyState, PageHeader, SectionHeading, Skeleton } from '@/components/ui';
import { DynamicIcon } from '@/components/DynamicIcon';

const METRIC_META = [
  {
    key: 'totalCis',
    label: '配置项总数',
    description: '纳管的 IT 资产与配置',
    icon: Database,
    tone: 'text-brand-600 bg-brand-50',
    accent: 'from-brand-500 to-indigo-400',
  },
  {
    key: 'openIncidents',
    label: '未关闭事件',
    description: '正在处理的服务中断',
    icon: Zap,
    tone: 'text-sky-600 bg-sky-50',
    accent: 'from-sky-500 to-cyan-400',
  },
  {
    key: 'pendingApprovals',
    label: '待审批工单',
    description: '等待 CAB 或流程审批',
    icon: ShieldAlert,
    tone: 'text-amber-600 bg-amber-50',
    accent: 'from-amber-500 to-orange-400',
  },
  {
    key: 'overdue',
    label: 'SLA 超时',
    description: '需要优先关注的工单',
    icon: TimerReset,
    tone: 'text-rose-600 bg-rose-50',
    accent: 'from-rose-500 to-pink-400',
  },
];

function greeting() {
  const hour = new Date().getHours();
  if (hour < 6) return '夜深了';
  if (hour < 9) return '早上好';
  if (hour < 12) return '上午好';
  if (hour < 14) return '中午好';
  if (hour < 18) return '下午好';
  return '晚上好';
}

export default function DashboardPage() {
  const { user, can } = useAuth();
  const navigate = useNavigate();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [range, setRange] = useState<7 | 14>(14);

  const load = async (showSpinner = false) => {
    if (showSpinner) setLoading(true);
    try {
      const response = await api.get<any>('/api/dashboard/summary');
      setData(response);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    const refresh = () => load();
    window.addEventListener(DATA_CHANGED_EVENT, refresh);
    return () => window.removeEventListener(DATA_CHANGED_EVENT, refresh);
  }, []);

  const today = new Date().toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' });
  const metrics = data?.metrics || {};
  const trend = (data?.trend || []).slice(-range);
  const byType = data?.byType || [];
  const totalType = byType.reduce((sum: number, item: any) => sum + item.count, 0);
  const myTasks = data?.myTasks || [];
  const recentTickets = data?.recentTickets || [];

  return (
    <div className="animate-enter">
      <PageHeader
        eyebrow="Service overview"
        title={
          <span className="flex flex-wrap items-center gap-2">
            {greeting()}，{user?.name || '管理员'}
            <span className="inline-flex h-6 items-center gap-1 rounded-full bg-emerald-50 px-2 text-[10px] font-medium text-emerald-700 ring-1 ring-inset ring-emerald-600/15">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> 运行平稳
            </span>
          </span>
        }
        description={`${today} · 这是你的 IT 服务全景视图，${metrics.pendingApprovals || 0} 项审批与 ${metrics.overdue || 0} 个 SLA 超时需要关注。`}
        actions={
          <>
            <Button variant="secondary" size="sm" icon={RefreshCw} onClick={() => load(true)} loading={loading}>
              刷新
            </Button>
            <Link to="/tickets/incident?new=1">
              <Button size="sm" icon={Plus}>新建事件</Button>
            </Link>
          </>
        }
      />

      <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 xl:grid-cols-4">
        {METRIC_META.map((meta, index) => {
          const Icon = meta.icon;
          const value = metrics[meta.key] || 0;
          return (
            <div
              key={meta.key}
              className="card card-hover relative overflow-hidden p-4.5 animate-enter"
              style={{ animationDelay: `${index * 55}ms` }}
            >
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-[11.5px] font-medium text-slate-500">{meta.label}</p>
                  {loading ? (
                    <Skeleton className="mt-2.5 h-8 w-16" />
                  ) : (
                    <p className="mt-1.5 text-[30px] font-semibold leading-none tracking-[-0.035em] text-slate-900">{formatNumber(value)}</p>
                  )}
                  <p className="mt-2 text-[10.5px] text-slate-400">{meta.description}</p>
                </div>
                <span className={cn('flex h-9 w-9 items-center justify-center rounded-md', meta.tone)}>
                  <Icon className="h-4.5 w-4.5" />
                </span>
              </div>
              <div className="mt-3.5 flex items-end justify-between border-t border-slate-100 pt-2.5">
                <span className="flex items-center gap-1 text-[9.5px] font-medium text-slate-400">
                  {meta.key === 'overdue' ? <AlertTriangle className="h-3 w-3 text-amber-500" /> : <TrendingUp className="h-3 w-3 text-emerald-500" />}
                  {meta.key === 'totalCis'
                    ? `其中 ${metrics.criticalCis || 0} 个核心资产`
                    : meta.key === 'openIncidents'
                      ? `MTTR ${metrics.mttrHours || 0} 小时`
                      : meta.key === 'pendingApprovals'
                        ? '等待流程角色处理'
                        : '持续跟踪 SLA 健康度'}
                </span>
                <div className="flex h-5 items-end gap-0.5 opacity-50">
                  {[3, 6, 4, 8, 5, 9, 7].map((height, bar) => (
                    <span key={bar} className={cn('w-1 rounded-sm bg-gradient-to-t', meta.accent)} style={{ height: `${height * 2}px` }} />
                  ))}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-3.5 grid grid-cols-1 gap-3.5 xl:grid-cols-12">
        <div className="card overflow-hidden xl:col-span-8">
          <SectionHeading
            title="工单流入趋势"
            description="按工单类型统计新建数量，快速识别服务压力"
            action={
              <div className="flex rounded-lg border border-slate-200 bg-slate-50 p-0.5">
                {[7, 14].map((item) => (
                  <button
                    key={item}
                    onClick={() => setRange(item as 7 | 14)}
                    className={cn('rounded-md px-2.5 py-1 text-[10px] font-medium transition', range === item ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-800')}
                  >
                    {item} 天
                  </button>
                ))}
              </div>
            }
          />
          <div className="px-2 pb-3 pt-5">
            <div className="h-[245px] w-full">
              {loading ? (
                <div className="flex h-full items-center justify-center"><Skeleton className="h-[200px] w-[92%]" /></div>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={trend} margin={{ top: 8, right: 18, left: -14, bottom: 0 }}>
                    <defs>
                      <linearGradient id="incidentFill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="var(--theme-primary)" stopOpacity={0.18} />
                        <stop offset="100%" stopColor="var(--theme-primary)" stopOpacity={0.01} />
                      </linearGradient>
                      <linearGradient id="problemFill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#722ed1" stopOpacity={0.16} />
                        <stop offset="100%" stopColor="#722ed1" stopOpacity={0.01} />
                      </linearGradient>
                      <linearGradient id="changeFill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#fa8c16" stopOpacity={0.16} />
                        <stop offset="100%" stopColor="#fa8c16" stopOpacity={0.01} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid stroke="#f0f0f0" strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#86909c' }} axisLine={false} tickLine={false} dy={8} />
                    <YAxis tick={{ fontSize: 11, fill: '#86909c' }} axisLine={false} tickLine={false} allowDecimals={false} />
                    <Tooltip
                      cursor={{ stroke: '#cbd5e1', strokeDasharray: '3 3' }}
                      content={({ active, payload, label }) =>
                        active && payload?.length ? (
                          <div className="rounded-md border border-[#e5e6eb] bg-white px-3 py-2.5 text-[#1f2329] shadow-[var(--shadow-float)]">
                            <p className="mb-1.5 text-[11px] text-[#86909c]">{label}</p>
                            {payload.map((item) => (
                              <div key={item.dataKey} className="flex items-center justify-between gap-5 text-[12px]">
                                <span className="flex items-center gap-1.5 text-[#4e5969]">
                                  <span className="h-1.5 w-1.5 rounded-full" style={{ background: item.color }} />
                                  {item.name}
                                </span>
                                <span className="font-semibold">{item.value}</span>
                              </div>
                            ))}
                          </div>
                        ) : null
                      }
                    />
                    <Area type="monotone" dataKey="incident" name="事件" stroke="var(--theme-primary)" strokeWidth={2} fill="url(#incidentFill)" dot={false} activeDot={{ r: 3.5 }} />
                    <Area type="monotone" dataKey="problem" name="问题" stroke="#722ed1" strokeWidth={1.8} fill="url(#problemFill)" dot={false} activeDot={{ r: 3.5 }} />
                    <Area type="monotone" dataKey="change" name="变更" stroke="#fa8c16" strokeWidth={1.8} fill="url(#changeFill)" dot={false} activeDot={{ r: 3.5 }} />
                  </AreaChart>
                </ResponsiveContainer>
              )}
            </div>
            <div className="mt-1 flex items-center justify-center gap-6">
              {[
                { label: '事件', color: 'var(--theme-primary)' },
                { label: '问题', color: '#722ed1' },
                { label: '变更', color: '#fa8c16' },
              ].map((item) => (
                <span key={item.label} className="flex items-center gap-1.5 text-[10px] text-slate-500">
                  <span className="h-1.5 w-1.5 rounded-full" style={{ background: item.color }} />
                  {item.label}
                </span>
              ))}
            </div>
          </div>
        </div>

        <div className="card overflow-hidden xl:col-span-4">
          <SectionHeading title="CI 资产构成" description={`${totalType} 个配置项的分布`} action={<Link to="/cmdb" className="text-[10.5px] font-medium text-brand-600 hover:text-brand-700">查看全部</Link>} />
          <div className="relative flex h-[188px] items-center justify-center pt-3">
            {loading ? (
              <Skeleton className="h-36 w-36 rounded-full" />
            ) : (
              <>
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={byType} dataKey="count" nameKey="name" innerRadius={57} outerRadius={78} paddingAngle={2.5} stroke="none">
                      {byType.map((item: any) => (
                        <Cell key={item.code} fill={item.color} />
                      ))}
                    </Pie>
                    <Tooltip
                      content={({ active, payload }) =>
                        active && payload?.length ? (
                          <div className="rounded border border-[#e5e6eb] bg-white px-2.5 py-1.5 text-[12px] text-[#1f2329] shadow-[var(--shadow-float)]">
                            {payload[0].name} · <span className="font-semibold">{payload[0].value}</span>
                          </div>
                        ) : null
                      }
                    />
                  </PieChart>
                </ResponsiveContainer>
                <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center pt-3">
                  <span className="text-[24px] font-semibold tracking-tight text-slate-900">{totalType}</span>
                  <span className="text-[9.5px] text-slate-400">配置项</span>
                </div>
              </>
            )}
          </div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-2 px-5 pb-4 pt-1">
            {byType.slice(0, 8).map((item: any) => (
              <Link key={item.code} to={`/cmdb?type=${item.code}`} className="flex items-center gap-2 text-[10.5px] text-slate-500 transition hover:text-slate-800">
                <span className="h-1.5 w-1.5 rounded-full" style={{ background: item.color }} />
                <span className="flex-1 truncate">{item.name}</span>
                <span className="font-medium text-slate-700">{item.count}</span>
              </Link>
            ))}
          </div>
        </div>
      </div>

      <div className="mt-3.5 grid grid-cols-1 gap-3.5 xl:grid-cols-12">
        <div className="card overflow-hidden xl:col-span-5">
          <SectionHeading
            title="我的待办"
            description="分配给我或由我发起的活跃工单"
            action={<Link to="/tickets/incident?scope=mine" className="text-[10.5px] font-medium text-brand-600 hover:text-brand-700">全部待办</Link>}
          />
          {myTasks.length ? (
            <div className="divide-y divide-[#f0f2f7]">
              {myTasks.map((ticket: any) => {
                const type = TICKET_TYPE_META[ticket.type];
                const status = TICKET_STATUS_META[ticket.status];
                return (
                  <Link key={ticket.id} to={`/tickets/${ticket.type}/${ticket.id}`} className="group flex items-center gap-3 px-5 py-3 transition hover:bg-[#fafbff]">
                    <span className={cn('flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-white', type?.soft)}>
                      {ticket.type === 'incident' ? <Zap className="h-3.5 w-3.5" /> : ticket.type === 'problem' ? <SearchCheck className="h-3.5 w-3.5" /> : <GitPullRequest className="h-3.5 w-3.5" />}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[12px] font-medium text-slate-700 group-hover:text-brand-700">{ticket.title}</p>
                      <div className="mt-1 flex items-center gap-2 text-[9.5px] text-slate-400">
                        <span className="font-mono">{ticket.ticket_no}</span>
                        <span>·</span>
                        <span>{ticket.stage_name || '处理中'}</span>
                        {ticket.sla_due_at && new Date(ticket.sla_due_at) < new Date() ? <span className="font-medium text-rose-500">已超时</span> : null}
                      </div>
                    </div>
                    <Badge className={status?.className} dot={status?.dot}>{status?.label}</Badge>
                    <ArrowRight className="h-3.5 w-3.5 shrink-0 text-slate-300 transition group-hover:translate-x-0.5 group-hover:text-brand-500" />
                  </Link>
                );
              })}
            </div>
          ) : (
            <EmptyState title="没有待办" description="你当前没有需要处理的工单，保持高效。" icon={CheckCircle2} className="py-10" />
          )}
        </div>

        <div className="card overflow-hidden xl:col-span-7">
          <SectionHeading
            title="最近工单"
            description="团队最新更新的服务请求"
            action={<Link to="/tickets/incident" className="text-[10.5px] font-medium text-brand-600 hover:text-brand-700">查看全部</Link>}
          />
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th>工单</th>
                  <th>类型</th>
                  <th>优先级</th>
                  <th>负责人</th>
                  <th>更新时间</th>
                </tr>
              </thead>
              <tbody>
                {recentTickets.map((ticket: any) => (
                  <tr key={ticket.id} className="cursor-pointer" onClick={() => navigate(`/tickets/${ticket.type}/${ticket.id}`)}>
                    <td>
                      <p className="max-w-[310px] truncate text-[12px] font-medium text-slate-700">{ticket.title}</p>
                      <p className="mt-0.5 font-mono text-[9.5px] text-slate-400">{ticket.ticket_no}</p>
                    </td>
                    <td>
                      <Badge className={TICKET_TYPE_META[ticket.type]?.className}>{TICKET_TYPE_META[ticket.type]?.label}</Badge>
                    </td>
                    <td>
                      <Badge className={PRIORITY_META[ticket.priority]?.className} dot={PRIORITY_META[ticket.priority]?.dot}>{PRIORITY_META[ticket.priority]?.label}</Badge>
                    </td>
                    <td>
                      <span className="flex items-center gap-1.5 text-[11px] text-slate-500">
                        <Avatar name={ticket.assignee_name || '未分配'} src={ticket.assignee_avatar_url} size="xs" color="#94a3b8" />
                        {ticket.assignee_name || '未分配'}
                      </span>
                    </td>
                    <td className="whitespace-nowrap text-[10.5px] text-slate-400">{relativeTime(ticket.updated_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div className="mt-3.5 grid grid-cols-1 gap-3.5 xl:grid-cols-12">
        <div className="card overflow-hidden xl:col-span-4">
          <SectionHeading title="即将到来的变更" description="未来变更窗口与风险等级" action={<CalendarClock className="h-4 w-4 text-slate-300" />} />
          <div className="divide-y divide-[#f0f2f7]">
            {(data?.changes || []).slice(0, 4).map((change: any) => (
              <Link key={change.id} to={`/tickets/change/${change.id}`} className="block px-5 py-3 transition hover:bg-[#fafbff]">
                <div className="flex items-start gap-2.5">
                  <div className="flex h-9 w-9 shrink-0 flex-col items-center justify-center rounded-lg border border-amber-100 bg-amber-50">
                    <span className="text-[8.5px] font-medium uppercase text-amber-600">{change.planned_start ? new Date(change.planned_start).toLocaleDateString('zh-CN', { month: 'short' }) : '待定'}</span>
                    <span className="text-[12px] font-semibold leading-none text-amber-700">{change.planned_start ? new Date(change.planned_start).getDate() : '—'}</span>
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[11.5px] font-medium text-slate-700">{change.title}</p>
                    <div className="mt-1 flex items-center gap-2 text-[9.5px] text-slate-400">
                      <span>{change.change_type === 'emergency' ? '紧急变更' : change.change_type === 'standard' ? '标准变更' : '常规变更'}</span>
                      <span>·</span>
                      <span className={change.risk === 'high' ? 'text-rose-500' : change.risk === 'medium' ? 'text-amber-600' : 'text-slate-400'}>
                        {change.risk === 'high' ? '高风险' : change.risk === 'medium' ? '中风险' : '低风险'}
                      </span>
                    </div>
                  </div>
                  <ArrowUpRight className="h-3.5 w-3.5 text-slate-300" />
                </div>
              </Link>
            ))}
            {!data?.changes?.length ? <EmptyState title="暂无计划变更" icon={CalendarClock} className="py-10" /> : null}
          </div>
        </div>

        <div className="card overflow-hidden xl:col-span-4">
          <SectionHeading
            title="Zabbix 实时告警"
            description="最近接收的监控事件"
            action={<Link to="/alerts" className="text-[10.5px] font-medium text-brand-600 hover:text-brand-700">告警中心</Link>}
          />
          <div className="divide-y divide-[#f0f2f7]">
            {(data?.alerts || []).slice(0, 4).map((alert: any) => {
              const severity = SEVERITY_META[alert.severity] || SEVERITY_META.warning;
              return (
                <Link key={alert.id} to={alert.ticket_id ? `/tickets/incident/${alert.ticket_id}` : '/alerts'} className="flex items-start gap-2.5 px-5 py-3 transition hover:bg-[#fafbff]">
                  <span className="relative mt-1 flex h-2 w-2 shrink-0">
                    <span className={cn('absolute inline-flex h-full w-full rounded-full opacity-40 pulse-dot', severity.dot)} />
                    <span className={cn('relative inline-flex h-2 w-2 rounded-full', severity.dot)} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="line-clamp-2 text-[11.5px] leading-snug text-slate-700">{alert.event_name}</p>
                    <div className="mt-1 flex items-center gap-2 text-[9.5px] text-slate-400">
                      <span className="font-mono">{alert.host_name || 'unknown'}</span>
                      <span>·</span>
                      <span>{relativeTime(alert.received_at)}</span>
                      {alert.ticket_no ? <span className="ml-auto rounded bg-slate-100 px-1 py-0.5 font-mono text-[8.5px] text-slate-500">{alert.ticket_no}</span> : null}
                    </div>
                  </div>
                </Link>
              );
            })}
            {!data?.alerts?.length ? <EmptyState title="暂无告警" icon={ShieldAlert} className="py-10" /> : null}
          </div>
        </div>

        <div className="card overflow-hidden xl:col-span-4">
          <SectionHeading
            title="近期活动"
            description="平台关键操作与审计记录"
            action={<Activity className="h-4 w-4 text-slate-300" />}
          />
          <div className="px-5 py-4">
            <div className="relative space-y-4 before:absolute before:bottom-1 before:left-[13px] before:top-1 before:w-px before:bg-slate-100">
              {(data?.activity || []).slice(0, 4).map((item: any) => (
                <div key={item.id} className="relative flex gap-3">
                  <span className="relative z-10 flex h-6.5 w-6.5 shrink-0 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-400">
                    {item.action.startsWith('ci') ? <Server className="h-3 w-3" /> : item.action.startsWith('ticket') ? <GitPullRequest className="h-3 w-3" /> : item.action.startsWith('zabbix') ? <ShieldAlert className="h-3 w-3" /> : <Activity className="h-3 w-3" />}
                  </span>
                  <div className="min-w-0 pb-0.5">
                    <p className="text-[11px] leading-snug text-slate-600">{item.summary}</p>
                    <p className="mt-1 text-[9px] text-slate-400">{item.actor_name} · {relativeTime(item.created_at)}</p>
                  </div>
                </div>
              ))}
              {!data?.activity?.length ? <p className="py-6 text-center text-[11px] text-slate-400">暂无审计记录</p> : null}
            </div>
          </div>
        </div>
      </div>

      <div className="mt-4 flex flex-col items-center justify-between gap-2 rounded-xl border border-dashed border-slate-200 bg-white/60 px-4 py-3 text-[10px] text-slate-400 sm:flex-row">
        <span className="flex items-center gap-1.5"><Sparkles className="h-3 w-3 text-brand-400" /> NextITOps Service Intelligence · 数据实时来自 CMDB 与 ITSM 事件流</span>
        <span className="flex items-center gap-1.5"><Clock3 className="h-3 w-3" /> 最近刷新 {formatDate(new Date().toISOString(), 'HH:mm:ss')}</span>
      </div>
    </div>
  );
}
