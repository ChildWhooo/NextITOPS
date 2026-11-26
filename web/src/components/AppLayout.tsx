import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  Bell,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Database,
  BarChart3,
  GitPullRequest,
  Info,
  KeyRound,
  Layers3,
  LayoutDashboard,
  LogOut,
  Map as MapIcon,
  Menu,
  MessagesSquare,
  Megaphone,
  Palette,
  Plug,
  Radar,
  ScrollText,
  Search,
  SearchCheck,
  ShieldCheck,
  Sparkles,
  UserRound,
  Users,
  Waypoints,
  Network,
  Workflow,
  Zap,
  X,
  type LucideIcon,
} from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/context/AuthContext';
import { useBranding } from '@/context/BrandingContext';
import SystemStatusModal from '@/components/SystemStatusModal';
import { api } from '@/lib/api';
import { cn, formatDate, relativeTime, SEVERITY_META } from '@/lib/utils';
import { getSidebarTheme } from '@/lib/themes';
import { APP_VERSION, IS_BETA } from '@/lib/version';
import { loadBasicFields } from '@/lib/ciBasicFields';
import type { CI, CIType, Ticket, User } from '@/lib/types';
import { Avatar, Button, Field, IconButton, Input, Modal } from '@/components/ui';

export function BrandMark({ size = 'md' }: { size?: 'sm' | 'md' | 'lg'; light?: boolean }) {
  const sizes = { sm: 'h-8 w-8', md: 'h-9 w-9', lg: 'h-11 w-11' };
  const { branding } = useBranding();
  return (
    <span className={cn('relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-lg', sizes[size])}>
      {branding.system_logo ? (
        <img src={branding.system_logo} alt={branding.system_name} className="h-full w-full object-contain" />
      ) : (
        <>
          <span className="absolute inset-0" style={{ backgroundColor: 'var(--theme-primary)' }} />
          <svg viewBox="0 0 40 40" className="relative h-[72%] w-[72%]" fill="none">
            <path d="M10 27V13l10 6 10-6v14" stroke="white" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" />
            <circle cx="10" cy="13" r="2.6" fill="white" />
            <circle cx="30" cy="13" r="2.6" fill="white" fillOpacity=".75" />
            <circle cx="20" cy="29" r="2.6" fill="white" />
          </svg>
        </>
      )}
    </span>
  );
}

interface NavChild {
  label: string;
  href: string;
  color?: string;
}

interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
  permission?: string | string[];
  badge?: string;
  children?: NavChild[];
}

const DEFAULT_CI_TYPES: Array<Pick<CIType, 'code' | 'name' | 'color' | 'enabled'>> = [
  { code: 'server', name: '服务器', color: '#4f6ef7', enabled: true },
  { code: 'network', name: '网络设备', color: '#06b6d4', enabled: true },
  { code: 'security', name: '信息安全设备', color: '#f43f5e', enabled: true },
  { code: 'datacenter', name: '数据中心', color: '#8b5cf6', enabled: true },
  { code: 'rack', name: '机柜', color: '#f59e0b', enabled: true },
  { code: 'vm', name: '虚拟机', color: '#14b8a6', enabled: true },
  { code: 'os', name: '操作系统', color: '#64748b', enabled: true },
  { code: 'software', name: '软件', color: '#d946ef', enabled: true },
  { code: 'virtualization_host', name: '虚拟化宿主机', color: '#8b5cf6', enabled: true },
  { code: 'virtualization', name: '虚拟化平台', color: '#7c3aed', enabled: true },
  { code: 'business', name: '业务系统', color: '#ec4899', enabled: true },
  { code: 'ip', name: '网络IP资产', color: '#0ea5e9', enabled: true },
];

function assetChildren(types: Array<Pick<CIType, 'code' | 'name' | 'color' | 'enabled'>>, menuOrder: string[]): NavChild[] {
  const children: NavChild[] = [{ label: '全部资产', href: '/cmdb', color: '#94a3b8' }];
  for (const type of types.filter((item) => item.enabled !== false)) {
    if (type.code === 'rack') children.push({ label: '机柜', href: '/cmdb/racks', color: type.color });
    else if (type.code === 'datacenter') children.push({ label: '数据中心', href: '/cmdb/datacenters', color: type.color });
    else if (type.code === 'ip') children.push({ label: type.name, href: '/cmdb/ips', color: type.color });
    else children.push({ label: type.name, href: `/cmdb?type=${type.code}`, color: type.color });
  }
  if (!menuOrder.length) return children;
  const rank = new Map(menuOrder.map((href, index) => [href, index]));
  if (!rank.has('/cmdb')) rank.set('/cmdb', -1);
  return children.sort((a, b) => (rank.get(a.href) ?? 1000) - (rank.get(b.href) ?? 1000));
}

export const NAV_GROUPS: Array<{ label: string; items: NavItem[] }> = [
  {
    label: '工作空间',
    items: [
      { label: '工作台', href: '/', icon: LayoutDashboard, permission: 'dashboard.view' },
      { label: '自定义报表', href: '/reports', icon: BarChart3 },
    ],
  },
  {
    label: '配置管理',
    items: [
      { label: '资产总览', href: '/cmdb', icon: Database, permission: 'cmdb.view' },
      { label: '资产拓扑', href: '/cmdb/topology', icon: Network, permission: 'cmdb.view' },
      { label: 'CI 模型', href: '/cmdb/model', icon: Layers3, permission: 'cmdb.model_manage' },
      { label: '关系模型', href: '/cmdb/relations', icon: Waypoints, permission: 'cmdb.model_manage' },
    ],
  },
  {
    label: 'IT 服务',
    items: [
      { label: '事件管理', href: '/tickets/incident', icon: Zap, permission: 'itsm.view' },
      { label: '问题管理', href: '/tickets/problem', icon: SearchCheck, permission: 'itsm.view' },
      { label: '变更管理', href: '/tickets/change', icon: GitPullRequest, permission: 'itsm.view' },
      { label: '流程设计', href: '/workflows', icon: Workflow, permission: 'itsm.workflow_manage' },
    ],
  },
  {
    label: '监控自动化',
    items: [
      { label: '告警中心', href: '/alerts', icon: Bell, permission: 'itsm.view', badge: 'live' },
      { label: 'Zabbix 集成', href: '/integrations/zabbix', icon: Radar, permission: 'integration.manage' },
      { label: '通知设置', href: '/system/notifications', icon: MessagesSquare, permission: 'notification.manage' },
    ],
  },
  {
    label: '系统设置',
    items: [
      { label: 'API 配置', href: '/system/third-party', icon: Plug, permission: 'system.role_manage' },
      { label: '用户管理', href: '/system/users', icon: Users, permission: 'system.user_manage' },
      { label: '角色权限', href: '/system/roles', icon: ShieldCheck, permission: 'system.role_manage' },
      { label: '页面自定义', href: '/system/appearance', icon: Sparkles, permission: 'system.role_manage' },
      { label: '维护公告', href: '/system/maintenance', icon: Megaphone, permission: 'system.role_manage' },
      { label: '隐私协议设置', href: '/system/privacy', icon: ShieldCheck, permission: 'system.role_manage' },
      { label: '基础数据设置', href: '/system/base-data', icon: Database, permission: 'system.role_manage' },
      { label: '审计日志', href: '/system/audit', icon: ScrollText },
      { label: '关于系统', href: '/system/about', icon: Info },
    ],
  },
];

