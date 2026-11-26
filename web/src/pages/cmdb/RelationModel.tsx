import { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeftRight,
  Link2,
  LockKeyhole,
  Pencil,
  Plus,
  ShieldCheck,
  Trash2,
} from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { usePageTitle } from '@/lib/hooks';
import { cn } from '@/lib/utils';
import type { CIRelationType, CIType } from '@/lib/types';
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
  TableSkeleton,
  Toggle,
} from '@/components/ui';

const COLORS = ['#4f6ef7', '#0ea5e9', '#10b981', '#8b5cf6', '#f59e0b', '#ef4444', '#64748b', '#d946ef'];
const TEMPLATE = { code: '', name: '', reverse_name: '', from_type_id: '', to_type_id: '', color: '#4f6ef7', description: '', enabled: true, sort_order: 99 };

export default function RelationModelPage() {
  usePageTitle('关系模型');
  const [types, setTypes] = useState<CIType[]>([]);
  const [relationTypes, setRelationTypes] = useState<CIRelationType[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<CIRelationType | null>(null);
  const [form, setForm] = useState<Record<string, any>>(TEMPLATE);
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<CIRelationType | null>(null);
  const [deleting, setDeleting] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const [typeResponse, relationResponse] = await Promise.all([
        api.get<{ data: CIType[] }>('/api/ci-types'),
        api.get<{ data: CIRelationType[] }>('/api/ci-relation-types'),
      ]);
      setTypes(typeResponse.data);
      setRelationTypes(relationResponse.data);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load().catch((error) => toast.error(error.message));
  }, []);

  const grouped = useMemo(() => ({
    builtin: relationTypes.filter((item) => item.builtin),
    custom: relationTypes.filter((item) => !item.builtin),
  }), [relationTypes]);

  const openCreate = () => {
    setEditing(null);
    setForm({ ...TEMPLATE, sort_order: relationTypes.length + 1 });
    setModalOpen(true);
  };

  const openEdit = (item: CIRelationType) => {
    setEditing(item);
    setForm({
      code: item.code,
      name: item.name,
      reverse_name: item.reverse_name,
      from_type_id: item.from_type_id || '',
      to_type_id: item.to_type_id || '',
      color: item.color,
      description: item.description,
      enabled: item.enabled,
      sort_order: item.sort_order,
    });
    setModalOpen(true);
  };

  const save = async () => {
    if (!form.name?.trim() || !form.reverse_name?.trim()) return toast.error('请填写正向和反向关系名称');
    if (!editing && !form.code?.trim()) return toast.error('请填写关系标识');
    setSaving(true);
    try {
      const payload = {
        ...form,
        from_type_id: form.from_type_id ? Number(form.from_type_id) : null,
        to_type_id: form.to_type_id ? Number(form.to_type_id) : null,
        sort_order: Number(form.sort_order || 99),
      };
      if (editing) await api.put(`/api/ci-relation-types/${editing.id}`, payload);
      else await api.post('/api/ci-relation-types', payload);
      toast.success(editing ? '关系类型已更新' : '自定义关系已创建');
      setModalOpen(false);
      await load();
    } catch (error: any) {
      toast.error(error.message);
    } finally {
      setSaving(false);
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await api.delete(`/api/ci-relation-types/${deleteTarget.id}`);
      toast.success('关系类型已删除');
      setDeleteTarget(null);
      await load();
    } catch (error: any) {
      toast.error(error.message);
    } finally {
      setDeleting(false);
    }
  };

  const renderGroup = (title: string, subtitle: string, items: CIRelationType[]) => (
    <div className="card overflow-hidden">
      <div className="flex items-center justify-between border-b border-[#eef1f6] px-4 py-3">
        <div>
          <h2 className="text-[13px] font-semibold text-slate-800">{title}</h2>
          <p className="mt-0.5 text-[10px] text-slate-400">{subtitle}</p>
        </div>
        <span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[9.5px] text-slate-500">{items.length}</span>
      </div>
      {items.length ? (
        <div className="table-wrap">
          <table className="data-table">
            <thead><tr><th>关系定义</th><th>适用类型</th><th>使用量</th><th>状态</th><th className="text-right">操作</th></tr></thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id} className="group">
                  <td>
                    <div className="flex items-center gap-2.5">
                      <span className="flex h-7 w-7 items-center justify-center rounded-lg text-white" style={{ background: item.color }}><Link2 className="h-3.5 w-3.5" /></span>
                      <div>
                        <p className="text-[11.5px] font-medium text-slate-700">{item.name} <ArrowLeftRight className="mx-1 inline h-3 w-3 text-slate-300" /> {item.reverse_name}</p>
                        <p className="mt-0.5 font-mono text-[9px] text-slate-400">{item.code} · {item.description || '暂无说明'}</p>
                      </div>
                    </div>
                  </td>
                  <td>
                    <p className="text-[10.5px] text-slate-500">{item.from_type_name || '任意类型'} → {item.to_type_name || '任意类型'}</p>
                  </td>
                  <td><span className="text-[11px] text-slate-500">{item.usage_count || 0} 条</span></td>
                  <td><Badge className={item.enabled ? 'bg-emerald-50 text-emerald-700 ring-emerald-600/15' : 'bg-slate-100 text-slate-500 ring-slate-500/10'} dot={item.enabled ? 'bg-emerald-500' : 'bg-slate-400'}>{item.enabled ? '启用' : '停用'}</Badge></td>
                  <td>
                    <div className="flex items-center justify-end gap-0.5 opacity-0 transition group-hover:opacity-100">
                      <IconButton icon={Pencil} label="编辑关系" onClick={() => openEdit(item)} />
                      {!item.builtin ? <IconButton icon={Trash2} label="删除关系" variant="danger" onClick={() => setDeleteTarget(item)} /> : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : <EmptyState title="暂无关系类型" icon={Link2} className="py-10" />}
    </div>
  );

  return (
    <div className="animate-enter">
      <PageHeader
        eyebrow="Relationship model"
        title="CI 关系模型"
        description="定义配置项之间的语义关系：安装操作系统、安装软件、虚拟化平台组成、包含虚拟机等。关系会出现在 CI 详情和关联选择器中。"
        actions={<Button size="sm" icon={Plus} onClick={openCreate}>新增关系类型</Button>}
      />
      <div className="mb-3.5 flex flex-wrap items-center gap-3 rounded-xl border border-brand-100 bg-brand-50/50 px-4 py-3 text-[10.5px] text-brand-800/70">
        <ShieldCheck className="h-4 w-4 text-brand-600" />
        内置关系可修改名称与适用范围但不可删除；自定义关系可约束源 CI 类型和目标 CI 类型，确保建模语义一致。
      </div>
      {loading ? <div className="card p-5"><TableSkeleton rows={6} cols={5} /></div> : (
        <div className="space-y-3.5">
          {renderGroup('内置关系', '平台预置的通用 CMDB 关系语义', grouped.builtin)}
          {renderGroup('自定义关系', '由管理员按业务场景扩展的关系类型', grouped.custom)}
        </div>
      )}

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editing ? `编辑关系 · ${editing.code}` : '新增自定义关系'}
        description="正向名称用于源 CI → 目标 CI，反向名称用于目标 CI 详情中的回显。"
        icon={Link2}
        size="md"
        footer={<><Button variant="secondary" size="sm" onClick={() => setModalOpen(false)}>取消</Button><Button size="sm" loading={saving} onClick={save}>{editing ? '保存' : '创建关系'}</Button></>}
      >
        <div className="space-y-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="关系标识" required hint="小写字母、数字与下划线">
              <Input value={form.code} onChange={(event) => setForm((current) => ({ ...current, code: event.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_') }))} disabled={Boolean(editing)} className="font-mono" placeholder="runs_on" />
            </Field>
            <Field label="正向名称" required><Input value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} placeholder="安装软件" /></Field>
            <Field label="反向名称" required><Input value={form.reverse_name} onChange={(event) => setForm((current) => ({ ...current, reverse_name: event.target.value }))} placeholder="被安装于" /></Field>
            <Field label="节点颜色">
              <div className="flex flex-wrap gap-1.5 pt-1">
                {COLORS.map((color) => <button key={color} type="button" onClick={() => setForm((current) => ({ ...current, color }))} className="h-6 w-6 rounded-full" style={{ background: color, boxShadow: form.color === color ? `0 0 0 2px white, 0 0 0 4px ${color}` : undefined }} />)}
              </div>
            </Field>
            <Field label="源 CI 类型" hint="留空表示任意类型">
              <select className="input-base" value={form.from_type_id || ''} onChange={(event) => setForm((current) => ({ ...current, from_type_id: event.target.value }))}>
                <option value="">任意类型</option>
                {types.map((type) => <option key={type.id} value={type.id}>{type.name}</option>)}
              </select>
            </Field>
            <Field label="目标 CI 类型" hint="留空表示任意类型">
              <select className="input-base" value={form.to_type_id || ''} onChange={(event) => setForm((current) => ({ ...current, to_type_id: event.target.value }))}>
                <option value="">任意类型</option>
                {types.map((type) => <option key={type.id} value={type.id}>{type.name}</option>)}
              </select>
            </Field>
          </div>
          <Field label="关系说明"><Input value={form.description} onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))} placeholder="说明该关系的业务语义" /></Field>
          <div className="flex items-center justify-between rounded-xl border border-slate-200 px-3 py-2.5">
            <div><p className="text-[11px] font-medium text-slate-700">启用关系</p><p className="text-[9px] text-slate-400">停用后不能再新建该关系，历史关系保留。</p></div>
            <Toggle checked={Boolean(form.enabled)} onChange={(checked) => setForm((current) => ({ ...current, enabled: checked }))} />
          </div>
          {editing?.builtin ? <p className="flex items-center gap-1.5 text-[9.5px] text-amber-600"><LockKeyhole className="h-3 w-3" />内置关系不可删除，可修改显示名称与适用范围。</p> : null}
        </div>
      </Modal>

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onClose={() => setDeleteTarget(null)}
        onConfirm={confirmDelete}
        loading={deleting}
        title="删除关系类型"
        confirmText="确认删除"
        description={<>确定删除自定义关系「{deleteTarget?.name} / {deleteTarget?.reverse_name}」吗？已有 CI 使用该关系时无法删除。</>}
      />
    </div>
  );
}
