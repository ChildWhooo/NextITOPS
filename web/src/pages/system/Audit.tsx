import { useEffect, useState } from 'react';
import {
  Activity,
  BellRing,
  Database,
  FileJson,
  Filter,
  GitPullRequest,
  History,
  Radar,
  ScrollText,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  UserRound,
  Users,
  Workflow as WorkflowIcon,
} from 'lucide-react';
import { toast } from 'sonner';
import { api, buildQuery } from '@/lib/api';
import { usePageTitle, useDebounce } from '@/lib/hooks';
import { useAuth } from '@/context/AuthContext';
import { usePageSize } from '@/lib/pageSize';
import { cn, formatDate, relativeTime } from '@/lib/utils';
import { Avatar, Badge, Button, EmptyState, Field, Input, Modal, PageHeader, PageSizeSelect, Pagination, SearchInput, Skeleton, TableSkeleton } from '@/components/ui';
import { DateTextInput } from '@/components/DateTextInput';

const ACTION_META: Record<string, { label: string; className: string; icon: any }> = {
  'auth.login': { label: '登录', className: 'bg-sky-50 text-sky-700 ring-sky-600/15', icon: UserRound },
  'auth.password': { label: '密码变更', className: 'bg-amber-50 text-amber-700 ring-amber-600/15', icon: ShieldCheck },
  'ci.create': { label: '新建 CI', className: 'bg-emerald-50 text-emerald-700 ring-emerald-600/15', icon: Database },
  'ci.update': { label: '更新 CI', className: 'bg-white text-brand-700 ring-brand-200', icon: Database },
  'ci.delete': { label: '删除 CI', className: 'bg-rose-50 text-rose-700 ring-rose-600/15', icon: Database },
  'ci.import': { label: '导入 CI', className: 'bg-violet-50 text-violet-700 ring-violet-600/15', icon: Database },
  'ci.bulk_update': { label: '批量更新 CI', className: 'bg-white text-brand-700 ring-brand-200', icon: Database },
  'ci.bulk_delete': { label: '批量删除 CI', className: 'bg-rose-50 text-rose-700 ring-rose-600/15', icon: Database },
  'ci_field.bulk_delete': { label: '批量删字段', className: 'bg-rose-50 text-rose-700 ring-rose-600/15', icon: Database },
  'ticket.create': { label: '创建工单', className: 'bg-emerald-50 text-emerald-700 ring-emerald-600/15', icon: GitPullRequest },
  'ticket.update': { label: '更新工单', className: 'bg-white text-brand-700 ring-brand-200', icon: GitPullRequest },
  'ticket.delete': { label: '删除工单', className: 'bg-rose-50 text-rose-700 ring-rose-600/15', icon: GitPullRequest },
  'ticket.approve': { label: '审批通过', className: 'bg-teal-50 text-teal-700 ring-teal-600/15', icon: ShieldCheck },
  'ticket.reject': { label: '审批驳回', className: 'bg-rose-50 text-rose-700 ring-rose-600/15', icon: ShieldCheck },
  'ticket.close': { label: '关闭工单', className: 'bg-slate-100 text-slate-600 ring-slate-500/10', icon: GitPullRequest },
  'ticket.advance': { label: '流转工单', className: 'bg-white text-brand-700 ring-brand-200', icon: GitPullRequest },
  'workflow.create': { label: '创建流程', className: 'bg-violet-50 text-violet-700 ring-violet-600/15', icon: WorkflowIcon },
  'workflow.update': { label: '更新流程', className: 'bg-violet-50 text-violet-700 ring-violet-600/15', icon: WorkflowIcon },
  'workflow.delete': { label: '删除流程', className: 'bg-rose-50 text-rose-700 ring-rose-600/15', icon: WorkflowIcon },
  'zabbix.event_received': { label: '接收告警', className: 'bg-orange-50 text-orange-700 ring-orange-600/15', icon: Radar },
  'zabbix.ticket_created': { label: '告警建单', className: 'bg-emerald-50 text-emerald-700 ring-emerald-600/15', icon: Radar },
  'zabbix.create': { label: '新增集成', className: 'bg-rose-50 text-rose-700 ring-rose-600/15', icon: Radar },
  'zabbix.sync': { label: 'Zabbix 同步', className: 'bg-orange-50 text-orange-700 ring-orange-600/15', icon: Radar },
  'zabbix.simulate': { label: '模拟告警', className: 'bg-orange-50 text-orange-700 ring-orange-600/15', icon: Radar },
  'notification.update': { label: '通知配置', className: 'bg-teal-50 text-teal-700 ring-teal-600/15', icon: BellRing },
  'notification.test': { label: '通知测试', className: 'bg-cyan-50 text-cyan-700 ring-cyan-600/15', icon: BellRing },
  'user.create': { label: '创建用户', className: 'bg-violet-50 text-violet-700 ring-violet-600/15', icon: Users },
  'role.update': { label: '角色变更', className: 'bg-amber-50 text-amber-700 ring-amber-600/15', icon: ShieldCheck },
};

