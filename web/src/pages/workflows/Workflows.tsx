import { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  ArrowDown,
  ArrowUp,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock3,
  Copy,
  GitPullRequest,
  GripVertical,
  Layers3,
  Plus,
  SearchCheck,
  Settings2,
  ShieldCheck,
  Sparkles,
  Trash2,
  UserRound,
  Workflow as WorkflowIcon,
  Zap,
} from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { notifyDataChanged } from '@/lib/refresh';
import { usePageTitle } from '@/lib/hooks';
import {
  TICKET_TYPE_META,
  cn,
  formatDate,
} from '@/lib/utils';
import type { Role, Workflow, WorkflowStage } from '@/lib/types';
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
  SectionHeading,
  Spinner,
  Tabs,
  Toggle,
} from '@/components/ui';

const TYPE_OPTIONS = [
  { value: 'incident', label: '事件流程', icon: Zap },
  { value: 'problem', label: '问题流程', icon: SearchCheck },
  { value: 'change', label: '变更流程', icon: GitPullRequest },
];

const STAGE_TYPE_META: Record<string, { label: string; icon: any; className: string }> = {
  start: { label: '开始', icon: Sparkles, className: 'bg-sky-50 text-sky-700 ring-sky-600/15' },
  task: { label: '处理', icon: Clock3, className: 'bg-blue-50 text-blue-700 ring-blue-600/15' },
  approval: { label: '审批', icon: ShieldCheck, className: 'bg-amber-50 text-amber-700 ring-amber-600/20' },
  end: { label: '结束', icon: CheckCircle2, className: 'bg-emerald-50 text-emerald-700 ring-emerald-600/15' },
};

const STAGE_COLORS = ['#0ea5e9', '#4f6ef7', '#8b5cf6', '#f59e0b', '#ef4444', '#10b981', '#64748b'];

function blankStage(index: number): WorkflowStage {
  return {
    id: 0,
    workflow_id: 0,
    stage_key: `stage_${Date.now().toString().slice(-5)}_${index}`,
    name: `阶段 ${index + 1}`,
    stage_type: 'task',
    seq: index + 1,
    color: STAGE_COLORS[index % STAGE_COLORS.length],
    description: '',
    sla_hours: 8,
    assignee_role_id: null,
    approver_role_id: null,
  };
}

