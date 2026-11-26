import { useEffect, useRef, useState } from 'react';
import { AtSign, Building2, Camera, Check, KeyRound, Mail, Phone, ShieldCheck, Trash2, UserRound } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { usePageTitle } from '@/lib/hooks';
import { useAuth } from '@/context/AuthContext';
import { cn, formatDate } from '@/lib/utils';
import { Avatar, Badge, Button, Field, Input, PageHeader, SectionHeading } from '@/components/ui';

const GROUP_META: Record<string, string> = {
  概览: 'bg-sky-50 text-sky-700',
  CMDB: 'bg-brand-50 text-brand-700',
  ITSM: 'bg-violet-50 text-violet-700',
  自动化: 'bg-rose-50 text-rose-700',
  系统: 'bg-amber-50 text-amber-700',
};

export default function ProfilePage() {
  usePageTitle('个人资料');
  const { user, refresh } = useAuth();
  const [form, setForm] = useState({ name: '', email: '', phone: '', title: '', feishu_open_id: '', wecom_userid: '' });
  const [saving, setSaving] = useState(false);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [passwords, setPasswords] = useState({ currentPassword: '', newPassword: '', confirm: '' });
  const [changing, setChanging] = useState(false);
  const [passwordPolicy, setPasswordPolicy] = useState<any>({ min_length: 6 });
  const [avatarBusy, setAvatarBusy] = useState(false);
  const avatarInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (user) setForm({ name: user.name || '', email: user.email || '', phone: user.phone || '', title: user.title || '', feishu_open_id: user.feishu_open_id || '', wecom_userid: user.wecom_userid || '' });
  }, [user]);
  useEffect(() => {
    api.get<{ data: any }>('/api/auth/password-policy').then((response) => setPasswordPolicy(response.data)).catch(() => {});
  }, []);

  if (!user) return null;

  const save = async () => {
    if (!form.name.trim()) return toast.error('姓名不能为空');
    setSaving(true);
    try {
      await api.put('/api/profile', form);
      await refresh();
      toast.success('个人资料已更新');
    } catch (error: any) {
      toast.error(error.message);
    } finally {
      setSaving(false);
    }
  };

  const uploadAvatar = async (file?: File) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) return toast.error('请选择图片文件');
    if (file.size > 1024 * 1024) return toast.error('头像图片不能超过 1MB');
    setAvatarBusy(true);
    try {
      const body = new FormData();
      body.append('avatar', file);
      await api.post('/api/profile/avatar', body);
      await refresh();
      toast.success('头像已更新');
    } catch (error: any) {
      toast.error(error.message);
    } finally {
      setAvatarBusy(false);
      if (avatarInputRef.current) avatarInputRef.current.value = '';
    }
  };

  const removeAvatar = async () => {
    setAvatarBusy(true);
    try {
      await api.delete('/api/profile/avatar');
      await refresh();
      toast.success('已恢复默认头像');
    } catch (error: any) {
      toast.error(error.message);
    } finally {
      setAvatarBusy(false);
    }
  };

  const changePassword = async () => {
    if (passwords.newPassword.length < (Number(passwordPolicy.min_length) || 6)) return toast.error(`新密码至少 ${Number(passwordPolicy.min_length) || 6} 位`);
    if (passwords.newPassword !== passwords.confirm) return toast.error('两次密码不一致');
    setChanging(true);
    try {
      await api.post('/api/auth/change-password', { currentPassword: passwords.currentPassword, newPassword: passwords.newPassword });
      toast.success('密码已更新');
      setPasswordOpen(false);
      setPasswords({ currentPassword: '', newPassword: '', confirm: '' });
    } catch (error: any) {
      toast.error(error.message);
    } finally {
      setChanging(false);
    }
  };

  const permissions = user.permissions || user.role?.permissions || [];
  const grouped = permissions.reduce<Record<string, string[]>>((groups, code) => {
    const group = code.startsWith('cmdb')
      ? 'CMDB'
      : code.startsWith('itsm')
        ? 'ITSM'
        : code.startsWith('dashboard')
          ? '概览'
          : code.startsWith('integration')
            ? '自动化'
            : '系统';
    groups[group] = groups[group] || [];
    groups[group].push(code);
    return groups;
  }, {});

  return (
    <div className="animate-enter">
      <PageHeader eyebrow="My account" title="个人资料" description="管理你的账号信息、安全设置与查看权限范围。" />

      <div className="grid grid-cols-1 gap-3.5 xl:grid-cols-12">
        <div className="space-y-3.5 xl:col-span-4">
          <div className="card overflow-hidden">
            <div
              className="h-14"
              style={{
                background: `linear-gradient(135deg, color-mix(in srgb, ${user.avatar_color || '#4f6ef7'} 26%, white) 0%, var(--theme-primary-light) 100%)`,
              }}
            />
            <div className="px-5 pb-5">
              <div className="-mt-6 flex items-end justify-between">
                <Avatar name={user.name} src={user.avatar_url} color={user.avatar_color} size="xl" className="ring-4 ring-white" />
                <Badge className="mb-1 bg-emerald-50 text-emerald-700 ring-emerald-600/15" dot="bg-emerald-500">账号正常</Badge>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <input
                  ref={avatarInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/gif"
                  className="hidden"
                  onChange={(event) => uploadAvatar(event.target.files?.[0])}
                />
                <Button variant="secondary" size="xs" icon={Camera} loading={avatarBusy} onClick={() => avatarInputRef.current?.click()}>更换头像</Button>
                {user.avatar_url ? <Button variant="ghost" size="xs" icon={Trash2} disabled={avatarBusy} onClick={removeAvatar}>恢复默认</Button> : null}
                <span className="text-[9.5px] text-slate-400">JPG/PNG/WebP/GIF，不超过 1MB</span>
              </div>
              <h2 className="mt-3 text-[18px] font-semibold text-slate-900">{user.name}</h2>
              <p className="mt-0.5 text-[11px] text-slate-500">{user.title || '平台用户'} · {user.department || '未设置部门'}</p>
              <div className="mt-3 flex items-center gap-1.5">
                <Badge className="bg-white text-brand-700 ring-brand-200">{user.role?.name}</Badge>
                <span className="text-[9.5px] text-slate-400">@{user.username}</span>
              </div>
              <div className="mt-4 space-y-2.5 border-t border-slate-100 pt-4">
                <InfoLine icon={Mail} value={user.email || '未设置邮箱'} />
                <InfoLine icon={Phone} value={user.phone || '未设置手机号'} />
                <InfoLine icon={Building2} value={user.department || '未设置部门'} />
                <InfoLine icon={AtSign} value={`上次登录：${user.last_login_at ? formatDate(user.last_login_at) : '首次登录'}`} />
              </div>
              <Button variant="secondary" size="sm" icon={KeyRound} onClick={() => setPasswordOpen(true)} className="mt-4 w-full">修改登录密码</Button>
            </div>
          </div>

          <div className="card overflow-hidden">
            <SectionHeading title="角色权限" description={`${permissions.length} 项权限`} />
            <div className="space-y-2 p-4">
              {Object.entries(grouped).map(([group, codes]) => (
                <div key={group} className="flex items-center justify-between rounded-lg bg-slate-50 px-2.5 py-2">
                  <span className={cn('rounded px-1.5 py-0.5 text-[9px] font-medium', GROUP_META[group] || 'bg-slate-100 text-slate-600')}>{group}</span>
                  <span className="text-[10px] text-slate-500">{codes.length} 项</span>
                </div>
              ))}
              {permissions.length === 0 ? <p className="py-4 text-center text-[10px] text-slate-400">当前角色暂无功能权限</p> : null}
            </div>
          </div>
        </div>

        <div className="space-y-3.5 xl:col-span-8">
          <div className="card overflow-hidden">
            <SectionHeading title="基本信息" description="这些信息会展示在工单与审计记录中。" />
            <div className="p-5">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field label="姓名" required><Input value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} /></Field>
                <Field label="职位"><Input value={form.title} onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))} /></Field>
                <Field label="邮箱"><Input type="email" value={form.email} onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))} /></Field>
                <Field label="手机号"><Input value={form.phone} onChange={(event) => setForm((current) => ({ ...current, phone: event.target.value }))} /></Field>
                <Field label="用户名"><Input value={user.username} disabled /></Field>
                <Field label="所属部门"><Input value={user.department} disabled /></Field>
                <Field label="飞书 open_id" hint="用于飞书机器人 @ 到你，可留空">
                  <Input value={form.feishu_open_id} onChange={(event) => setForm((current) => ({ ...current, feishu_open_id: event.target.value }))} placeholder="ou_..." className="font-mono text-[11px]" />
                </Field>
                <Field label="企业微信 userid" hint="企业通讯录中的成员账号，可留空">
                  <Input value={form.wecom_userid} onChange={(event) => setForm((current) => ({ ...current, wecom_userid: event.target.value }))} placeholder="zhangsan" className="font-mono text-[11px]" />
                </Field>
              </div>
              <div className="mt-5 flex justify-end">
                <Button size="sm" loading={saving} onClick={save}>保存资料</Button>
              </div>
            </div>
          </div>

          <div className="card overflow-hidden">
            <SectionHeading title="安全与访问" description="账号安全状态与登录信息" />
            <div className="grid gap-3 p-5 sm:grid-cols-3">
              <SecurityCard icon={ShieldCheck} title="角色权限" value={user.role?.name || '—'} desc={`拥有 ${permissions.length} 项功能权限`} tone="text-emerald-600 bg-emerald-50" />
              <SecurityCard icon={KeyRound} title="登录密码" value="已设置" desc="建议定期更换密码" tone="text-brand-600 bg-brand-50" />
              <SecurityCard icon={UserRound} title="账号状态" value="正常" desc="当前可以正常访问平台" tone="text-violet-600 bg-violet-50" />
            </div>
          </div>

          <div className="rounded-xl border border-dashed border-slate-200 bg-white/60 p-4 text-[10px] leading-relaxed text-slate-400">
            账号由平台管理员创建与分配角色。如需更高权限，请联系 IT 服务经理或系统管理员；所有权限变更都会记入审计日志。
          </div>
        </div>
      </div>

      {passwordOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-ink-950/45" onClick={() => setPasswordOpen(false)} />
          <div className="animate-scale-in relative w-full max-w-md rounded-lg border border-[#e5e6eb] bg-white p-5 shadow-[var(--shadow-float)]">
            <h3 className="text-[15px] font-semibold text-slate-900">修改登录密码</h3>
            <p className="mt-1 text-[11px] text-slate-500">更新后当前会话仍然有效，下次登录使用新密码。</p>
            <div className="mt-4 space-y-3">
              <Field label="当前密码"><Input type="password" value={passwords.currentPassword} onChange={(event) => setPasswords((current) => ({ ...current, currentPassword: event.target.value }))} /></Field>
              <Field label="新密码" hint={`至少 ${Number(passwordPolicy.min_length) || 6} 位`}><Input type="password" value={passwords.newPassword} onChange={(event) => setPasswords((current) => ({ ...current, newPassword: event.target.value }))} /></Field>
              <Field label="确认新密码"><Input type="password" value={passwords.confirm} onChange={(event) => setPasswords((current) => ({ ...current, confirm: event.target.value }))} /></Field>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <Button variant="secondary" size="sm" onClick={() => setPasswordOpen(false)}>取消</Button>
              <Button size="sm" loading={changing} onClick={changePassword}>更新密码</Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function InfoLine({ icon: Icon, value }: { icon: any; value: string }) {
  return (
    <div className="flex items-center gap-2 text-[10.5px] text-slate-500">
      <Icon className="h-3.5 w-3.5 text-slate-400" />
      <span className="truncate">{value}</span>
    </div>
  );
}

function SecurityCard({ icon: Icon, title, value, desc, tone }: { icon: any; title: string; value: string; desc: string; tone: string }) {
  return (
    <div className="rounded-xl border border-slate-100 p-3.5">
      <span className={cn('flex h-8 w-8 items-center justify-center rounded-lg', tone)}><Icon className="h-4 w-4" /></span>
      <p className="mt-2.5 text-[9px] text-slate-400">{title}</p>
      <p className="mt-0.5 text-[12px] font-semibold text-slate-700">{value}</p>
      <p className="mt-0.5 text-[9px] text-slate-400">{desc}</p>
    </div>
  );
}
