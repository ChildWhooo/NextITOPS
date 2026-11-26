import { useEffect, useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import { api } from '@/lib/api';
import { Skeleton } from '@/components/ui';
import { cn } from '@/lib/utils';

export interface PrivacyPolicy {
  version: string;
  title: string;
  effectiveDate: string;
  updatedAt: string;
  summary: string;
  sections: Array<{ title: string; paragraphs?: string[]; bullets?: string[] }>;
}

export function usePrivacyPolicy() {
  const [policy, setPolicy] = useState<PrivacyPolicy | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    api
      .get<PrivacyPolicy>('/api/privacy')
      .then(setPolicy)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  return { policy, loading, error };
}

export function PrivacyPolicyContent({ policy, compact = false }: { policy: PrivacyPolicy; compact?: boolean }) {
  return (
    <div className={cn(compact ? 'space-y-3.5' : 'space-y-5')}>
      <div className="rounded-xl border border-brand-100 bg-brand-50/50 px-4 py-3">
        <div className="flex items-center gap-2 text-[11px] font-semibold text-brand-800">
          <ShieldCheck className="h-3.5 w-3.5" /> 隐私与数据使用协议
        </div>
        <p className="mt-1 text-[10.5px] leading-relaxed text-brand-800/70">{policy.summary}</p>
      </div>
      {policy.sections.map((section) => (
        <section key={section.title}>
          <h3 className="text-[12px] font-semibold text-slate-800">{section.title}</h3>
          {section.paragraphs?.map((paragraph) => (
            <p key={paragraph} className="mt-1.5 text-[10.5px] leading-6 text-slate-600">{paragraph}</p>
          ))}
          {section.bullets?.length ? (
            <ul className="mt-1.5 space-y-1 pl-4">
              {section.bullets.map((bullet) => (
                <li key={bullet} className="list-disc text-[10.5px] leading-5 text-slate-600">{bullet}</li>
              ))}
            </ul>
          ) : null}
        </section>
      ))}
      <p className="border-t border-slate-100 pt-3 text-[9.5px] text-slate-400">
        版本 {policy.version} · 生效日期 {policy.effectiveDate} · 最近更新 {policy.updatedAt}
      </p>
    </div>
  );
}

export function PrivacyPolicyLoader({ compact = false }: { compact?: boolean }) {
  return (
    <div className={cn('space-y-3', compact && 'space-y-2')}>
      <Skeleton className="h-20 w-full" />
      <Skeleton className="h-5 w-40" />
      <Skeleton className="h-16 w-full" />
      <Skeleton className="h-5 w-32" />
      <Skeleton className="h-24 w-full" />
    </div>
  );
}