const BREADCRUMB_HREFS: Record<string, string> = {
  资产总览: '/cmdb',
  事件管理: '/tickets/incident',
  问题管理: '/tickets/problem',
  变更管理: '/tickets/change',
  流程设计: '/workflows',
  告警中心: '/alerts',
  'Zabbix 集成': '/integrations/zabbix',
  通知设置: '/system/notifications',
  用户管理: '/system/users',
  角色权限: '/system/roles',
  页面自定义: '/system/appearance',
  维护公告: '/system/maintenance',
  地理位置配置: '/system/map-settings',
  审计日志: '/system/audit',
  关于系统: '/system/about',
  'CI 模型': '/cmdb/model',
  关系模型: '/cmdb/relations',
};

function useFilteredNav(ciTypes: Array<Pick<CIType, 'code' | 'name' | 'color' | 'enabled'>>, menuOrder: string[], navLayout: { groups?: string[]; items?: string[]; placements?: Record<string, string> } = {}) {
  const { can } = useAuth();
  return useMemo(() => {
    const allItems = NAV_GROUPS.flatMap((group) => group.items.map((item) => ({ ...item, defaultGroup: group.label })));
    const groupLabels = [...new Set(NAV_GROUPS.map((group) => group.label))];
    const itemRank = new Map((navLayout.items || []).map((href, index) => [href, index]));
    const groupRank = new Map((navLayout.groups || []).map((label, index) => [label, index]));
    const groups = groupLabels
      .sort((a, b) => (groupRank.get(a) ?? 999) - (groupRank.get(b) ?? 999))
      .map((label) => {
        const items = allItems
          .filter((item) => can(item.permission))
          .filter((item) => (navLayout.placements?.[item.href] || item.defaultGroup) === label)
          .sort((a, b) => (itemRank.get(a.href) ?? 999) - (itemRank.get(b.href) ?? 999))
          .map((item) => item.href === '/cmdb' ? { ...item, children: assetChildren(ciTypes, menuOrder) } : item);
        return { label, items };
      })
      .filter((group) => group.items.length);
    return groups;
  }, [can, ciTypes, menuOrder, navLayout]);
}

