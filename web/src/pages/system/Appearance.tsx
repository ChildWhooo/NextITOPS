import { useEffect, useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, ImagePlus, LayoutPanelLeft, ListTree, Move, Palette, RotateCcw, Save, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { usePageTitle } from '@/lib/hooks';
import { cn } from '@/lib/utils';
import { useAuth } from '@/context/AuthContext';
import { useBranding } from '@/context/BrandingContext';
import { NAV_GROUPS } from '@/components/AppLayout';
import { SIDEBAR_THEMES } from '@/lib/themes';
import type { CIType } from '@/lib/types';
import { Button, Field, Input, PageHeader, Skeleton } from '@/components/ui';

const ALL_ASSET = { id: 0, code: '__all__', name: '全部资产', color: '#94a3b8', enabled: true, ci_count: 0, description: '全部配置项' } as unknown as CIType;

export default function AppearancePage() {
  usePageTitle('页面自定义');
  const { user } = useAuth();
  const { branding, refresh } = useBranding();
  const [name, setName] = useState(branding.system_name || 'NextITOps');
  const [logo, setLogo] = useState(branding.system_logo || '');
  const [description, setDescription] = useState(branding.system_description || '');
  const [subtitle, setSubtitle] = useState(branding.system_subtitle || '');
  const [headline, setHeadline] = useState(branding.login_headline || '让每一次变更，都有据可依。');
  const [navLabels, setNavLabels] = useState<Record<string, string>>(branding.nav_labels || {});
  const [loginBackground, setLoginBackground] = useState(branding.login_background || '');
  const [loginGradient, setLoginGradient] = useState(branding.login_gradient || 'aurora');
  const [loginCopyright, setLoginCopyright] = useState(branding.login_copyright || '');
  const [loginStatusText, setLoginStatusText] = useState(branding.login_status_text || '');
  const [themeId, setThemeId] = useState(() => localStorage.getItem(`nextitops_sidebar_theme_${user?.id || 'guest'}`) || branding.default_sidebar_theme || 'ink');
  const [dragAsset, setDragAsset] = useState<number | null>(null);
  const [dragNav, setDragNav] = useState<{ group: string; index: number } | null>(null);
  const [types, setTypes] = useState<CIType[]>([]);
  const [order, setOrder] = useState<CIType[]>([]);
  const [navLayout, setNavLayout] = useState<{ groups?: string[]; items?: string[]; placements?: Record<string, string> }>(() => {
    try { return JSON.parse(localStorage.getItem('nextitops_nav_layout') || '{}'); } catch { return {}; }
  });
  const [width, setWidth] = useState(() => Number(localStorage.getItem('nextitops_collapsed_width') || 104));
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    Promise.all([
      api.get<{ data: CIType[] }>('/api/ci-types'),
      api.get<{ data: { assetOrder?: string[]; navLayout?: any } }>('/api/system/navigation'),
    ]).then(([typesResponse, navResponse]) => {
      setTypes(typesResponse.data);
      const saved = navResponse.data.assetOrder || [];
      const sorted = [...typesResponse.data].sort((a, b) => {
        const ai = saved.indexOf(`/cmdb?type=${a.code}`);
        const bi = saved.indexOf(`/cmdb?type=${b.code}`);
        return (ai < 0 ? 999 : ai) - (bi < 0 ? 999 : bi);
      });
      setOrder([ALL_ASSET, ...sorted]);
      if (navResponse.data.navLayout) setNavLayout(navResponse.data.navLayout);
    }).catch((error) => toast.error(error.message)).finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    setName(branding.system_name || 'NextITOps');
    setLogo(branding.system_logo || '');
    setDescription(branding.system_description || '');
    setSubtitle(branding.system_subtitle || '');
    setHeadline(branding.login_headline || '让每一次变更，都有据可依。');
    setNavLabels(branding.nav_labels || {});
    setLoginBackground(branding.login_background || '');
    setLoginGradient(branding.login_gradient || 'aurora');
    setLoginCopyright(branding.login_copyright || '');
    setLoginStatusText(branding.login_status_text || '');
  }, [branding]);

  const typeHref = (type: CIType) => type.code === '__all__' ? '/cmdb' : type.code === 'rack' ? '/cmdb/racks' : type.code === 'datacenter' ? '/cmdb/datacenters' : type.code === 'ip' ? '/cmdb/ips' : `/cmdb?type=${type.code}`;

  const navGroups = useMemo(() => {
    const defaultGroups = NAV_GROUPS.map((group) => group.label);
    const groupOrder = navLayout.groups?.length ? [...navLayout.groups, ...defaultGroups.filter((label) => !navLayout.groups?.includes(label))] : defaultGroups;
    const allItems = NAV_GROUPS.flatMap((group) => group.items.map((item) => ({ ...item, defaultGroup: group.label })));
    return groupOrder.map((label) => ({
      label,
      items: allItems
        .filter((item) => (navLayout.placements?.[item.href] || item.defaultGroup) === label)
        .sort((a, b) => {
          const ai = navLayout.items?.indexOf(a.href) ?? -1;
          const bi = navLayout.items?.indexOf(b.href) ?? -1;
          return (ai < 0 ? 999 : ai) - (bi < 0 ? 999 : bi);
        }),
    }));
  }, [navLayout]);

  const allNavItems = useMemo(() => NAV_GROUPS.flatMap((group) => group.items), []);
  const moveNavItem = (href: string, groupLabel: string, direction: -1 | 1) => {
    const groupItems = navGroups.find((group) => group.label === groupLabel)?.items || [];
    const index = groupItems.findIndex((item) => item.href === href);
    const target = groupItems[index + direction];
    if (!target) return;
    setNavLayout((current) => {
      const base = current.items?.length ? [...current.items] : allNavItems.map((item) => item.href);
      const ai = base.indexOf(href);
      const bi = base.indexOf(target.href);
      if (ai < 0 || bi < 0) return current;
      [base[ai], base[bi]] = [base[bi], base[ai]];
      return { ...current, items: base };
    });
  };
  const moveNavGroup = (label: string, direction: -1 | 1) => {
    setNavLayout((current) => {
      const base = navGroups.map((group) => group.label);
      const index = base.indexOf(label);
      const target = index + direction;
      if (target < 0 || target >= base.length) return current;
      [base[index], base[target]] = [base[target], base[index]];
      return { ...current, groups: base };
    });
  };
  const placeNavItem = (href: string, groupLabel: string) => {
    setNavLayout((current) => ({ ...current, placements: { ...(current.placements || {}), [href]: groupLabel } }));
  };

  const move = (index: number, direction: -1 | 1) => {
    setOrder((current) => {
      const next = [...current];
      const target = index + direction;
      if (target < 0 || target >= next.length) return current;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  };

  const uploadLogo = (file?: File) => {
    if (!file) return;
    if (file.size > 1.5 * 1024 * 1024) return toast.error('Logo 文件不能超过 1.5MB');
    const reader = new FileReader();
    reader.onload = () => setLogo(String(reader.result || ''));
    reader.readAsDataURL(file);
  };

  const save = async () => {
    if (!name.trim()) return toast.error('请填写系统标题');
    setSaving(true);
    try {
      await api.put('/api/system/branding', {
        system_name: name.trim(),
        system_logo: logo,
        system_description: description,
        system_subtitle: subtitle,
        login_headline: headline,
        nav_labels: navLabels,
        login_background: loginBackground,
        login_gradient: loginGradient,
        login_copyright: loginCopyright,
        login_status_text: loginStatusText,
        default_sidebar_theme: themeId,
      });
      localStorage.setItem(`nextitops_sidebar_theme_${user?.id || 'guest'}`, themeId);
      localStorage.setItem('nextitops_collapsed_width', String(width));
      await api.put('/api/system/navigation', { assetOrder: order.map(typeHref), navLayout });
      await refresh();
      window.dispatchEvent(new Event('nextitops:preferences-changed'));
      toast.success('页面设置已保存');
    } catch (error: any) {
      toast.error(error.message);
    } finally {
      setSaving(false);
    }
  };

  const resetBranding = () => {
    setName('NextITOps');
    setLogo('');
    setDescription('让配置、告警与服务流程在一个清晰的工作台里协同运转。');
    setSubtitle('SERVICE INTELLIGENCE');
    setHeadline('让每一次变更，都有据可依。');
    setNavLabels({});
    setLoginBackground('');
    setLoginGradient('aurora');
    setLoginCopyright('');
    setLoginStatusText('');
  };

  const uploadBackground = (file?: File) => {
    if (!file) return;
    if (file.size > 3 * 1024 * 1024) return toast.error('背景图片不能超过 3MB');
    const reader = new FileReader();
    reader.onload = () => setLoginBackground(String(reader.result || ''));
    reader.readAsDataURL(file);
  };

  const dropAsset = (index: number) => {
    if (dragAsset === null) return;
    setOrder((current) => {
      const next = [...current];
      const [item] = next.splice(dragAsset, 1);
      next.splice(index, 0, item);
      return next;
    });
    setDragAsset(null);
  };

  const dropNav = (groupLabel: string, index: number) => {
    if (!dragNav || dragNav.group !== groupLabel) return;
    const groupItems = navGroups.find((group) => group.label === groupLabel)?.items || [];
    const sourceHref = groupItems[dragNav.index]?.href;
    const targetHref = groupItems[index]?.href;
    if (!sourceHref || !targetHref) return;
    setNavLayout((current) => {
      const base = current.items?.length ? [...current.items] : allNavItems.map((item) => item.href);
      const sourceIndex = base.indexOf(sourceHref);
      base.splice(sourceIndex, 1);
      const targetIndex = base.indexOf(targetHref);
      base.splice(targetIndex, 0, sourceHref);
      return { ...current, items: base };
    });
    setDragNav(null);
  };

  return (
    <div className="animate-enter">
      <PageHeader eyebrow="Appearance" title="页面自定义" description="配置系统标题、Logo、收起侧栏宽度与资产子菜单顺序；保存后立即应用当前账号。" actions={<Button size="sm" icon={Save} loading={saving} onClick={save}>保存页面设置</Button>} />
      <div className="mb-3.5 card overflow-hidden">
        <div className="border-b border-[#eef1f6] px-5 py-3.5">
          <h2 className="flex items-center gap-1.5 text-[13px] font-semibold text-slate-800"><ListTree className="h-3.5 w-3.5 text-brand-500" /> 全站菜单顺序与分组</h2>
          <p className="mt-0.5 text-[10px] text-slate-400">调整所有一级分组和菜单顺序；菜单可移动到其他分组，形成新的层级归属。</p>
        </div>
        <div className="custom-scroll grid max-h-[460px] gap-3 overflow-y-auto p-4 sm:grid-cols-2 xl:grid-cols-3">
          {navGroups.map((group, groupIndex) => (
            <div key={group.label} className="rounded-xl border border-slate-200 bg-white">
              <div className="flex items-center gap-1.5 border-b border-slate-100 px-3 py-2">
                <input className="min-w-0 flex-1 rounded border border-transparent bg-transparent px-1 py-0.5 text-[11.5px] font-semibold text-slate-700 outline-none hover:border-slate-200 focus:border-brand-300" value={navLabels[`group:${group.label}`] ?? group.label} onChange={(event) => setNavLabels((current) => ({ ...current, [`group:${group.label}`]: event.target.value }))} aria-label="菜单分组名称" />
                <button onClick={() => moveNavGroup(group.label, -1)} disabled={groupIndex === 0} className="rounded p-0.5 text-slate-400 hover:bg-slate-100 disabled:opacity-25" aria-label="分组上移"><ArrowUp className="h-3 w-3" /></button>
                <button onClick={() => moveNavGroup(group.label, 1)} disabled={groupIndex === navGroups.length - 1} className="rounded p-0.5 text-slate-400 hover:bg-slate-100 disabled:opacity-25" aria-label="分组下移"><ArrowDown className="h-3 w-3" /></button>
              </div>
              <div className="space-y-1 p-2">
                {group.items.map((item, itemIndex) => (
                  <div key={item.href} draggable onDragStart={(event) => { event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', item.href); setDragNav({ group: group.label, index: itemIndex }); }} onDragOver={(event) => event.preventDefault()} onDrop={() => dropNav(group.label, itemIndex)} onDragEnd={() => setDragNav(null)} className="flex cursor-grab items-center gap-1 rounded-lg bg-slate-50/60 px-2 py-1.5 active:cursor-grabbing">
                    <Move className="h-3 w-3 shrink-0 text-slate-400" aria-label="拖拽调整顺序" />
                    <span className="min-w-0 flex-1 truncate text-[10.5px] text-slate-600">{item.label}</span>
                    <input className="h-6 w-[92px] rounded border border-slate-200 bg-white px-1 text-[9px] text-slate-600 outline-none focus:border-brand-300" value={navLabels[item.href] ?? item.label} onChange={(event) => setNavLabels((current) => ({ ...current, [item.href]: event.target.value }))} aria-label={`重命名 ${item.label}`} placeholder="显示名称" />
                    <select className="h-6 max-w-[96px] rounded border border-slate-200 bg-white px-1 text-[9px] text-slate-500 outline-none" value={navLayout.placements?.[item.href] || group.label} onChange={(event) => placeNavItem(item.href, event.target.value)} aria-label="菜单分组">
                      {NAV_GROUPS.map((target) => <option key={target.label} value={target.label}>{target.label}</option>)}
                    </select>
                    <button onClick={() => moveNavItem(item.href, group.label, -1)} disabled={itemIndex === 0} className="rounded p-0.5 text-slate-400 hover:bg-white disabled:opacity-25" aria-label="菜单上移"><ArrowUp className="h-3 w-3" /></button>
                    <button onClick={() => moveNavItem(item.href, group.label, 1)} disabled={itemIndex === group.items.length - 1} className="rounded p-0.5 text-slate-400 hover:bg-white disabled:opacity-25" aria-label="菜单下移"><ArrowDown className="h-3 w-3" /></button>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="grid gap-3.5 xl:grid-cols-12">
        <div className="card overflow-hidden xl:col-span-5">
          <div className="border-b border-[#eef1f6] px-5 py-3.5">
            <h2 className="flex items-center gap-1.5 text-[13px] font-semibold text-slate-800"><Palette className="h-3.5 w-3.5 text-brand-500" /> 系统品牌</h2>
            <p className="mt-0.5 text-[10px] text-slate-400">登录页、侧边栏与浏览器标题都会使用这里的设置。</p>
          </div>
          <div className="space-y-4 p-5">
            <Field label="系统标题" required><Input value={name} onChange={(event) => setName(event.target.value)} maxLength={60} placeholder="例如 NextITOps" /></Field>
            <Field label="系统 Logo" hint="PNG / JPEG / WebP / SVG，不超过 1.5MB">
              <div className="flex items-center gap-3 rounded-xl border border-slate-200 p-3">
                <span className="flex h-14 w-14 items-center justify-center overflow-hidden rounded-xl bg-slate-50">
                  {logo ? <img src={logo} alt="系统 Logo" className="h-full w-full object-contain" /> : <ImagePlus className="h-5 w-5 text-slate-400" />}
                </span>
                <div className="flex-1">
                  <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[10.5px] font-medium text-slate-600 hover:bg-slate-50">
                    <Upload className="h-3.5 w-3.5" /> 上传 Logo
                    <input type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" className="hidden" onChange={(event) => uploadLogo(event.target.files?.[0])} />
                  </label>
                  <button onClick={resetBranding} className="ml-2 inline-flex items-center gap-1 text-[10px] text-slate-400 hover:text-slate-600"><RotateCcw className="h-3 w-3" /> 恢复默认</button>
                  <p className="mt-1.5 text-[9px] text-slate-400">建议使用正方形透明背景图片。</p>
                </div>
              </div>
            </Field>
            <Field label="系统副标题" hint="显示在 Logo 下方，例如 SERVICE INTELLIGENCE"><Input value={subtitle} onChange={(event) => setSubtitle(event.target.value)} maxLength={80} /></Field>
            <Field label="系统描述" hint="显示在登录页左侧"><textarea className="input-base min-h-[72px]" value={description} onChange={(event) => setDescription(event.target.value)} maxLength={500} /></Field>
            <Field label="登录页主标题" hint="支持手动换行；长标题自动缩放并自动换行"><textarea className="input-base min-h-[68px]" value={headline} onChange={(event) => setHeadline(event.target.value)} maxLength={300} /></Field>
            <Field label="登录页左侧背景" hint="不上传时使用下方渐变方案">
              <div className="flex items-center gap-3">
                <span className="flex h-16 w-24 items-center justify-center overflow-hidden rounded-lg bg-slate-100">
                  {loginBackground ? <img src={loginBackground} alt="登录背景" className="h-full w-full object-cover" /> : <ImagePlus className="h-5 w-5 text-slate-400" />}
                </span>
                <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[10.5px] font-medium text-slate-600 hover:bg-slate-50"><Upload className="h-3.5 w-3.5" /> 上传背景<input type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(event) => uploadBackground(event.target.files?.[0])} /></label>
                {loginBackground ? <button onClick={() => setLoginBackground('')} className="text-[10px] text-slate-400 hover:text-slate-600">移除</button> : null}
              </div>
            </Field>
            <Field label="渐变色调">
              <select className="input-base" value={loginGradient} onChange={(event) => setLoginGradient(event.target.value)}>
                <option value="aurora">极光蓝紫</option>
                <option value="ocean">深海青蓝</option>
                <option value="midnight">午夜深蓝</option>
                <option value="sunset">暮光橙粉</option>
                <option value="forest">墨林绿</option>
              </select>
            </Field>
            <Field label="页脚版权文字" hint="留空使用系统名称生成默认版权"><Input value={loginCopyright} onChange={(event) => setLoginCopyright(event.target.value)} maxLength={160} placeholder={`© 2026 ${name} · 轻量 ITSM Platform`} /></Field>
            <Field label="页脚运行状态文字" hint="显示在登录页左下角状态点旁"><Input value={loginStatusText} onChange={(event) => setLoginStatusText(event.target.value)} maxLength={80} placeholder="System operational" /></Field>
            <div className="rounded-xl border border-slate-200 p-3">
              <p className="text-[11px] font-medium text-slate-700">侧边栏主题</p>
              <p className="mt-0.5 text-[9px] text-slate-400">系统默认主题设置：用户未自定义主题时自动使用此主题。</p>
              <div className="mt-2 grid grid-cols-2 gap-1.5">
                {SIDEBAR_THEMES.map((theme) => (
                  <button key={theme.id} onClick={() => setThemeId(theme.id)} className={cn('rounded-lg border px-2 py-2 text-left transition', themeId === theme.id ? 'border-brand-400 ring-2 ring-brand-100' : 'border-slate-200 hover:border-slate-300')} style={{ background: theme.bg }}>
                    <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded-full" style={{ background: theme.accent }} /><span className="text-[10px] font-medium" style={{ color: theme.activeText }}>{theme.name}</span></span>
                    <span className="mt-0.5 block text-[8px]" style={{ color: theme.muted }}>{theme.description}</span>
                  </button>
                ))}
              </div>
            </div>
            <div className="rounded-xl border border-slate-200 p-3">
              <div className="flex items-center justify-between"><div><p className="text-[11px] font-medium text-slate-700">收起侧栏宽度</p><p className="mt-0.5 text-[9px] text-slate-400">当前为 {width}px，建议 104–120px。</p></div><span className="text-[16px] font-semibold text-brand-600">{width}px</span></div>
              <input type="range" min="96" max="128" step="4" value={width} onChange={(event) => setWidth(Number(event.target.value))} className="mt-3 w-full accent-brand-600" />
            </div>
          </div>
        </div>

        <div className="card flex h-full flex-col overflow-hidden xl:col-span-7">
          <div className="shrink-0 border-b border-[#eef1f6] px-5 py-3.5">
            <h2 className="flex items-center gap-1.5 text-[13px] font-semibold text-slate-800"><LayoutPanelLeft className="h-3.5 w-3.5 text-brand-500" /> 资产子菜单顺序</h2>
            <p className="mt-0.5 text-[10px] text-slate-400">只影响当前账号的侧边栏；新建 CI 类型会自动追加到末尾。</p>
          </div>
          <div className="custom-scroll min-h-0 flex-1 space-y-1.5 overflow-y-auto p-4">
            {loading ? [1, 2, 3, 4, 5].map((item) => <Skeleton key={item} className="h-11" />) : order.map((type, index) => (
              <div key={type.id} draggable onDragStart={(event) => { event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', String(index)); setDragAsset(index); }} onDragOver={(event) => event.preventDefault()} onDrop={() => dropAsset(index)} onDragEnd={() => setDragAsset(null)} className="flex cursor-grab items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2.5 active:cursor-grabbing">
                <Move className="h-4 w-4 shrink-0 text-slate-400" aria-label="拖拽调整顺序" />
                <span className="h-2 w-2 rounded-full" style={{ background: type.color }} />
                <span className="min-w-0 flex-1"><span className="block text-[11.5px] font-medium text-slate-700">{type.name}</span><span className="block text-[9px] text-slate-400">{typeHref(type)}</span></span>
                <button onClick={() => move(index, -1)} disabled={index === 0} className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-30" aria-label="上移"><ArrowUp className="h-3.5 w-3.5" /></button>
                <button onClick={() => move(index, 1)} disabled={index === order.length - 1} className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-30" aria-label="下移"><ArrowDown className="h-3.5 w-3.5" /></button>
              </div>
            ))}
          </div>
        </div>
      </div>

    </div>
  );
}
