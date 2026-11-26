import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  CalendarClock,
  Check,
  CheckCircle2,
  ChevronRight,
  Circle,
  Clock3,
  Edit3,
  ExternalLink,
  FileX2,
  GitPullRequest,
  History,
  Image as ImageIcon,
  Link2,
  List,
  ListOrdered,
  LockKeyhole,
  MessageSquare,
  Paperclip,
  Download,
  Plus,
  RotateCcw,
  Search,
  SearchCheck,
  Send,
  Server,
  ShieldCheck,
  Sparkles,
  ThumbsDown,
  ThumbsUp,
  Timer,
  Trash2,
  UserRound,
  X,
  Zap,
} from 'lucide-react';
import { toast } from 'sonner';
import { RichTextContent, RichTextEditor } from '@/components/RichText';
import { DateTextInput } from '@/components/DateTextInput';
import { api, buildQuery } from '@/lib/api';
import { usePageTitle } from '@/lib/hooks';
import { useAuth } from '@/context/AuthContext';
import {
  ACTION_LABELS,
  PRIORITY_META,
  RELATION_LABELS,
  SOURCE_LABELS,
  TICKET_STATUS_META,
  TICKET_TYPE_META,
  cn,
  formatDate,
  relativeTime,
} from '@/lib/utils';
import type { CI, Ticket, TicketComment, TicketHistory, User } from '@/lib/types';
import {
  Avatar,
  Badge,
  Button,
  EmptyState,
  Field,
  IconButton,
  InfoGrid,
  Input,
  Modal,
  PageHeader,
  SectionHeading,
  Skeleton,
  Spinner,
  Tabs,
  ConfirmDialog,
} from '@/components/ui';
import { CIPicker } from '@/components/CIPicker';
import { DateInput } from '@/components/DateInput';

const TYPE_ICONS: Record<string, any> = { incident: Zap, problem: SearchCheck, change: GitPullRequest };

const STAGE_ICONS: Record<string, any> = { start: Circle, task: Clock3, approval: ShieldCheck, end: CheckCircle2 };

const ACTION_ICONS: Record<string, any> = {
  created: Sparkles,
  advanced: ArrowRight,
  approved: ThumbsUp,
  rejected: ThumbsDown,
  closed: CheckCircle2,
  reopened: RotateCcw,
  assigned: UserRound,
  'zabbix.recovery': ShieldCheck,
  'zabbix.repeat': ShieldCheck,
  'zabbix.reopened': RotateCcw,
};

