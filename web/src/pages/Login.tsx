import { useEffect, useState, type CSSProperties } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import {
  ArrowRight,
  Eye,
  EyeOff,
  LockKeyhole,
  ShieldCheck,
  UserRound,
} from 'lucide-react';
import { usePageTitle } from '@/lib/hooks';
import { getSidebarTheme } from '@/lib/themes';
import { useBranding } from '@/context/BrandingContext';
import { useAuth } from '@/context/AuthContext';
import { ApiError } from '@/lib/api';
import { cn } from '@/lib/utils';
import { BrandMark } from '@/components/AppLayout';
import { PrivacyPolicyContent, PrivacyPolicyLoader, usePrivacyPolicy } from '@/components/PrivacyPolicy';
import { Button, Checkbox, Modal } from '@/components/ui';

function readThemeId(themeUser: string | null, fallback: string) {
  if (!themeUser) return fallback || 'ink';
  try {
    return localStorage.getItem(`nextitops_sidebar_theme_${themeUser}`) || fallback || 'ink';
  } catch {
    return fallback || 'ink';
  }
}

export default function LoginPage() {
  usePageTitle('登录');
  const { login, user } = useAuth();
  const { branding } = useBranding();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const themeUser = searchParams.get('themeUser');
  const [loginThemeId, setLoginThemeId] = useState(() => readThemeId(themeUser, branding.default_sidebar_theme));
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [consentOpen, setConsentOpen] = useState(false);
  const [consentChecked, setConsentChecked] = useState(false);
  const [consentLoading, setConsentLoading] = useState(false);
  const [consentError, setConsentError] = useState('');
  const { policy, loading: privacyLoading } = usePrivacyPolicy();
  const loginTheme = getSidebarTheme(loginThemeId);
  const lightLogin = loginTheme.mode !== 'dark';
  const loginThemeStyle = {
    '--theme-primary': loginTheme.primary,
    '--theme-primary-dark': loginTheme.primaryDark,
    '--theme-primary-light': loginTheme.primaryLight,
  } as CSSProperties;

  useEffect(() => {
    setLoginThemeId(readThemeId(themeUser, branding.default_sidebar_theme));
  }, [themeUser, branding.default_sidebar_theme]);

  const from = (location.state as any)?.from?.pathname || '/';
  const headlineText = branding.login_headline || '让每一次变更，都有据可依。';
  const headlineLength = headlineText.replace(/\s/g, '').length;
  const headlineSize = headlineLength > 32 ? 'clamp(28px, 3vw, 38px)' : headlineLength > 20 ? 'clamp(32px, 3.6vw, 44px)' : 'clamp(36px, 4vw, 50px)';
  const loginCopyright = branding.login_copyright || `© 2026 ${branding.system_name} · 轻量 ITSM Platform`;
  const loginStatusText = branding.login_status_text || 'System operational';

  useEffect(() => {
    if (user) navigate(from, { replace: true });
  }, [user, navigate, from]);

  const submit = async (event?: React.FormEvent) => {
    event?.preventDefault();
    setError('');
    setLoading(true);
    try {
      const result = await login(username.trim(), password);
      if (result?.requiresConsent) {
        setConsentOpen(true);
        setConsentChecked(false);
        setConsentError('');
        return;
      }
      localStorage.setItem('nextitops_password_expired', result?.password_expired ? '1' : '0');
      navigate(result?.user?.role?.code === 'auditor' ? '/system/audit' : from, { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '登录失败，请重试');
    } finally {
      setLoading(false);
    }
  };

  const acceptPrivacy = async () => {
    setConsentError('');
    if (!consentChecked) {
      setConsentError('请先勾选同意隐私协议后再继续登录');
      return;
    }
    setConsentLoading(true);
    try {
      const result = await login(username.trim(), password, true);
      if (result?.requiresConsent) throw new Error('隐私协议确认失败，请重试');
      localStorage.setItem('nextitops_password_expired', result?.password_expired ? '1' : '0');
      setConsentOpen(false);
      navigate(result?.user?.role?.code === 'auditor' ? '/system/audit' : from, { replace: true });
    } catch (err: any) {
      setConsentError(err instanceof ApiError || err instanceof Error ? err.message : '登录失败，请重试');
    } finally {
      setConsentLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen bg-white" style={loginThemeStyle}>
      <section
        className={cn('relative hidden w-[52%] overflow-hidden lg:flex lg:flex-col', lightLogin ? 'bg-[#f5f7fa]' : 'bg-[#1f2329]')}
        style={{
          backgroundImage: branding.login_background
            ? lightLogin
              ? `linear-gradient(135deg, rgba(245,247,250,.90), rgba(245,247,250,.72)), url(${branding.login_background})`
              : `linear-gradient(135deg, rgba(17,20,24,.88), rgba(17,20,24,.68)), url(${branding.login_background})`
            : `radial-gradient(ellipse at 18% 0%, color-mix(in srgb, ${loginTheme.primary} 14%, transparent), transparent 58%)`,
          backgroundSize: branding.login_background ? 'cover' : undefined,
          backgroundPosition: branding.login_background ? 'center' : undefined,
        }}
      >
        <div className={cn('absolute inset-x-0 bottom-0 h-px', lightLogin ? 'bg-[#e5e6eb]' : 'bg-white/10')} />
        <div className="relative flex h-full flex-col p-10 xl:p-14">
          <div className="flex items-center gap-3">
            <BrandMark size="lg" />
            <div>
              <div className={cn('flex items-center gap-2 text-[18px] font-semibold tracking-tight', lightLogin ? 'text-[#1f2329]' : 'text-white')}>
                {branding.system_name} <span className={cn('rounded px-1.5 py-0.5 text-[9px] font-semibold tracking-wider', lightLogin ? 'bg-[#f2f3f5] text-[#86909c]' : 'bg-white/10 text-white/60')}>ITSM</span>
              </div>
              <p className={cn('mt-0.5 text-[9px] font-medium uppercase tracking-[0.22em]', lightLogin ? 'text-[#86909c]' : 'text-slate-500')}>{branding.system_subtitle || 'SERVICE INTELLIGENCE'}</p>
            </div>
          </div>

          <div className="my-auto w-full max-w-[720px] py-12">
            <div className={cn('mb-5 inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-[10.5px] font-medium', lightLogin ? 'border-[#e5e6eb] bg-white text-[#4e5969]' : 'border-white/10 bg-white/[0.04] text-slate-300 backdrop-blur')}>
              <span className={cn('flex h-1.5 w-1.5 rounded-full', lightLogin ? 'bg-emerald-500' : 'bg-emerald-400')} />
              新一代轻量 IT 服务管理平台
            </div>
            <h1 className={cn('w-full max-w-[720px] whitespace-pre-line break-words text-balance font-semibold tracking-[-0.035em]', lightLogin ? 'text-[#1f2329]' : 'text-white')} style={{ fontSize: headlineSize, lineHeight: 1.15 }}>
              {headlineText}
            </h1>
            <p className={cn('mt-5 max-w-[640px] text-[13.5px] leading-7', lightLogin ? 'text-[#4e5969]' : 'text-slate-400')}>{branding.system_description || '让配置、告警与服务流程在一个清晰的工作台里协同运转。'}</p>
          </div>

          <div className={cn('flex items-center justify-between border-t pt-5 text-[9.5px]', lightLogin ? 'border-[#e5e6eb] text-[#86909c]' : 'border-white/[0.07] text-slate-600')}>
            <span>{loginCopyright}</span>
            <span className="flex items-center gap-1.5">
              <span className={cn('h-1 w-1 rounded-full', lightLogin ? 'bg-emerald-500' : 'bg-emerald-400')} />
              {loginStatusText}
            </span>
          </div>
        </div>
      </section>

      <section className="relative flex flex-1 flex-col justify-center bg-[#f5f7fa] px-4 py-8 sm:px-8 lg:px-12">
        <div className="relative mx-auto w-full max-w-[420px] rounded-lg border border-[#e5e6eb] bg-white p-6 shadow-[0_8px_28px_rgba(31,35,41,0.06)] sm:p-8">
          <div className="mb-8 flex items-center gap-3 lg:hidden">
            <BrandMark />
            <div>
              <p className="text-[16px] font-semibold text-slate-900">{branding.system_name}</p>
              <p className="text-[9px] uppercase tracking-[0.2em] text-slate-400">{branding.system_subtitle || 'SERVICE INTELLIGENCE'}</p>
            </div>
          </div>

          <div className="mb-7">
            <p className="mb-1.5 text-[12px] font-medium text-brand-600">账号登录</p>
            <h2 className="text-[24px] font-semibold leading-8 tracking-[-0.02em] text-[#1f2329]">登录管理工作台</h2>
            <p className="mt-2 text-[13px] leading-6 text-[#4e5969]">请使用企业账号登录，首次登录需确认隐私协议。</p>
          </div>

          <form onSubmit={submit} className="space-y-4">
            <div>
              <label className="label">用户名</label>
              <div className="relative">
                <UserRound className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                  autoComplete="username"
                  required
                  placeholder="请输入用户名"
                  className="input-base h-10 bg-white pl-10 text-[13px]"
                />
              </div>
            </div>
            <div>
              <div className="mb-1.5 flex items-center justify-between">
                <label className="text-[12.5px] font-medium text-slate-600">密码</label>
                <span className="text-[10px] text-slate-400">联系管理员重置</span>
              </div>
              <div className="relative">
                <LockKeyhole className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  required
                  placeholder="请输入密码"
                  className="input-base h-10 bg-white px-10 text-[13px]"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((value) => !value)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 rounded p-1 text-slate-400 hover:text-slate-600"
                  aria-label={showPassword ? '隐藏密码' : '显示密码'}
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            {error ? (
              <div className="rounded-md border border-[#ffccc7] bg-[#fff2f0] px-3 py-2.5 text-[12px] text-[#cf1322]">{error}</div>
            ) : null}

            <Button type="submit" size="lg" loading={loading} className="w-full">
              {loading ? '正在验证…' : '登录'}
              {!loading ? <ArrowRight className="h-4 w-4" /> : null}
            </Button>
          </form>

          <div className="mt-7 flex flex-col gap-2 border-t border-[#f0f0f0] pt-4 text-[11px] text-[#86909c] sm:flex-row sm:items-center sm:justify-between">
            <span className="flex min-w-0 items-center gap-1.5">
              <ShieldCheck className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">仅限授权人员访问，操作将记录审计日志</span>
            </span>
            <Link to="/privacy" target="_blank" className="shrink-0 font-medium text-brand-600 transition hover:text-brand-700">
              隐私协议
            </Link>
          </div>
        </div>
      </section>

      <Modal
        open={consentOpen}
        onClose={() => setConsentOpen(false)}
        title="确认隐私协议"
        description="首次登录平台前，请阅读并确认以下隐私保护与数据使用协议。"
        icon={ShieldCheck}
        size="lg"
        footer={
          <>
            <Button variant="secondary" size="sm" onClick={() => setConsentOpen(false)}>暂不同意</Button>
            <Button size="sm" loading={consentLoading} disabled={!consentChecked} onClick={acceptPrivacy}>同意并登录</Button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="max-h-[46vh] overflow-y-auto rounded-md border border-[#e5e6eb] bg-[#fafafa] p-4 custom-scroll">
            {privacyLoading ? <PrivacyPolicyLoader compact /> : policy ? <PrivacyPolicyContent policy={policy} compact /> : <p className="text-[11px] text-rose-600">隐私协议加载失败，请刷新页面重试。</p>}
          </div>
          <div className="rounded-md border border-[#e5e6eb] px-3 py-2.5">
            <div className="flex items-center gap-2">
              <Checkbox checked={consentChecked} onChange={setConsentChecked} />
              <div className="text-[10.5px] leading-relaxed text-slate-600">
                我已阅读并同意
                <Link to="/privacy" target="_blank" className="mx-1 font-medium text-brand-600 hover:text-brand-700">《{branding.system_name} 隐私保护与数据使用协议》</Link>
                并了解平台将处理与 IT 服务相关的账号、工单、资产与审计数据。
              </div>
            </div>
            {consentError ? <p className="mt-2 text-[10px] text-rose-600">{consentError}</p> : null}
          </div>
        </div>
      </Modal>
    </div>
  );
}
