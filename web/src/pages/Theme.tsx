import { useState } from 'react';
import { Check, Palette } from 'lucide-react';
import { toast } from 'sonner';
import { usePageTitle } from '@/lib/hooks';
import { useBranding } from '@/context/BrandingContext';
import { useAuth } from '@/context/AuthContext';
import { SIDEBAR_THEMES, getSidebarTheme } from '@/lib/themes';
import { cn } from '@/lib/utils';
import { Button, PageHeader } from '@/components/ui';

export default function ThemePage() {
  usePageTitle('主题设置');
  const { user } = useAuth();
  const { branding } = useBranding();
  const storageKey = `nextitops_sidebar_theme_${user?.id || 'guest'}`;
  const [themeId, setThemeId] = useState(() => localStorage.getItem(storageKey) || branding.default_sidebar_theme || 'ink');
  const active = getSidebarTheme(themeId);
  const previewLight = active.mode === 'light';
  const save = () => {
    localStorage.setItem(storageKey, themeId);
    window.dispatchEvent(new Event('nextitops:preferences-changed'));
    toast.success('主题已保存，仅对你生效');
  };
  return (
    <div className="animate-enter">
      <PageHeader eyebrow="My preferences" title="主题设置" description="选择适合你的侧边栏配色；主题只保存在当前账号的浏览器中，不影响其他用户。" actions={<Button size="sm" icon={Check} onClick={save}>保存主题</Button>} />
      <div className="grid gap-3.5 lg:grid-cols-2">
        <div className="card overflow-hidden">
          <div className="border-b border-[#eef1f6] px-5 py-3.5"><h2 className="flex items-center gap-1.5 text-[13px] font-semibold text-slate-800"><Palette className="h-3.5 w-3.5 text-brand-500" /> 配色方案</h2><p className="mt-0.5 text-[10px] text-slate-400">保存后立即应用到侧边栏，下次登录自动记住。</p></div>
          <div className="space-y-2 p-4">
            {SIDEBAR_THEMES.map((theme) => (
              <button key={theme.id} onClick={() => setThemeId(theme.id)} className={cn('flex w-full items-center gap-3 rounded-xl border p-3 text-left transition', themeId === theme.id ? 'border-brand-400 ring-2 ring-brand-100' : 'border-slate-200 hover:border-slate-300')} style={{ background: theme.bg }}>
                <span className="flex h-10 w-14 flex-col justify-center gap-1 rounded-lg p-1.5" style={{ background: theme.panel }}>
                  <span className="h-1 w-7 rounded-full" style={{ background: theme.activeBg }} />
                  <span className="h-1 w-9 rounded-full" style={{ background: theme.muted, opacity: 0.5 }} />
                  <span className="h-1 w-5 rounded-full" style={{ background: theme.accent }} />
                </span>
                <span className="min-w-0 flex-1"><span className="block text-[12px] font-semibold" style={{ color: theme.activeText }}>{theme.name}</span><span className="mt-0.5 block text-[10px]" style={{ color: theme.muted }}>{theme.description}</span></span>
                {themeId === theme.id ? <Check className="h-4 w-4" style={{ color: theme.accent }} /> : null}
              </button>
            ))}
          </div>
        </div>
        <div className="card overflow-hidden">
          <div className="border-b border-[#eef1f6] px-5 py-3.5"><h2 className="text-[13px] font-semibold text-slate-800">实时预览</h2><p className="mt-0.5 text-[10px] text-slate-400">当前：{active.name}</p></div>
          <div className="p-4">
            <div className="overflow-hidden rounded-xl border border-slate-200" style={{ background: active.bg }}>
              <div className="flex items-center gap-2 border-b p-3" style={{ borderColor: previewLight ? '#e5e6eb' : 'rgba(255,255,255,0.1)' }}><span className="h-7 w-7 rounded-lg" style={{ background: active.accent }} /><span className="text-[13px] font-semibold" style={{ color: previewLight ? '#1f2329' : '#ffffff' }}>NextITOps</span></div>
              <div className="space-y-1 p-2">
                <div className="rounded-lg px-3 py-2 text-[11px]" style={{ background: active.activeBg, color: active.activeText }}>资产总览</div>
                <div className="px-3 py-2 text-[11px]" style={{ color: active.muted }}>事件管理</div>
                <div className="px-3 py-2 text-[11px]" style={{ color: active.muted }}>监控自动化</div>
              </div>
            </div>
            <p className="mt-3 text-[10px] leading-relaxed text-slate-400">系统名称、Logo、登录背景、菜单顺序等关键配置仍由系统管理员在「页面自定义」中维护。</p>
          </div>
        </div>
      </div>
    </div>
  );
}
