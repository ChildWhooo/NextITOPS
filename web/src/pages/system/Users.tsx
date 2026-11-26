import { useEffect, useMemo, useState } from 'react';
import {
  BellRing,
  Check,
  Download,
  KeyRound,
  Mail,
  Pencil,
  Phone,
  Plus,
  Search,
  ShieldCheck,
  Trash2,
  Upload,
  UserCheck,
  UserRound,
  Users as UsersIcon,
  UserX,
} from 'lucide-react';
import { toast } from 'sonner';
import { api, downloadFile } from '@/lib/api';
import { usePageSize } from '@/lib/pageSize';
import { notifyDataChanged } from '@/lib/refresh';
import { usePageTitle } from '@/lib/hooks';
import { useAuth } from '@/context/AuthContext';
import { cn, formatDate, relativeTime } from '@/lib/utils';
import type { Role, User } from '@/lib/types';
import {
  Avatar,
  Badge,
  Button,
  Checkbox,
  ConfirmDialog,
  EmptyState,
  Field,
  IconButton,
  Input,
  Modal,
  PageHeader,
  PageSizeSelect,
  Pagination,
  SearchInput,
  Skeleton,
  TableSkeleton,
  Toggle,
} from '@/components/ui';
import { SortableTh } from '@/components/SortableTh';

const AVATAR_COLORS = ['#4f6ef7', '#0ea5a4', '#8b5cf6', '#f59e0b', '#ec4899', '#10b981', '#ef4444', '#64748b'];

const EMPTY_FORM = {
  username: '',
  name: '',
  password: '',
  email: '',
  phone: '',
  department: '',
  title: '',
  role_id: '',
  status: 'active',
  avatar_color: '#4f6ef7',
  feishu_open_id: '',
  wecom_userid: '',
  allowed_ips: '',
  bound_mac: '',
};

function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let field = '';
  let row: string[] = [];
  let quoted = false;
  const input = text.replace(/^\uFEFF/, '');
  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    if (char === '"') {
      if (quoted && input[index + 1] === '"') { field += '"'; index += 1; }
      else quoted = !quoted;
    } else if (char === ',' && !quoted) {
      row.push(field); field = '';
    } else if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && input[index + 1] === '\n') index += 1;
      row.push(field); field = '';
      if (row.some((cell) => cell.trim())) rows.push(row);
      row = [];
    } else {
      field += char;
    }
  }
  row.push(field);
  if (row.some((cell) => cell.trim())) rows.push(row);
  if (!rows.length) return [];
  const headers = rows[0].map((header) => header.trim());
  return rows.slice(1).map((cells) => Object.fromEntries(headers.map((header, index) => [header, (cells[index] || '').trim()])));
}