export default function WorkflowsPage() {
  usePageTitle('流程设计');
  const [typeFilter, setTypeFilter] = useState<'incident' | 'problem' | 'change'>('incident');
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [roles, setRoles] = useState<Role[]>([]);
  const [loading, setLoading] = useState(true);

  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<Workflow | null>(null);
  const [form, setForm] = useState<Record<string, any>>({});
  const [stages, setStages] = useState<WorkflowStage[]>([]);
  const [saving, setSaving] = useState(false);
  const [expandedStage, setExpandedStage] = useState<number>(0);

  const [deleteTarget, setDeleteTarget] = useState<Workflow | null>(null);
  const [deleting, setDeleting] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const response = await api.get<{ data: Workflow[] }>('/api/workflows');
      setWorkflows(response.data);
      const filtered = response.data.filter((item) => item.ticket_type === typeFilter);
      if (!filtered.find((item) => item.id === selectedId)) setSelectedId(filtered[0]?.id || null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    api.get<{ data: Role[] }>('/api/roles').then((response) => setRoles(response.data)).catch(() => {});
  }, []);

  useEffect(() => {
    const filtered = workflows.filter((item) => item.ticket_type === typeFilter);
    if (!filtered.find((item) => item.id === selectedId)) setSelectedId(filtered[0]?.id || null);
  }, [typeFilter, workflows]);

  const filtered = useMemo(() => workflows.filter((item) => item.ticket_type === typeFilter), [workflows, typeFilter]);
  const selected = workflows.find((item) => item.id === selectedId) || null;

  const openCreate = () => {
    setEditing(null);
    setForm({
      name: '',
      code: '',
      ticket_type: typeFilter,
      description: '',
      is_default: filtered.length === 0,
      is_active: true,
    });
    const now = Date.now().toString().slice(-4);
    setStages([
      { ...blankStage(0), stage_key: 'start', name: '事件受理', stage_type: 'start', color: '#0ea5e9', sla_hours: 2 },
      { ...blankStage(1), stage_key: `handle_${now}`, name: '处理中', stage_type: 'task', color: '#4f6ef7', sla_hours: 8, assignee_role_id: roles.find((role) => role.code === 'ops')?.id || null },
      { ...blankStage(2), stage_key: 'end', name: '关闭归档', stage_type: 'end', color: '#10b981', sla_hours: 24 },
    ]);
    setExpandedStage(0);
    setEditorOpen(true);
  };

  const openEdit = (workflow: Workflow) => {
    setEditing(workflow);
    setForm({
      name: workflow.name,
      code: workflow.code,
      ticket_type: workflow.ticket_type,
      description: workflow.description,
      is_default: workflow.is_default,
      is_active: workflow.is_active,
    });
    setStages(workflow.stages.map((stage) => ({ ...stage })));
    setExpandedStage(0);
    setEditorOpen(true);
  };

  const updateStage = (index: number, key: keyof WorkflowStage, value: any) => {
    setStages((current) => current.map((stage, stageIndex) => (stageIndex === index ? { ...stage, [key]: value } : stage)));
    if (key === 'stage_type' && value === 'approval') {
      setStages((current) => current.map((stage, stageIndex) => stageIndex === index ? { ...stage, approver_role_id: stage.approver_role_id || roles.find((role) => role.code === 'approver')?.id || null } : stage));
    }
  };

  const addStage = () => {
    const next = [...stages];
    const last = next.pop();
    const index = next.length;
    const stage = blankStage(index);
    next.push(stage);
    if (last) next.push(last);
    setStages(next);
    setExpandedStage(index);
  };

  const removeStage = (index: number) => {
    if (stages.length <= 2) return toast.error('流程至少需要两个阶段');
    setStages((current) => current.filter((_, stageIndex) => stageIndex !== index));
  };

  const moveStage = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= stages.length) return;
    const next = [...stages];
    [next[index], next[target]] = [next[target], next[index]];
    setStages(next);
    setExpandedStage(target);
  };

  const save = async () => {
    if (!form.name?.trim()) return toast.error('请填写流程名称');
    if (!editing && !form.code?.trim()) return toast.error('请填写流程编码');
    if (stages.length < 2) return toast.error('流程至少需要两个阶段');
    if (stages[0].stage_type !== 'start') return toast.error('第一个阶段必须为「开始」类型');
    if (stages[stages.length - 1].stage_type !== 'end') return toast.error('最后一个阶段必须为「结束」类型');
    if (stages.some((stage) => !stage.name?.trim())) return toast.error('所有阶段都需要名称');
    const keys = stages.map((stage) => stage.stage_key);
    if (new Set(keys).size !== keys.length) return toast.error('阶段标识不能重复');
    setSaving(true);
    try {
      const payload = {
        ...form,
        stages: stages.map((stage) => ({
          ...(stage.id ? { id: stage.id } : {}),
          stage_key: stage.stage_key,
          name: stage.name,
          stage_type: stage.stage_type,
          color: stage.color || '#4f6ef7',
          description: stage.description || '',
          sla_hours: Number(stage.sla_hours || 0),
          assignee_role_id: stage.assignee_role_id || null,
          approver_role_id: stage.approver_role_id || null,
        })),
      };
      if (editing) {
        await api.put(`/api/workflows/${editing.id}`, payload);
        toast.success('流程已更新');
        notifyDataChanged();
      } else {
        const response = await api.post<{ data: Workflow }>('/api/workflows', payload);
        toast.success('流程已创建');
        notifyDataChanged();
        setSelectedId(response.data.id);
      }
      setEditorOpen(false);
      await load();
    } catch (error: any) {
      toast.error(error.message);
    } finally {
      setSaving(false);
    }
  };

  const duplicate = async (workflow: Workflow) => {
    try {
      const response = await api.post<{ data: Workflow }>(`/api/workflows/${workflow.id}/duplicate`);
      toast.success('流程副本已创建');
      await load();
      setSelectedId(response.data.id);
    } catch (error: any) {
      toast.error(error.message);
    }
  };

  const setDefault = async (workflow: Workflow) => {
    try {
      await api.post(`/api/workflows/${workflow.id}/default`);
      toast.success('已设为默认流程');
      await load();
    } catch (error: any) {
      toast.error(error.message);
    }
  };

  const toggleActive = async (workflow: Workflow) => {
    try {
      await api.put(`/api/workflows/${workflow.id}`, { is_active: !workflow.is_active });
      toast.success(workflow.is_active ? '流程已停用' : '流程已启用');
      await load();
    } catch (error: any) {
      toast.error(error.message);
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await api.delete(`/api/workflows/${deleteTarget.id}`);
      toast.success('流程已删除');
      notifyDataChanged();
      setDeleteTarget(null);
      await load();
    } catch (error: any) {
      toast.error(error.message);
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="animate-enter">
      <PageHeader
        eyebrow="Workflow orchestration"
        title="ITSM 流程设计"
        description="为事件、问题与变更自定义阶段、SLA、处理角色和审批节点，让服务流程贴合组织。"
        actions={<Button size="sm" icon={Plus} onClick={openCreate}>新建流程</Button>}
      />

      <div className="mb-3.5 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex rounded-xl border border-[#e7eaf1] bg-white p-1">
          {TYPE_OPTIONS.map((option) => {
            const Icon = option.icon;
            const active = typeFilter === option.value;
            const count = workflows.filter((item) => item.ticket_type === option.value).length;
            return (
              <button
                key={option.value}
                onClick={() => setTypeFilter(option.value as any)}
                className={cn('flex h-8 items-center gap-1.5 rounded-lg px-3 text-[11.5px] font-medium transition', active ? 'bg-brand-50 text-brand-700' : 'text-slate-500 hover:text-slate-800')}
              >
                <Icon className="h-3.5 w-3.5" />
                {option.label}
                <span className={cn('rounded px-1 py-0.5 text-[9px]', active ? 'bg-brand-100 text-brand-700' : 'bg-slate-100 text-slate-500')}>{count}</span>
              </button>
            );
          })}
        </div>
        <p className="text-[10px] text-slate-400">默认流程用于新工单；已有工单的流程结构将被锁定，可复制后调整。</p>
      </div>

      <div className="grid grid-cols-1 gap-3.5 xl:grid-cols-12">
        <div className="card overflow-hidden xl:col-span-4">
          <div className="flex items-center justify-between border-b border-[#eef1f6] px-4 py-3.5">
            <div>
              <h2 className="text-[13px] font-semibold text-slate-800">流程列表</h2>
              <p className="mt-0.5 text-[10px] text-slate-400">{filtered.length} 个流程 · 点击查看</p>
            </div>
            <Button variant="ghost" size="xs" icon={Plus} onClick={openCreate}>新建</Button>
          </div>
          {loading ? (
            <div className="space-y-2 p-3">{Array.from({ length: 4 }).map((_, index) => <div key={index} className="h-20 animate-pulse rounded-xl bg-slate-100" />)}</div>
          ) : filtered.length ? (
            <div className="space-y-1 p-2">
              {filtered.map((workflow) => (
                <button
                  key={workflow.id}
                  onClick={() => setSelectedId(workflow.id)}
                  className={cn('w-full rounded-xl border p-3 text-left transition', selectedId === workflow.id ? 'border-brand-200 bg-brand-50/60' : 'border-transparent hover:border-slate-200 hover:bg-slate-50')}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="truncate text-[12px] font-medium text-slate-700">{workflow.name}</span>
                        {workflow.is_default ? <span className="rounded bg-emerald-50 px-1 py-0.5 text-[8px] font-medium text-emerald-600">默认</span> : null}
                        {!workflow.is_active ? <span className="rounded bg-slate-100 px-1 py-0.5 text-[8px] text-slate-500">停用</span> : null}
                      </div>
                      <p className="mt-0.5 font-mono text-[9px] text-slate-400">{workflow.code}</p>
                    </div>
                    <ChevronRight className={cn('mt-1 h-3.5 w-3.5 shrink-0', selectedId === workflow.id ? 'text-brand-500' : 'text-slate-300')} />
                  </div>
                  <div className="mt-2.5 flex items-center gap-3 text-[9px] text-slate-400">
                    <span className="flex items-center gap-1"><WorkflowIcon className="h-3 w-3" />{workflow.stages.length} 阶段</span>
                    <span className="flex items-center gap-1"><Layers3 className="h-3 w-3" />{workflow.ticket_count} 工单</span>
                    <span className="ml-auto">v{workflow.version}</span>
                  </div>
                  <div className="mt-2 flex gap-1">
                    {workflow.stages.map((stage) => <span key={stage.id} className="h-1 flex-1 rounded-full" style={{ background: stage.color }} title={stage.name} />)}
                  </div>
                </button>
              ))}
            </div>
          ) : (
            <EmptyState title="该类型暂无流程" description="创建流程后才能新建该类工单。" icon={WorkflowIcon} className="py-12" action={<Button size="sm" icon={Plus} onClick={openCreate}>新建流程</Button>} />
          )}
        </div>

        <div className="xl:col-span-8">
          {selected ? (
            <div className="space-y-3.5">
              <div className="card overflow-hidden">
                <div className="relative border-b border-[#eef1f6] p-5">
                  <div className="absolute inset-0 opacity-[0.07]" style={{ background: `linear-gradient(120deg, ${selected.ticket_type === 'change' ? '#f59e0b' : selected.ticket_type === 'problem' ? '#8b5cf6' : '#0ea5e9'}, transparent)` }} />
                  <div className="relative flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="text-[18px] font-semibold tracking-tight text-slate-900">{selected.name}</h2>
                        <Badge className={TICKET_TYPE_META[selected.ticket_type].className}>{TICKET_TYPE_META[selected.ticket_type].label}流程</Badge>
                        {selected.is_default ? <Badge className="bg-emerald-50 text-emerald-700 ring-emerald-600/15" icon={Check}>默认</Badge> : null}
                        {!selected.is_active ? <Badge className="bg-slate-100 text-slate-500 ring-slate-500/10">已停用</Badge> : null}
                      </div>
                      <p className="mt-1 max-w-xl text-[11px] leading-relaxed text-slate-500">{selected.description || '暂无流程说明'}</p>
                      <div className="mt-2 flex items-center gap-3 text-[9.5px] text-slate-400">
                        <span className="font-mono">{selected.code}</span>
                        <span>·</span>
                        <span>v{selected.version}</span>
                        <span>·</span>
                        <span>更新于 {formatDate(selected.updated_at, 'YYYY/MM/DD')}</span>
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Button variant="secondary" size="sm" icon={Settings2} onClick={() => openEdit(selected)}>{selected.ticket_count ? '编辑属性' : '编辑流程'}</Button>
                      <IconButton icon={Copy} label="复制流程" onClick={() => duplicate(selected)} />
                      <IconButton icon={Trash2} label="删除流程" variant="danger" onClick={() => setDeleteTarget(selected)} />
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-2 divide-x divide-[#eef1f6] border-b border-[#eef1f6] sm:grid-cols-4">
                  <WorkflowMetric label="阶段数" value={String(selected.stages.length)} sub="含开始与结束" />
                  <WorkflowMetric label="关联工单" value={String(selected.ticket_count)} sub="历史与进行中" />
                  <WorkflowMetric label="总 SLA" value={`${selected.stages.reduce((sum, stage) => sum + Number(stage.sla_hours || 0), 0)}h`} sub="各阶段 SLA 之和" />
                  <WorkflowMetric label="审批节点" value={String(selected.stages.filter((stage) => stage.stage_type === 'approval').length)} sub="需 CAB 或角色审批" />
                </div>

                <div className="p-5">
                  <div className="mb-4 flex items-center justify-between">
                    <div>
                      <h3 className="text-[12.5px] font-semibold text-slate-800">流程预览</h3>
                      <p className="mt-0.5 text-[10px] text-slate-400">工单将按以下顺序流转，每个阶段独立计算 SLA。</p>
                    </div>
                    {selected.is_default ? (
                      <span className="flex items-center gap-1 text-[9.5px] font-medium text-emerald-600"><CheckCircle2 className="h-3 w-3" /> 当前默认</span>
                    ) : (
                      <Button variant="secondary" size="xs" onClick={() => setDefault(selected)}>设为默认</Button>
                    )}
                  </div>
                  <div className="overflow-x-auto pb-2">
                    <div className="flex min-w-[600px] items-start">
                      {selected.stages.map((stage, index) => {
                        const meta = STAGE_TYPE_META[stage.stage_type];
                        const Icon = meta.icon;
                        return (
                          <div key={stage.id} className="flex items-start" style={{ flex: index < selected.stages.length - 1 ? 1 : undefined }}>
                            <div className="w-[112px] shrink-0">
                              <div className="flex flex-col items-center text-center">
                                <span className="flex h-10 w-10 items-center justify-center rounded-xl text-white shadow-sm" style={{ background: stage.color }}>
                                  <Icon className="h-4 w-4" />
                                </span>
                                <p className="mt-2 text-[10.5px] font-medium leading-tight text-slate-700">{stage.name}</p>
                                <p className="mt-0.5 text-[8.5px] text-slate-400">{meta.label} · {stage.sla_hours}h</p>
                                {stage.stage_type === 'approval' && stage.approver_role_name ? <p className="mt-0.5 max-w-[100px] truncate text-[8px] text-amber-600">{stage.approver_role_name}</p> : null}
                                {stage.stage_type !== 'approval' && stage.assignee_role_name ? <p className="mt-0.5 max-w-[100px] truncate text-[8px] text-slate-400">{stage.assignee_role_name}</p> : null}
                              </div>
                            </div>
                            {index < selected.stages.length - 1 ? (
                              <div className="mt-5 flex flex-1 items-center px-1">
                                <span className="h-px flex-1 border-t border-dashed border-slate-300" />
                                <ChevronRight className="-ml-1 h-3.5 w-3.5 text-slate-300" />
                              </div>
                            ) : null}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </div>

              <div className="card overflow-hidden">
                <SectionHeading title="阶段配置" description="每个阶段的处理角色、SLA 与审批要求" action={<Button variant="secondary" size="xs" icon={Settings2} onClick={() => openEdit(selected)}>编辑</Button>} />
                <div className="table-wrap">
                  <table className="data-table">
                    <thead><tr><th>顺序</th><th>阶段</th><th>类型</th><th>SLA</th><th>处理角色</th><th>审批角色</th><th>操作</th></tr></thead>
                    <tbody>
                      {selected.stages.map((stage) => {
                        const meta = STAGE_TYPE_META[stage.stage_type];
                        return (
                          <tr key={stage.id}>
                            <td><span className="flex h-6 w-6 items-center justify-center rounded-md bg-slate-100 text-[10px] font-semibold text-slate-500">{stage.seq}</span></td>
                            <td>
                              <div className="flex items-center gap-2">
                                <span className="h-2 w-2 rounded-full" style={{ background: stage.color }} />
                                <div>
                                  <p className="text-[11.5px] font-medium text-slate-700">{stage.name}</p>
                                  <p className="font-mono text-[9px] text-slate-400">{stage.stage_key}</p>
                                </div>
                              </div>
                            </td>
                            <td><Badge className={meta.className}>{meta.label}</Badge></td>
                            <td className="text-[11px] text-slate-500">{stage.sla_hours} 小时</td>
                            <td className="text-[10.5px] text-slate-500">{stage.assignee_role_name || '—'}</td>
                            <td className="text-[10.5px] text-slate-500">{stage.stage_type === 'approval' ? stage.approver_role_name || '指定审批角色' : '—'}</td>
                            <td><Button variant="ghost" size="xs" icon={Settings2} onClick={() => openEdit(selected)}>配置</Button></td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="flex flex-col items-start justify-between gap-2 rounded-xl border border-slate-200 bg-white px-4 py-3 sm:flex-row sm:items-center">
                <div>
                  <p className="text-[11px] font-medium text-slate-700">{selected.is_active ? '流程处于启用状态' : '流程已停用'}</p>
                  <p className="mt-0.5 text-[9.5px] text-slate-400">停用后新建工单不可选择该流程，已有工单继续按其阶段流转。</p>
                </div>
                <Button variant="secondary" size="sm" onClick={() => toggleActive(selected)}>{selected.is_active ? '停用流程' : '启用流程'}</Button>
              </div>
            </div>
          ) : (
            <div className="card"><EmptyState title="选择左侧流程" description="查看流程阶段、SLA 与审批角色配置。" icon={WorkflowIcon} className="py-20" /></div>
          )}
        </div>
      </div>

      <Modal
        open={editorOpen}
        onClose={() => setEditorOpen(false)}
        title={editing ? `编辑流程 · ${editing.code}` : '新建 ITSM 流程'}
        description={editing?.ticket_count ? '当前流程已有工单使用，仅可修改阶段属性，不能增删阶段。如需调整结构请复制流程。' : '定义阶段顺序、SLA 与角色分派；流程会立即用于新建工单。'}
        icon={WorkflowIcon}
        size="xl"
        resizable
        footer={
          <>
            <Button variant="secondary" size="sm" onClick={() => setEditorOpen(false)}>取消</Button>
            <Button size="sm" loading={saving} onClick={save}>{editing ? '保存流程' : '创建流程'}</Button>
          </>
        }
      >
        <div className="space-y-5">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="流程名称" required><Input value={form.name || ''} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} placeholder="如 标准事件流程" /></Field>
            <Field label="流程编码" required hint="大写字母、数字与横线">
              <Input value={form.code || ''} onChange={(event) => setForm((current) => ({ ...current, code: event.target.value.toUpperCase().replace(/[^A-Z0-9_-]/g, '_') }))} placeholder="INC-CUSTOM" className="font-mono" disabled={Boolean(editing)} />
            </Field>
            <Field label="适用类型">
              <select className="input-base" value={form.ticket_type} onChange={(event) => setForm((current) => ({ ...current, ticket_type: event.target.value }))} disabled={Boolean(editing)}>
                <option value="incident">事件</option>
                <option value="problem">问题</option>
                <option value="change">变更</option>
              </select>
            </Field>
            <Field label="描述"><Input value={form.description || ''} onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))} placeholder="流程适用场景" /></Field>
          </div>
          <div className="flex flex-wrap items-center gap-5 rounded-xl border border-slate-200 bg-slate-50/60 px-3 py-2.5">
            <label className="flex items-center gap-2 text-[11px] text-slate-600">
              <Toggle checked={Boolean(form.is_default)} onChange={(checked) => setForm((current) => ({ ...current, is_default: checked }))} /> 设为该类型默认流程
            </label>
            <label className="flex items-center gap-2 text-[11px] text-slate-600">
              <Toggle checked={Boolean(form.is_active)} onChange={(checked) => setForm((current) => ({ ...current, is_active: checked }))} /> 启用流程
            </label>
            <span className="ml-auto text-[9.5px] text-slate-400">首个阶段必须为开始，最后阶段必须为结束。</span>
          </div>

          <div>
            <div className="mb-2 flex items-center justify-between">
              <div>
                <h3 className="text-[12.5px] font-semibold text-slate-800">阶段编排</h3>
                <p className="mt-0.5 text-[10px] text-slate-400">{stages.length} 个阶段 · 总 SLA {stages.reduce((sum, stage) => sum + Number(stage.sla_hours || 0), 0)} 小时</p>
              </div>
              <Button variant="secondary" size="sm" icon={Plus} onClick={addStage} disabled={Boolean(editing?.ticket_count)}>添加阶段</Button>
            </div>
            <div className="space-y-2">
              {stages.map((stage, index) => {
                const meta = STAGE_TYPE_META[stage.stage_type];
                const Icon = meta.icon;
                const open = expandedStage === index;
                const locked = Boolean(editing?.ticket_count);
                return (
                  <div key={stage.id || `${stage.stage_key}-${index}`} className={cn('rounded-xl border transition', open ? 'border-brand-200 bg-brand-50/20' : 'border-slate-200 bg-white')}>
                    <div className="flex items-center gap-2 px-3 py-2.5">
                      <div className="flex flex-col items-center gap-0.5 text-slate-300">
                        <button disabled={index === 0 || locked} onClick={() => moveStage(index, -1)} className="rounded p-0.5 hover:bg-slate-100 hover:text-slate-600 disabled:opacity-30"><ArrowUp className="h-3 w-3" /></button>
                        <button disabled={index === stages.length - 1 || locked} onClick={() => moveStage(index, 1)} className="rounded p-0.5 hover:bg-slate-100 hover:text-slate-600 disabled:opacity-30"><ArrowDown className="h-3 w-3" /></button>
                      </div>
                      <span className="flex h-7 w-7 items-center justify-center rounded-lg text-white" style={{ background: stage.color }}><Icon className="h-3.5 w-3.5" /></span>
                      <button onClick={() => setExpandedStage(open ? -1 : index)} className="flex flex-1 items-center gap-2 text-left">
                        <span className="text-[11.5px] font-medium text-slate-700">{stage.name || '未命名阶段'}</span>
                        <span className="rounded bg-white px-1.5 py-0.5 text-[8.5px] text-slate-400 ring-1 ring-slate-200">{meta.label}</span>
                        <span className="text-[9px] text-slate-400">SLA {stage.sla_hours}h</span>
                      </button>
                      {!locked ? <IconButton icon={Trash2} label="删除阶段" variant="danger" onClick={() => removeStage(index)} /> : null}
                      <button onClick={() => setExpandedStage(open ? -1 : index)} className="rounded p-1 text-slate-400 hover:bg-white"><ChevronDown className={cn('h-4 w-4 transition', open && 'rotate-180')} /></button>
                    </div>
                    {open ? (
                      <div className="border-t border-slate-200/70 p-3.5">
                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                          <Field label="阶段名称"><Input value={stage.name} onChange={(event) => updateStage(index, 'name', event.target.value)} /></Field>
                          <Field label="阶段标识" hint="小写字母/数字/下划线"><Input value={stage.stage_key} onChange={(event) => updateStage(index, 'stage_key', event.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_'))} className="font-mono" /></Field>
                          <Field label="阶段类型">
                            <select className="input-base" value={stage.stage_type} onChange={(event) => updateStage(index, 'stage_type', event.target.value)}>
                              <option value="start">开始</option><option value="task">处理</option><option value="approval">审批</option><option value="end">结束</option>
                            </select>
                          </Field>
                          <Field label="SLA（小时）"><Input type="number" min="0" step="0.5" value={stage.sla_hours} onChange={(event) => updateStage(index, 'sla_hours', event.target.value)} /></Field>
                          <Field label="处理角色">
                            <select className="input-base" value={stage.assignee_role_id || ''} onChange={(event) => updateStage(index, 'assignee_role_id', event.target.value ? Number(event.target.value) : null)}>
                              <option value="">不限</option>
                              {roles.map((role) => <option key={role.id} value={role.id}>{role.name}</option>)}
                            </select>
                          </Field>
                          {stage.stage_type === 'approval' ? (
                            <Field label="审批角色">
                              <select className="input-base" value={stage.approver_role_id || ''} onChange={(event) => updateStage(index, 'approver_role_id', event.target.value ? Number(event.target.value) : null)}>
                                <option value="">不限（拥有审批权限即可）</option>
                                {roles.map((role) => <option key={role.id} value={role.id}>{role.name}</option>)}
                              </select>
                            </Field>
                          ) : null}
                          <Field label="节点颜色">
                            <div className="flex h-10 flex-wrap items-center gap-1.5">
                              {STAGE_COLORS.map((color) => (
                                <button key={color} type="button" onClick={() => updateStage(index, 'color', color)} className="flex h-6 w-6 items-center justify-center rounded-full" style={{ background: color, boxShadow: stage.color === color ? '0 0 0 2px white, 0 0 0 4px ' + color : undefined }}>
                                  {stage.color === color ? <Check className="h-3 w-3 text-white" /> : null}
                                </button>
                              ))}
                            </div>
                          </Field>
                          <Field label="阶段说明" className="sm:col-span-2 lg:col-span-4"><Input value={stage.description || ''} onChange={(event) => updateStage(index, 'description', event.target.value)} placeholder="说明该阶段要完成的工作…" /></Field>
                        </div>
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
            {editing?.ticket_count ? (
              <div className="mt-2 flex items-start gap-2 rounded-lg border border-amber-100 bg-amber-50 px-3 py-2 text-[10px] leading-relaxed text-amber-700">
                <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> 该流程已有 {editing.ticket_count} 张工单，阶段结构已锁定。可调整名称、SLA、角色与说明，或复制流程后修改结构。
              </div>
            ) : null}
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onClose={() => setDeleteTarget(null)}
        onConfirm={confirmDelete}
        loading={deleting}
        title="删除流程"
        confirmText="确认删除"
        description={<>确定删除流程「{deleteTarget?.name}」吗？已有工单使用的流程不可删除。默认流程删除后会自动指定其他可用流程。</>}
      />
    </div>
  );
}

function WorkflowMetric({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="px-4 py-3.5">
      <p className="text-[9.5px] text-slate-400">{label}</p>
      <p className="mt-0.5 text-[18px] font-semibold tracking-tight text-slate-800">{value}</p>
      <p className="mt-0.5 text-[8.5px] text-slate-400">{sub}</p>
    </div>
  );
}
