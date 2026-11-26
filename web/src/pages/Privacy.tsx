import { ArrowLeft, ShieldCheck } from 'lucide-react';
import { Link } from 'react-router-dom';
import { BrandMark } from '@/components/AppLayout';
import { PrivacyPolicyContent, PrivacyPolicyLoader, usePrivacyPolicy } from '@/components/PrivacyPolicy';
import { Button } from '@/components/ui';
import { useAuth } from '@/context/AuthContext';
import { useBranding } from '@/context/BrandingContext';

export default function PrivacyPage() {
  const { policy, loading, error } = usePrivacyPolicy();
  const { user } = useAuth();
  const { branding } = useBranding();
  return (
    <div className="min-h-screen bg-[#f5f6fa]">
      <header className="border-b border-[#e7eaf1] bg-white">
        <div className="mx-auto flex h-[64px] max-w-5xl items-center justify-between px-4 sm:px-6">
          <Link to={user ? '/' : '/login'} className="flex items-center gap-2.5">
            <BrandMark />
            <div>
              <p className="text-[15px] font-semibold tracking-tight text-slate-900">{branding.system_name}</p>
              <p className="text-[8.5px] uppercase tracking-[0.18em] text-slate-400">Privacy & Compliance</p>
            </div>
          </Link>
          <Link to={user ? '/' : '/login'}>
            <Button variant="secondary" size="sm" icon={ArrowLeft}>{user ? '返回工作台' : '返回登录'}</Button>
          </Link>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
        <div className="mb-5">
          <div className="mb-2 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-brand-600">
            <ShieldCheck className="h-3.5 w-3.5" /> Privacy statement
          </div>
          <h1 className="text-[25px] font-semibold tracking-[-0.025em] text-slate-900">隐私保护与数据使用协议</h1>
          <p className="mt-1.5 max-w-2xl text-[12px] leading-relaxed text-slate-500">
            本页面长期公开访问。你可以在登录前或登录后随时查阅协议全文与版本信息。
          </p>
        </div>
        <div className="card p-5 sm:p-7">
          {loading ? <PrivacyPolicyLoader /> : error ? <p className="text-[12px] text-rose-600">{error}</p> : policy ? <PrivacyPolicyContent policy={policy} /> : null}
        </div>
        <p className="mt-4 text-center text-[9.5px] text-slate-400">© 2026 {branding.system_name} · 数据安全与隐私合规</p>
      </main>
    </div>
  );
}