export default function UsersPage() {
  usePageTitle('用户管理');
  const { user: currentUser, can } = useAuth();
  const [users, setUsers] = useState<User[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [sortBy, setSortBy] = useState('username');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const toggleSort = (field: string) => {
    if (sortBy === field) setSortDir((current) => current === 'asc' ? 'desc' : 'asc');
    else { setSortBy(field); setSortDir('asc'); }
  };

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<User | null>(null);
  const [form, setForm] = useState<Record<string, any>>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<User | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = usePageSize('users');
  const [importOpen, setImportOpen] = useState(false);
  const [importRows, setImportRows] = useState<Record<string, any>[]>([]);
  const [importing, setImporting] = useState(false);
  const [batchRole, setBatchRole] = useState('');
  const [batchDeleteOpen, setBatchDeleteOpen] = useState(false);
  const [notifyUser, setNotifyUser] = useState(true);
  const [initialPassword, setInitialPassword] = useState('');
  const [policy, setPolicy] = useState<any>(null);
  const [policyOpen, setPolicyOpen] = useState(false);
  const [policySaving, setPolicySaving] = useState(false);
  const [securityOpen, setSecurityOpen] = useState(false);
  const [security, setSecurity] = useState<any>({ max_failures: 8, lock_minutes: 15, ip_whitelist: '', ip_blacklist: '' });
  const [securitySaving, setSecuritySaving] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const [userResponse, roleResponse] = await Promise.all([
        api.get<{ data: User[] }>('/api/users'),
        api.get<{ data: Role[] }>('/api/roles'),
      ]);
      setUsers(userResponse.data);
      setRoles(roleResponse.data);
      api.get<{ data: any }>('/api/system/password-policy').then((response) => setPolicy(response.data)).catch(() => {});
      api.get<{ data: any }>('/api/system/login-security').then((response) => setSecurity(response.data)).catch(() => {});
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load().catch((error) => toast.error(error.message));
  }, []);

  const filtered = useMemo(() => {
    const rows = users.filter((user) => {
      if (status && user.status !== status) return false;
      if (roleFilter && String(user.role_id) !== roleFilter) return false;
      if (search) {
        const haystack = `${user.name} ${user.username} ${user.email} ${user.department}`.toLowerCase();
        if (!haystack.includes(search.toLowerCase())) return false;
      }
      return true;
    });
    return [...rows].sort((a: any, b: any) => {
      const av = String(a[sortBy] ?? '').toLowerCase();
      const bv = String(b[sortBy] ?? '').toLowerCase();
      return (av < bv ? -1 : av > bv ? 1 : 0) * (sortDir === 'asc' ? 1 : -1);
    });
  }, [users, status, roleFilter, search, sortBy, sortDir]);

  const stats = useMemo(
    () => ({
      total: users.length,
      active: users.filter((item) => item.status === 'active').length,
      disabled: users.filter((item) => item.status === 'disabled').length,
      departments: new Set(users.map((item) => item.department).filter(Boolean)).size,
    }),
    [users],
  );

  const paged = useMemo(() => filtered.slice((page - 1) * pageSize, page * pageSize), [filtered, page, pageSize]);
  useEffect(() => { setPage(1); }, [search, status, roleFilter, pageSize]);
  useEffect(() => { setPage((current) => Math.min(current, Math.max(1, Math.ceil(filtered.length / pageSize)))); }, [filtered.length, pageSize]);

  const toggleSelected = (id: number) => setSelectedIds((current) => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const pageAllSelected = paged.length > 0 && paged.every((user) => selectedIds.has(user.id));
  const togglePage = () => setSelectedIds((current) => {
    const next = new Set(current);
    if (pageAllSelected) paged.forEach((user) => next.delete(user.id));
    else paged.forEach((user) => next.add(user.id));
    return next;
  });

  const exportUsers = async () => {
    try { const filename = await downloadFile('/api/users/export', 'users.csv'); toast.success(`已导出 ${filename}`); }
    catch (error: any) { toast.error(error.message); }
  };

  const importUsers = async () => {
    if (!importRows.length) return toast.error('请选择包含用户数据的 CSV 文件');
    setImporting(true);
    try {
      const response = await api.post<{ created: number; updated: number; failed: number; errors: any[] }>('/api/users/import', { rows: importRows });
      toast.success(`导入完成：新建 ${response.created}，更新 ${response.updated}${response.failed ? `，失败 ${response.failed}` : ''}`);
      if (response.failed) toast.error(response.errors.slice(0, 3).map((item) => `第 ${item.row} 行：${item.message}`).join('；'));
      setImportOpen(false); setImportRows([]); await load(); notifyDataChanged();
    } catch (error: any) { toast.error(error.message); } finally { setImporting(false); }
  };

  const batchAction = async (action: 'role' | 'status' | 'delete', statusValue: 'active' | 'disabled' = 'active') => {
    if (!selectedIds.size) return;
    try {
      if (action === 'role' && !batchRole) return toast.error('请选择目标角色');
      await api.post('/api/users/batch', { ids: [...selectedIds], action, role_id: action === 'role' ? Number(batchRole) : undefined, status: action === 'status' ? statusValue : undefined });
      toast.success(action === 'delete' ? '批量删除完成' : '批量更新完成');
      setSelectedIds(new Set()); setBatchDeleteOpen(false); await load(); notifyDataChanged();
    } catch (error: any) { toast.error(error.message); }
  };

  const openCreate = () => {
    setEditing(null);
    setForm({ ...EMPTY_FORM, role_id: roles.find((role) => role.code === 'employee')?.id || roles[roles.length - 1]?.id || '' });
    setNotifyUser(true);
    setError('');
    setModalOpen(true);
  };

  const openEdit = (user: User) => {
    setEditing(user);
    setForm({
      username: user.username,
      name: user.name,
      password: '',
      email: user.email || '',
      phone: user.phone || '',
      department: user.department || '',
      title: user.title || '',
      role_id: user.role_id,
      status: user.status,
      avatar_color: user.avatar_color || '#4f6ef7',
      feishu_open_id: user.feishu_open_id || '',
      wecom_userid: user.wecom_userid || '',
      allowed_ips: (user as any).allowed_ips || '',
      bound_mac: (user as any).bound_mac || '',
    });
    setError('');
    setModalOpen(true);
  };

  const save = async () => {
    setError('');
    if (!form.name?.trim()) return setError('请填写姓名');
    if (!editing && !form.username?.trim()) return setError('请填写用户名');
    if (!form.role_id) return setError('请选择角色');
    if (!editing && form.password && form.password.length < (Number(policy?.min_length) || 6)) return setError(`初始密码至少 ${Number(policy?.min_length) || 6} 位`);
    if (editing && form.password && form.password.length < (Number(policy?.min_length) || 6)) return setError(`新密码至少 ${Number(policy?.min_length) || 6} 位`);
    setSaving(true);
    try {
      if (editing) {
        await api.put(`/api/users/${editing.id}`, { ...form, role_id: Number(form.role_id) });
        toast.success('用户信息已更新');
      } else {
        const response = await api.post<{ initial_password?: string }>('/api/users', { ...form, role_id: Number(form.role_id), notify_user: notifyUser });
        if (response.initial_password) setInitialPassword(response.initial_password);
        toast.success('用户已创建，请保存初始密码');
      }
      setModalOpen(false);
      await load();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const toggleStatus = async (user: User) => {
    try {
      await api.put(`/api/users/${user.id}`, { status: user.status === 'active' ? 'disabled' : 'active' });
      toast.success(user.status === 'active' ? '用户已停用' : '用户已启用');
      await load();
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await api.delete(`/api/users/${deleteTarget.id}`);
      toast.success('用户已删除');
      setDeleteTarget(null);
      await load();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="animate-enter">
      <PageHeader
        eyebrow="Identity & access"
        title="用户管理"
        description="管理平台账号、角色分配与账号状态。角色权限决定用户可访问的功能和数据。"
        actions={<div className="flex items-center gap-2"><Button variant="secondary" size="sm" icon={ShieldCheck} onClick={() => setSecurityOpen(true)}>登录安全</Button><Button variant="secondary" size="sm" icon={KeyRound} onClick={() => setPolicyOpen(true)}>密码策略</Button><Button variant="secondary" size="sm" icon={Upload} onClick={exportUsers}>导出</Button><Button variant="secondary" size="sm" icon={Download} onClick={() => setImportOpen(true)}>导入</Button><Button size="sm" icon={Plus} onClick={openCreate}>新增用户</Button></div>}
      />

      <div className="mb-3.5 grid grid-cols-2 gap-2.5 lg:grid-cols-4">
        {[
          { label: '用户总数', value: stats.total, icon: UsersIcon, tone: 'text-brand-600 bg-brand-50' },
          { label: '活跃账号', value: stats.active, icon: UserCheck, tone: 'text-emerald-600 bg-emerald-50' },
          { label: '停用账号', value: stats.disabled, icon: UserX, tone: 'text-slate-500 bg-slate-100' },
          { label: '所属部门', value: stats.departments, icon: ShieldCheck, tone: 'text-violet-600 bg-violet-50' },
        ].map((item) => (
          <div key={item.label} className="card flex items-center gap-3 p-3.5">
            <span className={cn('flex h-9 w-9 items-center justify-center rounded-xl', item.tone)}><item.icon className="h-4 w-4" /></span>
            <div><p className="text-[20px] font-semibold leading-none text-slate-900">{item.value}</p><p className="mt-1 text-[9.5px] text-slate-400">{item.label}</p></div>
          </div>
        ))}
      </div>

      <div className="card overflow-hidden">
        <div className="flex flex-col gap-3 border-b border-[#eef1f6] p-4">
          <div className="flex items-center justify-between">
            <div><h2 className="text-[13px] font-semibold text-slate-800">账号列表</h2><p className="mt-0.5 text-[10px] text-slate-400">{filtered.length} 个账号</p></div>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <SearchInput value={search} onChange={setSearch} placeholder="搜索姓名、用户名、邮箱或部门…" className="w-full sm:w-[300px]" />
            <select className="input-base h-9 w-auto min-w-[120px] text-[12px]" value={roleFilter} onChange={(event) => setRoleFilter(event.target.value)}>
              <option value="">全部角色</option>
              {roles.map((role) => <option key={role.id} value={role.id}>{role.name}</option>)}
            </select>
            <select className="input-base h-9 w-auto min-w-[110px] text-[12px]" value={status} onChange={(event) => setStatus(event.target.value)}>
              <option value="">全部状态</option>
              <option value="active">正常</option>
              <option value="disabled">已停用</option>
            </select>
          </div>
        </div>

        {selectedIds.size ? (
          <div className="flex flex-col gap-2 border-b border-brand-100 bg-brand-50/70 px-4 py-2.5 sm:flex-row sm:items-center">
            <p className="flex-1 text-[11px] font-medium text-brand-800">已选择 {selectedIds.size} 个用户</p>
            <select className="input-base h-8 w-auto min-w-[130px] text-[11px]" value={batchRole} onChange={(event) => setBatchRole(event.target.value)}><option value="">选择目标角色</option>{roles.map((role) => <option key={role.id} value={role.id}>{role.name}</option>)}</select>
            <Button size="xs" variant="secondary" onClick={() => batchAction('role')}>批量改角色</Button>
            <Button size="xs" variant="secondary" onClick={() => batchAction('status', 'active')}>批量启用</Button>
            <Button size="xs" variant="secondary" onClick={() => batchAction('status', 'disabled')}>批量停用</Button>
            <Button size="xs" variant="danger" icon={Trash2} onClick={() => setBatchDeleteOpen(true)}>批量删除</Button>
            <button className="text-[10px] text-brand-600 hover:text-brand-800" onClick={() => setSelectedIds(new Set())}>取消选择</button>
          </div>
        ) : null}

        {loading ? (
          <TableSkeleton rows={6} cols={5} />
        ) : filtered.length ? (
          <div className="table-wrap">
            <table className="data-table">
              <thead><tr><th className="w-8"><Checkbox checked={pageAllSelected} onChange={togglePage} /></th><SortableTh label="用户" field="username" sortBy={sortBy} sortDir={sortDir} onSort={toggleSort} /><SortableTh label="角色" field="role_name" sortBy={sortBy} sortDir={sortDir} onSort={toggleSort} /><SortableTh label="部门 / 职位" field="department" sortBy={sortBy} sortDir={sortDir} onSort={toggleSort} /><SortableTh label="联系方式" field="phone" sortBy={sortBy} sortDir={sortDir} onSort={toggleSort} /><SortableTh label="最近登录" field="last_login_at" sortBy={sortBy} sortDir={sortDir} onSort={toggleSort} /><SortableTh label="状态" field="status" sortBy={sortBy} sortDir={sortDir} onSort={toggleSort} /><th className="text-right">操作</th></tr></thead>
              <tbody>
                {paged.map((user) => (
                  <tr key={user.id} className="group">
                    <td><Checkbox checked={selectedIds.has(user.id)} onChange={() => toggleSelected(user.id)} /></td>
                    <td>
                      <div className="flex items-center gap-2.5">
                        <Avatar name={user.name} src={user.avatar_url} color={user.avatar_color} size="md" />
                        <div>
                          <div className="flex items-center gap-1.5">
                            <p className="text-[12px] font-medium text-slate-700">{user.name}</p>
                            {user.id === currentUser?.id ? <span className="rounded bg-brand-50 px-1 py-0.5 text-[8px] font-medium text-brand-600">我</span> : null}
                          </div>
                          <p className="mt-0.5 font-mono text-[9px] text-slate-400">{user.username}</p>
                        </div>
                      </div>
                    </td>
                    <td><Badge className={user.role_code === 'admin' ? 'bg-violet-50 text-violet-700 ring-violet-600/15' : user.role_code === 'ops' ? 'bg-white text-brand-700 ring-brand-200' : 'bg-slate-100 text-slate-600 ring-slate-500/10'}>{user.role_name || '—'}</Badge></td>
                    <td><p className="text-[11px] text-slate-600">{user.department || '—'}</p><p className="mt-0.5 text-[9.5px] text-slate-400">{user.title || '—'}</p></td>
                    <td><p className="flex items-center gap-1 text-[10px] text-slate-500"><Mail className="h-2.5 w-2.5 text-slate-400" />{user.email || '—'}</p><p className="mt-0.5 flex items-center gap-1 text-[9.5px] text-slate-400"><Phone className="h-2.5 w-2.5" />{user.phone || '—'}</p></td>
                    <td className="whitespace-nowrap text-[10px] text-slate-400">{user.last_login_at ? relativeTime(user.last_login_at) : '从未登录'}</td>
                    <td><Badge className={user.status === 'active' ? 'bg-emerald-50 text-emerald-700 ring-emerald-600/15' : 'bg-slate-100 text-slate-500 ring-slate-500/10'} dot={user.status === 'active' ? 'bg-emerald-500' : 'bg-slate-400'}>{user.status === 'active' ? '正常' : '已停用'}</Badge></td>
                    <td>
                      <div className="flex items-center justify-end gap-0.5 opacity-0 transition group-hover:opacity-100">
                        <IconButton icon={Pencil} label="编辑" onClick={() => openEdit(user)} />
                        <IconButton icon={user.status === 'active' ? UserX : UserCheck} label={user.status === 'active' ? '停用' : '启用'} onClick={() => toggleStatus(user)} disabled={user.id === currentUser?.id} />
                        <IconButton icon={Trash2} label="删除" variant="danger" onClick={() => setDeleteTarget(user)} disabled={user.id === currentUser?.id || user.username === 'admin'} />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="flex flex-col items-center justify-between gap-2 border-t border-[#eef1f6] px-4 py-2.5 sm:flex-row">
              <PageSizeSelect value={pageSize} onChange={setPageSize} />
              <Pagination page={page} pageSize={pageSize} total={filtered.length} onChange={setPage} />
            </div>
          </div>
        ) : (
          <EmptyState title="没有匹配的用户" description="调整搜索条件，或邀请新用户加入平台。" icon={UserRound} action={<Button size="sm" icon={Plus} onClick={openCreate}>新增用户</Button>} />
        )}
      </div>

      <div className="mt-3 flex items-center gap-1.5 px-1 text-[9.5px] text-slate-400">
        <ShieldCheck className="h-3 w-3" />
        账号状态与角色变更即时生效。停用账号不会删除历史工单与审计记录。
      </div>

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editing ? `编辑用户 · ${editing.name}` : '新增平台用户'}
        description="分配角色后，用户将继承角色的功能权限。"
        icon={UserRound}
        size="md"
        footer={<><Button variant="secondary" size="sm" onClick={() => setModalOpen(false)}>取消</Button><Button size="sm" loading={saving} onClick={save}>{editing ? '保存' : '创建用户'}</Button></>}
      >
        {error ? <div className="mb-3 rounded-lg border border-rose-100 bg-rose-50 px-3 py-2 text-[11px] text-rose-700">{error}</div> : null}
        <div className="space-y-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="姓名" required><Input value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} placeholder="真实姓名" /></Field>
            <Field label="用户名" required hint="登录账号，创建后不建议修改">
              <Input value={form.username} onChange={(event) => setForm((current) => ({ ...current, username: event.target.value }))} placeholder="zhangsan" className="font-mono" disabled={Boolean(editing)} />
            </Field>
            <Field label={editing ? '重置密码' : '初始密码'} hint={editing ? '留空则不修改密码' : '留空将按密码策略自动生成，创建后显示初始密码'}>
              <Input type="password" value={form.password} onChange={(event) => setForm((current) => ({ ...current, password: event.target.value }))} placeholder={editing ? '留空保持不变' : '留空自动生成'} autoComplete="new-password" />
            </Field>
            {!editing ? <label className="flex items-center gap-2 text-[10.5px] text-slate-600"><input type="checkbox" checked={notifyUser} onChange={(event) => setNotifyUser(event.target.checked)} /> 创建后通过已启用通知渠道通知用户</label> : null}
            <Field label="角色" required>
              <select className="input-base" value={form.role_id} onChange={(event) => setForm((current) => ({ ...current, role_id: event.target.value }))}>
                <option value="">选择角色</option>
                {roles.map((role) => <option key={role.id} value={role.id}>{role.name} · {role.permissions.length} 项权限</option>)}
              </select>
            </Field>
            <Field label="邮箱"><Input type="email" value={form.email} onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))} placeholder="name@company.com" /></Field>
            <Field label="手机号"><Input value={form.phone} onChange={(event) => setForm((current) => ({ ...current, phone: event.target.value }))} placeholder="138-0000-0000" /></Field>
            <Field label="部门"><Input value={form.department} onChange={(event) => setForm((current) => ({ ...current, department: event.target.value }))} placeholder="信息技术部" /></Field>
            <Field label="职位"><Input value={form.title} onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))} placeholder="运维工程师" /></Field>
          </div>
          <Field label="头像颜色">
            <div className="flex flex-wrap gap-2 pt-1">
              {AVATAR_COLORS.map((color) => (
                <button key={color} type="button" onClick={() => setForm((current) => ({ ...current, avatar_color: color }))} className="flex h-7 w-7 items-center justify-center rounded-full" style={{ background: color, boxShadow: form.avatar_color === color ? `0 0 0 2px white, 0 0 0 4px ${color}` : undefined }}>
                  {form.avatar_color === color ? <Check className="h-3 w-3 text-white" /> : null}
                </button>
              ))}
            </div>
          </Field>
          <div className="rounded-xl border border-slate-200 bg-slate-50/50 p-3">
            <div className="mb-2 flex items-start gap-2">
              <span className="mt-0.5 flex h-5 w-5 items-center justify-center rounded-md bg-brand-50 text-brand-600"><BellRing className="h-3 w-3" /></span>
              <div>
                <p className="text-[11px] font-medium text-slate-700">通知账号</p>
                <p className="mt-0.5 text-[9px] leading-relaxed text-slate-400">用于飞书 / 企业微信机器人 @ 到人，可选。邮件通知使用上方邮箱。</p>
              </div>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="飞书 open_id" hint="例如 ou_xxxxxxxx">
                <Input value={form.feishu_open_id || ''} onChange={(event) => setForm((current) => ({ ...current, feishu_open_id: event.target.value }))} placeholder="ou_..." className="font-mono text-[11px]" />
              </Field>
              <Field label="企业微信 userid" hint="企业通讯录中的成员账号">
                <Input value={form.wecom_userid || ''} onChange={(event) => setForm((current) => ({ ...current, wecom_userid: event.target.value }))} placeholder="zhangsan" className="font-mono text-[11px]" />
              </Field>
            </div>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-3">
            <p className="mb-2 text-[11px] font-medium text-slate-700">登录来源限制</p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="允许 IP" hint="逗号分隔，支持 10.0.* 前缀；留空不限制">
                <Input value={form.allowed_ips || ''} onChange={(event) => setForm((current) => ({ ...current, allowed_ips: event.target.value }))} placeholder="10.20.*, 192.168.1.8" className="font-mono text-[11px]" />
              </Field>
              <Field label="绑定 MAC" hint="需反向代理传递 X-Client-MAC 才强制校验">
                <Input value={form.bound_mac || ''} onChange={(event) => setForm((current) => ({ ...current, bound_mac: event.target.value }))} placeholder="00:1A:2B:3C:4D:5E" className="font-mono text-[11px]" />
              </Field>
            </div>
          </div>
          {editing ? (
            <div className="flex items-center justify-between rounded-xl border border-slate-200 px-3 py-2.5">
              <div><p className="text-[11px] font-medium text-slate-700">账号状态</p><p className="text-[9px] text-slate-400">停用后用户无法登录。</p></div>
              <Toggle checked={form.status === 'active'} onChange={(checked) => setForm((current) => ({ ...current, status: checked ? 'active' : 'disabled' }))} disabled={editing.id === currentUser?.id} />
            </div>
          ) : null}
        </div>
      </Modal>

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onClose={() => setDeleteTarget(null)}
        onConfirm={confirmDelete}
        loading={deleting}
        title="删除用户"
        confirmText="确认删除"
        description={<>确定删除账号「{deleteTarget?.name}」吗？其历史工单与审计记录会保留，但无法继续登录。</>}
      />

      <Modal open={batchDeleteOpen} onClose={() => setBatchDeleteOpen(false)} title="批量删除用户" description={`将删除已选择的 ${selectedIds.size} 个用户，历史工单与审计记录保留。`} icon={Trash2} size="sm" footer={<><Button variant="secondary" size="sm" onClick={() => setBatchDeleteOpen(false)}>取消</Button><Button variant="danger" size="sm" onClick={() => batchAction('delete')}>确认批量删除</Button></>}>
        <p className="rounded-lg bg-rose-50 px-3 py-2 text-[10.5px] text-rose-700">内置管理员与当前登录账号不会被删除。</p>
      </Modal>

      <Modal open={importOpen} onClose={() => setImportOpen(false)} title="导入用户" description="支持 CSV 文件，列名与导出模板一致；已存在的用户名会更新资料。" icon={Download} size="md" footer={<><Button variant="secondary" size="sm" onClick={() => setImportOpen(false)}>取消</Button><Button size="sm" loading={importing} onClick={importUsers}>开始导入</Button></>}>
        <div className="space-y-3">
          <label className="flex min-h-[120px] cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed border-slate-300 bg-slate-50/60 p-4 text-center hover:border-brand-300 hover:bg-brand-50/30">
            <Download className="h-6 w-6 text-slate-400" />
            <p className="mt-2 text-[11px] font-medium text-slate-600">选择用户 CSV 文件</p>
            <p className="mt-1 text-[9.5px] text-slate-400">建议先点击「导出」获取模板；未填写密码时默认 ChangeMe123</p>
            <input type="file" accept=".csv,text/csv" className="hidden" onChange={(event) => {
              const file = event.target.files?.[0];
              if (!file) return;
              const reader = new FileReader();
              reader.onload = () => setImportRows(parseCsv(String(reader.result || '')));
              reader.readAsText(file, 'utf-8');
            }} />
          </label>
          {importRows.length ? <p className="rounded-lg bg-emerald-50 px-3 py-2 text-[10.5px] text-emerald-700">已解析 {importRows.length} 行用户数据，点击开始导入。</p> : null}
          <p className="text-[9.5px] leading-relaxed text-slate-400">角色列请填写角色标识（admin/ops/approver/employee）或角色名称；状态填写 active 或 disabled。</p>
        </div>
      </Modal>
      <Modal open={securityOpen} onClose={() => setSecurityOpen(false)} title="登录安全策略" description="限制来源 IP、配置失败锁定；用户级 IP/MAC 可在编辑用户中设置。" icon={ShieldCheck} size="md" footer={<><Button variant="secondary" size="sm" onClick={() => setSecurityOpen(false)}>取消</Button><Button size="sm" loading={securitySaving} onClick={async () => {
        setSecuritySaving(true);
        try {
          const response = await api.put<{ data: any }>('/api/system/login-security', security);
          setSecurity(response.data); setSecurityOpen(false); toast.success('登录安全策略已保存');
        } catch (error: any) { toast.error(error.message); } finally { setSecuritySaving(false); }
      }}>保存策略</Button></>}>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Field label="密码错误次数"><Input type="number" min="1" max="100" value={security.max_failures} onChange={(event) => setSecurity((current: any) => ({ ...current, max_failures: event.target.value }))} /></Field>
            <Field label="锁定时长（分钟）"><Input type="number" min="1" max="1440" value={security.lock_minutes} onChange={(event) => setSecurity((current: any) => ({ ...current, lock_minutes: event.target.value }))} /></Field>
            <Field label="登录超时（分钟）" hint="超过该时间无任何操作自动注销"><Input type="number" min="1" max="1440" value={security.idle_timeout_minutes ?? 10} onChange={(event) => setSecurity((current: any) => ({ ...current, idle_timeout_minutes: event.target.value }))} /></Field>
          </div>
          <Field label="IP 白名单" hint="逗号/换行分隔；支持 10.20.* 和 10.20. 前缀；留空不启用"><textarea className="input-base min-h-[64px] font-mono text-[11px]" value={security.ip_whitelist || ''} onChange={(event) => setSecurity((current: any) => ({ ...current, ip_whitelist: event.target.value }))} placeholder="10.20.*, 192.168.1." /></Field>
          <Field label="IP 黑名单" hint="优先于白名单匹配"><textarea className="input-base min-h-[64px] font-mono text-[11px]" value={security.ip_blacklist || ''} onChange={(event) => setSecurity((current: any) => ({ ...current, ip_blacklist: event.target.value }))} placeholder="203.0.113.8" /></Field>
          <p className="text-[9.5px] leading-relaxed text-slate-400">MAC 绑定需在反向代理中传递 X-Client-MAC 请求头；未传递时只记录不强制校验。</p>
        </div>
      </Modal>

      <Modal open={policyOpen} onClose={() => setPolicyOpen(false)} title="密码复杂度与过期策略" description="新用户初始密码会按此策略自动生成；用户密码过期后登录会强制修改。" icon={KeyRound} size="md" footer={<><Button variant="secondary" size="sm" onClick={() => setPolicyOpen(false)}>取消</Button><Button size="sm" loading={policySaving} onClick={async () => {
        setPolicySaving(true);
        try {
          const response = await api.put<{ data: any }>('/api/system/password-policy', {
            min_length: Number(policy.min_length),
            require_upper: Boolean(policy.require_upper),
            require_lower: Boolean(policy.require_lower),
            require_number: Boolean(policy.require_number),
            require_symbol: Boolean(policy.require_symbol),
            expire_days: Number(policy.expire_days),
            notify_user: Boolean(policy.notify_user),
          });
          setPolicy(response.data); setPolicyOpen(false); toast.success('密码策略已保存');
        } catch (error: any) { toast.error(error.message); } finally { setPolicySaving(false); }
      }}>保存策略</Button></>}>
        {policy ? <div className="space-y-3">
          <Field label="最小长度"><Input type="number" min="6" max="64" value={policy.min_length} onChange={(event) => setPolicy((current: any) => ({ ...current, min_length: event.target.value }))} /></Field>
          <Field label="密码过期天数" hint="0 表示永不过期"><Input type="number" min="0" max="3650" value={policy.expire_days} onChange={(event) => setPolicy((current: any) => ({ ...current, expire_days: event.target.value }))} /></Field>
          <div className="grid grid-cols-2 gap-2 rounded-xl border border-slate-200 p-3 text-[10.5px] text-slate-600">
            {[
              ['require_upper', '必须包含大写字母'],
              ['require_lower', '必须包含小写字母'],
              ['require_number', '必须包含数字'],
              ['require_symbol', '必须包含符号'],
              ['notify_user', '创建用户时默认通知'],
            ].map(([key, label]) => <label key={key} className="flex items-center gap-1.5"><input type="checkbox" checked={Boolean(policy[key])} onChange={(event) => setPolicy((current: any) => ({ ...current, [key]: event.target.checked }))} />{label}</label>)}
          </div>
          <p className="text-[9.5px] text-slate-400">可用符号：~ ! @ # $ % ^ &amp; * . - _ + =</p>
        </div> : <Skeleton className="h-40" />}
      </Modal>

      <Modal open={Boolean(initialPassword)} onClose={() => setInitialPassword('')} title="用户创建成功" description="请将初始密码安全地交给用户，首次登录后可自行修改。" icon={KeyRound} size="sm" footer={<Button size="sm" onClick={() => setInitialPassword('')}>我已保存</Button>}>
        <div className="rounded-xl border border-brand-200 bg-brand-50/60 p-4 text-center">
          <p className="text-[9.5px] text-brand-700/70">初始密码</p>
          <p className="mt-1 break-all font-mono text-[18px] font-semibold tracking-wider text-brand-900">{initialPassword}</p>
          <button onClick={() => { navigator.clipboard?.writeText(initialPassword); toast.success('初始密码已复制'); }} className="mt-3 rounded-lg bg-white px-3 py-1.5 text-[10px] font-medium text-brand-700 ring-1 ring-brand-200 hover:bg-brand-50">复制密码</button>
        </div>
      </Modal>
    </div>
  );
}
