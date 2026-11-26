import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  AlertCircle,
  CalendarClock,
  CheckCircle2,
  ChevronRight,
  Clock3,
  Filter,
  GitPullRequest,
  Inbox,
  Plus,
  RotateCcw,
  SearchCheck,
  ShieldCheck,
  TimerReset,
  Trash2,
  UserRound,
  Zap,
} from 'lucide-react';
import { toast } from 'sonner';
import { RichTextEditor } from '@/components/RichText';
import { DateTextInput } from '@/components/DateTextInput';
import { api, buildQuery } from '@/lib/api';
import { notifyDataChanged } from '@/lib/refresh';
import { usePageTitle, useDebounce } from '@/lib/hooks';
import { usePageSize } from '@/lib/pageSize';
import { useAuth } from '@/context/AuthContext';
import {
  PRIORITY_META,
  SOURCE_LABELS,
  TICKET_STATUS_META,
  TICKET_TYPE_META,
  cn,
  formatDate,
  relativeTime,
} from '@/lib/utils';
import type { CI, Ticket, User, Workflow } from '@/lib/types';
import { Avatar, Badge, Button, EmptyState, Field, IconButton, Input, Modal, PageHeader, PageSizeSelect, Pagination, SearchInput, Spinner, TableSkeleton, Tabs } from '@/components/ui';
import { CIPicker } from '@/components/CIPicker';
import { SearchSelect } from '@/components/SearchSelect';
import { SortableTh } from '@/components/SortableTh';
import { DateInput } from '@/components/DateInput';

const TYPE_META: Record<string, { label: string; title: string; eyebrow: string; description: string; icon: any; soft: string; accent: string }> = {
  incident: {
    label: '事件',
    title: '事件管理',
    eyebrow: 'Incident management',
    description: '快速受理服务中断与请求，按 SLA 分级响应并恢复业务。',
    icon: Zap,
    soft: 'bg-sky-500',
    accent: 'from-sky-500 to-cyan-400',
  },
  problem: {
    label: '问题',
    title: '问题管理',
    eyebrow: 'Problem management',
    description: '聚合重复事件，定位根因并推动永久性解决方案。',
    icon: SearchCheck,
    soft: 'bg-violet-500',
    accent: 'from-violet-500 to-purple-400',
  },
  change: {
    label: '变更',
    title: '变更管理',
    eyebrow: 'Change management',
    description: '评估变更风险、CAB 审批、实施验证，并与 CMDB 配置项联动。',
    icon: GitPullRequest,
    soft: 'bg-amber-500',
    accent: 'from-amber-500 to-orange-400',
  },
};

const STATUS_TABS = [
  { value: 'active', label: '活动工单' },
  { value: '', label: '全部' },
  { value: 'new', label: '待受理' },
  { value: 'in_progress', label: '处理中' },
  { value: 'pending_approval', label: '待审批' },
  { value: 'overdue', label: 'SLA 超时' },
  { value: 'resolved', label: '已解决' },
  { value: 'closed', label: '已关闭' },
  { value: 'done', label: '已完成' },
];

const EMPTY_FORM = {
  title: '',
  description: '',
  priority: 'medium',
  impact: 'medium',
  urgency: 'medium',
  category: '',
  source: 'portal',
  workflow_id: '',
  assignee_id: '',
  risk: 'medium',
  change_type: 'normal',
  planned_start: '',
  planned_end: '',
  implementation_plan: '',
  rollback_plan: '',
  test_plan: '',
  cab_date: '',
  outage_required: false,
  root_cause: '',
  workaround: '',
};