export function AppLayout() {
  const { user, logout, can } = useAuth();
  const { branding } = useBranding();

  useEffect(() => {
    let disposed = false;
    let lastActivity = Date.now();
    let timeoutMinutes = 10;
    const onActivity = () => { lastActivity = Date.now(); };
    const timer = setInterval(() => {
      if (disposed) return;
      if (Date.now() - lastActivity >= Math.max(1, timeoutMinutes) * 60_000) {
        clearInterval(timer);
        logout();
      }
    }, 15_000);
    api.get<{ data: { idle_timeout_minutes: number } }>('/api/system/session-policy')
      .then((response) => {
        timeoutMinutes = Number(response.data?.idle_timeout_minutes) || 10;
        localStorage.setItem('nextitops_idle_timeout', String(timeoutMinutes));
        lastActivity = Date.now();
      })
      .catch(() => { timeoutMinutes = 10; });
    window.addEventListener('mousemove', onActivity, { passive: true });
    window.addEventListener('keydown', onActivity);
    window.addEventListener('click', onActivity, { passive: true });
    window.addEventListener('scroll', onActivity, { passive: true });
    return () => {
      disposed = true;
      clearInterval(timer);
      window.removeEventListener('mousemove', onActivity);
      window.removeEventListener('keydown', onActivity);
      window.removeEventListener('click', onActivity);
      window.removeEventListener('scroll', onActivity);
    };
  }, [logout]);
  const navigate = useNavigate();
  const location = useLocation();
  const [ciTypes, setCiTypes] = useState(DEFAULT_CI_TYPES);
  const orderStorageKey = `nextitops_asset_order_${user?.id || 'guest'}`;
  const [menuOrder, setMenuOrder] = useState<string[]>(() => {
    try {
      const value = JSON.parse(localStorage.getItem(orderStorageKey) || '[]');
      return Array.isArray(value) ? value.filter((item) => typeof item === 'string') : [];
    } catch {
      return [];
    }
  });
  const [navLayout, setNavLayout] = useState<{ groups?: string[]; items?: string[]; placements?: Record<string, string> }>(() => {
    try { return JSON.parse(localStorage.getItem('nextitops_nav_layout') || '{}'); } catch { return {}; }
  });
  const navGroups = useFilteredNav(ciTypes, menuOrder, navLayout);

  useEffect(() => {
    loadBasicFields().catch(() => {});
  }, []);

  useEffect(() => {
    api.get<{ data: { assetOrder?: string[]; navLayout?: any } }>('/api/system/navigation')
      .then((response) => {
        if (Array.isArray(response.data?.assetOrder)) setMenuOrder(response.data.assetOrder);
        if (response.data?.navLayout) setNavLayout(response.data.navLayout);
      })
      .catch(() => {});
  }, []);
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem('nextitops_sidebar') === 'collapsed');
  const themeStorageKey = `nextitops_sidebar_theme_${user?.id || 'guest'}`;
  const [sidebarThemeId, setSidebarThemeId] = useState(() => localStorage.getItem(themeStorageKey) || branding.default_sidebar_theme || 'ink');
  const sidebarTheme = getSidebarTheme(sidebarThemeId);
  const lightSidebar = sidebarTheme.mode === 'light';
  const [collapsedWidth, setCollapsedWidth] = useState(() => {
    const stored = Number(localStorage.getItem('nextitops_collapsed_width') || 104);
    return Number.isFinite(stored) ? Math.min(128, Math.max(96, stored)) : 104;
  });
  const [mobileOpen, setMobileOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [passwordForced, setPasswordForced] = useState(() => localStorage.getItem('nextitops_password_expired') === '1');
  const [statusOpen, setStatusOpen] = useState(false);  const [notifications, setNotifications] = useState<any[]>([]);
  const [maintenanceNotice, setMaintenanceNotice] = useState<any>(null);
  const [dismissedMaintenance, setDismissedMaintenance] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem('nextitops_dismissed_maintenance') || '[]'); } catch { return []; }
  });
  const [assetOpen, setAssetOpen] = useState(true);
  const groupStorageKey = `nextitops_nav_groups_${user?.id || 'guest'}`;
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(() => {
    try { return new Set(JSON.parse(localStorage.getItem(groupStorageKey) || '[]')); } catch { return new Set(); }
  });
  const toggleGroup = (label: string) => {
    setCollapsedGroups((current) => {
      const next = new Set(current);
      if (next.has(label)) next.delete(label); else next.add(label);
      localStorage.setItem(groupStorageKey, JSON.stringify([...next]));
      return next;
    });
  };
  const currentType = new URLSearchParams(location.search).get('type');
  const assetSection = location.pathname === '/cmdb' || location.pathname === '/cmdb/racks' || location.pathname === '/cmdb/datacenters' || location.pathname === '/cmdb/ips';

  useEffect(() => {
    localStorage.setItem('nextitops_sidebar', collapsed ? 'collapsed' : 'expanded');
  }, [collapsed]);

  useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    api.get<any>('/api/dashboard/summary').then((data) => setNotifications(data.alerts || [])).catch(() => {});
    api.get<{ data: any[] }>('/api/maintenance').then((response) => {
      const current = response.data.find((item) => item.phase === 'active')
        || response.data.find((item) => item.phase === 'planned' && new Date(item.start_at).getTime() - Date.now() < 7 * 86400000);
      setMaintenanceNotice(current && !dismissedMaintenance.includes(String(current.id)) ? current : null);
    }).catch(() => {});
  }, [location.pathname]);

  useEffect(() => {
    if (!can('cmdb.view')) return;
    const loadTypes = () => {
      api.get<{ data: CIType[] }>('/api/ci-types').then((response) => {
        if (Array.isArray(response.data) && response.data.length) setCiTypes(response.data);
      }).catch(() => {});
    };
    loadTypes();
    const handler = () => loadTypes();
    window.addEventListener('nextitops:ci-types-changed', handler);
    return () => window.removeEventListener('nextitops:ci-types-changed', handler);
  }, [can]);

  useEffect(() => {
    const handler = () => {
      const stored = Number(localStorage.getItem('nextitops_collapsed_width') || 104);
      setCollapsedWidth(Number.isFinite(stored) ? Math.min(128, Math.max(96, stored)) : 104);
      setSidebarThemeId(localStorage.getItem(themeStorageKey) || branding.default_sidebar_theme || 'ink');
      api.get<{ data: { assetOrder?: string[]; navLayout?: any } }>('/api/system/navigation').then((response) => {
        if (Array.isArray(response.data?.assetOrder)) setMenuOrder(response.data.assetOrder);
        if (response.data?.navLayout) setNavLayout(response.data.navLayout);
      }).catch(() => {});
    };
    window.addEventListener('nextitops:preferences-changed', handler);
    return () => window.removeEventListener('nextitops:preferences-changed', handler);
  }, [orderStorageKey, themeStorageKey]);

  useEffect(() => {
    if (!localStorage.getItem(themeStorageKey)) setSidebarThemeId(branding.default_sidebar_theme || 'ink');
  }, [branding.default_sidebar_theme, themeStorageKey]);

  useEffect(() => {
    document.documentElement.dataset.sidebarMode = sidebarTheme.mode === 'dark' ? 'dark' : 'light';
    document.documentElement.style.setProperty('--theme-primary', sidebarTheme.primary);
    document.documentElement.style.setProperty('--theme-primary-dark', sidebarTheme.primaryDark);
    document.documentElement.style.setProperty('--theme-primary-light', sidebarTheme.primaryLight);
    document.documentElement.style.setProperty('--sidebar-bg', sidebarTheme.bg);
    document.documentElement.style.setProperty('--sidebar-panel', sidebarTheme.panel);
    document.documentElement.style.setProperty('--sidebar-text', sidebarTheme.activeText);
    document.documentElement.style.setProperty('--sidebar-muted', sidebarTheme.muted);
    document.documentElement.style.setProperty('--sidebar-border', sidebarTheme.mode === 'dark' ? 'rgba(255, 255, 255, 0.12)' : '#e5e6eb');
  }, [sidebarTheme]);

  useEffect(() => {
    if (passwordForced) setPasswordOpen(true);
  }, [passwordForced]);

  useEffect(() => {
    if (!assetSection) setAssetOpen(false);
  }, [assetSection]);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setSearchOpen(true);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  if (!user) return null;

  const isActive = (href: string) => {
    if (href === '/') return location.pathname === '/';
    if (href === '/cmdb') {
      return location.pathname === '/cmdb' || location.pathname === '/cmdb/racks' || location.pathname === '/cmdb/datacenters' || /^\/cmdb\/\d+/.test(location.pathname);
    }
    return location.pathname === href || location.pathname.startsWith(`${href}/`);
  };

  const childActive = (child: NavChild) => {
    const [path, query] = child.href.split('?');
    if (location.pathname !== path) return false;
    if (query) return new URLSearchParams(query).get('type') === currentType;
    if (path === '/cmdb') return !currentType;
    return true;
  };

  const breadcrumb = (() => {
    const path = location.pathname;
    if (path === '/') return ['工作台'];
    if (path === '/cmdb') {
      const typeName = ciTypes.find((item) => item.code === currentType)?.name;
      return ['配置管理', '资产总览', typeName || '全部资产'];
    }
    if (path === '/cmdb/model') return ['配置管理', 'CI 模型'];
    if (path === '/cmdb/relations') return ['配置管理', '关系模型'];
    if (path === '/cmdb/racks') return ['配置管理', '资产总览', '机柜'];
    if (path === '/cmdb/datacenters') return ['配置管理', '资产总览', '数据中心分布'];
    if (path === '/cmdb/ips') return ['配置管理', '资产总览', '网络IP资产'];
    if (path === '/cmdb/topology') return ['配置管理', '资产拓扑'];
    if (/^\/cmdb\/\d+/.test(path)) return ['配置管理', '资产总览', '资产详情'];
    if (path.startsWith('/tickets/')) {
      const type = path.split('/')[2];
      const label = type === 'incident' ? '事件管理' : type === 'problem' ? '问题管理' : '变更管理';
      return ['IT 服务', label, path.split('/')[3] ? '工单详情' : ''].filter(Boolean);
    }
    if (path === '/workflows') return ['IT 服务', '流程设计'];
    if (path === '/reports') return ['工作空间', '自定义报表'];
    if (path === '/alerts') return ['监控自动化', '告警中心'];
    if (path === '/system/notifications') return ['监控自动化', '通知设置'];
    if (path === '/system/users') return ['系统设置', '用户管理'];
    if (path === '/system/roles') return ['系统设置', '角色权限'];
    if (path === '/system/appearance') return ['系统设置', '页面自定义'];
    if (path === '/system/maintenance') return ['系统设置', '维护公告'];
    if (path === '/system/map-settings') return ['配置管理', '资产总览', '数据中心分布', '地理位置配置'];
    if (path === '/system/third-party') return ['系统设置', 'API 配置'];
    if (path === '/system/privacy') return ['系统设置', '隐私协议设置'];
    if (path === '/system/ticket-sources') return ['系统设置', '工单来源设置'];
    if (path === '/system/base-data') return ['系统设置', '基础数据设置'];
    if (path === '/integrations/zabbix') return ['监控自动化', 'Zabbix 集成'];
    if (path === '/system/deletion-policy') return ['系统设置', '角色权限', '删除审批流程'];
    if (path === '/system/audit') return ['系统设置', '审计日志'];
    if (path === '/system/about') return ['系统设置', '关于系统'];
    if (path === '/profile') return ['账户', '个人资料'];
    if (path === '/theme') return ['账户', '主题设置'];
    if (path === '/privacy') return ['账户', '隐私协议'];
    return [''];
  })();

  const unread = notifications.filter((item) => item.ticket_no).length;

  return (
    <div className="min-h-screen bg-[#f5f7fa]" style={{
      '--sidebar-w': `${collapsedWidth}px`,
      '--theme-primary': sidebarTheme.primary,
      '--theme-primary-dark': sidebarTheme.primaryDark,
      '--theme-primary-light': sidebarTheme.primaryLight,
    } as CSSProperties}>
      {mobileOpen ? <div className="fixed inset-0 z-40 bg-ink-950/45 lg:hidden" onClick={() => setMobileOpen(false)} /> : null}

      <aside className={cn('fixed inset-y-0 left-0 z-50 flex flex-col border-r-0 transition-all duration-300', lightSidebar ? 'text-[#4e5969]' : 'text-slate-300', collapsed ? 'w-[248px] lg:w-[var(--sidebar-w)]' : 'w-[248px]', mobileOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0')} style={{ background: sidebarTheme.bg }}>
        <div className={cn('relative flex h-[64px] items-center gap-2.5 border-b px-4', lightSidebar && 'justify-center', lightSidebar ? 'border-[#e5e6eb]' : 'border-white/[0.06]', collapsed && 'lg:justify-center lg:px-2')}>
          <BrandMark />
          <div className={cn('min-w-0', lightSidebar ? '' : 'flex-1', collapsed && 'lg:hidden')}>
            <div className={cn('flex items-center gap-1.5 text-[15px] font-semibold tracking-tight', lightSidebar ? 'text-[#1f2329]' : 'text-white')}>{branding.system_name} <span className={cn('rounded px-1 py-0.5 text-[8px] font-semibold tracking-wide', lightSidebar ? 'bg-[#f2f3f5] text-[#86909c]' : 'bg-white/10 text-white/60')}>ITSM</span></div>
            <p className={cn('mt-0.5 truncate text-[9.5px] font-medium uppercase tracking-[0.12em]', lightSidebar ? 'text-[#86909c]' : 'text-slate-500')}>{branding.system_subtitle || 'SERVICE INTELLIGENCE'}</p>
          </div>
        </div>

        {lightSidebar ? <span className="pointer-events-none absolute bottom-0 right-0 top-[64px] w-px bg-[#e5e6eb]" aria-hidden="true" /> : null}
        {lightSidebar ? <span className="pointer-events-none absolute right-0 top-1/2 z-40 h-[100px] w-px -translate-y-1/2 bg-white" aria-hidden="true" /> : null}


        <div className="absolute -right-[18px] top-1/2 z-50 hidden h-[100px] w-[18px] -translate-y-1/2 lg:block">
          <svg className="pointer-events-none absolute inset-0 h-full w-full overflow-visible" viewBox="0 0 18 100" preserveAspectRatio="none" aria-hidden="true">
            <path
              d="M-0.5 0 C-0.5 8 4.5 14 9.5 17 C13.5 20 17.5 22 17.5 28 V72 C17.5 78 13.5 80 9.5 83 C4.5 86 -0.5 92 -0.5 100 L-2.5 100 L-2.5 0 Z"
              fill={sidebarTheme.bg}
            />
            <path
              d="M-0.5 0 C-0.5 8 4.5 14 9.5 17 C13.5 20 17.5 22 17.5 28 V72 C17.5 78 13.5 80 9.5 83 C4.5 86 -0.5 92 -0.5 100"
              fill="none"
              stroke={lightSidebar ? '#e5e6eb' : 'none'}
              strokeWidth="1"
              vectorEffect="non-scaling-stroke"
            />
          </svg>
          {lightSidebar ? (
            <span
              className="pointer-events-none absolute bottom-[28px] right-0 top-[28px] w-px bg-[#e5e6eb]"
              aria-hidden="true"
            />
          ) : null}
          <button
            type="button"
            onClick={() => setCollapsed((value) => !value)}
            className={cn(
              'absolute inset-y-0 left-0 flex w-[18px] items-center justify-center transition',
              lightSidebar ? 'text-[#86909c] hover:text-brand-600' : 'text-slate-500 hover:text-white',
            )}
            title={collapsed ? '展开侧栏' : '收起侧栏'}
            aria-label={collapsed ? '展开侧栏' : '收起侧栏'}
          >
            {collapsed ? <ChevronRight className="h-[15px] w-[15px] -translate-x-px" strokeWidth={1.5} /> : <ChevronLeft className="h-[15px] w-[15px] -translate-x-px" strokeWidth={1.5} />}
          </button>
        </div>

        <nav className="nav-scroll mr-[3px] min-h-0 flex-1 space-y-5 overflow-y-auto py-4 pl-2.5 pr-0">
          {navGroups.map((group) => (
            <div key={group.label}>
              <button
                type="button"
                onClick={() => toggleGroup(group.label)}
                className={cn('mb-1.5 flex w-full items-center gap-1 rounded-md px-2.5 py-1 text-left text-[11.5px] font-bold tracking-[0.12em] transition', lightSidebar ? 'text-[#86909c] hover:bg-[#fafafa] hover:text-[#1f2329]' : 'text-slate-400 hover:bg-white/[0.04] hover:text-slate-200', collapsed && 'lg:justify-center lg:gap-1 lg:px-1 lg:py-0.5 lg:text-center lg:text-[8.5px] lg:leading-3 lg:tracking-normal')}
                title={collapsedGroups.has(group.label) ? '展开子级菜单' : '收起子级菜单'}
                aria-label={collapsedGroups.has(group.label) ? '展开子级菜单' : '收起子级菜单'}
              >
                <span className={cn('min-w-0 flex-1 truncate', collapsed && 'lg:flex-none lg:max-w-full')}>{collapsed && (branding.nav_labels?.[`group:${group.label}`] || group.label) === '监控自动化' ? <>监控<br />自动化</> : (branding.nav_labels?.[`group:${group.label}`] || group.label)}</span>
                <ChevronDown className={cn('h-3 w-3 shrink-0 transition-transform', lightSidebar ? 'text-[#86909c]' : 'text-slate-500', collapsedGroups.has(group.label) && '-rotate-90', collapsed && (lightSidebar ? 'lg:text-[#4e5969]' : 'lg:text-slate-300'))} />
              </button>
              {!collapsedGroups.has(group.label) ? (
              <div className="space-y-0.5">
                {group.items.map((item) => {
                  const active = isActive(item.href);
                  const Icon = item.icon;
                  const hasChildren = Boolean(item.children?.length);
                  return (
                    <div key={item.href}>
                      <div className={cn('group relative flex h-9 items-center rounded-md transition-all', active ? (lightSidebar ? 'text-[#2c68ff]' : 'text-white shadow-[inset_0_0_0_1px_rgba(255,255,255,0.06)]') : (lightSidebar ? 'text-[#4e5969] hover:bg-[#fafafa] hover:text-[#1f2329]' : 'text-slate-400 hover:bg-white/[0.045] hover:text-slate-100'), collapsed && 'lg:justify-center')} style={active ? { background: sidebarTheme.activeBg, color: sidebarTheme.activeText } : undefined}>
                        {active && !lightSidebar ? <span className="absolute left-0 top-1/2 h-4 w-0.5 -translate-y-1/2 rounded-full" style={{ background: sidebarTheme.accent }} /> : null}
                        <Link to={item.href} title={collapsed ? (branding.nav_labels?.[item.href] || item.label) : undefined} className={cn('flex h-9 min-w-0 flex-1 items-center gap-2.5 px-2.5 text-[12.5px] font-medium', collapsed && 'lg:justify-center lg:px-0')} onClick={() => { setMobileOpen(false); if (item.href === '/cmdb') setAssetOpen(true); }}>
                          <Icon className={cn('h-[17px] w-[17px] shrink-0 transition', active ? 'text-current' : (lightSidebar ? 'text-[#86909c] group-hover:text-[#1f2329]' : 'text-slate-500 group-hover:text-slate-300'))} />
                          <span className={cn('truncate', collapsed && 'lg:hidden')}>{branding.nav_labels?.[item.href] || item.label}</span>
                          {item.badge === 'live' ? <span className={cn('ml-auto flex items-center gap-1 text-[8.5px] font-semibold uppercase tracking-wider', lightSidebar ? 'text-[#389e0d]' : 'text-emerald-400/80', collapsed && 'lg:hidden')}><span className={cn('h-1 w-1 rounded-full pulse-dot', lightSidebar ? 'bg-[#52c41a]' : 'bg-emerald-400')} />live</span> : null}
                        </Link>
                        {hasChildren ? (
                          <button onClick={() => setAssetOpen((value) => !value)} className={cn('mr-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-md transition', lightSidebar ? 'text-[#86909c] hover:bg-[#f2f3f5] hover:text-[#1f2329]' : 'text-slate-500 hover:bg-white/10 hover:text-slate-200', collapsed && 'lg:hidden')} aria-label={assetOpen ? '收起资产分类' : '展开资产分类'}>
                            <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', !assetOpen && '-rotate-90')} />
                          </button>
                        ) : null}
                      </div>
                      {hasChildren && assetOpen ? (
                        <div className={cn('ml-3 mt-0.5 space-y-0.5 border-l pl-2', lightSidebar ? 'border-[#f0f0f0]' : 'border-white/[0.08]', collapsed && 'lg:hidden')}>
                          {item.children!.map((child) => {
                            const childIsActive = childActive(child);
                            return (
                              <Link key={child.href} to={child.href} onClick={() => setMobileOpen(false)} className={cn('flex h-8 items-center gap-2 rounded-md px-2 text-[12px] transition', childIsActive ? 'font-medium' : (lightSidebar ? 'text-[#4e5969] hover:bg-[#fafafa] hover:text-[#1f2329]' : 'text-slate-500 hover:bg-white/[0.035] hover:text-slate-300'))} style={childIsActive ? { background: sidebarTheme.activeBg, color: sidebarTheme.activeText } : undefined}>
                                <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: child.color || '#64748b' }} />
                                <span className="truncate">{child.label}</span>
                              </Link>
                            );
                          })}
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
              ) : null}
            </div>
          ))}
        </nav>

        <div className={cn('border-t p-3', lightSidebar ? 'border-[#e5e6eb]' : 'border-white/[0.06]', collapsed && 'lg:px-2')}>
          <button onClick={() => setStatusOpen(true)} className={cn('mb-2 flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left transition', lightSidebar ? 'bg-[#fafafa] hover:bg-[#f2f3f5]' : 'bg-white/[0.035] hover:bg-white/[0.06]', collapsed && (lightSidebar ? 'lg:justify-center lg:bg-transparent lg:p-0' : 'lg:justify-center lg:bg-transparent lg:p-0'))}>
            <span className="relative flex h-2 w-2 shrink-0"><span className="absolute inline-flex h-full w-full rounded-full bg-[#52c41a] opacity-50 pulse-dot" /><span className="relative inline-flex h-2 w-2 rounded-full bg-[#52c41a]" /></span>
            <div className={cn('min-w-0', collapsed && 'lg:hidden')}><p className={cn('text-[10.5px] font-medium', lightSidebar ? 'text-[#1f2329]' : 'text-slate-300')}>平台运行正常</p><p className={cn('text-[9px]', lightSidebar ? 'text-[#86909c]' : 'text-slate-600')}>v{APP_VERSION}</p></div>
          </button>
          <div className={cn('flex items-center gap-2.5 rounded-lg px-1 py-1', collapsed && 'lg:justify-center lg:px-0')}>
            <Avatar name={user.name} src={user.avatar_url} color={user.avatar_color} size="sm" />
            <div className={cn('min-w-0 flex-1', collapsed && 'lg:hidden')}><p className={cn('truncate text-[11.5px] font-medium', lightSidebar ? 'text-[#1f2329]' : 'text-slate-200')}>{user.name}</p><p className={cn('truncate text-[9.5px]', lightSidebar ? 'text-[#86909c]' : 'text-slate-500')}>{user.role?.name}</p></div>
            <button className={cn('rounded-md p-1 transition', lightSidebar ? 'text-[#86909c] hover:bg-[#f2f3f5] hover:text-[#1f2329]' : 'text-slate-500 hover:bg-white/5 hover:text-slate-200', collapsed && 'lg:hidden')} onClick={logout} title="退出登录"><LogOut className="h-3.5 w-3.5" /></button>
          </div>
        </div>
      </aside>

      <div className={cn('min-h-screen transition-all duration-300', collapsed ? 'lg:pl-[var(--sidebar-w)]' : 'lg:pl-[248px]')}>
        <header className="sticky top-0 z-30 flex h-[64px] items-center gap-3 border-b border-[#e5e6eb] bg-white px-4 sm:px-6 lg:px-8">
          <button className="rounded-lg p-2 text-slate-600 hover:bg-slate-100 lg:hidden" onClick={() => setMobileOpen(true)} aria-label="打开菜单"><Menu className="h-5 w-5" /></button>
          <div className="flex min-w-0 flex-1 items-center gap-2 text-[12px]">
            {breadcrumb.map((item, index) => (
              <span key={`${item}-${index}`} className={cn('min-w-0 items-center gap-2', index === breadcrumb.length - 1 ? 'flex' : 'hidden sm:flex')}>
                {index > 0 ? <ChevronRight className="hidden h-3 w-3 shrink-0 text-slate-300 sm:block" /> : null}
                {index < breadcrumb.length - 1 && BREADCRUMB_HREFS[item] ? (
                  <Link to={BREADCRUMB_HREFS[item]} className="truncate text-slate-400 transition hover:text-brand-600">{item}</Link>
                ) : (
                  <span className={cn('truncate', index === breadcrumb.length - 1 ? 'font-medium text-slate-700' : 'text-slate-400')}>{item}</span>
                )}
              </span>
            ))}
          </div>
          <div className="flex items-center gap-1.5">
            <button onClick={() => setSearchOpen(true)} className="hidden h-9 min-w-[220px] items-center gap-2 rounded-md border border-[#e5e6eb] bg-[#f7f8fa] px-3 text-left text-[12px] text-[#86909c] transition hover:border-brand-500 hover:bg-white md:flex"><Search className="h-3.5 w-3.5" /><span className="flex-1">搜索资产、工单…</span><span className="kbd">⌘ K</span></button>
            <button onClick={() => setSearchOpen(true)} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 md:hidden" aria-label="搜索"><Search className="h-[18px] w-[18px]" /></button>
            <span className="mx-1 hidden h-5 w-px bg-slate-200 sm:block" />
            <div className={cn('hidden items-center gap-1.5 rounded border px-2 py-1 sm:flex', IS_BETA ? 'border-[#ffd591] bg-[#fff7e6]' : 'border-[#b7eb8f] bg-[#f6ffed]')}><span className={cn('h-1.5 w-1.5 rounded-full', IS_BETA ? 'bg-[#fa8c16]' : 'bg-[#52c41a]')} /><span className={cn('text-[11px] font-medium', IS_BETA ? 'text-[#d46b08]' : 'text-[#389e0d]')}>{IS_BETA ? 'Beta 开发环境' : '生产环境'}</span></div>
            <NotificationMenu notifications={notifications} unread={unread} />
            <UserMenu user={user} onProfile={() => navigate('/profile')} onTheme={() => navigate('/theme')} onPassword={() => { setPasswordForced(false); setPasswordOpen(true); }} onPrivacy={() => navigate('/privacy')} onLogout={logout} />
          </div>
        </header>
        {maintenanceNotice ? (
          <div className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-[10.5px] text-amber-800 sm:px-6 lg:px-8">
            <div className="flex w-full items-center gap-2">
              <Megaphone className="h-3.5 w-3.5 shrink-0" />
              <span className="font-semibold">{maintenanceNotice.phase === 'active' ? '系统维护中' : '维护预告'}</span>
              <span className="min-w-0 flex-1 truncate">{maintenanceNotice.title} · {formatDate(maintenanceNotice.start_at, 'MM-DD HH:mm')} — {formatDate(maintenanceNotice.end_at, 'MM-DD HH:mm')}</span>
              <span className="hidden text-[9px] text-amber-700/70 sm:block">{maintenanceNotice.content}</span>
              <button onClick={() => { const next = [...dismissedMaintenance, String(maintenanceNotice.id)]; setDismissedMaintenance(next); localStorage.setItem('nextitops_dismissed_maintenance', JSON.stringify(next)); setMaintenanceNotice(null); }} className="rounded p-1 text-amber-600 hover:bg-amber-100" aria-label="关闭维护公告"><X className="h-3.5 w-3.5" /></button>
            </div>
          </div>
        ) : null}
        <main className="w-full px-4 py-5 sm:px-6 lg:px-6 lg:py-6 2xl:px-8"><Outlet /></main>
      </div>

      <GlobalSearch open={searchOpen} onClose={() => setSearchOpen(false)} ciTypes={ciTypes} menuOrder={menuOrder} />
      <PasswordModal open={passwordOpen} forced={passwordForced} onClose={() => { if (!passwordForced) setPasswordOpen(false); }} onSuccess={() => { localStorage.setItem('nextitops_password_expired', '0'); setPasswordForced(false); setPasswordOpen(false); }} />
      <SystemStatusModal open={statusOpen} onClose={() => setStatusOpen(false)} />
    </div>
  );
}

function NotificationMenu({ notifications, unread }: { notifications: any[]; unread: number }) {
  const navigate = useNavigate();
  return (
    <div className="relative">
      <details className="group">
        <summary className="flex h-9 w-9 cursor-pointer list-none items-center justify-center rounded-lg text-slate-500 transition hover:bg-slate-100 hover:text-slate-800 [&::-webkit-details-marker]:hidden">
          <span className="relative"><Bell className="h-[18px] w-[18px]" />{unread > 0 ? <span className="absolute -right-1 -top-1 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-rose-500 text-[8px] font-bold text-white ring-2 ring-white">{unread}</span> : null}</span>
        </summary>
        <div className="animate-scale-in absolute right-0 top-[calc(100%+10px)] z-40 w-[330px] rounded-xl border border-slate-200 bg-white p-2 shadow-[var(--shadow-float)]">
          <div className="flex items-center justify-between px-2 py-1.5"><span className="text-[12px] font-semibold text-slate-800">最新监控告警</span><button className="text-[10.5px] font-medium text-brand-600 hover:text-brand-700" onClick={() => navigate('/alerts')}>全部告警</button></div>
          <div className="space-y-0.5">
            {notifications.slice(0, 4).map((alert) => {
              const severity = SEVERITY_META[alert.severity] || SEVERITY_META.warning;
              return (
                <button key={alert.id} onClick={() => navigate(alert.ticket_id ? `/tickets/incident/${alert.ticket_id}` : '/alerts')} className="flex w-full items-start gap-2.5 rounded-lg px-2 py-2 text-left transition hover:bg-slate-50">
                  <span className={cn('mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full', severity.dot)} />
                  <span className="min-w-0 flex-1"><span className="line-clamp-2 block text-[11.5px] leading-snug text-slate-700">{alert.event_name}</span><span className="mt-1 flex items-center gap-1.5 text-[9.5px] text-slate-400">{alert.host_name || '未知主机'} · {relativeTime(alert.received_at)}</span></span>
                </button>
              );
            })}
            {!notifications.length ? <p className="px-2 py-6 text-center text-[11px] text-slate-400">暂无告警</p> : null}
          </div>
        </div>
      </details>
    </div>
  );
}

function UserMenu({ user, onProfile, onTheme, onPassword, onPrivacy, onLogout }: { user: User; onProfile: () => void; onTheme: () => void; onPassword: () => void; onPrivacy: () => void; onLogout: () => void }) {
  return (
    <details className="group relative">
      <summary className="flex cursor-pointer list-none items-center gap-2 rounded-lg p-1 pl-1.5 transition hover:bg-slate-100 [&::-webkit-details-marker]:hidden">
        <Avatar name={user.name} src={user.avatar_url} color={user.avatar_color} size="sm" />
        <div className="hidden min-w-0 text-left sm:block"><p className="max-w-[84px] truncate text-[11.5px] font-medium leading-tight text-slate-700">{user.name}</p><p className="max-w-[84px] truncate text-[9.5px] leading-tight text-slate-400">{user.role?.name}</p></div>
        <ChevronDown className="hidden h-3 w-3 text-slate-400 sm:block" />
      </summary>
      <div className="animate-scale-in absolute right-0 top-[calc(100%+10px)] z-40 w-[220px] rounded-xl border border-slate-200 bg-white p-1.5 shadow-[var(--shadow-float)]">
        <div className="mb-1 border-b border-slate-100 px-2.5 py-2"><p className="text-[12.5px] font-semibold text-slate-800">{user.name}</p><p className="mt-0.5 truncate text-[10px] text-slate-400">{user.email || user.username}</p><span className="mt-1.5 inline-flex rounded bg-brand-50 px-1.5 py-0.5 text-[9px] font-semibold text-brand-700">{user.role?.name}</span></div>
        <button onClick={onProfile} className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[12px] text-slate-600 hover:bg-slate-50"><UserRound className="h-4 w-4 text-slate-400" /> 个人资料</button>
        <button onClick={onTheme} className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[12px] text-slate-600 hover:bg-slate-50"><Palette className="h-4 w-4 text-slate-400" /> 主题设置</button>
        <button onClick={onPassword} className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[12px] text-slate-600 hover:bg-slate-50"><KeyRound className="h-4 w-4 text-slate-400" /> 修改密码</button>
        <button onClick={onPrivacy} className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[12px] text-slate-600 hover:bg-slate-50"><ShieldCheck className="h-4 w-4 text-slate-400" /> 隐私协议</button>
        <div className="my-1 h-px bg-slate-100" />
        <button onClick={onLogout} className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[12px] text-rose-600 hover:bg-rose-50"><LogOut className="h-4 w-4" /> 退出登录</button>
      </div>
    </details>
  );
}

function GlobalSearch({ open, onClose, ciTypes, menuOrder }: { open: boolean; onClose: () => void; ciTypes: Array<Pick<CIType, 'code' | 'name' | 'color' | 'enabled'>>; menuOrder: string[] }) {
  const navigate = useNavigate();
  const { can } = useAuth();
  const navGroups = useFilteredNav(ciTypes, menuOrder);
  const [query, setQuery] = useState('');
  const [cis, setCis] = useState<CI[]>([]);
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [searching, setSearching] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const go = (path: string) => { onClose(); navigate(path); };
  const pages = navGroups.flatMap((group) => group.items.map((item) => ({ ...item, group: group.label })));

  useEffect(() => {
    if (!open) { setQuery(''); setCis([]); setTickets([]); return; }
    setTimeout(() => inputRef.current?.focus(), 50);
  }, [open]);

  useEffect(() => {
    if (!query.trim()) return;
    const timer = setTimeout(async () => {
      setSearching(true);
      try {
        const requests: Promise<any>[] = [api.get<any>(`/api/cis/options?q=${encodeURIComponent(query.trim())}`).catch(() => ({ data: [] }))];
        if (can('itsm.view')) requests.push(api.get<any>(`/api/tickets?q=${encodeURIComponent(query.trim())}&pageSize=5`).catch(() => ({ data: [] })));
        const [ciResult, ticketResult] = await Promise.all(requests);
        setCis(ciResult.data || []);
        setTickets(ticketResult?.data || []);
      } finally { setSearching(false); }
    }, 240);
    return () => clearTimeout(timer);
  }, [query, can]);

  return (
    <Modal open={open} onClose={onClose} size="lg" resizable={false} bodyClassName="p-0">
      <div className="flex items-center gap-3 border-b border-[#edf0f6] px-4">
        <Search className="h-4 w-4 shrink-0 text-slate-400" />
        <input ref={inputRef} value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            if (cis[0]) go(`/cmdb/${cis[0].id}`);
            else if (tickets[0]) go(`/tickets/${tickets[0].type}/${tickets[0].id}`);
            else if (!query.trim() && pages[0]) go(pages[0].href);
          }
        }} placeholder="搜索资产编号、IP、工单编号，或跳转功能…" className="h-14 flex-1 border-0 bg-transparent text-sm text-slate-800 outline-none placeholder:text-slate-400" />
        <button onClick={onClose} className="rounded-md border border-slate-200 px-1.5 py-0.5 text-[10px] text-slate-400">ESC</button>
      </div>
      <div className="custom-scroll max-h-[60vh] overflow-y-auto p-2">
        {!query.trim() ? (
          <div className="p-2">
            <p className="px-2 py-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">快速导航</p>
            <div className="grid gap-1 sm:grid-cols-2">
              {pages.map((page) => {
                const Icon = page.icon;
                return <button key={page.href} onClick={() => go(page.href)} className="flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition hover:bg-slate-50"><span className="flex h-7 w-7 items-center justify-center rounded-lg bg-slate-100 text-slate-500"><Icon className="h-3.5 w-3.5" /></span><span className="min-w-0"><span className="block text-[12px] font-medium text-slate-700">{page.label}</span><span className="block text-[9.5px] text-slate-400">{page.group}</span></span></button>;
              })}
            </div>
          </div>
        ) : (
          <div className="space-y-3 p-1">
            {cis.length ? <div><p className="px-2 py-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">配置项</p>{cis.map((ci) => <button key={ci.id} onClick={() => go(`/cmdb/${ci.id}`)} className="flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left hover:bg-slate-50"><span className="flex h-7 w-7 items-center justify-center rounded-lg bg-brand-50 text-brand-600"><Database className="h-3.5 w-3.5" /></span><span className="min-w-0 flex-1"><span className="block truncate text-[12px] font-medium text-slate-700">{ci.name}</span><span className="block font-mono text-[9.5px] text-slate-400">{ci.asset_no}</span></span><span className="text-[9.5px] text-slate-400">{ci.type_name}</span></button>)}</div> : null}
            {tickets.length ? <div><p className="px-2 py-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">工单</p>{tickets.map((ticket) => <button key={ticket.id} onClick={() => go(`/tickets/${ticket.type}/${ticket.id}`)} className="flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left hover:bg-slate-50"><span className="flex h-7 w-7 items-center justify-center rounded-lg bg-amber-50 text-amber-600"><GitPullRequest className="h-3.5 w-3.5" /></span><span className="min-w-0 flex-1"><span className="block truncate text-[12px] font-medium text-slate-700">{ticket.title}</span><span className="block font-mono text-[9.5px] text-slate-400">{ticket.ticket_no}</span></span></button>)}</div> : null}
            {!searching && !cis.length && !tickets.length ? <div className="px-3 py-12 text-center"><p className="text-[12px] text-slate-500">没有找到匹配结果</p><p className="mt-1 text-[10px] text-slate-400">尝试资产编号、IP 或工单标题</p></div> : null}
            {searching ? <p className="px-2 py-4 text-center text-[11px] text-slate-400">正在搜索…</p> : null}
          </div>
        )}
      </div>
      <div className="flex items-center justify-between border-t border-[#edf0f6] bg-[#fbfcfe] px-4 py-2 text-[9.5px] text-slate-400"><span className="flex items-center gap-1"><Sparkles className="h-3 w-3" /> 支持跨 CMDB 与工单检索</span><span>回车打开 · ESC 关闭</span></div>
    </Modal>
  );
}

function PasswordModal({ open, forced = false, onClose, onSuccess }: { open: boolean; forced?: boolean; onClose: () => void; onSuccess?: () => void }) {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [policy, setPolicy] = useState<any>({ min_length: 6, require_upper: false, require_lower: false, require_number: false, require_symbol: false });

  useEffect(() => {
    if (open) api.get<{ data: any }>('/api/auth/password-policy').then((response) => setPolicy(response.data)).catch(() => {});
  }, [open]);

  const submit = async () => {
    setError('');
    const minLength = Number(policy.min_length) || 6;
    if (newPassword.length < minLength) return setError(`新密码至少 ${minLength} 位`);
    if (policy.require_upper && !/[A-Z]/.test(newPassword)) return setError('新密码需包含大写字母');
    if (policy.require_lower && !/[a-z]/.test(newPassword)) return setError('新密码需包含小写字母');
    if (policy.require_number && !/\d/.test(newPassword)) return setError('新密码需包含数字');
    if (policy.require_symbol && !/[^A-Za-z0-9]/.test(newPassword)) return setError('新密码需包含符号');
    if (newPassword !== confirmPassword) return setError('两次输入的新密码不一致');
    setLoading(true);
    try {
      await api.post('/api/auth/change-password', { currentPassword, newPassword });
      toast.success('密码已更新');
      setCurrentPassword(''); setNewPassword(''); setConfirmPassword('');
      onSuccess?.();
      onClose();
    } catch (err: any) { setError(err.message); } finally { setLoading(false); }
  };

  return (
    <Modal open={open} onClose={() => { if (!forced) onClose(); }} title={forced ? '密码已过期，请设置新密码' : '修改登录密码'} description={forced ? '为保障账号安全，首次登录或密码过期后必须先完成修改才能继续使用平台。' : `密码需满足当前安全策略，至少 ${policy.min_length || 6} 位。`} size="sm" icon={KeyRound} footer={<>{forced ? null : <Button variant="secondary" size="sm" onClick={onClose}>取消</Button>}<Button size="sm" loading={loading} onClick={submit}>更新密码</Button></>}>
      <div className="space-y-3">
        <Field label="当前密码"><Input type="password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} placeholder="输入当前密码" /></Field>
        <Field label="新密码"><Input type="password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} placeholder="满足密码复杂度策略" /></Field>
        <Field label="确认新密码" error={error}><Input type="password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} placeholder="再次输入新密码" /></Field>
      </div>
    </Modal>
  );
}
