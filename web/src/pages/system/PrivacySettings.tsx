import { useEffect, useState } from 'react';
import { Save, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { usePageTitle } from '@/lib/hooks';
import { Button, Field, Input, PageHeader, Skeleton } from '@/components/ui';

export default function PrivacySettingsPage() {
  usePageTitle('隐私协议设置');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [title, setTitle] = useState('');
  const [summary, setSummary] = useState('');
  const [body, setBody] = useState('');
  useEffect(() => {
    api.get<any>('/api/privacy').then((policy) => {
      setTitle(policy.title || '');
      setSummary(policy.summary || '');
      setBody((policy.sections || []).map((section: any) => `## ${section.title}\n${(section.paragraphs || []).join('\n\n')}${(section.bullets || []).length ? `\n- ${(section.bullets || []).join('\n- ')}` : ''}`).join('\n\n'));
    }).catch((error) => toast.error(error.message)).finally(() => setLoading(false));
  }, []);

  const save = async () => {
    setSaving(true);
    try {
      const sections = body.split(/^## /m).filter((block) => block.trim()).map((block) => {
        const [heading, ...rest] = block.trim().split('\n');
        const paragraphs: string[] = [];
        const bullets: string[] = [];
        let current = '';
        for (const line of rest) {
          if (line.trim().startsWith('- ')) { if (current.trim()) { paragraphs.push(current.trim()); current = ''; } bullets.push(line.trim().slice(2)); }
          else if (!line.trim()) { if (current.trim()) { paragraphs.push(current.trim()); current = ''; } }
          else current += `${current ? '\n' : ''}${line}`;
        }
        if (current.trim()) paragraphs.push(current.trim());
        return { title: heading.trim(), paragraphs, bullets };
      });
      await api.put('/api/privacy', { title, summary, sections });
      toast.success('隐私协议已更新，新登录用户将看到最新内容');
    } catch (error: any) { toast.error(error.message); } finally { setSaving(false); }
  };

  return (
    <div className="animate-enter">
      <PageHeader eyebrow="Privacy" title="隐私协议设置" description="自定义默认隐私协议；系统名称会自动同步到协议内容。" actions={<Button size="sm" icon={Save} loading={saving} onClick={save}>保存协议</Button>} />
      <div className="card overflow-hidden">
        <div className="border-b border-[#eef1f6] px-5 py-3.5"><h2 className="flex items-center gap-1.5 text-[13px] font-semibold text-slate-800"><ShieldCheck className="h-3.5 w-3.5 text-brand-500" /> 协议内容</h2><p className="mt-0.5 text-[10px] text-slate-400">正文使用「## 章节标题」开始新章节；段落用空行分隔，列表行以「- 」开头。</p></div>
        {loading ? <div className="space-y-2 p-5"><Skeleton className="h-10" /><Skeleton className="h-20" /><Skeleton className="h-64" /></div> : (
          <div className="space-y-3 p-5">
            <Field label="协议标题" required><Input value={title} onChange={(event) => setTitle(event.target.value)} /></Field>
            <Field label="协议摘要"><textarea className="input-base min-h-[72px]" value={summary} onChange={(event) => setSummary(event.target.value)} /></Field>
            <Field label="协议正文"><textarea className="input-base min-h-[420px] font-mono text-[11px] leading-6" value={body} onChange={(event) => setBody(event.target.value)} /></Field>
          </div>
        )}
      </div>
    </div>
  );
}