export default function TicketDetailPage() {
  const { type, id } = useParams();
  const navigate = useNavigate();
  const { can, user } = useAuth();
  const [ticket, setTicket] = useState<Ticket | null>(null);
  const [permissions, setPermissions] = useState<any>({});
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<'comments' | 'history'>('comments');
  const [commentBody, setCommentBody] = useState('');
  const editorRef = useRef<HTMLDivElement>(null);
  const [uploading, setUploading] = useState(false);
  const [previewAttachment, setPreviewAttachment] = useState<any>(null);
  const [previewUrl, setPreviewUrl] = useState('');
  const [internal, setInternal] = useState(false);
  const [posting, setPosting] = useState(false);
  const [users, setUsers] = useState<User[]>([]);

  const [actionModal, setActionModal] = useState<null | { action: 'advance' | 'approve' | 'reject' | 'complete' | 'close' }>(null);
  const [actionComment, setActionComment] = useState('');
  const [resolution, setResolution] = useState('');
  const [acting, setActing] = useState(false);

  const [editOpen, setEditOpen] = useState(false);
  const [editForm, setEditForm] = useState<Record<string, any>>({});
  const [savingEdit, setSavingEdit] = useState(false);

  const [ciOpen, setCiOpen] = useState(false);
  const [ciSelection, setCiSelection] = useState<CI[]>([]);
  const [addingCi, setAddingCi] = useState(false);

  const [linkOpen, setLinkOpen] = useState(false);
  const [linkQuery, setLinkQuery] = useState('');
  const [linkOptions, setLinkOptions] = useState<Ticket[]>([]);
  const [linkedTicketId, setLinkedTicketId] = useState('');
  const [relationType, setRelationType] = useState('related');
  const [linking, setLinking] = useState(false);
  const [deletionOpen, setDeletionOpen] = useState(false);
  const [deleteReason, setDeleteReason] = useState('');
  const [requestingDelete, setRequestingDelete] = useState(false);
  const [directDeleteOpen, setDirectDeleteOpen] = useState(false);
  const [deletingTicket, setDeletingTicket] = useState(false);

  usePageTitle(ticket?.ticket_no || '工单详情');

  const load = async () => {
    setLoading(true);
    try {
      const response = await api.get<{ data: Ticket; permissions: any }>(`/api/tickets/${id}`);
      setTicket(response.data);
      setPermissions(response.permissions || {});
      setResolution(response.data.resolution || '');
    } catch (error: any) {
      toast.error(error.message);
      navigate(`/tickets/${type || 'incident'}`, { replace: true });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [id]);

  useEffect(() => {
    api.get<{ data: User[] }>('/api/users').then((response) => setUsers(response.data)).catch(() => {});
  }, []);

  useEffect(() => {
    if (!linkOpen) return;
    const timer = setTimeout(() => {
      api
        .get<{ data: Ticket[] }>(`/api/tickets${buildQuery({ q: linkQuery, pageSize: 8 })}`)
        .then((response) => setLinkOptions(response.data.filter((item) => item.id !== ticket?.id)))
        .catch(() => {});
    }, 250);
    return () => clearTimeout(timer);
  }, [linkQuery, linkOpen, ticket?.id]);

  const stages = ticket?.stages || [];
  const currentIndex = stages.findIndex((stage) => stage.id === ticket?.current_stage_id);
  const currentStage = stages[currentIndex];
  const statusMeta = TICKET_STATUS_META[ticket?.status || 'new'] || TICKET_STATUS_META.new;
  const priorityMeta = PRIORITY_META[ticket?.priority || 'medium'] || PRIORITY_META.medium;
  const typeMeta = TICKET_TYPE_META[ticket?.type || 'incident'];
  const TypeIcon = TYPE_ICONS[ticket?.type || 'incident'];
  const closed = ['closed', 'cancelled'].includes(ticket?.status || '');
  const overdue = Boolean(ticket?.sla_due_at && new Date(ticket.sla_due_at).getTime() < Date.now() && !['resolved', 'closed', 'cancelled'].includes(ticket?.status || ''));
  const isApproval = currentStage?.stage_type === 'approval';
  const canApprove = permissions.can_approve && isApproval && !closed;
  const canEdit = permissions.can_edit && !closed;
  const canAct = canEdit && !isApproval;
  const activeWork = canAct && ticket?.status !== 'resolved';
  const relationRows = [...(ticket?.relations || []), ...(ticket?.incoming_relations || [])];
  const pendingDeletion = ticket?.deletion_request?.status === 'pending';
  const canRequestDeletion = Boolean(permissions.can_request_delete) && !pendingDeletion;
  const canDirectDelete = Boolean(permissions.can_manage);

  const uploadAttachment = async (file?: File) => {
    if (!file) return;
    if (file.size > 50 * 1024 * 1024) return toast.error('附件不能超过 50MB');
    setUploading(true);
    try {
      const form = new FormData();
      form.append('file', file);
      await api.post(`/api/tickets/${id}/attachments`, form);
      toast.success('附件已上传');
      await load();
    } catch (error: any) {
      toast.error(error.message);
    } finally {
      setUploading(false);
    }
  };

  const openAttachment = async (attachment: any) => {
    try {
      const response = await api.get<Response>(`/api/ticket-attachments/${attachment.id}`, { raw: true });
      const blob = await response.blob();
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      const url = URL.createObjectURL(blob);
      setPreviewAttachment(attachment);
      setPreviewUrl(url);
    } catch (error: any) {
      toast.error(error.message);
    }
  };

  const downloadAttachment = async (attachment: any) => {
    try {
      const response = await api.get<Response>(`/api/ticket-attachments/${attachment.id}`, { raw: true });
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = attachment.filename;
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error: any) {
      toast.error(error.message);
    }
  };

  const openAttachmentPreview = (attachment: any) => openAttachment(attachment);

  const closeAttachmentPreview = () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl('');
    setPreviewAttachment(null);
  };

  const openAction = (action: 'advance' | 'approve' | 'reject' | 'complete' | 'close') => {
    setActionComment('');
    if (action === 'close') setResolution(ticket?.resolution || '');
    setActionModal({ action });
  };

  const submitAction = async () => {
    if (!actionModal) return;
    if (actionModal.action === 'reject' && !actionComment.trim()) return toast.error('驳回时请填写审批意见');
    if (actionModal.action === 'close' && !resolution.trim()) return toast.error('请填写解决方案');
    setActing(true);
    try {
      if (actionModal.action === 'close') {
        await api.post(`/api/tickets/${id}/close`, { resolution, comment: actionComment });
        toast.success('工单已关闭');
      } else {
        await api.post(`/api/tickets/${id}/advance`, { action: actionModal.action, comment: actionComment });
        toast.success(
          actionModal.action === 'approve' ? '审批已通过' : actionModal.action === 'reject' ? '工单已驳回' : actionModal.action === 'complete' ? '工单已完成并关闭' : '工单已推进到下一阶段',
        );
      }
      setActionModal(null);
      await load();
    } catch (error: any) {
      toast.error(error.message);
    } finally {
      setActing(false);
    }
  };

  const reopen = async () => {
    setActing(true);
    try {
      await api.post(`/api/tickets/${id}/reopen`, { comment: '重新打开工单' });
      toast.success('工单已重新打开');
      await load();
    } catch (error: any) {
      toast.error(error.message);
    } finally {
      setActing(false);
    }
  };

  const requestDeletion = async () => {
    if (deleteReason.trim().length < 4) return toast.error('请填写至少 4 个字的删除原因');
    setRequestingDelete(true);
    try {
      await api.post(`/api/tickets/${id}/deletion-request`, { reason: deleteReason.trim() });
      toast.success('删除申请已提交，等待审批');
      setDeletionOpen(false);
      setDeleteReason('');
      await load();
    } catch (error: any) {
      toast.error(error.message);
    } finally {
      setRequestingDelete(false);
    }
  };

  const confirmDirectDelete = async () => {
    setDeletingTicket(true);
    try {
      await api.delete(`/api/tickets/${id}`);
      toast.success(`工单 ${ticket?.ticket_no} 已由超级管理员删除`);
      navigate(`/tickets/${type || ticket?.type || 'incident'}`);
    } catch (error: any) {
      toast.error(error.message);
    } finally {
      setDeletingTicket(false);
    }
  };

  const submitComment = async () => {
    if (!commentBody.trim()) return;
    setPosting(true);
    try {
      const response = await api.post<{ data: Ticket }>(`/api/tickets/${id}/comments`, { body: commentBody, is_internal: internal });
      setTicket(response.data);
      setCommentBody('');
      if (editorRef.current) editorRef.current.innerHTML = '';
      toast.success('评论已发布');
    } catch (error: any) {
      toast.error(error.message);
    } finally {
      setPosting(false);
    }
  };

  const openEdit = () => {
    if (!ticket) return;
    setEditForm({
      title: ticket.title,
      description: ticket.description || '',
      priority: ticket.priority,
      impact: ticket.impact,
      urgency: ticket.urgency,
      category: ticket.category || '',
      assignee_id: ticket.assignee_id || '',
      resolution: ticket.resolution || '',
      root_cause: ticket.root_cause || '',
      workaround: ticket.workaround || '',
      risk: ticket.risk || 'medium',
      change_type: ticket.change_type || 'normal',
      planned_start: toLocalInput(ticket.planned_start),
      planned_end: toLocalInput(ticket.planned_end),
      implementation_plan: ticket.implementation_plan || '',
      rollback_plan: ticket.rollback_plan || '',
      test_plan: ticket.test_plan || '',
      cab_date: ticket.cab_date ? String(ticket.cab_date).slice(0, 10) : '',
      outage_required: Boolean(ticket.outage_required),
    });
    setEditOpen(true);
  };

  const saveEdit = async () => {
    if (!editForm.title?.trim()) return toast.error('标题不能为空');
    setSavingEdit(true);
    try {
      const response = await api.put<{ data: Ticket }>(`/api/tickets/${id}`, {
        ...editForm,
        assignee_id: editForm.assignee_id ? Number(editForm.assignee_id) : null,
      });
      setTicket(response.data);
      setEditOpen(false);
      toast.success('工单已更新');
    } catch (error: any) {
      toast.error(error.message);
    } finally {
      setSavingEdit(false);
    }
  };

  const addCis = async () => {
    if (!ciSelection.length) return;
    setAddingCi(true);
    try {
      for (const ci of ciSelection) {
        await api.post(`/api/tickets/${id}/cis`, { ci_id: ci.id });
      }
      toast.success('关联 CI 已添加');
      setCiOpen(false);
      setCiSelection([]);
      await load();
    } catch (error: any) {
      toast.error(error.message);
    } finally {
      setAddingCi(false);
    }
  };

  const removeCi = async (ciId: number) => {
    try {
      await api.delete(`/api/tickets/${id}/cis/${ciId}`);
      toast.success('已移除关联 CI');
      await load();
    } catch (error: any) {
      toast.error(error.message);
    }
  };

  const addRelation = async () => {
    if (!linkedTicketId) return toast.error('请选择要关联的工单');
    setLinking(true);
    try {
      await api.post(`/api/tickets/${id}/relations`, { linked_ticket_id: Number(linkedTicketId), relation_type: relationType });
      toast.success('工单关联已建立');
      setLinkOpen(false);
      setLinkedTicketId('');
      setLinkQuery('');
      await load();
    } catch (error: any) {
      toast.error(error.message);
    } finally {
      setLinking(false);
    }
  };

  if (loading || !ticket) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-7 w-40" />
        <div className="card p-6"><Skeleton className="h-32 w-full" /></div>
        <div className="grid gap-4 xl:grid-cols-3"><div className="card h-80 xl:col-span-2" /><div className="card h-80" /></div>
      </div>
    );
  }

  return (
    <div className="animate-enter">
      <button onClick={() => navigate(`/tickets/${ticket.type}`)} className="mb-3 flex items-center gap-1.5 text-[11.5px] font-medium text-slate-500 hover:text-slate-800">
        <ArrowLeft className="h-3.5 w-3.5" /> 返回{typeMeta.label}列表
      </button>

      <div className="card overflow-hidden">
        <div className={cn('h-1 bg-gradient-to-r', ticket.type === 'incident' ? 'from-sky-500 to-cyan-400' : ticket.type === 'problem' ? 'from-violet-500 to-purple-400' : 'from-amber-500 to-orange-400')} />
        <div className="flex flex-col gap-4 p-5 sm:p-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="flex min-w-0 items-start gap-3.5">
              <span className={cn('flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-white shadow-sm', typeMeta.soft)}>
                <TypeIcon className="h-5 w-5" />
              </span>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-[11px] font-medium text-slate-400">{ticket.ticket_no}</span>
                  <span className="h-3 w-px bg-slate-200" />
                  <Badge className={typeMeta.className}>{typeMeta.label}</Badge>
                  <Badge className={statusMeta.className} dot={statusMeta.dot}>{statusMeta.label}</Badge>
                  <Badge className={priorityMeta.className} dot={priorityMeta.dot}>{priorityMeta.label}优先级</Badge>
                  {overdue ? <Badge className="bg-rose-50 text-rose-700 ring-rose-600/15" icon={AlertCircle}>SLA 超时</Badge> : null}
                </div>
                <h1 className="mt-2 max-w-4xl text-[20px] font-semibold leading-snug tracking-[-0.02em] text-slate-900">{ticket.title}</h1>
                <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[10.5px] text-slate-400">
                  <span className="flex items-center gap-1.5"><Avatar name={ticket.requester_name} size="xs" color={ticket.requester_color || '#4f6ef7'} />{ticket.requester_name} 发起</span>
                  <span className="flex items-center gap-1"><Clock3 className="h-3 w-3" />{formatDate(ticket.created_at)}</span>
                  <span className="flex items-center gap-1"><GitPullRequest className="h-3 w-3" />{ticket.workflow_name}</span>
                  <span>来源：{SOURCE_LABELS[ticket.source] || ticket.source}</span>
                </div>
              </div>
            </div>
            <div className="flex shrink-0 flex-wrap items-center gap-2">
              {canEdit ? <Button variant="secondary" size="sm" icon={Edit3} onClick={openEdit}>编辑</Button> : null}
              {pendingDeletion ? <Badge className="bg-amber-50 text-amber-700 ring-amber-600/20" icon={FileX2}>删除审批中</Badge> : null}
              {canRequestDeletion ? <Button variant="secondary" size="sm" icon={FileX2} onClick={() => setDeletionOpen(true)}>申请删除</Button> : null}
              {canDirectDelete ? <IconButton icon={Trash2} label="超级管理员删除工单" variant="danger" onClick={() => setDirectDeleteOpen(true)} /> : null}
              {canApprove ? (
                <>
                  <Button variant="secondary" size="sm" icon={ThumbsDown} onClick={() => openAction('reject')} className="text-rose-600 hover:bg-rose-50">驳回</Button>
                  <Button size="sm" icon={ThumbsUp} onClick={() => openAction('approve')}>审批通过</Button>
                </>
              ) : null}
              {activeWork && currentStage?.stage_type === 'end' ? (
                <Button size="sm" icon={CheckCircle2} onClick={() => openAction('complete')}>完成并关闭</Button>
              ) : null}
              {activeWork && currentStage?.stage_type !== 'end' && currentStage?.stage_type !== 'approval' ? (
                <Button size="sm" icon={ArrowRight} onClick={() => openAction('advance')}>推进流程</Button>
              ) : null}
              {canEdit && ticket.status === 'resolved' ? (
                <Button size="sm" icon={CheckCircle2} onClick={() => openAction('close')}>关闭工单</Button>
              ) : null}
              {closed && permissions.can_edit ? <Button variant="secondary" size="sm" icon={RotateCcw} onClick={reopen} loading={acting}>重新打开</Button> : null}
            </div>
          </div>

          <div className="overflow-x-auto rounded-xl border border-slate-100 bg-slate-50/60 px-3 py-3">
            <div className="flex min-w-[620px] items-center">
              {stages.map((stage, index) => {
                const complete = index < currentIndex;
                const current = index === currentIndex;
                const StageIcon = STAGE_ICONS[stage.stage_type] || Circle;
                return (
                  <div key={stage.id} className={cn('flex items-center', index < stages.length - 1 ? 'flex-1' : '')}>
                    <div className="flex items-center gap-2.5">
                      <span
                        className={cn(
                          'flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-[10px] font-semibold transition',
                          complete ? 'border-emerald-500 bg-emerald-500 text-white' : current ? 'border-brand-500 bg-white text-brand-600 ring-4 ring-brand-100' : 'border-slate-200 bg-white text-slate-300',
                        )}
                        style={current ? { borderColor: stage.color, color: stage.color, boxShadow: `0 0 0 4px ${stage.color}18` } : undefined}
                      >
                        {complete ? <Check className="h-3.5 w-3.5" /> : <StageIcon className="h-3.5 w-3.5" />}
                      </span>
                      <div className="min-w-0">
                        <p className={cn('whitespace-nowrap text-[10.5px] font-medium', current ? 'text-slate-800' : complete ? 'text-slate-500' : 'text-slate-400')}>{stage.name}</p>
                        <p className="mt-0.5 whitespace-nowrap text-[8.5px] text-slate-400">{stage.stage_type === 'approval' ? '审批节点' : stage.stage_type === 'end' ? '结束节点' : `${stage.sla_hours}h SLA`}</p>
                      </div>
                    </div>
                    {index < stages.length - 1 ? (
                      <span className={cn('mx-3 h-px flex-1 transition', index < currentIndex ? 'bg-emerald-300' : 'bg-slate-200')} />
                    ) : null}
                  </div>
                );
              })}
            </div>
          </div>

          <div className={cn('flex flex-col gap-3 rounded-xl border p-3.5 sm:flex-row sm:items-center sm:justify-between', isApproval ? 'border-amber-200 bg-amber-50/60' : 'border-slate-100 bg-slate-50/60')}>
            <div className="flex items-start gap-2.5">
              <span className={cn('flex h-8 w-8 shrink-0 items-center justify-center rounded-lg', isApproval ? 'bg-amber-100 text-amber-700' : 'bg-white text-slate-500 shadow-sm')}>
                {isApproval ? <ShieldCheck className="h-4 w-4" /> : <Clock3 className="h-4 w-4" />}
              </span>
              <div>
                <p className="text-[11.5px] font-semibold text-slate-800">
                  {closed ? '工单已结束' : isApproval ? '等待审批' : currentStage?.stage_type === 'end' ? '待完成与归档' : '当前阶段：' + (currentStage?.name || '—')}
                </p>
                <p className="mt-0.5 text-[10px] leading-relaxed text-slate-500">
                  {isApproval ? `${currentStage.approver_role_name || '指定审批角色'} 可处理此节点 · ${currentStage.description}` : currentStage?.description || '按流程推进工单处理。'}
                </p>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-4 text-[10px] text-slate-500">
              <div>
                <p className="text-[8.5px] uppercase tracking-wider text-slate-400">当前阶段 SLA</p>
                <p className={cn('mt-0.5 font-medium', overdue ? 'text-rose-600' : 'text-slate-700')}>{ticket.sla_due_at ? formatDate(ticket.sla_due_at) : '未设置'}</p>
              </div>
              <div>
                <p className="text-[8.5px] uppercase tracking-wider text-slate-400">处理人</p>
                <p className="mt-0.5 font-medium text-slate-700">{ticket.assignee_name || '未分配'}</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="mt-3.5 grid grid-cols-1 gap-3.5 xl:grid-cols-12">
        <div className="space-y-3.5 xl:col-span-8">
          <div className="card">
            <SectionHeading title="工单描述" description="问题现象与上下文信息" />
            <div className="p-5 text-[12.5px] leading-7 text-slate-600">
              <RichTextContent html={ticket.description} />
              {!ticket.description ? '暂无详细描述。' : null}
            </div>
          </div>

          {ticket.type === 'problem' ? (
            <div className="grid grid-cols-1 gap-3.5 md:grid-cols-2">
              <div className="card">
                <SectionHeading title="根因分析" />
                <p className="min-h-[80px] whitespace-pre-wrap p-5 text-[12px] leading-6 text-slate-600">{ticket.root_cause || '尚未记录根因。'}</p>
              </div>
              <div className="card">
                <SectionHeading title="临时规避方案" />
                <p className="min-h-[80px] whitespace-pre-wrap p-5 text-[12px] leading-6 text-slate-600">{ticket.workaround || '尚未记录规避方案。'}</p>
              </div>
            </div>
          ) : null}

          {ticket.type === 'change' ? (
            <div className="card overflow-hidden">
              <SectionHeading title="变更方案与风险" description="用于 CAB 审批与实施控制" action={<span className={cn('rounded-md px-1.5 py-0.5 text-[9.5px] font-medium', ticket.risk === 'high' ? 'bg-rose-50 text-rose-700' : ticket.risk === 'medium' ? 'bg-amber-50 text-amber-700' : 'bg-emerald-50 text-emerald-700')}>{ticket.risk === 'high' ? '高风险' : ticket.risk === 'medium' ? '中风险' : '低风险'}</span>} />
              <div className="p-5">
                <InfoGrid
                  columns={3}
                  items={[
                    { label: '变更类型', value: ticket.change_type === 'emergency' ? '紧急变更' : ticket.change_type === 'standard' ? '标准变更' : '常规变更' },
                    { label: '计划开始', value: formatDate(ticket.planned_start) },
                    { label: '计划结束', value: formatDate(ticket.planned_end) },
                    { label: 'CAB 评审', value: formatDate(ticket.cab_date, 'YYYY/MM/DD') },
                    { label: '业务中断', value: ticket.outage_required ? '需要停机窗口' : '无损变更' },
                    { label: '关联 CI', value: `${ticket.cis?.length || 0} 个配置项` },
                  ]}
                />
                <div className="mt-5 grid grid-cols-1 gap-3 md:grid-cols-3">
                  <PlanBox title="实施方案" content={ticket.implementation_plan} />
                  <PlanBox title="回退方案" content={ticket.rollback_plan} tone="rose" />
                  <PlanBox title="验证方案" content={ticket.test_plan} tone="emerald" />
                </div>
              </div>
            </div>
          ) : null}

          {ticket.type === 'incident' && ticket.resolution ? (
            <div className="card">
              <SectionHeading title="解决方案" action={<Badge className="bg-emerald-50 text-emerald-700 ring-emerald-600/15" icon={CheckCircle2}>已解决</Badge>} />
              <p className="whitespace-pre-wrap p-5 text-[12px] leading-6 text-slate-600">{ticket.resolution}</p>
            </div>
          ) : null}

          <div className="card overflow-hidden">
            <SectionHeading
              title="关联配置项"
              description="该工单影响的 CMDB 资产与业务关系"
              action={canEdit ? <Button variant="ghost" size="xs" icon={Plus} onClick={() => setCiOpen(true)}>关联 CI</Button> : null}
            />
            {ticket.cis?.length ? (
              <div className="table-wrap">
                <table className="data-table">
                  <thead><tr><th>资产</th><th>类型</th><th>状态</th><th>位置 / IP</th><th></th></tr></thead>
                  <tbody>
                    {ticket.cis.map((ci) => (
                      <tr key={ci.id} className="group">
                        <td>
                          <Link to={`/cmdb/${ci.id}`} className="flex items-center gap-2.5">
                            <span className="flex h-7 w-7 items-center justify-center rounded-lg text-white" style={{ background: ci.type_color || '#4f6ef7' }}><Server className="h-3.5 w-3.5" /></span>
                            <span>
                              <span className="block text-[11.5px] font-medium text-slate-700">{ci.name}</span>
                              <span className="block font-mono text-[9px] text-slate-400">{ci.asset_no}</span>
                            </span>
                          </Link>
                        </td>
                        <td className="text-[10.5px] text-slate-500">{ci.type_name}</td>
                        <td><Badge className="bg-emerald-50 text-emerald-700 ring-emerald-600/15">使用中</Badge></td>
                        <td><p className="text-[10px] text-slate-500">{ci.location || '—'}</p><p className="font-mono text-[9px] text-slate-400">{ci.ip_address || '无 IP'}</p></td>
                        <td>
                          <div className="flex items-center justify-end gap-1 opacity-0 transition group-hover:opacity-100">
                            <Link to={`/cmdb/${ci.id}`}><IconButton icon={ExternalLink} label="查看 CI" /></Link>
                            {canEdit ? <IconButton icon={X} label="移除关联" variant="danger" onClick={() => removeCi(ci.id)} /> : null}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <EmptyState title="尚未关联配置项" description="关联 CI 可以快速定位影响范围并支撑变更审批。" icon={Server} className="py-9" action={canEdit ? <Button variant="secondary" size="sm" icon={Plus} onClick={() => setCiOpen(true)}>关联 CI</Button> : undefined} />
            )}
          </div>

          <div className="card overflow-hidden">
            <div className="flex items-center justify-between border-b border-[#eef1f6] px-5 py-2">
              <Tabs<'comments' | 'history'>
                items={[
                  { value: 'comments', label: `沟通记录 ${ticket.comments?.length || 0}` },
                  { value: 'history', label: `流转记录 ${ticket.history?.length || 0}` },
                ]}
                value={tab}
                onChange={setTab}
                className="border-b-0"
              />
            </div>

            {tab === 'comments' ? (
              <div>
                <div className="divide-y divide-slate-100 px-5">
                  {ticket.comments?.length ? (
                    ticket.comments.map((comment) => <CommentRow key={comment.id} comment={comment} />)
                  ) : (
                    <p className="py-10 text-center text-[11px] text-slate-400">还没有沟通记录，添加第一条评论吧。</p>
                  )}
                </div>
                <div className="border-t border-slate-100 bg-slate-50/40 p-4">
                  <div className="flex items-start gap-2.5">
                    <Avatar name={user?.name} src={user?.avatar_url} color={user?.avatar_color} size="sm" />
                    <div className="min-w-0 flex-1">
                      <div className="rounded-xl border border-slate-200 bg-white">
                        <div className="flex flex-wrap items-center gap-0.5 border-b border-slate-100 px-2 py-1">
                          {[
                            ['bold', 'B', 'font-bold'],
                            ['italic', 'I', 'italic'],
                            ['underline', 'U', 'underline'],
                            ['insertUnorderedList', '•', ''],
                            ['insertOrderedList', '1.', ''],
                          ].map(([command, label, className]) => (
                            <button key={command} onMouseDown={(event) => { event.preventDefault(); document.execCommand(command); }} className={`h-6 min-w-6 rounded px-1 text-[11px] text-slate-500 hover:bg-slate-100 ${className}`} aria-label={command}>{label}</button>
                          ))}
                          <label className="ml-1 flex h-6 cursor-pointer items-center gap-1 rounded px-1.5 text-[9.5px] text-slate-500 hover:bg-slate-100"><Paperclip className="h-3 w-3" />附件<input type="file" className="hidden" onChange={(event) => uploadAttachment(event.target.files?.[0])} /></label>
                          {uploading ? <span className="text-[9px] text-slate-400">上传中…</span> : null}
                        </div>
                        <div
                          ref={editorRef}
                          contentEditable
                          suppressContentEditableWarning
                          className="min-h-[80px] px-3 py-2.5 text-[11.5px] leading-6 text-slate-700 outline-none empty:before:content-[attr(data-placeholder)] empty:before:text-slate-400"
                          data-placeholder="回复工单、补充排查信息或同步处理进展…"
                          onInput={(event) => setCommentBody(event.currentTarget.innerHTML)}
                        />
                      </div>
                      <div className="mt-2 flex items-center justify-between gap-2">
                        <div>
                          {canEdit ? (
                            <label className="flex cursor-pointer items-center gap-1.5 text-[10px] text-slate-500">
                              <input type="checkbox" checked={internal} onChange={(event) => setInternal(event.target.checked)} className="accent-brand-600" />
                              <LockKeyhole className="h-3 w-3 text-slate-400" /> 仅内部可见
                            </label>
                          ) : null}
                        </div>
                        <Button size="sm" icon={Send} loading={posting} onClick={submitComment} disabled={!commentBody.trim()}>发送评论</Button>
                      </div>
                    </div>
                  </div>
                </div>
                {ticket.attachments?.length ? (
                  <div className="border-t border-slate-100 px-5 py-3">
                    <p className="mb-2 flex items-center gap-1.5 text-[10px] font-medium text-slate-500"><Paperclip className="h-3 w-3" /> 附件（{ticket.attachments.length}）</p>
                    <div className="grid gap-1.5 sm:grid-cols-2">
                      {ticket.attachments.map((attachment) => (
                        <div key={attachment.id} className="flex items-center gap-2 rounded-lg border border-slate-200 px-2.5 py-2">
                          {attachment.mime_type?.startsWith('image/') ? <ImageIcon className="h-3.5 w-3.5 text-sky-500" /> : <Paperclip className="h-3.5 w-3.5 text-slate-400" />}
                          <button onClick={() => openAttachmentPreview(attachment)} className="min-w-0 flex-1 text-left"><span className="block truncate text-[10.5px] font-medium text-slate-600">{attachment.filename}</span><span className="block text-[8.5px] text-slate-400">{attachment.uploader_name || '—'} · {(attachment.size / 1024 / 1024).toFixed(1)}MB</span></button>
                          <button onClick={() => downloadAttachment(attachment)} className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600" aria-label="下载附件"><Download className="h-3.5 w-3.5" /></button>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>
            ) : (
              <div className="px-5 py-4">
                <div className="relative space-y-1 before:absolute before:bottom-2 before:left-[15px] before:top-2 before:w-px before:bg-slate-100">
                  {ticket.history?.map((item: TicketHistory) => {
                    const Icon = ACTION_ICONS[item.action] || History;
                    return (
                      <div key={item.id} className="relative flex gap-3 py-2">
                        <span className="relative z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500">
                          <Icon className="h-3.5 w-3.5" />
                        </span>
                        <div className="min-w-0 flex-1 pt-0.5">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <p className="text-[11.5px] font-medium text-slate-700">{item.actor_name || '系统'} {ACTION_LABELS[item.action] || item.action}</p>
                            {item.stage_name ? <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[8.5px] text-slate-500">{item.stage_name}</span> : null}
                          </div>
                          {item.comment ? <p className="mt-1 whitespace-pre-wrap text-[10.5px] leading-relaxed text-slate-500">{item.comment}</p> : null}
                          <p className="mt-1 text-[9px] text-slate-400">{formatDate(item.created_at, 'YYYY/MM/DD HH:mm:ss')} · {relativeTime(item.created_at)}</p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="space-y-3.5 xl:col-span-4">
          <div className="card overflow-hidden">
            <SectionHeading title="工单信息" />
            <div className="p-5">
              <dl className="space-y-3">
                <SideLine label="工单编号" value={<span className="font-mono text-[11px]">{ticket.ticket_no}</span>} />
                <SideLine label="工单类型" value={typeMeta.label} />
                <SideLine label="当前状态" value={<Badge className={statusMeta.className} dot={statusMeta.dot}>{statusMeta.label}</Badge>} />
                <SideLine label="优先级" value={<Badge className={priorityMeta.className} dot={priorityMeta.dot}>{priorityMeta.label}</Badge>} />
                <SideLine label="影响范围" value={ticket.impact === 'high' ? '高' : ticket.impact === 'medium' ? '中' : '低'} />
                <SideLine label="紧急程度" value={ticket.urgency === 'critical' ? '紧急' : ticket.urgency === 'high' ? '高' : ticket.urgency === 'medium' ? '中' : '低'} />
                <SideLine label="分类" value={ticket.category || '未分类'} />
                <SideLine label="处理流程" value={ticket.workflow_name || '—'} />
                <SideLine label="来源" value={SOURCE_LABELS[ticket.source] || ticket.source} />
                <SideLine label="创建时间" value={formatDate(ticket.created_at)} />
                <SideLine label="最近更新" value={formatDate(ticket.updated_at)} />
              </dl>
            </div>
          </div>

          <div className="card overflow-hidden">
            <SectionHeading title="相关成员" />
            <div className="space-y-3 p-5">
              <MemberRow label="请求人" name={ticket.requester_name} department={ticket.requester_department} color={ticket.requester_color} avatarUrl={ticket.requester_avatar_url} />
              <MemberRow label="负责人" name={ticket.assignee_name || '未分配'} department={ticket.assignee_name ? '指派的处理人' : '等待分派'} color={ticket.assignee_color || '#94a3b8'} avatarUrl={ticket.assignee_avatar_url} />
            </div>
          </div>

          <div className="card overflow-hidden">
            <SectionHeading title="SLA 与时间" action={overdue ? <Badge className="bg-rose-50 text-rose-700 ring-rose-600/15">已超时</Badge> : <Badge className="bg-emerald-50 text-emerald-700 ring-emerald-600/15">进行中</Badge>} />
            <div className="p-5">
              <div className="flex items-center gap-3">
                <span className={cn('flex h-9 w-9 items-center justify-center rounded-xl', overdue ? 'bg-rose-50 text-rose-600' : 'bg-brand-50 text-brand-600')}><Timer className="h-4 w-4" /></span>
                <div>
                  <p className="text-[9.5px] text-slate-400">当前阶段截止</p>
                  <p className={cn('text-[12px] font-semibold', overdue ? 'text-rose-600' : 'text-slate-700')}>{formatDate(ticket.sla_due_at)}</p>
                </div>
              </div>
              <div className="mt-3 space-y-2 border-t border-slate-100 pt-3">
                <SideLine label="解决时间" value={formatDate(ticket.resolved_at)} />
                <SideLine label="关闭时间" value={formatDate(ticket.closed_at)} />
              </div>
            </div>
          </div>

          {ticket.deletion_request ? (
            <div className="card overflow-hidden">
              <SectionHeading
                title="删除申请"
                action={
                  <Badge className={
                    ticket.deletion_request.status === 'pending'
                      ? 'bg-amber-50 text-amber-700 ring-amber-600/20'
                      : ticket.deletion_request.status === 'approved'
                        ? 'bg-emerald-50 text-emerald-700 ring-emerald-600/15'
                        : 'bg-rose-50 text-rose-700 ring-rose-600/15'
                  }>
                    {ticket.deletion_request.status === 'pending' ? '待审批' : ticket.deletion_request.status === 'approved' ? '已通过' : '已驳回'}
                  </Badge>
                }
              />
              <div className="space-y-2 p-5 text-[11px]">
                <p className="text-[9px] text-slate-400">申请原因</p>
                <p className="leading-relaxed text-slate-600">{ticket.deletion_request.reason}</p>
                <div className="mt-3 border-t border-slate-100 pt-2 text-[9.5px] text-slate-400">
                  {ticket.deletion_request.requester_name || '—'} 申请 · {formatDate(ticket.deletion_request.created_at)}
                  {ticket.deletion_request.reviewed_at ? <span className="ml-1">· {ticket.deletion_request.reviewer_name || '—'} 审核于 {formatDate(ticket.deletion_request.reviewed_at)}</span> : null}
                </div>
                {ticket.deletion_request.review_comment ? <p className="rounded-lg bg-slate-50 px-2.5 py-2 text-[10px] text-slate-500">审批意见：{ticket.deletion_request.review_comment}</p> : null}
              </div>
            </div>
          ) : null}

          {ticket.resolution ? (
            <div className="card overflow-hidden">
              <SectionHeading title="解决方案" />
              <p className="whitespace-pre-wrap p-5 text-[11px] leading-6 text-slate-600">{ticket.resolution}</p>
            </div>
          ) : null}

          <div className="card overflow-hidden">
            <SectionHeading title="关联工单" description={`${relationRows.length} 条关系`} action={canEdit ? <Button variant="ghost" size="xs" icon={Link2} onClick={() => setLinkOpen(true)}>关联</Button> : null} />
            {relationRows.length ? (
              <div className="divide-y divide-slate-100">
                {relationRows.map((relation: any) => {
                  const incoming = !ticket.relations?.some((item: any) => item.id === relation.id);
                  const relatedId = incoming ? relation.ticket_id : relation.linked_ticket_id;
                  return (
                    <Link key={`${incoming ? 'in' : 'out'}-${relation.id}`} to={`/tickets/${relation.linked_type}/${relatedId}`} className="flex items-center gap-2.5 px-5 py-2.5 transition hover:bg-slate-50">
                      <span className={cn('rounded px-1.5 py-0.5 text-[8.5px]', incoming ? 'bg-violet-50 text-violet-600' : 'bg-slate-100 text-slate-500')}>{RELATION_LABELS[relation.relation_type] || relation.relation_type}</span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[10.5px] text-slate-600">{relation.linked_title}</p>
                        <p className="font-mono text-[8.5px] text-slate-400">{relation.linked_ticket_no}</p>
                      </div>
                      <ArrowRight className="h-3 w-3 text-slate-300" />
                    </Link>
                  );
                })}
              </div>
            ) : (
              <p className="px-5 py-5 text-[10.5px] text-slate-400">暂无关联工单。</p>
            )}
          </div>

          <div className="rounded-xl border border-dashed border-brand-200 bg-brand-50/40 p-3.5">
            <div className="flex items-start gap-2">
              <Sparkles className="mt-0.5 h-3.5 w-3.5 text-brand-500" />
              <p className="text-[9.5px] leading-relaxed text-brand-800/80">
                工单全过程记录在审计日志中。变更必须关联 CI，审批通过后方可实施；实施完成后更新 CMDB。
              </p>
            </div>
          </div>
        </div>
      </div>

      <Modal
        open={Boolean(actionModal)}
        onClose={() => setActionModal(null)}
        title={
          actionModal?.action === 'approve' ? '审批通过' :
          actionModal?.action === 'reject' ? '驳回审批' :
          actionModal?.action === 'complete' ? '完成并关闭' :
          actionModal?.action === 'close' ? '关闭工单' : '推进流程'
        }
        description={
          actionModal?.action === 'approve' ? '审批通过后，工单将进入下一流程阶段。' :
          actionModal?.action === 'reject' ? '驳回将取消该工单，请说明具体原因。' :
          actionModal?.action === 'complete' ? '确认处理完成并归档，关闭后将无法继续流转。' :
          actionModal?.action === 'close' ? '填写解决方案并关闭工单。' : `将工单从「${currentStage?.name || ''}」推进到下一阶段。`
        }
        icon={actionModal?.action === 'approve' ? ThumbsUp : actionModal?.action === 'reject' ? ThumbsDown : actionModal?.action === 'close' || actionModal?.action === 'complete' ? CheckCircle2 : ArrowRight}
        size="md"
        footer={
          <>
            <Button variant="secondary" size="sm" onClick={() => setActionModal(null)}>取消</Button>
            <Button
              size="sm"
              variant={actionModal?.action === 'reject' ? 'danger' : 'primary'}
              loading={acting}
              onClick={submitAction}
            >
              {actionModal?.action === 'approve' ? '确认通过' : actionModal?.action === 'reject' ? '确认驳回' : actionModal?.action === 'complete' ? '完成并关闭' : actionModal?.action === 'close' ? '关闭工单' : '推进流程'}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          {actionModal?.action === 'close' ? (
            <Field label="解决方案" required>
              <textarea className="input-base min-h-[100px]" value={resolution} onChange={(event) => setResolution(event.target.value)} placeholder="描述根因、处理动作与验证结果…" />
            </Field>
          ) : null}
          <Field label={actionModal?.action === 'reject' ? '驳回原因' : '处理说明'} required={actionModal?.action === 'reject'}>
            <textarea className="input-base min-h-[90px]" value={actionComment} onChange={(event) => setActionComment(event.target.value)} placeholder={actionModal?.action === 'reject' ? '请填写驳回原因与改进建议…' : '可选：填写处理过程、审批意见或验证结果…'} />
          </Field>
        </div>
      </Modal>

      <Modal
        open={editOpen}
        onClose={() => setEditOpen(false)}
        title="编辑工单"
        description="更新工单内容、分派与类型专属信息。"
        icon={Edit3}
        size="lg"
        footer={
          <>
            <Button variant="secondary" size="sm" onClick={() => setEditOpen(false)}>取消</Button>
            <Button size="sm" loading={savingEdit} onClick={saveEdit}>保存修改</Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label="标题" required><Input value={editForm.title || ''} onChange={(event) => setEditForm((current) => ({ ...current, title: event.target.value }))} /></Field>
          <Field label="描述"><RichTextEditor value={editForm.description || ''} onChange={(description) => setEditForm((current) => ({ ...current, description }))} minHeight={92} /></Field>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="优先级">
              <select className="input-base" value={editForm.priority} onChange={(event) => setEditForm((current) => ({ ...current, priority: event.target.value }))}>
                {Object.entries(PRIORITY_META).map(([value, item]) => <option key={value} value={value}>{item.label}</option>)}
              </select>
            </Field>
            <Field label="影响范围">
              <select className="input-base" value={editForm.impact} onChange={(event) => setEditForm((current) => ({ ...current, impact: event.target.value }))}>
                <option value="high">高</option><option value="medium">中</option><option value="low">低</option>
              </select>
            </Field>
            <Field label="紧急程度">
              <select className="input-base" value={editForm.urgency} onChange={(event) => setEditForm((current) => ({ ...current, urgency: event.target.value }))}>
                <option value="critical">紧急</option><option value="high">高</option><option value="medium">中</option><option value="low">低</option>
              </select>
            </Field>
            <Field label="负责人">
              <select className="input-base" value={editForm.assignee_id} onChange={(event) => setEditForm((current) => ({ ...current, assignee_id: event.target.value }))}>
                <option value="">未分配</option>
                {users.filter((item) => item.status === 'active' && !['admin', 'auditor'].includes(String((item as any).role_code || ''))).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
              </select>
            </Field>
          </div>
          <Field label="分类"><Input value={editForm.category || ''} onChange={(event) => setEditForm((current) => ({ ...current, category: event.target.value }))} /></Field>
          <Field label="解决方案"><RichTextEditor value={editForm.resolution || ''} onChange={(resolution) => setEditForm((current) => ({ ...current, resolution }))} minHeight={80} /></Field>
          {ticket.type === 'problem' ? (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="根因分析"><RichTextEditor value={editForm.root_cause || ''} onChange={(root_cause) => setEditForm((current) => ({ ...current, root_cause }))} minHeight={80} /></Field>
              <Field label="临时规避方案"><RichTextEditor value={editForm.workaround || ''} onChange={(workaround) => setEditForm((current) => ({ ...current, workaround }))} minHeight={80} /></Field>
            </div>
          ) : null}
          {ticket.type === 'change' ? (
            <div className="space-y-3 rounded-xl border border-amber-100 bg-amber-50/40 p-3.5">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <Field label="变更类型"><select className="input-base" value={editForm.change_type} onChange={(event) => setEditForm((current) => ({ ...current, change_type: event.target.value }))}><option value="standard">标准变更</option><option value="normal">常规变更</option><option value="emergency">紧急变更</option></select></Field>
                <Field label="风险等级"><select className="input-base" value={editForm.risk} onChange={(event) => setEditForm((current) => ({ ...current, risk: event.target.value }))}><option value="high">高</option><option value="medium">中</option><option value="low">低</option></select></Field>
                <Field label="CAB 评审"><DateInput value={editForm.cab_date || ''} onChange={(value) => setEditForm((current) => ({ ...current, cab_date: value }))} /></Field>
                <Field label="计划开始"><DateTextInput withTime value={editForm.planned_start || ''} onChange={(planned_start) => setEditForm((current) => ({ ...current, planned_start }))} /></Field>
                <Field label="计划结束"><DateTextInput withTime value={editForm.planned_end || ''} onChange={(planned_end) => setEditForm((current) => ({ ...current, planned_end }))} /></Field>
                <Field label="业务中断"><select className="input-base" value={editForm.outage_required ? 'yes' : 'no'} onChange={(event) => setEditForm((current) => ({ ...current, outage_required: event.target.value === 'yes' }))}><option value="no">否</option><option value="yes">是</option></select></Field>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <Field label="实施方案"><RichTextEditor value={editForm.implementation_plan || ''} onChange={(implementation_plan) => setEditForm((current) => ({ ...current, implementation_plan }))} minHeight={76} /></Field>
                <Field label="回退方案"><RichTextEditor value={editForm.rollback_plan || ''} onChange={(rollback_plan) => setEditForm((current) => ({ ...current, rollback_plan }))} minHeight={76} /></Field>
                <Field label="验证方案"><RichTextEditor value={editForm.test_plan || ''} onChange={(test_plan) => setEditForm((current) => ({ ...current, test_plan }))} minHeight={76} /></Field>
              </div>
            </div>
          ) : null}
        </div>
      </Modal>

      <Modal
        open={ciOpen}
        onClose={() => setCiOpen(false)}
        title="关联配置项"
        description="选择受影响的 CMDB 配置项，建立工单影响链。"
        icon={Server}
        size="md"
        footer={
          <>
            <Button variant="secondary" size="sm" onClick={() => setCiOpen(false)}>取消</Button>
            <Button size="sm" loading={addingCi} onClick={addCis} disabled={!ciSelection.length}>添加关联</Button>
          </>
        }
      >
        <CIPicker value={ciSelection} onChange={setCiSelection} />
      </Modal>

      <Modal
        open={linkOpen}
        onClose={() => setLinkOpen(false)}
        title="关联工单"
        description="将相关事件、问题或变更进行关联，便于追踪影响链。"
        icon={Link2}
        size="md"
        footer={
          <>
            <Button variant="secondary" size="sm" onClick={() => setLinkOpen(false)}>取消</Button>
            <Button size="sm" loading={linking} onClick={addRelation}>建立关联</Button>
          </>
        }
      >
        <div className="space-y-3">
          <Field label="关系类型">
            <select className="input-base" value={relationType} onChange={(event) => setRelationType(event.target.value)}>
              <option value="related">相关</option>
              <option value="caused_by">由…引起</option>
              <option value="duplicate">重复于</option>
              <option value="blocks">阻塞</option>
            </select>
          </Field>
          <Field label="选择工单" hint="输入标题或编号搜索">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
              <input className="input-base pl-9" value={linkQuery} onChange={(event) => setLinkQuery(event.target.value)} placeholder="搜索工单…" />
            </div>
            <div className="custom-scroll mt-2 max-h-56 space-y-1 overflow-y-auto rounded-xl border border-slate-200 p-1">
              {linkOptions.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => setLinkedTicketId(String(option.id))}
                  className={cn('flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left transition', linkedTicketId === String(option.id) ? 'bg-brand-50 ring-1 ring-brand-200' : 'hover:bg-slate-50')}
                >
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-slate-100 text-slate-500">
                    {option.type === 'incident' ? <Zap className="h-3 w-3" /> : option.type === 'problem' ? <SearchCheck className="h-3 w-3" /> : <GitPullRequest className="h-3 w-3" />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[11px] font-medium text-slate-700">{option.title}</span>
                    <span className="block font-mono text-[9px] text-slate-400">{option.ticket_no}</span>
                  </span>
                  {linkedTicketId === String(option.id) ? <Check className="h-3.5 w-3.5 text-brand-600" /> : null}
                </button>
              ))}
              {!linkOptions.length ? <p className="px-3 py-4 text-center text-[10.5px] text-slate-400">没有匹配的工单</p> : null}
            </div>
          </Field>
        </div>
      </Modal>
      <Modal
        open={deletionOpen}
        onClose={() => setDeletionOpen(false)}
        title="申请删除工单"
        description="提交后进入超级管理员配置的删除审批流程，审批通过后工单将被永久移除。"
        icon={FileX2}
        size="sm"
        footer={<><Button variant="secondary" size="sm" onClick={() => setDeletionOpen(false)}>取消</Button><Button variant="danger" size="sm" loading={requestingDelete} onClick={requestDeletion}>提交删除申请</Button></>}
      >
        <div className="space-y-3">
          <div className="flex items-start gap-2 rounded-lg border border-amber-100 bg-amber-50 px-3 py-2 text-[10px] leading-relaxed text-amber-700">
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            删除申请需要具备审批权限的管理员处理。工单的评论、流转记录、关联 CI 关系和关联工单也会一并删除。
          </div>
          <Field label="删除原因" required>
            <textarea className="input-base min-h-[90px]" value={deleteReason} onChange={(event) => setDeleteReason(event.target.value)} placeholder="说明为什么需要删除该历史工单，例如重复记录、测试数据或错误创建…" />
          </Field>
        </div>
      </Modal>

      <ConfirmDialog
        open={directDeleteOpen}
        onClose={() => setDirectDeleteOpen(false)}
        onConfirm={confirmDirectDelete}
        loading={deletingTicket}
        title="超级管理员直接删除工单"
        confirmText="永久删除"
        description={<>你是超级管理员，可直接删除工单 <strong>{ticket.ticket_no}</strong>。该操作会永久移除工单及全部关联记录，不经过删除审批，且不可恢复。</>}
      />

      <Modal open={Boolean(previewAttachment)} onClose={closeAttachmentPreview} title={previewAttachment?.filename || '附件预览'} description={previewAttachment ? `${(previewAttachment.size / 1024 / 1024).toFixed(2)} MB · ${previewAttachment.mime_type}` : ''} size="lg" footer={<><Button variant="secondary" size="sm" onClick={closeAttachmentPreview}>关闭</Button>{previewAttachment ? <Button size="sm" icon={Download} onClick={() => downloadAttachment(previewAttachment)}>下载</Button> : null}</>}>
        {previewUrl ? (
          previewAttachment?.mime_type?.startsWith('image/') ? <img src={previewUrl} alt={previewAttachment.filename} className="max-h-[65vh] w-full object-contain" />
            : previewAttachment?.mime_type === 'application/pdf' ? <iframe src={previewUrl} title={previewAttachment.filename} className="h-[65vh] w-full rounded-lg border border-slate-200" />
              : <div className="rounded-lg bg-slate-50 p-8 text-center text-[11px] text-slate-500">该文件类型暂不支持在线预览，请下载后查看。</div>
        ) : null}
      </Modal>
    </div>
  );
}

function CommentRow({ comment }: { comment: TicketComment }) {
  return (
    <div className="flex gap-3 py-4">
      <Avatar name={comment.user_name || '系统'} src={comment.user_avatar_url} color={comment.user_color || '#64748b'} size="sm" />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[11.5px] font-medium text-slate-700">{comment.user_name || '系统'}</span>
          {comment.user_department ? <span className="text-[9px] text-slate-400">{comment.user_department}</span> : null}
          {comment.is_internal ? <span className="flex items-center gap-0.5 rounded bg-amber-50 px-1.5 py-0.5 text-[8.5px] font-medium text-amber-700"><LockKeyhole className="h-2.5 w-2.5" />内部</span> : null}
          <span className="text-[9px] text-slate-400">· {relativeTime(comment.created_at)}</span>
        </div>
        {comment.body.includes('<') ? <div className="prose-ticket mt-1.5 text-[11.5px] leading-6 text-slate-600" dangerouslySetInnerHTML={{ __html: comment.body }} /> : <p className="mt-1.5 whitespace-pre-wrap text-[11.5px] leading-6 text-slate-600">{comment.body}</p>}
      </div>
    </div>
  );
}

function PlanBox({ title, content, tone = 'default' }: { title: string; content?: string; tone?: 'default' | 'rose' | 'emerald' }) {
  const tones = {
    default: 'border-brand-100 bg-brand-50/40',
    rose: 'border-rose-100 bg-rose-50/40',
    emerald: 'border-emerald-100 bg-emerald-50/40',
  };
  return (
    <div className={cn('rounded-xl border p-3.5', tones[tone])}>
      <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">{title}</p>
      <p className="mt-2 min-h-[56px] whitespace-pre-wrap text-[10.5px] leading-5 text-slate-600">{content || '尚未填写'}</p>
    </div>
  );
}

function SideLine({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 text-[11px]">
      <dt className="shrink-0 text-slate-400">{label}</dt>
      <dd className="text-right text-slate-600">{value}</dd>
    </div>
  );
}

function MemberRow({ label, name, department, color, avatarUrl }: { label: string; name: string; department?: string; color?: string; avatarUrl?: string | null }) {
  return (
    <div className="flex items-center gap-2.5">
      <Avatar name={name} src={avatarUrl} color={color} size="sm" />
      <div className="min-w-0 flex-1">
        <p className="text-[9px] text-slate-400">{label}</p>
        <p className="truncate text-[11.5px] font-medium text-slate-700">{name}</p>
      </div>
      {department ? <span className="max-w-[110px] truncate text-[9px] text-slate-400">{department}</span> : null}
    </div>
  );
}

function toLocalInput(value?: string) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value).slice(0, 16);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}
