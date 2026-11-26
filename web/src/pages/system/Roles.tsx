import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Check,
  Database,
  LayoutDashboard,
  LockKeyhole,
  Plus,
  Radar,
  Settings2,
  ShieldCheck,
  Trash2,
  Users,
  Workflow,
  type LucideIcon,
} from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { usePageTitle } from '@/lib/hooks';
import { cn } from '@/lib/utils';
import type { Role } from '@/lib/types';
import { Badge, Button, ConfirmDialog, EmptyState, Field, IconButton, Input, Modal, PageHeader, Skeleton } from '@/components/ui';

const GROUP_META: Record<string, { icon: LucideIcon; className: string; description: string }> = {
  概览: { icon: LayoutDashboard, className: 'bg-sky-50 text-sky-600', description: '工作台与运营数据可见性' },
  CMDB: { icon: Database, className: 'bg-brand-50 text-brand-600', description: '配置项、模型与导入导出' },
  ITSM: { icon: Workflow, className: 'bg-violet-50 text-violet-600', description: '事件、问题、变更与流程' },
  自动化: { icon: Radar, className: 'bg-rose-50 text-rose-600', description: '监控集成与告警自动化' },
  系统: { icon: Settings2, className: 'bg-amber-50 text-amber-600', description: '用户、角色与审计管理' },
};

const ROLE_COLORS = ['#4f6ef7', '#0ea5a4', '#8b5cf6', '#f59e0b', '#ef4444', '#64748b'];

