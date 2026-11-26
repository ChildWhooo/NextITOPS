import { useEffect, useState } from 'react';
import { BellRing, CalendarClock, Megaphone, Pencil, Plus, Send, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { DateTextInput } from '@/components/DateTextInput';
import { api } from '@/lib/api';
import { usePageTitle } from '@/lib/hooks';
import { cn, formatDate } from '@/lib/utils';
import { Badge, Button, ConfirmDialog, EmptyState, Field, IconButton, Input, Modal, PageHeader, Skeleton } from '@/components/ui';

const EMPTY = { title: '', content: '', start_at: '', end_at: '', notify_users: true };

export default function MaintenancePage() {
  usePageTitle('维护公告');
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [form, setForm] = useState<Record<string, any>>(EMPTY);
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<any>(null);
  const [deleting, setDeleting] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const response = await api.get<{ data: any[] }>('/api/maintenance');
      setRows(response.data);
    } catch (error: any) { toast.error(error.message); } finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  const openCreate = () => {
    setEditing(null);
    const start = new Date(Date.now() + 86400000);
    const end = new Date(start.getTime() + 3600000);
    const toLocal = (date: Date) => new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
    setForm({ ...EMPTY, start_at: toLocal(start), end_at: toLocal(end) });
    setOpen(true);
  };

  const openEdit = (row: any) => {
    setEditing(row);
    const toLocal = (value: string) => {
      const date = new Date(value);
      return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
    };
    setForm({ title: row.title, content: row.content, start_at: toLocal(row.start_at), end_at: toLocal(row.end_at), notify_users: row.notify_users });
    setOpen(true);
  };

  const save = async () => {
    if (!form.title?.trim() || !form.content?.trim()) return toast.error('请填写标题和内容');
    setSaving(true);
    try {
      const payload = {
        ...form,
        start_at: new Date(form.start_at).toISOString(),
        end_at: new Date(form.end_at).toISOString(),
        status: editing?.status || 'planned',
      };
      if (editing) await api.put(`/api/maintenance/${editing.id}`, payload);
      else await api.post('/api/maintenance', payload);
      toast.success(editing ? '维护公告已更新' : '维护公告已发布');
      setOpen(false);
      await load();
    } catch (error: any) { toast.error(error.message); } finally { setSaving(false); }
  };

  const notify = async (row: any) => {
    try {
      const response = await api.post<{ result: any }>(`/api/maintenance/${row.id}/notify`, {});
      toast.success(`已通知 ${response.result?.users || 0} 位用户`);
      await load();
    } catch (error: any) { toast.error(error.message); }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await api.delete(`/api/maintenance/${deleteTarget.id}`);
      toast.success('维护公告已删除');
      setDeleteTarget(null);
      await load();
    } catch (error: any) { toast.error(error.message); } finally { setDeleting(false); }
  };

  const phaseMeta: Record<string, string> = {
    planned: 'bg-white text-brand-700 ring-brand-200',
    active: 'bg-amber-50 text-amber-700 ring-amber-600/15',
    completed: 'bg-slate-100 text-slate-500 ring-slate-500/10',
    cancelled: 'bg-rose-50 text-rose-600 ring-rose-600/15',
  };

  return (
    <div className="animate-enter">
      <PageHeader eyebrow="Maintenance" title="维护公告" description="定义系统停机维护窗口与内容，发布后可通过邮件、飞书、企业微信通知全部用户。" actions={<Button size="sm" icon={Plus} onClick={openCreate}>发布维护公告</Button>} />
      <div className="card overflow-hidden">
        <div className="flex items-center justify-between border-b border-[#eef1f6] px-5 py-3.5">
          <div><h2 className="text-[13px] font-semibold text-slate-800">维护计划</h2><p className="mt-0.5 text-[10px] text-slate-400">当前 {rows.length} 条记录</p></div>
          <Badge className="bg-emerald-50 text-emerald-700 ring-emerald-600/15">通知渠道由通知设置统一管理</Badge>
        </div>
        {loading ? <div className="space-y-2 p-4">{[1, 2].map((item) => <Skeleton key={item} className="h-20" />)}</div> : rows.length ? (
          <div className="divide-y divide-[#f0f2f7]">
            {rows.map((row) => (
              <div key={row.id} className="flex flex-col gap-3 px-5 py-4 transition hover:bg-[#fafbff] sm:flex-row sm:items-start">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-amber-50 text-amber-600"><Megaphone className="h-4 w-4" /></span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2"><p className="text-[12px] font-semibold text-slate-700">{row.title}</p><Badge className={phaseMeta[row.phase] || phaseMeta.planned}>{row.phase === 'active' ? '维护中' : row.phase === 'completed' ? '已结束' : row.phase === 'cancelled' ? '已取消' : '待开始'}</Badge>{row.notified_at ? <Badge className="bg-emerald-50 text-emerald-700 ring-emerald-600/15" dot="bg-emerald-500">已通知</Badge> : null}</div>
                  <p className="mt-1 line-clamp-2 text-[10.5px] leading-relaxed text-slate-500">{row.content}</p>
                  <p className="mt-1.5 flex items-center gap-1 text-[9.5px] text-slate-400"><CalendarClock className="h-3 w-3" /> {formatDate(row.start_at)} — {formatDate(row.end_at)}</p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <Button variant="secondary" size="xs" icon={Send} onClick={() => notify(row)}>发送通知</Button>
                  <IconButton icon={Pencil} label="编辑" onClick={() => openEdit(row)} />
                  <IconButton icon={Trash2} label="删除" variant="danger" onClick={() => setDeleteTarget(row)} />
                </div>
              </div>
            ))}
          </div>
        ) : <EmptyState title="暂无维护公告" description="发布一条停机维护计划，提前通知业务用户。" icon={Megaphone} className="py-16" />}
      </div>

      <Modal open={open} onClose={() => setOpen(false)} title={editing ? '编辑维护公告' : '发布维护公告'} description="公告会显示在全局顶部，可选择立即通知全部用户。" icon={BellRing} size="md" footer={<><Button variant="secondary" size="sm" onClick={() => setOpen(false)}>取消</Button><Button size="sm" loading={saving} onClick={save}>{editing ? '保存' : '发布'}</Button></>}>
        <div className="space-y-3">
          <Field label="维护标题" required><Input value={form.title} onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))} placeholder="例如 核心数据库例行维护" /></Field>
          <Field label="维护内容" required><textarea className="input-base min-h-[90px]" value={form.content} onChange={(event) => setForm((current) => ({ ...current, content: event.target.value }))} placeholder="说明停机范围、影响业务和用户需要做什么…" /></Field>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="开始时间" required><DateTextInput withTime value={form.start_at} onChange={(start_at) => setForm((current) => ({ ...current, start_at }))} /></Field>
            <Field label="结束时间" required><DateTextInput withTime value={form.end_at} onChange={(end_at) => setForm((current) => ({ ...current, end_at }))} /></Field>
          </div>
          <div className="flex items-center justify-between rounded-xl border border-slate-200 px-3 py-2.5">
            <div><p className="text-[11px] font-medium text-slate-700">发布后通知全部用户</p><p className="text-[9px] text-slate-400">通过已启用的邮件、飞书、企业微信渠道发送。</p></div>
            <input type="checkbox" checked={form.notify_users} onChange={(event) => setForm((current) => ({ ...current, notify_users: event.target.checked }))} />
          </div>
        </div>
      </Modal>
      <ConfirmDialog open={Boolean(deleteTarget)} onClose={() => setDeleteTarget(null)} onConfirm={confirmDelete} loading={deleting} title="删除维护公告" description={<>确定删除「{deleteTarget?.title}」吗？</>} />
    </div>
  );
}