const ENTITY_META: Record<string, string> = {
  user: '用户',
  role: '角色',
  ci: '配置项',
  ci_type: 'CI 类型',
  workflow: '流程',
  ticket: '工单',
  integration: '集成',
  notification_channel: '通知渠道',
};

const CATEGORY_META: Record<string, { label: string; className: string }> = {
  user: { label: '用户操作', className: 'bg-white text-brand-700 ring-brand-200' },
  api: { label: '接口日志', className: 'bg-cyan-50 text-cyan-700 ring-cyan-600/15' },
  system: { label: '系统运行', className: 'bg-amber-50 text-amber-700 ring-amber-600/15' },
};

const AUDIT_CATEGORIES = [
  { value: '', label: '全部日志' },
  { value: 'user', label: '用户操作' },
  { value: 'api', label: '接口 / Zabbix' },
  { value: 'system', label: '系统运行' },
];

export default function AuditPage() {
  usePageTitle('审计日志');
  const [logs, setLogs] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = usePageSize('audit');
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const debounced = useDebounce(search, 300);
  const [detail, setDetail] = useState<any>(null);
  const [category, setCategory] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [actor, setActor] = useState('');
  const [action, setAction] = useState('');
  const [entityType, setEntityType] = useState('');
  const { user } = useAuth();
  const [syslogOpen, setSyslogOpen] = useState(false);
  const [syslogSaving, setSyslogSaving] = useState(false);
  const [syslogTesting, setSyslogTesting] = useState(false);
  const [syslog, setSyslog] = useState<any>({ enabled: false, host: '', port: 514, protocol: 'udp', facility: 1 });

  const load = async () => {
    setLoading(true);
    try {
      const response = await api.get<{ data: any[]; pagination: { total: number } }>(
        `/api/audit-logs${buildQuery({
          q: debounced,
          page,
          pageSize,
          category,
          actor,
          action,
          entity_type: entityType,
          from: fromDate ? new Date(`${fromDate}T00:00:00`).toISOString() : undefined,
          to: toDate ? new Date(`${toDate}T23:59:59.999`).toISOString() : undefined,
        })}`,
      );
      setLogs(response.data);
      setTotal(response.pagination.total);
    } catch (error: any) {
      toast.error(error.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [debounced, page, pageSize, category, fromDate, toDate, actor, action, entityType]);

  useEffect(() => {
    setPage(1);
  }, [debounced, category, fromDate, toDate, actor, action, entityType]);

  const today = new Date().toISOString().slice(0, 10);
  const todayCount = logs.filter((log) => String(log.created_at).slice(0, 10) === today).length;
  const actors = new Set(logs.map((log) => log.actor_name)).size;
  const moduleCounts = logs.reduce<Record<string, number>>((acc, log) => {
    const key = log.action.split('.')[0];
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});

  return (
    <div className="animate-enter">
      <PageHeader
        eyebrow="Governance & traceability"
        title="审计日志"
        description="记录平台关键操作与安全事件，为合规审计、问题追溯和责任界定提供依据。"
        actions={<div className="flex items-center gap-2">{user?.role?.code === 'admin' ? <Button variant="secondary" size="sm" icon={SlidersHorizontal} onClick={async () => { const response = await api.get<{ data: any }>('/api/system/syslog'); setSyslog(response.data); setSyslogOpen(true); }}>Syslog 同步</Button> : null}<Button variant="secondary" size="sm" icon={History} onClick={load}>刷新日志</Button></div>}
      />

      <div className="mb-3.5 grid grid-cols-2 gap-2.5 lg:grid-cols-4">
        {[
          { label: '审计记录', value: total, icon: ScrollText, tone: 'text-brand-600 bg-brand-50' },
          { label: '本页今日操作', value: todayCount, icon: Activity, tone: 'text-emerald-600 bg-emerald-50' },
          { label: '活跃操作者', value: actors, icon: Users, tone: 'text-violet-600 bg-violet-50' },
          { label: '涉及模块', value: Object.keys(moduleCounts).length, icon: Filter, tone: 'text-amber-600 bg-amber-50' },
        ].map((item) => (
          <div key={item.label} className="card flex items-center gap-3 p-3.5">
            <span className={cn('flex h-9 w-9 items-center justify-center rounded-xl', item.tone)}><item.icon className="h-4 w-4" /></span>
            <div><p className="text-[20px] font-semibold leading-none text-slate-900">{item.value}</p><p className="mt-1 text-[9.5px] text-slate-400">{item.label}</p></div>
          </div>
        ))}
      </div>

      <div className="card overflow-hidden">
        <div className="flex flex-col gap-3 border-b border-[#eef1f6] p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div><h2 className="text-[13px] font-semibold text-slate-800">操作记录</h2><p className="mt-0.5 text-[10px] text-slate-400">系统管理员/审计管理员查看全部；普通用户仅查看与本人相关的资产、工单和操作。</p></div>
            <SearchInput value={search} onChange={setSearch} placeholder="搜索操作、人员或对象…" className="w-full sm:w-[280px]" />
          </div>
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-1.5">
              {AUDIT_CATEGORIES.map((item) => (
                <button key={item.value} onClick={() => setCategory(item.value)} className={cn('rounded-lg px-2.5 py-1.5 text-[10.5px] font-medium transition', category === item.value ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-500 hover:bg-slate-200')}>{item.label}</button>
              ))}
            </div>
            <div className="flex flex-nowrap items-center gap-1.5 overflow-x-auto pb-1">
              <div className="flex shrink-0 items-center gap-1.5 whitespace-nowrap">
                <DateTextInput className="h-8 w-[132px] text-[10.5px]" value={fromDate} onChange={setFromDate} ariaLabel="开始日期" />
                <span className="text-[10px] text-slate-400">至</span>
                <DateTextInput className="h-8 w-[132px] text-[10.5px]" value={toDate} onChange={setToDate} ariaLabel="结束日期" />
              </div>
              <input className="input-base h-8 w-[110px] shrink-0 text-[10.5px]" value={actor} onChange={(event) => setActor(event.target.value)} placeholder="操作者" aria-label="操作者" />
              <input className="input-base h-8 w-[120px] shrink-0 text-[10.5px]" value={action} onChange={(event) => setAction(event.target.value)} placeholder="操作类型" aria-label="操作类型" />
              <select className="input-base h-8 w-[110px] shrink-0 text-[10.5px]" value={entityType} onChange={(event) => setEntityType(event.target.value)} aria-label="对象类型">
                <option value="">全部对象</option>
                {Object.entries(ENTITY_META).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
              {(category || fromDate || toDate || actor || action || entityType) ? <button onClick={() => { setCategory(''); setFromDate(''); setToDate(''); setActor(''); setAction(''); setEntityType(''); }} className="shrink-0 px-1 text-[10px] text-slate-400 hover:text-slate-600">清除</button> : null}
            </div>
          </div>
        </div>
        {loading ? (
          <TableSkeleton rows={7} cols={5} />
        ) : logs.length ? (
          <>
            <div className="table-wrap">
              <table className="data-table">
                <thead><tr><th>时间</th><th>操作者</th><th>动作</th><th>对象</th><th>操作摘要</th><th>IP</th><th></th></tr></thead>
                <tbody>
                  {logs.map((log) => {
                    const meta = ACTION_META[log.action] || { label: log.action, className: 'bg-slate-100 text-slate-600 ring-slate-500/10', icon: Activity };
                    const Icon = meta.icon;
                    return (
                      <tr key={log.id} className="group cursor-pointer" onClick={() => setDetail(log)}>
                        <td>
                          <p className="whitespace-nowrap text-[10.5px] text-slate-600">{formatDate(log.created_at)}</p>
                          <p className="mt-0.5 text-[9px] text-slate-400">{relativeTime(log.created_at)}</p>
                        </td>
                        <td>
                          <div className="flex items-center gap-2">
                            <Avatar name={log.actor_name || '系统'} size="xs" color="#64748b" />
                            <span className="text-[11px] text-slate-600">{log.actor_name || '系统'}</span>
                          </div>
                        </td>
                        <td>
                          <span className={cn('inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[9.5px] font-medium ring-1 ring-inset', meta.className)}><Icon className="h-3 w-3" />{meta.label}</span>
                          {log.category ? <span className={cn('ml-1.5 inline-flex rounded px-1.5 py-0.5 text-[8.5px] font-medium ring-1 ring-inset', (CATEGORY_META[log.category] || CATEGORY_META.user).className)}>{(CATEGORY_META[log.category] || CATEGORY_META.user).label}</span> : null}
                        </td>
                        <td>
                          <p className="text-[10.5px] text-slate-500">{log.entity_type_label || ENTITY_META[log.entity_type] || log.entity_type || '系统'}</p>
                          {log.entity_label ? (
                            <p className="mt-0.5 max-w-[220px] truncate text-[9px] text-slate-400" title={log.entity_label}>{log.entity_label}</p>
                          ) : null}
                        </td>
                        <td><p className="max-w-[360px] truncate text-[11px] text-slate-600">{log.summary || '—'}</p></td>
                        <td><code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[9px] text-slate-500">{log.ip || '—'}</code></td>
                        <td><FileJson className="h-3.5 w-3.5 text-slate-300 transition group-hover:text-brand-500" /></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="flex flex-col items-center justify-between gap-2 border-t border-[#eef1f6] px-4 py-2 sm:flex-row"><PageSizeSelect value={pageSize} onChange={setPageSize} /><Pagination page={page} pageSize={pageSize} total={total} onChange={setPage} /></div>
          </>
        ) : (
          <EmptyState title="暂无审计记录" description="平台操作会自动记录在此，支持按操作者与关键字检索。" icon={ScrollText} />
        )}
      </div>

      <div className="mt-3 flex items-center gap-1.5 px-1 text-[9.5px] text-slate-400">
        <ShieldCheck className="h-3 w-3" />
        审计日志包含操作者、IP、对象与时间戳，用于安全合规审查。
      </div>

      <Modal open={syslogOpen} onClose={() => setSyslogOpen(false)} title="Syslog 同步" description="将审计日志实时转发到外部 Syslog 服务器。" icon={SlidersHorizontal} size="sm" footer={<><Button variant="secondary" size="sm" onClick={() => setSyslogOpen(false)}>取消</Button><Button variant="secondary" size="sm" loading={syslogTesting} onClick={async () => { setSyslogTesting(true); try { await api.put('/api/system/syslog', syslog); await api.post('/api/system/syslog/test'); toast.success('测试消息已发送'); } catch (error: any) { toast.error(error.message); } finally { setSyslogTesting(false); } }}>保存并测试</Button><Button size="sm" loading={syslogSaving} onClick={async () => { setSyslogSaving(true); try { const response = await api.put<{ data: any }>('/api/system/syslog', syslog); setSyslog(response.data); setSyslogOpen(false); toast.success('Syslog 配置已保存'); } catch (error: any) { toast.error(error.message); } finally { setSyslogSaving(false); } }}>保存配置</Button></>}>
        <div className="space-y-3">
          <label className="flex items-center justify-between rounded-xl border border-slate-200 px-3 py-2.5"><span><span className="block text-[11px] font-medium text-slate-700">启用 Syslog 同步</span><span className="block text-[9px] text-slate-400">新审计日志将实时发送到目标服务器</span></span><input type="checkbox" checked={Boolean(syslog.enabled)} onChange={(event) => setSyslog((current: any) => ({ ...current, enabled: event.target.checked }))} className="accent-brand-600" /></label>
          <Field label="服务器地址"><Input value={syslog.host} onChange={(event) => setSyslog((current: any) => ({ ...current, host: event.target.value }))} placeholder="192.168.1.10 或 syslog.example.com" /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="端口"><Input type="number" min="1" max="65535" value={syslog.port} onChange={(event) => setSyslog((current: any) => ({ ...current, port: event.target.value }))} /></Field>
            <Field label="协议"><select className="input-base" value={syslog.protocol} onChange={(event) => setSyslog((current: any) => ({ ...current, protocol: event.target.value }))}><option value="udp">UDP</option><option value="tcp">TCP</option></select></Field>
          </div>
          <Field label="Facility" hint="0-23，默认 1（user-level）"><Input type="number" min="0" max="23" value={syslog.facility} onChange={(event) => setSyslog((current: any) => ({ ...current, facility: event.target.value }))} /></Field>
          <p className="text-[9.5px] leading-relaxed text-slate-400">使用 RFC5424 格式转发操作者、IP、动作、对象和摘要；发送失败不会影响审计日志落库。</p>
        </div>
      </Modal>

      <Modal
        open={Boolean(detail)}
        onClose={() => setDetail(null)}
        title="审计详情"
        description={detail ? `${detail.summary} · ${formatDate(detail.created_at, 'YYYY/MM/DD HH:mm:ss')}` : ''}
        icon={FileJson}
        size="md"
        footer={<Button variant="secondary" size="sm" onClick={() => setDetail(null)}>关闭</Button>}
      >
        {detail ? (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <FieldView label="操作者" value={detail.actor_name || '系统'} />
              <FieldView label="IP 地址" value={detail.ip || '—'} />
              <FieldView label="动作" value={detail.action} />
              <FieldView label="对象" value={detail.entity_label || ENTITY_META[detail.entity_type] || detail.entity_type || '系统'} />
            </div>
            <div>
              <p className="mb-1.5 text-[10px] font-medium text-slate-400">操作摘要</p>
              <p className="rounded-lg border border-slate-100 bg-slate-50 p-3 text-[11px] leading-relaxed text-slate-600">{detail.summary || '—'}</p>
            </div>
            <div>
              <p className="mb-1.5 text-[10px] font-medium text-slate-400">详细上下文</p>
              <pre className="custom-scroll max-h-64 overflow-auto rounded-xl bg-ink-900 p-3.5 font-mono text-[9.5px] leading-relaxed text-slate-300">{JSON.stringify(detail.detail || {}, null, 2)}</pre>
            </div>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}

function FieldView({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[9px] uppercase tracking-wider text-slate-400">{label}</p>
      <p className="mt-1 text-[11px] text-slate-600">{value}</p>
    </div>
  );
}
