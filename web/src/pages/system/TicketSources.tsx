import { useEffect, useState } from 'react';
import { Plus, Save, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { usePageTitle } from '@/lib/hooks';
import { Button, Field, Input, PageHeader, Skeleton } from '@/components/ui';

export default function TicketSourcesPage() {
  usePageTitle('工单来源设置');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [sources, setSources] = useState<Array<{ value: string; label: string }>>([]);
  useEffect(() => {
    api.get<{ data: Array<{ value: string; label: string }> }>('/api/ticket-sources').then((response) => setSources(response.data)).catch((error) => toast.error(error.message)).finally(() => setLoading(false));
  }, []);
  const update = (index: number, patch: Partial<{ value: string; label: string }>) => setSources((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item));
  const save = async () => {
    setSaving(true);
    try {
      const response = await api.put<{ data: Array<{ value: string; label: string }> }>('/api/ticket-sources', { sources });
      setSources(response.data);
      toast.success('工单来源已保存');
    } catch (error: any) { toast.error(error.message); } finally { setSaving(false); }
  };
  return (
    <div className="animate-enter">
      <PageHeader eyebrow="ITSM sources" title="工单来源设置" description="配置新建事件、问题、变更时可选择的来源，例如 IM 报障、电话、邮件、监控系统。" actions={<Button size="sm" icon={Save} loading={saving} onClick={save}>保存来源</Button>} />
      <div className="card overflow-hidden">
        <div className="border-b border-[#eef1f6] px-5 py-3.5"><h2 className="text-[13px] font-semibold text-slate-800">可选来源</h2><p className="mt-0.5 text-[10px] text-slate-400">标识用于存储和统计，显示名称用于工单页面。</p></div>
        {loading ? <div className="space-y-2 p-4"><Skeleton className="h-10" /><Skeleton className="h-10" /></div> : (
          <div className="space-y-2 p-4">
            {sources.map((source, index) => (
              <div key={index} className="grid grid-cols-[1fr_1fr_32px] items-end gap-2 rounded-xl border border-slate-200 p-3">
                <Field label="标识"><Input value={source.value} onChange={(event) => update(index, { value: event.target.value })} className="font-mono text-[11px]" /></Field>
                <Field label="显示名称"><Input value={source.label} onChange={(event) => update(index, { label: event.target.value })} /></Field>
                <button onClick={() => setSources((current) => current.filter((_, itemIndex) => itemIndex !== index))} className="mb-2 flex h-7 w-7 items-center justify-center rounded text-slate-400 hover:bg-rose-50 hover:text-rose-600" aria-label="删除来源"><Trash2 className="h-3.5 w-3.5" /></button>
              </div>
            ))}
            <Button variant="secondary" size="sm" icon={Plus} onClick={() => setSources((current) => [...current, { value: '', label: '' }])}>添加来源</Button>
          </div>
        )}
      </div>
    </div>
  );
}
