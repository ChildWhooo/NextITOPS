import { useEffect, useState } from 'react';
import { Database, Plus, Save, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { usePageTitle } from '@/lib/hooks';
import { Button, Field, Input, PageHeader, Skeleton } from '@/components/ui';
import { cn } from '@/lib/utils';

type Key = 'ticket_sources' | 'priorities' | 'impacts' | 'urgencies' | 'change_types' | 'risks';
type Item = { value: string; label: string };
const TABS: Array<{ key: Key; label: string; hint: string }> = [
  { key: 'ticket_sources', label: '工单来源', hint: '用户报障、监控系统、巡检等来源入口' },
  { key: 'priorities', label: '优先级', hint: '事件、问题、变更的优先级下拉选项' },
  { key: 'impacts', label: '影响范围', hint: '影响范围下拉选项' },
  { key: 'urgencies', label: '紧急程度', hint: '紧急程度下拉选项' },
  { key: 'change_types', label: '变更类型', hint: '标准、普通、紧急变更等分类' },
  { key: 'risks', label: '风险等级', hint: '变更风险等级下拉选项' },
];

export default function BaseDataPage() {
  usePageTitle('基础数据设置');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [active, setActive] = useState<Key>('ticket_sources');
  const [data, setData] = useState<Record<Key, Item[]>>({ ticket_sources: [], priorities: [], impacts: [], urgencies: [], change_types: [], risks: [] });
  useEffect(() => {
    api.get<{ data: Record<Key, Item[]> }>('/api/base-data').then((response) => setData(response.data)).catch((error) => toast.error(error.message)).finally(() => setLoading(false));
  }, []);
  const items = data[active] || [];
  const update = (index: number, patch: Partial<Item>) => setData((current) => ({ ...current, [active]: current[active].map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item) }));
  const save = async () => {
    setSaving(true);
    try {
      const response = await api.put<{ data: Record<Key, Item[]> }>('/api/base-data', data);
      setData(response.data);
      toast.success('基础数据已保存');
    } catch (error: any) { toast.error(error.message); } finally { setSaving(false); }
  };
  const tab = TABS.find((item) => item.key === active)!;
  return (
    <div className="animate-enter">
      <PageHeader eyebrow="Master data" title="基础数据设置" description="集中维护工单来源、优先级、影响范围、紧急程度、变更类型和风险等级等下拉选项。" actions={<Button size="sm" icon={Save} loading={saving} onClick={save}>保存基础数据</Button>} />
      <div className="grid gap-3 lg:grid-cols-[220px_1fr]">
        <div className="card h-fit p-2">
          {TABS.map((item) => (
            <button key={item.key} onClick={() => setActive(item.key)} className={cn('flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-left text-[11.5px] font-medium transition', active === item.key ? 'bg-brand-50 text-brand-700' : 'text-slate-500 hover:bg-slate-50')}>
              <Database className="h-3.5 w-3.5" /> {item.label}
            </button>
          ))}
        </div>
        <div className="card overflow-hidden">
          <div className="flex items-center justify-between border-b border-[#eef1f6] px-5 py-3.5"><div><h2 className="text-[13px] font-semibold text-slate-800">{tab.label}</h2><p className="mt-0.5 text-[10px] text-slate-400">{tab.hint}</p></div><Button variant="secondary" size="sm" icon={Plus} onClick={() => setData((current) => ({ ...current, [active]: [...current[active], { value: '', label: '' }] }))}>添加选项</Button></div>
          {loading ? <div className="space-y-2 p-4"><Skeleton className="h-10" /><Skeleton className="h-10" /></div> : (
            <div className="space-y-2 p-4">
              {items.map((item, index) => (
                <div key={index} className="grid grid-cols-[1fr_1fr_32px] items-end gap-2 rounded-xl border border-slate-200 p-3">
                  <Field label="存储值"><Input value={item.value} onChange={(event) => update(index, { value: event.target.value })} className="font-mono text-[11px]" placeholder="例如 im" /></Field>
                  <Field label="显示名称"><Input value={item.label} onChange={(event) => update(index, { label: event.target.value })} placeholder="例如 IM 报障" /></Field>
                  <button onClick={() => setData((current) => ({ ...current, [active]: current[active].filter((_, itemIndex) => itemIndex !== index) }))} className="mb-2 flex h-7 w-7 items-center justify-center rounded text-slate-400 hover:bg-rose-50 hover:text-rose-600" aria-label="删除选项"><Trash2 className="h-3.5 w-3.5" /></button>
                </div>
              ))}
              {!items.length ? <p className="py-8 text-center text-[11px] text-slate-400">暂无选项，请添加。</p> : null}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