export default function RolesPage() {
  const navigate = useNavigate();
  usePageTitle('角色权限');
  const [roles, setRoles] = useState<Role[]>([]);
  const [permissions, setPermissions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Role | null>(null);
  const [form, setForm] = useState<Record<string, any>>({ code: '', name: '', description: '', permissions: [] });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<Role | null>(null);
  const [deleting, setDeleting] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const [rolesResponse, permissionsResponse] = await Promise.all([
        api.get<{ data: Role[] }>('/api/roles'),
        api.get<{ data: any[] }>('/api/permissions'),
      ]);
      setRoles(rolesResponse.data);
      setPermissions(permissionsResponse.data);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load().catch((error) => toast.error(error.message));
  }, []);

  const grouped = useMemo(
    () =>
      permissions.reduce<Record<string, any[]>>((groups, permission) => {
        groups[permission.group] = groups[permission.group] || [];
        groups[permission.group].push(permission);
        return groups;
      }, {}),
    [permissions],
  );

  const openCreate = () => {
    setEditing(null);
    setForm({ code: '', name: '', description: '', permissions: ['dashboard.view'] });
    setError('');
    setModalOpen(true);
  };

  const openEdit = (role: Role) => {
    setEditing(role);
    setForm({ code: role.code, name: role.name, description: role.description, permissions: [...role.permissions] });
    setError('');
    setModalOpen(true);
  };

  const togglePermission = (code: string) => {
    setForm((current) => ({
      ...current,
      permissions: current.permissions.includes(code) ? current.permissions.filter((item: string) => item !== code) : [...current.permissions, code],
    }));
  };

  const toggleGroup = (groupPermissions: any[]) => {
    const codes = groupPermissions.map((permission) => permission.code);
    const allSelected = codes.every((code) => form.permissions.includes(code));
    setForm((current) => ({
      ...current,
      permissions: allSelected ? current.permissions.filter((code: string) => !codes.includes(code)) : [...new Set([...current.permissions, ...codes])],
    }));
  };

  const save = async () => {
    setError('');
    if (!form.name?.trim()) return setError('请填写角色名称');
    if (!editing && !form.code?.trim()) return setError('请填写角色标识');
    if (!form.permissions.length) return setError('请至少选择一项权限');
    setSaving(true);
    try {
      if (editing) {
        await api.put(`/api/roles/${editing.id}`, { name: form.name, description: form.description, permissions: form.permissions });
        toast.success('角色权限已更新');
      } else {
        await api.post('/api/roles', { ...form, code: form.code });
        toast.success('角色已创建');
      }
      setModalOpen(false);
      await load();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await api.delete(`/api/roles/${deleteTarget.id}`);
      toast.success('角色已删除');
      setDeleteTarget(null);
      await load();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setDeleting(false);
    }
  };

  const totalAssigned = roles.reduce((sum, role) => sum + (role.user_count || 0), 0);
  const readOnly = editing?.code === 'admin';

  return (
    <div className="animate-enter">
      <PageHeader
        eyebrow="Role-based access control"
        title="角色与权限"
        description="基于 RBAC 配置角色权限，控制用户在 CMDB、ITSM、集成与系统管理中的操作边界。"
        actions={<><Button variant="secondary" size="sm" icon={Trash2} onClick={() => navigate('/system/deletion-policy')}>删除审批流程</Button><Button size="sm" icon={Plus} onClick={openCreate}>新增角色</Button></>}
      />

      <div className="mb-3.5 grid grid-cols-2 gap-2.5 lg:grid-cols-4">
        {[
          { label: '角色数量', value: roles.length, icon: ShieldCheck, tone: 'text-brand-600 bg-brand-50' },
          { label: '自定义角色', value: roles.filter((role) => !role.is_system).length, icon: Settings2, tone: 'text-violet-600 bg-violet-50' },
          { label: '已分配用户', value: totalAssigned, icon: Users, tone: 'text-emerald-600 bg-emerald-50' },
          { label: '权限项', value: permissions.length, icon: LockKeyhole, tone: 'text-amber-600 bg-amber-50' },
        ].map((item) => (
          <div key={item.label} className="card flex items-center gap-3 p-3.5">
            <span className={cn('flex h-9 w-9 items-center justify-center rounded-xl', item.tone)}><item.icon className="h-4 w-4" /></span>
            <div><p className="text-[20px] font-semibold leading-none text-slate-900">{item.value}</p><p className="mt-1 text-[9.5px] text-slate-400">{item.label}</p></div>
          </div>
        ))}
      </div>

      {loading ? (
        <div className="grid gap-3.5 md:grid-cols-2 xl:grid-cols-3">{Array.from({ length: 4 }).map((_, index) => <Skeleton key={index} className="h-52 w-full" />)}</div>
      ) : roles.length ? (
        <div className="grid grid-cols-1 gap-3.5 md:grid-cols-2 xl:grid-cols-3">
          {roles.map((role, index) => {
            const color = ROLE_COLORS[index % ROLE_COLORS.length];
            const groups = new Set(role.permissions.map((code) => permissions.find((permission) => permission.code === code)?.group).filter(Boolean));
            return (
              <div key={role.id} className="card card-hover overflow-hidden">
                <div className="h-1" style={{ background: color }} />
                <div className="p-4">
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-2.5">
                      <span className="flex h-10 w-10 items-center justify-center rounded-xl text-white" style={{ background: color }}><ShieldCheck className="h-5 w-5" /></span>
                      <div>
                        <div className="flex items-center gap-1.5">
                          <h3 className="text-[13.5px] font-semibold text-slate-800">{role.name}</h3>
                          {role.is_system ? <Badge className="bg-slate-100 text-slate-500 ring-slate-500/10">内置</Badge> : <Badge className="bg-violet-50 text-violet-700 ring-violet-600/15">自定义</Badge>}
                        </div>
                        <p className="mt-0.5 font-mono text-[9px] text-slate-400">{role.code}</p>
                      </div>
                    </div>
                    {role.code !== 'admin' ? (
                      <div className="flex items-center gap-0.5">
                        <IconButton icon={Settings2} label="编辑权限" onClick={() => openEdit(role)} />
                        {!role.is_system ? <IconButton icon={Trash2} label="删除角色" variant="danger" onClick={() => setDeleteTarget(role)} /> : null}
                      </div>
                    ) : null}
                  </div>
                  <p className="mt-3 min-h-[32px] text-[10.5px] leading-relaxed text-slate-500">{role.description || '暂无角色描述'}</p>
                  <div className="mt-3 flex flex-wrap items-center gap-1.5">
                    {[...groups].map((group) => {
                      const meta = GROUP_META[group];
                      if (!meta) return null;
                      return <span key={group} className={cn('rounded-md px-1.5 py-0.5 text-[8.5px] font-medium', meta.className)}>{group}</span>;
                    })}
                  </div>
                  <div className="mt-4 flex items-center justify-between border-t border-slate-100 pt-3">
                    <div className="flex items-center gap-3 text-[9.5px] text-slate-400">
                      <span className="flex items-center gap-1"><LockKeyhole className="h-3 w-3" />{role.permissions.length} 项权限</span>
                      <span className="flex items-center gap-1"><Users className="h-3 w-3" />{role.user_count || 0} 位用户</span>
                    </div>
                    {role.code !== 'admin' ? (
                      <button onClick={() => openEdit(role)} className="flex items-center gap-1 text-[10px] font-medium text-brand-600 hover:text-brand-700">配置权限 <Check className="h-3 w-3" /></button>
                    ) : <span className="flex items-center gap-1 text-[9px] text-slate-400"><LockKeyhole className="h-3 w-3" />全部权限</span>}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="card"><EmptyState title="暂无角色" description="创建角色并分配权限以开始。" icon={ShieldCheck} /></div>
      )}

      <div className="mt-3.5 grid grid-cols-1 gap-3.5 lg:grid-cols-3">
        {Object.entries(GROUP_META).map(([group, meta]) => {
          const Icon = meta.icon;
          return (
            <div key={group} className="card flex items-start gap-3 p-4">
              <span className={cn('flex h-8 w-8 shrink-0 items-center justify-center rounded-lg', meta.className)}><Icon className="h-4 w-4" /></span>
              <div>
                <p className="text-[11.5px] font-semibold text-slate-700">{group}权限</p>
                <p className="mt-0.5 text-[9.5px] leading-relaxed text-slate-400">{meta.description} · {permissions.filter((item) => item.group === group).length} 项</p>
              </div>
            </div>
          );
        })}
      </div>

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editing ? `配置角色 · ${editing.name}` : '新增角色'}
        description={readOnly ? '系统管理员角色拥有全部权限，不可修改。' : '选择该角色可执行的操作。权限变更对已分配用户即时生效。'}
        icon={ShieldCheck}
        size="lg"
        resizable={false}
        footer={
          readOnly ? <Button variant="secondary" size="sm" onClick={() => setModalOpen(false)}>关闭</Button> : (
            <><Button variant="secondary" size="sm" onClick={() => setModalOpen(false)}>取消</Button><Button size="sm" loading={saving} onClick={save}>{editing ? '保存权限' : '创建角色'}</Button></>
          )
        }
      >
        {error ? <div className="mb-3 rounded-lg border border-rose-100 bg-rose-50 px-3 py-2 text-[11px] text-rose-700">{error}</div> : null}
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="角色名称" required><Input value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} placeholder="如 安全审计员" disabled={readOnly} /></Field>
            <Field label="角色标识" required hint="小写字母、数字与横线">
              <Input value={form.code} onChange={(event) => setForm((current) => ({ ...current, code: event.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, '') }))} placeholder="security_auditor" className="font-mono" disabled={Boolean(editing)} />
            </Field>
          </div>
          <Field label="角色说明"><Input value={form.description} onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))} placeholder="描述该角色的职责范围" disabled={readOnly} /></Field>

          <div>
            <div className="mb-2 flex items-center justify-between">
              <p className="text-[11.5px] font-semibold text-slate-700">权限配置</p>
              <span className={cn('rounded-md px-2 py-0.5 text-[9.5px]', form.permissions.length === permissions.length ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500')}>{form.permissions.length} / {permissions.length} 项</span>
            </div>
            <div className="space-y-2.5">
              {Object.entries(grouped).map(([group, groupPermissions]) => {
                const meta = GROUP_META[group] || GROUP_META['系统'];
                const Icon = meta.icon;
                const codes = groupPermissions.map((permission) => permission.code);
                const allSelected = codes.every((code) => form.permissions.includes(code));
                const someSelected = codes.some((code) => form.permissions.includes(code));
                return (
                  <div key={group} className="rounded-xl border border-slate-200">
                    <div className="flex items-center justify-between border-b border-slate-100 px-3 py-2">
                      <div className="flex items-center gap-2">
                        <span className={cn('flex h-6 w-6 items-center justify-center rounded-md', meta.className)}><Icon className="h-3 w-3" /></span>
                        <span className="text-[11px] font-medium text-slate-700">{group}</span>
                      </div>
                      <button onClick={() => toggleGroup(groupPermissions)} disabled={readOnly} className={cn('flex items-center gap-1 text-[9.5px] font-medium', allSelected ? 'text-brand-600' : 'text-slate-400 hover:text-slate-600')}>
                        <span className={cn('flex h-3.5 w-3.5 items-center justify-center rounded border', allSelected ? 'border-brand-500 bg-brand-500 text-white' : someSelected ? 'border-brand-300 bg-brand-50' : 'border-slate-300')}>
                          {allSelected ? <Check className="h-2.5 w-2.5" /> : null}
                        </span>
                        全选
                      </button>
                    </div>
                    <div className="grid grid-cols-1 gap-1 p-2 sm:grid-cols-2">
                      {groupPermissions.map((permission) => {
                        const active = form.permissions.includes(permission.code);
                        return (
                          <button
                            key={permission.code}
                            type="button"
                            disabled={readOnly}
                            onClick={() => togglePermission(permission.code)}
                            className={cn('flex items-center gap-2 rounded-lg px-2 py-1.5 text-left transition', active ? 'bg-brand-50/70' : 'hover:bg-slate-50', readOnly && 'cursor-default')}
                          >
                            <span className={cn('flex h-4 w-4 shrink-0 items-center justify-center rounded border transition', active ? 'border-brand-500 bg-brand-500 text-white' : 'border-slate-300 bg-white')}>
                              {active ? <Check className="h-3 w-3" /> : null}
                            </span>
                            <span className="min-w-0">
                              <span className="block truncate text-[10.5px] font-medium text-slate-600">{permission.name}</span>
                              <span className="block font-mono text-[8.5px] text-slate-400">{permission.code}</span>
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
          {editing?.is_system ? <p className="flex items-center gap-1.5 text-[9.5px] text-amber-600"><ShieldCheck className="h-3 w-3" />内置角色不可删除，权限可按需调整。</p> : null}
        </div>
      </Modal>

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onClose={() => setDeleteTarget(null)}
        onConfirm={confirmDelete}
        loading={deleting}
        title="删除角色"
        confirmText="确认删除"
        description={<>确定删除角色「{deleteTarget?.name}」吗？角色下仍有用户时无法删除。</>}
      />
    </div>
  );
}