export default function TicketListPage() {
  const params = useParams();
  const type = (['incident', 'problem', 'change'].includes(params.type || '') ? params.type : 'incident') as 'incident' | 'problem' | 'change';
  const meta = TYPE_META[type];
  const { user, can } = useAuth();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [scopeMine, setScopeMine] = useState(searchParams.get('scope') === 'mine');
  const [pendingDeletionFilter, setPendingDeletionFilter] = useState(false);

  usePageTitle(meta.title);

  const [rows, setRows] = useState<Ticket[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [sortBy, setSortBy] = useState('ticket_no');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const toggleSort = (field: string) => {
    if (sortBy === field) setSortDir((current) => current === 'asc' ? 'desc' : 'asc');
    else { setSortBy(field); setSortDir('asc'); }
    setPage(1);
  };
  const [pageSize, setPageSize] = usePageSize('tickets');
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<any>(null);
  const [status, setStatus] = useState('');
  const [priority, setPriority] = useState('');
  const [assignee, setAssignee] = useState('');
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounce(search, 300);
  const [users, setUsers] = useState<User[]>([]);

  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState<Record<string, any>>(EMPTY_FORM);
  const [changeUpdates, setChangeUpdates] = useState<Array<{ ci_id: string; field_key: string; value: string }>>([]);
  const [cis, setCis] = useState<CI[]>([]);
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [sources, setSources] = useState<Array<{ value: string; label: string }>>([]);
  const [baseData, setBaseData] = useState<any>(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);
  const [deletionPolicy, setDeletionPolicy] = useState<any>(null);
  const [selected, setSelected] = useState<number[]>([]);
  const [deleteTargets, setDeleteTargets] = useState<Ticket[]>([]);
  const [deleteMode, setDeleteMode] = useState<'request' | 'direct'>('request');
  const [deleteReason, setDeleteReason] = useState('');
  const [deleteError, setDeleteError] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [reviewTarget, setReviewTarget] = useState<Ticket | null>(null);
  const [reviewComment, setReviewComment] = useState('');
  const [reviewError, setReviewError] = useState('');
  const [reviewing, setReviewing] = useState(false);

  useEffect(() => {
    setStatus('');
    setPriority('');
    setAssignee('');
    setSearch('');
    setPage(1);
    setScopeMine(searchParams.get('scope') === 'mine');
  }, [type]);

  const loadStats = async () => {
    const response = await api.get<any>(`/api/tickets/stats${buildQuery({ type, scope: scopeMine ? 'mine' : '' })}`);
    setStats(response);
  };

  useEffect(() => {
    api.get<{ data: any }>('/api/base-data').then((response) => {
      setBaseData(response.data);
      setSources(response.data.ticket_sources || []);
    }).catch(() => {
      api.get<{ data: Array<{ value: string; label: string }> }>('/api/ticket-sources').then((response) => setSources(response.data || [])).catch(() => {});
    });
  }, []);

  useEffect(() => {
    loadStats().catch(() => {});
  }, [type, scopeMine, refreshKey]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    const query = buildQuery({
      type,
      status: status === 'active' ? 'new,in_progress,pending_approval' : status === 'done' ? 'resolved,closed' : status === 'overdue' ? '' : status,
      overdue: status === 'overdue' ? 'true' : '',
      priority,
      assignee_id: assignee,
      q: debouncedSearch,
      scope: scopeMine ? 'mine' : '',
      deletion: pendingDeletionFilter ? 'pending' : '',
      page,
      pageSize,
      sortBy,
      sortDir,
    });
    api
      .get<{ data: Ticket[]; pagination: { total: number } }>(`/api/tickets${query}`)
      .then((response) => {
        if (!active) return;
        setRows(response.data);
        setTotal(response.pagination.total);
      })
      .catch((error) => active && toast.error(error.message))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [type, status, priority, assignee, debouncedSearch, scopeMine, pendingDeletionFilter, page, pageSize, refreshKey, sortBy, sortDir]);

  useEffect(() => {
    setSelected([]);
  }, [type, status, priority, assignee, debouncedSearch, scopeMine, pendingDeletionFilter, page, pageSize, refreshKey, sortBy, sortDir]);

  useEffect(() => {
    api.get<{ data: any }>('/api/deletion-policy').then((response) => setDeletionPolicy(response.data)).catch(() => {});
  }, []);

  useEffect(() => {
    setPage(1);
  }, [status, priority, assignee, debouncedSearch, scopeMine, pendingDeletionFilter, pageSize]);

  useEffect(() => {
    api.get<{ data: User[] }>('/api/users').then((response) => setUsers(response.data)).catch(() => {});
  }, []);

  useEffect(() => {
    if (!createOpen) return;
    api
      .get<{ data: Workflow[] }>(`/api/workflows?type=${type}`)
      .then((response) => {
        const active = response.data.filter((item) => item.is_active);
        setWorkflows(active);
        const defaultWorkflow = active.find((item) => item.is_default) || active[0];
        setForm((current) => ({ ...current, workflow_id: current.workflow_id || defaultWorkflow?.id || '' }));
      })
      .catch(() => {});
  }, [createOpen, type]);

  useEffect(() => {
    if (searchParams.get('new') === '1' && (can('itsm.create') || can('itsm.edit'))) {
      openCreate();
      const next = new URLSearchParams(searchParams);
      next.delete('new');
      setSearchParams(next, { replace: true });
    }
  }, [searchParams.get('new')]);

  const setMine = (value: boolean) => {
    setScopeMine(value);
    const next = new URLSearchParams(searchParams);
    if (value) next.set('scope', 'mine');
    else next.delete('scope');
    setSearchParams(next, { replace: true });
  };

  const openCreate = () => {
    setForm({ ...EMPTY_FORM });
    setCis([]);
    setChangeUpdates([]);
    setFormError('');
    setCreateOpen(true);
  };

  const submit = async () => {
    setFormError('');
    if (form.title.trim().length < 3) return setFormError('请填写至少 3 个字的标题');
    if (type === 'change' && !cis.length) return setFormError('变更必须关联至少一个 CI 配置项');
    setSaving(true);
    try {
      const response = await api.post<{ data: Ticket }>('/api/tickets', {
        ...form,
        type,
        workflow_id: form.workflow_id ? Number(form.workflow_id) : undefined,
        assignee_id: form.assignee_id ? Number(form.assignee_id) : null,
        ci_ids: cis.map((item) => item.id),
        change_type: form.change_type,
        change_updates: changeUpdates.filter((item) => item.ci_id && item.field_key).map((item) => ({ ci_id: Number(item.ci_id), field_key: item.field_key, value: item.value })),
      });
      toast.success(`${meta.label} ${response.data.ticket_no} 已创建`);
      notifyDataChanged();
      setCreateOpen(false);
      navigate(`/tickets/${type}/${response.data.id}`);
    } catch (error: any) {
      setFormError(error.message);
    } finally {
      setSaving(false);
    }
  };

  const summary = useMemo(() => {
    const by = stats?.by_status || {};
    return {
      active: (by.new || 0) + (by.in_progress || 0) + (by.pending_approval || 0),
      pending: by.pending_approval || 0,
      overdue: stats?.overdue || 0,
      done: (by.resolved || 0) + (by.closed || 0),
    };
  }, [stats]);

  const activeFilters = [status, priority, assignee, search].filter(Boolean).length;
  const selectedWorkflow = workflows.find((item) => String(item.id) === String(form.workflow_id));
  const canCreate = can('itsm.create') || can('itsm.edit');
  const canApprove = Boolean(deletionPolicy?.can_approve);
  const isAdmin = user?.role?.code === 'admin';
  const canRequestDelete = can('itsm.view');
  const selectableRows = rows.filter((ticket) => isAdmin || !ticket.deletion_request);
  const selectedTickets = rows.filter((ticket) => selected.includes(ticket.id) && (isAdmin || !ticket.deletion_request));
  const allSelected = selectableRows.length > 0 && selectableRows.every((ticket) => selected.includes(ticket.id));
  const TypeIcon = meta.icon;

  const toggleSelected = (ticket: Ticket) => {
    setSelected((current) => current.includes(ticket.id) ? current.filter((id) => id !== ticket.id) : [...current, ticket.id]);
  };

  const toggleAll = () => {
    if (allSelected) setSelected([]);
    else setSelected(selectableRows.map((ticket) => ticket.id));
  };

  const openDelete = (targets: Ticket[], mode: 'request' | 'direct') => {
    const allowed = targets.filter((ticket) => mode === 'direct' || !ticket.deletion_request);
    if (!allowed.length) return toast.error('请选择未提交删除申请的工单');
    setDeleteTargets(allowed);
    setDeleteMode(mode);
    setDeleteReason('');
    setDeleteError('');
  };

  const submitDelete = async () => {
    if (!deleteTargets.length) return;
    if (deleteMode === 'request' && deleteReason.trim().length < 4) return setDeleteError('请填写至少 4 个字的删除原因');
    setDeleting(true);
    setDeleteError('');
    try {
      if (deleteMode === 'direct') {
        for (const ticket of deleteTargets) await api.delete(`/api/tickets/${ticket.id}`);
        toast.success(`已直接删除 ${deleteTargets.length} 张工单`);
        notifyDataChanged();
      } else {
        const results = await Promise.allSettled(
          deleteTargets.map((ticket) => api.post(`/api/tickets/${ticket.id}/deletion-request`, { reason: deleteReason.trim() })),
        );
        const failed = results.filter((result) => result.status === 'rejected');
        if (failed.length) {
          throw new Error(`${failed.length} 张工单提交失败：${(failed[0] as PromiseRejectedResult).reason?.message || '请重试'}`);
        }
        toast.success(`已提交 ${deleteTargets.length} 张工单的删除申请`);      }
      setDeleteTargets([]);
      setSelected([]);
      setRefreshKey((value) => value + 1);
    } catch (error: any) {
      setDeleteError(error.message || '删除操作失败');
    } finally {
      setDeleting(false);
    }
  };

  const openReview = (ticket: Ticket) => {
    setReviewTarget(ticket);
    setReviewComment('');
    setReviewError('');
  };

  const submitReview = async (action: 'approve' | 'reject') => {
    if (!reviewTarget?.deletion_request) return;
    if (action === 'reject' && !reviewComment.trim()) return setReviewError('驳回时必须填写审批意见');
    setReviewing(true);
    setReviewError('');
    try {
      await api.post(`/api/deletion-requests/${reviewTarget.deletion_request.id}/${action}`, { comment: reviewComment.trim() });
      toast.success(action === 'approve' ? `已删除工单 ${reviewTarget.ticket_no}` : '删除申请已驳回');
      setReviewTarget(null);
      setRefreshKey((value) => value + 1);
    } catch (error: any) {
      setReviewError(error.message || '审批失败');
    } finally {
      setReviewing(false);
    }
  };

  return (
    <div className="animate-enter">
      <PageHeader
        eyebrow={meta.eyebrow}
        title={
          <span className="flex items-center gap-2.5">
            <span className={cn('flex h-8 w-8 items-center justify-center rounded-lg text-white', meta.soft)}><TypeIcon className="h-4 w-4" /></span>
            {meta.title}
          </span>
        }
        description={meta.description}
        actions={
          canCreate ? <Button size="sm" icon={Plus} onClick={openCreate}>新建{meta.label}</Button> : null
        }
      />

      <div className="mb-3.5 grid grid-cols-2 gap-2.5 lg:grid-cols-4">
        {[
          { label: '活动工单', value: summary.active, icon: TimerReset, tone: 'text-blue-600 bg-blue-50', hint: '待受理 · 处理中 · 待审批', status: 'active' },
          { label: '待审批', value: summary.pending, icon: ShieldCheck, tone: 'text-amber-600 bg-amber-50', hint: '等待流程角色审批', status: 'pending_approval' },
          { label: 'SLA 超时', value: summary.overdue, icon: AlertCircle, tone: 'text-rose-600 bg-rose-50', hint: '超过当前阶段 SLA', status: 'overdue' },
          { label: '已完成', value: summary.done, icon: CheckCircle2, tone: 'text-emerald-600 bg-emerald-50', hint: '已解决与已关闭', status: 'done' },
        ].map((item) => (
          <button key={item.label} onClick={() => { setStatus(item.status); setPendingDeletionFilter(false); setScopeMine(false); setPage(1); }} className="card flex items-center gap-3 p-3.5 text-left transition hover:border-brand-200 hover:shadow-sm">
            <span className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-xl', item.tone)}>
              <item.icon className="h-4 w-4" />
            </span>
            <div>
              <div className="flex items-baseline gap-2">
                <span className="text-[20px] font-semibold tracking-tight text-slate-900">{item.value}</span>
                <span className="text-[10.5px] text-slate-400">{item.label}</span>
              </div>
              <p className="mt-0.5 text-[9px] text-slate-400">{item.hint}</p>
            </div>
          </button>
        ))}
      </div>

      <div className="card overflow-hidden">
        <div className="flex flex-col gap-3 border-b border-[#edf0f6] px-4 pt-1">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Tabs
              items={STATUS_TABS.map((tab) => ({
                value: tab.value,
                label: tab.label,
                count: tab.value === 'active' ? summary.active : tab.value === 'overdue' ? summary.overdue : tab.value === 'done' ? summary.done : tab.value ? stats?.by_status?.[tab.value] || 0 : stats?.total || 0,
              }))}
              value={status}
              onChange={setStatus}
              className="flex-1 border-b-0"
            />
            <button
              onClick={() => setMine(!scopeMine)}
              className={cn(
                'mb-1 flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-[10.5px] font-medium transition',
                scopeMine ? 'border-brand-200 bg-brand-50 text-brand-700' : 'border-slate-200 bg-white text-slate-500 hover:bg-slate-50',
              )}
            >
              <UserRound className="h-3.5 w-3.5" />
              只看我的
            </button>
            {canApprove ? (
              <button
                onClick={() => setPendingDeletionFilter((value) => !value)}
                className={cn(
                  'mb-1 flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-[10.5px] font-medium transition',
                  pendingDeletionFilter ? 'border-amber-200 bg-amber-50 text-amber-700' : 'border-slate-200 bg-white text-slate-500 hover:bg-slate-50',
                )}
              >
                <Trash2 className="h-3.5 w-3.5" />
                待删除审批
              </button>
            ) : null}
          </div>
          <div className="flex flex-col gap-2 pb-3 lg:flex-row lg:items-center">
            <SearchInput value={search} onChange={setSearch} placeholder={`搜索${meta.label}编号、标题或描述…`} className="w-full lg:w-[330px]" />
            <div className="flex flex-1 flex-wrap items-center gap-2">
              <select className="input-base h-9 w-auto min-w-[105px] text-[12px]" value={priority} onChange={(event) => setPriority(event.target.value)}>
                <option value="">全部优先级</option>
                {Object.entries(PRIORITY_META).map(([value, item]) => <option key={value} value={value}>{item.label}</option>)}
              </select>
              <select className="input-base h-9 w-auto min-w-[115px] text-[12px]" value={assignee} onChange={(event) => setAssignee(event.target.value)}>
                <option value="">全部负责人</option>
                {users.filter((item) => item.status === 'active' && !['admin', 'auditor'].includes(String((item as any).role_code || ''))).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
              </select>
              {activeFilters ? (
                <button onClick={() => { setStatus(''); setPriority(''); setAssignee(''); setSearch(''); }} className="flex h-9 items-center gap-1 rounded-lg px-2 text-[11px] text-slate-500 hover:bg-slate-100">
                  <RotateCcw className="h-3 w-3" /> 清除筛选
                </button>
              ) : null}
              <span className="ml-auto hidden text-[10px] text-slate-400 sm:block">共 {total} 张{meta.label}工单</span>
            </div>
          </div>
        </div>

        {selected.length ? (
          <div className="flex flex-wrap items-center gap-2 border-b border-brand-100 bg-brand-50/60 px-4 py-2.5">
            <span className="text-[11px] font-medium text-brand-800">已选择 {selected.length} 张工单</span>
            <span className="text-[9.5px] text-brand-700/60">非超管用户提交删除申请；超级管理员可直接删除</span>
            <div className="ml-auto flex items-center gap-1.5">
              {canRequestDelete ? <Button variant="secondary" size="xs" icon={Trash2} onClick={() => openDelete(selectedTickets, 'request')}>批量申请删除</Button> : null}
              {isAdmin ? <Button variant="danger" size="xs" icon={Trash2} onClick={() => openDelete(selectedTickets, 'direct')}>批量直接删除</Button> : null}
              <button onClick={() => setSelected([])} className="rounded-lg px-2 py-1 text-[10.5px] text-slate-500 hover:bg-white/70 hover:text-slate-700">取消选择</button>
            </div>
          </div>
        ) : null}

        {loading ? (
          <TableSkeleton rows={7} cols={6} />
        ) : rows.length ? (
          <>
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th className="w-8"><input type="checkbox" aria-label="全选工单" checked={allSelected} disabled={!selectableRows.length} onChange={toggleAll} onClick={(event) => event.stopPropagation()} /></th>
                    <SortableTh label="工单" field="ticket_no" sortBy={sortBy} sortDir={sortDir} onSort={toggleSort} className="min-w-[300px]" />
                    <SortableTh label="状态" field="status" sortBy={sortBy} sortDir={sortDir} onSort={toggleSort} />
                    <SortableTh label="优先级" field="priority" sortBy={sortBy} sortDir={sortDir} onSort={toggleSort} />
                    <SortableTh label="当前阶段" field="stage_name" sortBy={sortBy} sortDir={sortDir} onSort={toggleSort} />
                    <SortableTh label="请求人 / 负责人" field="requester_name" sortBy={sortBy} sortDir={sortDir} onSort={toggleSort} />
                    <SortableTh label="SLA" field="sla_due_at" sortBy={sortBy} sortDir={sortDir} onSort={toggleSort} />
                    <SortableTh label="更新时间" field="updated_at" sortBy={sortBy} sortDir={sortDir} onSort={toggleSort} />
                    <th className="w-10"></th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((ticket) => {
                    const statusMeta = TICKET_STATUS_META[ticket.status] || TICKET_STATUS_META.new;
                    const priorityMeta = PRIORITY_META[ticket.priority] || PRIORITY_META.medium;
                    const due = ticket.sla_due_at ? new Date(ticket.sla_due_at).getTime() : null;
                    const slaStopped = ['resolved', 'closed', 'cancelled'].includes(ticket.status);
                    const overdue = !slaStopped && (ticket.is_overdue || Boolean(due && due < Date.now()));
                    const hoursDiff = due ? Math.round((due - Date.now()) / 3600000) : null;
                    const pendingDeletion = ticket.deletion_request;
                    return (
                      <tr key={ticket.id} className={cn('group cursor-pointer', selected.includes(ticket.id) && 'bg-brand-50/30')} onClick={() => navigate(`/tickets/${ticket.type}/${ticket.id}`)}>
                        <td onClick={(event) => event.stopPropagation()}>
                          <input type="checkbox" aria-label={`选择 ${ticket.ticket_no}`} checked={selected.includes(ticket.id)} disabled={!isAdmin && Boolean(ticket.deletion_request)} onChange={() => toggleSelected(ticket)} title={!isAdmin && ticket.deletion_request ? '该工单已有待审批删除申请' : '选择工单'} />
                        </td>
                        <td>
                          <div className="flex items-start gap-3">
                            <span className={cn('mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-white', TICKET_TYPE_META[ticket.type]?.soft)}>
                              {ticket.type === 'incident' ? <Zap className="h-3.5 w-3.5" /> : ticket.type === 'problem' ? <SearchCheck className="h-3.5 w-3.5" /> : <GitPullRequest className="h-3.5 w-3.5" />}
                            </span>
                            <div className="min-w-0">
                              <p className="max-w-[390px] truncate text-[12.5px] font-medium text-slate-700 group-hover:text-brand-700">{ticket.title}</p>
                              <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[9.5px] text-slate-400">
                                <span className="font-mono">{ticket.ticket_no}</span>
                                <span>·</span>
                                <span>{SOURCE_LABELS[ticket.source] || ticket.source}</span>
                                {ticket.category ? <><span>·</span><span>{ticket.category}</span></> : null}
                              </div>
                            </div>
                          </div>
                        </td>
                        <td><Badge className={statusMeta.className} dot={statusMeta.dot}>{statusMeta.label}</Badge></td>
                        <td><Badge className={priorityMeta.className} dot={priorityMeta.dot}>{priorityMeta.label}</Badge></td>
                        <td>
                          <span className="flex items-center gap-1.5 text-[11px] text-slate-600">
                            <span className="h-1.5 w-1.5 rounded-full" style={{ background: ticket.stage_color || '#94a3b8' }} />
                            {ticket.stage_name || '—'}
                          </span>
                        </td>
                        <td>
                          <div className="flex items-center gap-2">
                            <div className="flex -space-x-1.5">
                              <Avatar name={ticket.requester_name} src={ticket.requester_avatar_url} size="xs" color={ticket.requester_color || '#94a3b8'} />
                              {ticket.assignee_name ? <Avatar name={ticket.assignee_name} src={ticket.assignee_avatar_url} size="xs" color={ticket.assignee_color || '#4f6ef7'} /> : null}
                            </div>
                            <div className="text-[10px] leading-tight">
                              <p className="text-slate-600">{ticket.requester_name}</p>
                              <p className="text-slate-400">{ticket.assignee_name || '未分配'}</p>
                            </div>
                          </div>
                        </td>
                        <td>
                          {due ? (
                            <div>
                              <p className={cn('flex items-center gap-1 text-[10.5px] font-medium', overdue ? 'text-rose-600' : slaStopped ? 'text-slate-400' : 'text-slate-600')}>
                                {overdue ? <AlertCircle className="h-3 w-3" /> : <Clock3 className="h-3 w-3 text-slate-400" />}
                                {slaStopped ? 'SLA 已停止' : overdue ? `超时 ${Math.abs(hoursDiff || 0)}h` : hoursDiff !== null && hoursDiff < 24 ? `${hoursDiff}h 后到期` : formatDate(ticket.sla_due_at, 'MM-DD HH:mm')}
                              </p>
                              <p className="mt-0.5 text-[9px] text-slate-400">{formatDate(ticket.sla_due_at, 'YYYY/MM/DD HH:mm')}</p>
                            </div>
                          ) : <span className="text-[10px] text-slate-300">未设置</span>}
                        </td>
                        <td className="whitespace-nowrap text-[10.5px] text-slate-400">{relativeTime(ticket.updated_at)}</td>
                        <td onClick={(event) => event.stopPropagation()}>
                          <div className="flex items-center justify-end gap-1">
                            {pendingDeletion ? <Badge className="bg-amber-50 text-amber-700 ring-amber-600/15">删除审批中</Badge> : null}
                            {pendingDeletion && canApprove && pendingDeletion.requested_by !== user?.id ? (
                              <button onClick={() => openReview(ticket)} className="rounded-lg p-1.5 text-slate-400 transition hover:bg-amber-50 hover:text-amber-600" title="审批删除申请"><ShieldCheck className="h-3.5 w-3.5" /></button>
                            ) : null}
                            {(!pendingDeletion || isAdmin) && (isAdmin || canRequestDelete) ? (
                              <button onClick={() => openDelete([ticket], isAdmin ? 'direct' : 'request')} className="rounded-lg p-1.5 text-slate-300 transition hover:bg-rose-50 hover:text-rose-500" title={isAdmin ? '超级管理员直接删除' : '申请删除工单'}><Trash2 className="h-3.5 w-3.5" /></button>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="flex flex-col items-center justify-between gap-2 border-t border-[#eef1f6] px-4 py-2 sm:flex-row">
              <PageSizeSelect value={pageSize} onChange={setPageSize} />
              <Pagination page={page} pageSize={pageSize} total={total} onChange={setPage} />
            </div>
          </>
        ) : (
          <EmptyState
            title={activeFilters || scopeMine ? '没有匹配的工单' : `还没有${meta.label}工单`}
            description={activeFilters || scopeMine ? '尝试调整筛选条件，或查看全部工单。' : `创建第一张${meta.label}，开始标准化 IT 服务流程。`}
            icon={Inbox}
            action={canCreate && !activeFilters ? <Button size="sm" icon={Plus} onClick={openCreate}>新建{meta.label}</Button> : undefined}
          />
        )}
      </div>

      <Modal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title={`新建${meta.label}`}
        description={type === 'change' ? '填写变更方案并关联受影响的 CI，提交后将进入所选流程。' : `描述${meta.label}现象，系统将按流程自动分派与计算 SLA。`}
        icon={TypeIcon}
        size="lg"
        footer={
          <>
            <Button variant="secondary" size="sm" onClick={() => setCreateOpen(false)}>取消</Button>
            <Button size="sm" loading={saving} onClick={submit}>创建{meta.label}</Button>
          </>
        }
      >
        {formError ? (
          <div className="mb-4 flex items-start gap-2 rounded-xl border border-rose-100 bg-rose-50 px-3 py-2.5 text-[12px] text-rose-700">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /> {formError}
          </div>
        ) : null}
        <div className="space-y-4">
          <Field label="标题" required>
            <Input value={form.title} onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))} placeholder={`简要描述${meta.label}，例如：ERP 登录页面响应缓慢`} />
          </Field>
          <Field label="详细描述" hint="建议包含现象、影响范围、发生时间和已尝试的操作">
            <RichTextEditor value={form.description} onChange={(description) => setForm((current) => ({ ...current, description }))} placeholder="提供足够的上下文，帮助处理人快速定位问题…" />
          </Field>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Field label="工单来源">
              <SearchSelect value={String(form.source || 'portal')} onChange={(value) => setForm((current) => ({ ...current, source: value }))} options={sources.map((source) => ({ value: source.value, label: source.label }))} />
            </Field>
            <Field label="分类">
              <Input value={form.category} onChange={(event) => setForm((current) => ({ ...current, category: event.target.value }))} placeholder="例如：应用系统 / 网络" />
            </Field>
            <Field label="关联流程">
              <SearchSelect value={String(form.workflow_id || '')} onChange={(value) => setForm((current) => ({ ...current, workflow_id: value }))} options={[{ value: '', label: '使用默认流程' }, ...workflows.map((workflow) => ({ value: String(workflow.id), label: workflow.name }))]} />
            </Field>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Field label="优先级">
              <SearchSelect value={String(form.priority || '')} onChange={(value) => setForm((current) => ({ ...current, priority: value }))} options={(baseData?.priorities || Object.entries(PRIORITY_META).map(([value, item]) => ({ value, label: item.label }))).map((item: any) => ({ value: String(item.value), label: item.label }))} />
            </Field>
            <Field label="影响范围">
              <SearchSelect value={String(form.impact || '')} onChange={(value) => setForm((current) => ({ ...current, impact: value }))} options={(baseData?.impacts || [{ value: 'high', label: '高 · 多业务/用户' }, { value: 'medium', label: '中 · 单业务' }, { value: 'low', label: '低 · 个人' }]).map((item: any) => ({ value: String(item.value), label: item.label }))} />
            </Field>
            <Field label="紧急程度">
              <SearchSelect value={String(form.urgency || '')} onChange={(value) => setForm((current) => ({ ...current, urgency: value }))} options={(baseData?.urgencies || [{ value: 'critical', label: '紧急' }, { value: 'high', label: '高' }, { value: 'medium', label: '中' }, { value: 'low', label: '低' }]).map((item: any) => ({ value: String(item.value), label: item.label }))} />
            </Field>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {can('itsm.edit') ? (
              <Field label="负责人">
                <SearchSelect value={String(form.assignee_id || '')} onChange={(value) => setForm((current) => ({ ...current, assignee_id: value }))} placeholder="稍后分派" options={[{ value: '', label: '稍后分派' }, ...users.filter((item) => item.status === 'active' && !['admin', 'auditor'].includes(String((item as any).role_code || ''))).map((item) => ({ value: String(item.id), label: item.name, description: item.department || '' }))]} />
              </Field>
            ) : (
              <Field label="请求人"><Input value={user?.name || ''} disabled /></Field>
            )}
          </div>

          <Field label="处理流程" hint="由管理员在「流程设计」中配置，可选择适用的自定义流程">
            <SearchSelect value={String(form.workflow_id || '')} onChange={(value) => setForm((current) => ({ ...current, workflow_id: value }))} options={[{ value: '', label: '使用默认流程' }, ...workflows.map((workflow) => ({ value: String(workflow.id), label: `${workflow.name}${workflow.is_default ? '（默认）' : ''} · ${workflow.stages.length} 阶段` }))]} />
          </Field>
          {selectedWorkflow ? (
            <div className="flex items-center gap-1 overflow-x-auto rounded-xl border border-slate-100 bg-slate-50/70 px-3 py-2">
              {selectedWorkflow.stages.map((stage, index) => (
                <div key={stage.id} className="flex shrink-0 items-center gap-1">
                  {index > 0 ? <ChevronRight className="h-3 w-3 text-slate-300" /> : null}
                  <span className="flex items-center gap-1 text-[9.5px] text-slate-500">
                    <span className="h-1.5 w-1.5 rounded-full" style={{ background: stage.color }} />
                    {stage.name}
                  </span>
                </div>
              ))}
            </div>
          ) : null}

          <Field label={type === 'change' ? '关联 CI' : '关联配置项'} required={type === 'change'} hint={type === 'change' ? '变更必须关联至少一个受影响 CI，用于影响分析与审批' : '可选，关联 CMDB 中的配置项以形成影响链'}>
            <CIPicker value={cis} onChange={setCis} />
          </Field>

          {type === 'change' ? (
            <div className="rounded-xl border border-slate-200 p-3">
              <div className="mb-2 flex items-center justify-between">
                <div><p className="text-[11px] font-medium text-slate-700">变更完成后更新资产字段</p><p className="mt-0.5 text-[9.5px] text-slate-400">基础字段直接填字段名，如 os_name；扩展字段填 field_key，如 patch_level。</p></div>
                <Button type="button" variant="secondary" size="xs" icon={Plus} onClick={() => setChangeUpdates((current) => [...current, { ci_id: cis[0]?.id ? String(cis[0].id) : '', field_key: '', value: '' }])}>添加字段</Button>
              </div>
              <div className="space-y-2">
                {changeUpdates.map((item, index) => (
                  <div key={index} className="flex flex-col gap-2 sm:flex-row">
                    <select className="input-base h-9 text-[11px] sm:w-[220px]" value={item.ci_id} onChange={(event) => setChangeUpdates((current) => current.map((row, i) => i === index ? { ...row, ci_id: event.target.value } : row))}>
                      <option value="">选择关联资产</option>
                      {cis.map((ci) => <option key={ci.id} value={ci.id}>{ci.asset_no} · {ci.name}</option>)}
                    </select>
                    <Input className="h-9 flex-1 text-[11px]" value={item.field_key} onChange={(event) => setChangeUpdates((current) => current.map((row, i) => i === index ? { ...row, field_key: event.target.value } : row))} placeholder="字段名，如 patch_level" />
                    <Input className="h-9 flex-1 text-[11px]" value={item.value} onChange={(event) => setChangeUpdates((current) => current.map((row, i) => i === index ? { ...row, value: event.target.value } : row))} placeholder="变更完成后的值" />
                    <IconButton icon={Trash2} label="删除" variant="danger" onClick={() => setChangeUpdates((current) => current.filter((_, i) => i !== index))} />
                  </div>
                ))}
                {!changeUpdates.length ? <p className="py-2 text-[10px] text-slate-400">可选：变更成功后统一更新关联资产的指定字段。</p> : null}
              </div>
            </div>
          ) : null}

          {type === 'problem' ? (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="已知根因">
                <RichTextEditor value={form.root_cause} onChange={(root_cause) => setForm((current) => ({ ...current, root_cause }))} placeholder="如已定位根因，请在此说明" minHeight={72} />
              </Field>
              <Field label="临时规避方案">
                <RichTextEditor value={form.workaround} onChange={(workaround) => setForm((current) => ({ ...current, workaround }))} placeholder="在永久解决前的临时方案" minHeight={72} />
              </Field>
            </div>
          ) : null}

          {type === 'change' ? (
            <div className="space-y-3 rounded-xl border border-amber-100 bg-amber-50/40 p-3.5">
              <div className="flex items-center gap-1.5 text-[11px] font-semibold text-amber-800"><GitPullRequest className="h-3.5 w-3.5" /> 变更方案</div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <Field label="变更类型">
                  <select className="input-base" value={form.change_type} onChange={(event) => setForm((current) => ({ ...current, change_type: event.target.value }))}>
                    {(baseData?.change_types || [{ value: 'standard', label: '标准变更' }, { value: 'normal', label: '常规变更' }, { value: 'emergency', label: '紧急变更' }]).map((item: any) => <option key={item.value} value={item.value}>{item.label}</option>)}
                  </select>
                </Field>
                <Field label="风险等级">
                  <select className="input-base" value={form.risk} onChange={(event) => setForm((current) => ({ ...current, risk: event.target.value }))}>
                    {(baseData?.risks || [{ value: 'high', label: '高风险' }, { value: 'medium', label: '中风险' }, { value: 'low', label: '低风险' }]).map((item: any) => <option key={item.value} value={item.value}>{item.label}</option>)}
                  </select>
                </Field>
                <Field label="CAB 评审日期">
                  <DateInput value={form.cab_date || ''} onChange={(value) => setForm((current) => ({ ...current, cab_date: value }))} />
                </Field>
                <Field label="计划开始">
                  <DateTextInput withTime value={form.planned_start || ''} onChange={(planned_start) => setForm((current) => ({ ...current, planned_start }))} />
                </Field>
                <Field label="计划结束">
                  <DateTextInput withTime value={form.planned_end || ''} onChange={(planned_end) => setForm((current) => ({ ...current, planned_end }))} />
                </Field>
                <Field label="是否中断业务">
                  <select className="input-base" value={form.outage_required ? 'yes' : 'no'} onChange={(event) => setForm((current) => ({ ...current, outage_required: event.target.value === 'yes' }))}>
                    <option value="no">否 · 无损变更</option>
                    <option value="yes">是 · 需要停机窗口</option>
                  </select>
                </Field>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Field label="实施方案">
                  <RichTextEditor value={form.implementation_plan} onChange={(implementation_plan) => setForm((current) => ({ ...current, implementation_plan }))} placeholder="按步骤描述实施动作…" minHeight={74} />
                </Field>
                <Field label="回退方案">
                  <RichTextEditor value={form.rollback_plan} onChange={(rollback_plan) => setForm((current) => ({ ...current, rollback_plan }))} placeholder="失败时的回退步骤与预计耗时…" minHeight={74} />
                </Field>
              </div>
              <Field label="验证方案">
                <RichTextEditor value={form.test_plan} onChange={(test_plan) => setForm((current) => ({ ...current, test_plan }))} placeholder="变更后如何验证业务恢复…" minHeight={62} />
              </Field>
            </div>
          ) : null}
        </div>
      </Modal>

      <Modal
        open={Boolean(deleteTargets.length)}
        onClose={() => setDeleteTargets([])}
        title={deleteMode === 'direct' ? '直接删除工单' : '申请删除工单'}
        description={deleteMode === 'direct' ? '超级管理员可直接删除任意状态工单，删除后不可恢复。' : '提交后将进入管理员自定义的删除审批流程。'}
        icon={Trash2}
        size="sm"
        footer={
          <>
            <Button variant="secondary" size="sm" onClick={() => setDeleteTargets([])}>取消</Button>
            <Button variant="danger" size="sm" loading={deleting} onClick={submitDelete}>{deleteMode === 'direct' ? '确认删除' : '提交申请'}</Button>
          </>
        }
      >
        <div className="space-y-3">
          <div className="rounded-xl border border-slate-100 bg-slate-50/70 p-3">
            <p className="text-[9.5px] text-slate-400">已选工单（{deleteTargets.length}）</p>
            <div className="mt-1.5 space-y-1">
              {deleteTargets.slice(0, 8).map((ticket) => <p key={ticket.id} className="truncate font-mono text-[10.5px] text-slate-600">{ticket.ticket_no} · <span className="font-sans">{ticket.title}</span></p>)}
              {deleteTargets.length > 8 ? <p className="text-[9.5px] text-slate-400">另有 {deleteTargets.length - 8} 张…</p> : null}
            </div>
          </div>
          {deleteMode === 'direct' ? (
            <p className="flex items-start gap-1.5 rounded-lg bg-rose-50 px-3 py-2 text-[10px] leading-relaxed text-rose-700"><AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />工单及评论、流转记录、关联关系将被永久删除，且不可恢复。</p>
          ) : (
            <Field label="删除原因" required>
              <textarea className="input-base min-h-[82px]" value={deleteReason} onChange={(event) => { setDeleteReason(event.target.value); setDeleteError(''); }} placeholder="说明为什么需要删除这些历史工单，例如重复记录或错误创建…" />
            </Field>
          )}
          {deleteError ? <p className="text-[10px] text-rose-600">{deleteError}</p> : null}
        </div>
      </Modal>

      <Modal
        open={Boolean(reviewTarget)}
        onClose={() => setReviewTarget(null)}
        title="审批删除申请"
        description={reviewTarget ? `${reviewTarget.ticket_no} · ${reviewTarget.title}` : ''}
        icon={ShieldCheck}
        size="sm"
        footer={
          <>
            <Button variant="secondary" size="sm" loading={reviewing} onClick={() => submitReview('reject')}>驳回</Button>
            <Button variant="danger" size="sm" loading={reviewing} onClick={() => submitReview('approve')}>通过并删除</Button>
          </>
        }
      >
        {reviewTarget?.deletion_request ? (
          <div className="space-y-3">
            <div className="rounded-xl border border-slate-100 bg-slate-50/70 p-3 text-[10.5px] leading-relaxed text-slate-600">
              <p><span className="text-slate-400">申请人：</span>{reviewTarget.deletion_request.requester_name || '—'}</p>
              <p className="mt-1"><span className="text-slate-400">申请原因：</span>{reviewTarget.deletion_request.reason}</p>
            </div>
            <p className="flex items-start gap-1.5 rounded-lg bg-rose-50 px-3 py-2 text-[10px] leading-relaxed text-rose-700"><AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />通过后工单及其评论、流转记录、关联关系将被永久删除，不可恢复。</p>
            <Field label="审批意见" hint="驳回时必须填写">
              <textarea className="input-base min-h-[78px]" value={reviewComment} onChange={(event) => { setReviewComment(event.target.value); setReviewError(''); }} placeholder="填写审批说明或驳回原因…" />
            </Field>
            {reviewError ? <p className="text-[10px] text-rose-600">{reviewError}</p> : null}
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
