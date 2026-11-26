import { useEffect, useState } from 'react';
import { Check, Info, ShieldCheck, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { usePageTitle } from '@/lib/hooks';
import { cn } from '@/lib/utils';
import type { Role } from '@/lib/types';
import { Button, Checkbox, PageHeader, Skeleton } from '@/components/ui';

export default function DeletionPolicyPage() {
  usePageTitle('删除审批流程');
  const [roles, setRoles] = useState<Role[]>([]);
  const [selected, setSelected] = useState<number[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const [policy, roleResponse] = await Promise.all([
        api.get<{ data: any }>('/api/deletion-policy'),
        api.get<{ data: Role[] }>('/api/roles'),
      ]);
      setSelected(policy.data.approver_role_ids || []);
      setRoles(roleResponse.data.filter((role) => role.code !== 'admin'));
    } catch (error: any) {
      toast.error(error.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const toggle = (id: number) => setSelected((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);

  const save = async () => {
    setSaving(true);
    try {
      await api.put('/api/deletion-policy', { approver_role_ids: selected });
      toast.success('删除审批流程已更新');
    } catch (error: any) {
      toast.error(error.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="animate-enter">
      <PageHeader eyebrow="Governance" title="删除审批流程" description="超级管理员可删除任意状态工单且无需审批；其他用户删除工单时必须经过这里配置的审批角色。" />
      <div className="grid gap-3.5 xl:grid-cols-12">
        <div className="card overflow-hidden xl:col-span-8">
          <div className="border-b border-[#eef1f6] px-5 py-4">
            <h2 className="text-[13px] font-semibold text-slate-800">审批角色</h2>
            <p className="mt-0.5 text-[10px] text-slate-400">勾选可以审批删除申请的角色；未勾选时仅超级管理员可处理删除。</p>
          </div>
          {loading ? <div className="space-y-2 p-4">{[1, 2, 3].map((item) => <Skeleton key={item} className="h-12" />)}</div> : (
            <div className="divide-y divide-[#f0f2f7]">
              {roles.map((role) => {
                const checked = selected.includes(role.id);
                return (
                  <button key={role.id} onClick={() => toggle(role.id)} className={cn('flex w-full items-center gap-3 px-5 py-3.5 text-left transition', checked ? 'bg-brand-50/40' : 'hover:bg-slate-50')}>
                    <span className={cn('flex h-8 w-8 items-center justify-center rounded-lg', checked ? 'bg-brand-100 text-brand-700' : 'bg-slate-100 text-slate-400')}><ShieldCheck className="h-3.5 w-3.5" /></span>
                    <div className="min-w-0 flex-1"><p className="text-[12px] font-medium text-slate-700">{role.name}</p><p className="mt-0.5 text-[9.5px] text-slate-400">{role.description || role.code}</p></div>
                    <div className={cn('flex h-5 w-5 items-center justify-center rounded border', checked ? 'border-brand-600 bg-brand-600 text-white' : 'border-slate-300 bg-white')}>{checked ? <Check className="h-3 w-3" /> : null}</div>
                  </button>
                );
              })}
            </div>
          )}
          <div className="flex justify-end border-t border-[#eef1f6] px-5 py-3"><Button size="sm" loading={saving} onClick={save}>保存审批流程</Button></div>
        </div>
        <div className="space-y-3.5 xl:col-span-4">
          <div className="rounded-xl border border-amber-100 bg-amber-50/60 p-4 text-[10.5px] leading-relaxed text-amber-800">
            <p className="flex items-center gap-1.5 font-semibold"><Info className="h-3.5 w-3.5" /> 删除规则</p>
            <p className="mt-2">超级管理员是平台最高权限，删除任意状态工单时只需二次确认，不进入审批。</p>
            <p className="mt-1.5">非超级管理员提交删除申请后，必须由上述任一角色审批；审批人不能审批自己发起的申请。</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4 text-[10px] leading-relaxed text-slate-500">
            <p className="flex items-center gap-1.5 font-medium text-slate-700"><Trash2 className="h-3.5 w-3.5" /> 审批范围</p>
            <p className="mt-2">工单列表中的「待删除审批」入口只对已配置角色显示，审批通过后工单及评论、流转记录会被永久删除。</p>
          </div>
        </div>
      </div>
    </div>
  );
}
