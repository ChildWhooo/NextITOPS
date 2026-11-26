export interface SidebarTheme {
  id: string;
  name: string;
  description: string;
  bg: string;
  panel: string;
  activeBg: string;
  activeText: string;
  accent: string;
  muted: string;
  primary: string;
  primaryDark: string;
  primaryLight: string;
  mode?: 'light' | 'dark';
}

export const SIDEBAR_THEMES: SidebarTheme[] = [
  { id: 'ink', name: '经典浅色', description: '经典浅蓝，浅色导航', mode: 'light', bg: '#ffffff', panel: '#fafafa', activeBg: '#e6f4ff', activeText: '#2c68ff', accent: '#2c68ff', muted: '#86909c', primary: '#2c68ff', primaryDark: '#1d54e6', primaryLight: '#eff4ff' },
  { id: 'crimson', name: '绯红', description: '热烈红调，浅色导航', mode: 'light', bg: '#ffffff', panel: '#fff1f0', activeBg: '#fff1f0', activeText: '#cf1322', accent: '#f52f3e', muted: '#86909c', primary: '#f52f3e', primaryDark: '#cf1322', primaryLight: '#fff1f0' },
  { id: 'orange', name: '橙光', description: '活力橙调，浅色导航', mode: 'light', bg: '#ffffff', panel: '#fff2e8', activeBg: '#fff2e8', activeText: '#d4380d', accent: '#fd571f', muted: '#86909c', primary: '#fd571f', primaryDark: '#d4380d', primaryLight: '#fff2e8' },
  { id: 'amber', name: '琥珀', description: '温暖金橙，浅色导航', mode: 'light', bg: '#ffffff', panel: '#fff7e6', activeBg: '#fff7e6', activeText: '#d46b08', accent: '#ff8700', muted: '#86909c', primary: '#ff8700', primaryDark: '#d46b08', primaryLight: '#fff7e6' },
  { id: 'lime', name: '青柠', description: '清新黄绿，浅色导航', mode: 'light', bg: '#ffffff', panel: '#fcffe6', activeBg: '#f4ffb8', activeText: '#5b8c00', accent: '#a5e20d', muted: '#86909c', primary: '#7cb305', primaryDark: '#5b8c00', primaryLight: '#fcffe6' },
  { id: 'emerald', name: '翠绿', description: '清透绿调，浅色导航', mode: 'light', bg: '#ffffff', panel: '#e6fffb', activeBg: '#d9f7ef', activeText: '#08979c', accent: '#0bdba8', muted: '#86909c', primary: '#00b96b', primaryDark: '#08979c', primaryLight: '#e6fffb' },
  { id: 'cyan', name: '青碧', description: '冷静青调，浅色导航', mode: 'light', bg: '#ffffff', panel: '#e6fffb', activeBg: '#d9f7f7', activeText: '#08979c', accent: '#00c8c8', muted: '#86909c', primary: '#08979c', primaryDark: '#006d75', primaryLight: '#e6fffb' },
  { id: 'indigo', name: '靛蓝', description: '深邃蓝调，浅色导航', mode: 'light', bg: '#ffffff', panel: '#f0f5ff', activeBg: '#e6edff', activeText: '#254be9', accent: '#254be9', muted: '#86909c', primary: '#254be9', primaryDark: '#1d3fcc', primaryLight: '#f0f5ff' },
  { id: 'violet', name: '紫罗兰', description: '典雅紫调，浅色导航', mode: 'light', bg: '#ffffff', panel: '#f9f0ff', activeBg: '#f3e8ff', activeText: '#722ed1', accent: '#6e24d3', muted: '#86909c', primary: '#722ed1', primaryDark: '#531dab', primaryLight: '#f9f0ff' },
  { id: 'magenta', name: '品红', description: '明快粉调，浅色导航', mode: 'light', bg: '#ffffff', panel: '#fff0f6', activeBg: '#ffe6f0', activeText: '#c41d7f', accent: '#ff2b9f', muted: '#86909c', primary: '#eb2f96', primaryDark: '#c41d7f', primaryLight: '#fff0f6' },
  { id: 'ocean', name: '深海青', description: '沉静蓝色，青色高亮', mode: 'dark', bg: '#082235', panel: '#0c3048', activeBg: 'rgba(56,189,248,0.14)', activeText: '#e0f2fe', accent: '#38bdf8', muted: '#7da1b8', primary: '#0284c7', primaryDark: '#0369a1', primaryLight: '#e0f2fe' },
  { id: 'forest', name: '墨林绿', description: '低饱和绿，护眼柔和', mode: 'dark', bg: '#0b1f17', panel: '#112a20', activeBg: 'rgba(52,211,153,0.14)', activeText: '#dcfce7', accent: '#34d399', muted: '#7f9f91', primary: '#059669', primaryDark: '#047857', primaryLight: '#d1fae5' },
  { id: 'plum', name: '夜幕紫', description: '深紫夜色，洋红强调', mode: 'dark', bg: '#1b1026', panel: '#251633', activeBg: 'rgba(232,121,249,0.14)', activeText: '#fae8ff', accent: '#e879f9', muted: '#a58aaf', primary: '#c026d3', primaryDark: '#a21caf', primaryLight: '#fae8ff' },
  { id: 'graphite', name: '玄武灰', description: '中性石墨，金色点缀', mode: 'dark', bg: '#111827', panel: '#1b2537', activeBg: 'rgba(251,191,36,0.12)', activeText: '#f8fafc', accent: '#fbbf24', muted: '#8d99ac', primary: '#d97706', primaryDark: '#b45309', primaryLight: '#fef3c7' },
];

export function getSidebarTheme(id?: string | null) {
  return SIDEBAR_THEMES.find((theme) => theme.id === id) || SIDEBAR_THEMES[0];
}
