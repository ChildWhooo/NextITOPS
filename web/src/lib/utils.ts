import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import dayjs from 'dayjs';
import relativeTimePlugin from 'dayjs/plugin/relativeTime';
import 'dayjs/locale/zh-cn';

dayjs.extend(relativeTimePlugin);
dayjs.locale('zh-cn');

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatDate(value?: string | null, template = 'YYYY/MM/DD HH:mm') {
  if (!value) return '—';
  const date = dayjs(value);
  return date.isValid() ? date.format(template) : '—';
}

export function formatDay(value?: string | null) {
  return formatDate(value, 'YYYY/MM/DD');
}

export function relativeTime(value?: string | null) {
  if (!value) return '—';
  const date = dayjs(value);
  if (!date.isValid()) return '—';
  return date.fromNow();
}

export function isOverdue(value?: string | null, status?: string) {
  if (!value || ['resolved', 'closed', 'cancelled'].includes(status || '')) return false;
  return dayjs(value).isBefore(dayjs());
}

export function initials(name?: string | null) {
  if (!name) return '?';
  const trimmed = name.trim();
  if (/[\u4e00-\u9fa5]/.test(trimmed)) return trimmed.slice(-2);
  return trimmed
    .split(/\s+/)
    .map((part) => part[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
}

export function formatNumber(value?: number | string | null, digits = 0) {
  const number = Number(value || 0);
  return new Intl.NumberFormat('zh-CN', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(Number.isFinite(number) ? number : 0);
}

export function formatCurrency(value?: number | string | null) {
  const number = Number(value || 0);
  if (!number) return '—';
  if (number >= 10000) return `¥ ${formatNumber(number / 10000, 1)} 万`;
  return `¥ ${formatNumber(number)}`;
}

export function getErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  return '操作失败，请稍后重试';
}

export async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const textArea = document.createElement('textarea');
    textArea.value = text;
    textArea.style.position = 'fixed';
    textArea.style.opacity = '0';
    document.body.appendChild(textArea);
    textArea.select();
    const copied = document.execCommand('copy');
    textArea.remove();
    return copied;
  }
}

export const PRIORITY_META: Record<string, { label: string; className: string; dot: string }> = {
  critical: { label: '紧急', className: 'bg-rose-50 text-rose-700 ring-rose-600/15', dot: 'bg-rose-500' },
  high: { label: '高', className: 'bg-orange-50 text-orange-700 ring-orange-600/15', dot: 'bg-orange-500' },
  medium: { label: '中', className: 'bg-blue-50 text-blue-700 ring-blue-600/15', dot: 'bg-blue-500' },
  low: { label: '低', className: 'bg-slate-100 text-slate-600 ring-slate-500/10', dot: 'bg-slate-400' },
};

export const TICKET_STATUS_META: Record<string, { label: string; className: string; dot: string }> = {
  new: { label: '待受理', className: 'bg-sky-50 text-sky-700 ring-sky-600/15', dot: 'bg-sky-500' },
  in_progress: { label: '处理中', className: 'bg-blue-50 text-blue-700 ring-blue-600/15', dot: 'bg-blue-500' },
  pending_approval: { label: '待审批', className: 'bg-amber-50 text-amber-700 ring-amber-600/20', dot: 'bg-amber-500' },
  resolved: { label: '已解决', className: 'bg-emerald-50 text-emerald-700 ring-emerald-600/15', dot: 'bg-emerald-500' },
  closed: { label: '已关闭', className: 'bg-slate-100 text-slate-600 ring-slate-500/10', dot: 'bg-slate-400' },
  cancelled: { label: '已取消', className: 'bg-rose-50 text-rose-600 ring-rose-600/10', dot: 'bg-rose-400' },
};

export const TICKET_TYPE_META: Record<string, { label: string; short: string; className: string; soft: string; icon: string }> = {
  incident: { label: '事件', short: 'INC', className: 'text-sky-700 bg-sky-50 ring-sky-600/15', soft: 'bg-sky-500', icon: 'Zap' },
  problem: { label: '问题', short: 'PRB', className: 'text-violet-700 bg-violet-50 ring-violet-600/15', soft: 'bg-violet-500', icon: 'Search' },
  change: { label: '变更', short: 'CHG', className: 'text-amber-700 bg-amber-50 ring-amber-600/15', soft: 'bg-amber-500', icon: 'GitPullRequest' },
};

export const CI_STATUS_META: Record<string, { label: string; className: string; dot: string }> = {
  in_use: { label: '使用中', className: 'bg-emerald-50 text-emerald-700 ring-emerald-600/15', dot: 'bg-emerald-500' },
  idle: { label: '闲置', className: 'bg-slate-100 text-slate-600 ring-slate-500/10', dot: 'bg-slate-400' },
  maintenance: { label: '维护中', className: 'bg-amber-50 text-amber-700 ring-amber-600/20', dot: 'bg-amber-500' },
  retired: { label: '已退役', className: 'bg-rose-50 text-rose-600 ring-rose-600/10', dot: 'bg-rose-400' },
  planned: { label: '规划中', className: 'bg-violet-50 text-violet-700 ring-violet-600/15', dot: 'bg-violet-500' },
  offline: { label: '已下线', className: 'bg-slate-100 text-slate-500 ring-slate-500/10', dot: 'bg-slate-400' },
};

export const CRITICALITY_META: Record<string, { label: string; className: string }> = {
  critical: { label: '核心', className: 'bg-rose-50 text-rose-700 ring-rose-600/15' },
  high: { label: '重要', className: 'bg-orange-50 text-orange-700 ring-orange-600/15' },
  medium: { label: '一般', className: 'bg-blue-50 text-blue-700 ring-blue-600/15' },
  low: { label: '低', className: 'bg-slate-100 text-slate-600 ring-slate-500/10' },
};

export const ENVIRONMENT_META: Record<string, { label: string; className: string }> = {
  production: { label: '生产环境', className: 'bg-rose-50 text-rose-700 ring-rose-600/15' },
  staging: { label: '预发布', className: 'bg-amber-50 text-amber-700 ring-amber-600/15' },
  test: { label: '测试环境', className: 'bg-sky-50 text-sky-700 ring-sky-600/15' },
  dr: { label: '灾备环境', className: 'bg-violet-50 text-violet-700 ring-violet-600/15' },
};

export const SEVERITY_META: Record<string, { label: string; className: string; dot: string }> = {
  not_classified: { label: '未分类', className: 'bg-slate-100 text-slate-600 ring-slate-500/10', dot: 'bg-slate-400' },
  information: { label: '信息', className: 'bg-sky-50 text-sky-700 ring-sky-600/15', dot: 'bg-sky-500' },
  warning: { label: '警告', className: 'bg-amber-50 text-amber-700 ring-amber-600/20', dot: 'bg-amber-500' },
  average: { label: '一般严重', className: 'bg-orange-50 text-orange-700 ring-orange-600/15', dot: 'bg-orange-500' },
  high: { label: '高', className: 'bg-rose-50 text-rose-700 ring-rose-600/15', dot: 'bg-rose-500' },
  disaster: { label: '灾难', className: 'bg-red-100 text-red-800 ring-red-700/20', dot: 'bg-red-600' },
};

export const RELATION_LABELS: Record<string, string> = {
  depends_on: '依赖于',
  runs_on: '运行于',
  installed_on: '安装于',
  connects_to: '连接至',
  member_of: '归属于',
  hosts: '承载',
  related: '相关',
  caused_by: '由…引起',
  duplicate: '重复于',
  blocks: '阻塞',
};

export const SOURCE_LABELS: Record<string, string> = {
  portal: '服务门户',
  im: 'IM 报障',
  phone: '电话',
  email: '邮件',
  monitoring: '监控系统',
  zabbix: 'Zabbix',
  walk_in: '现场',
  inspection: '巡检',
  admin: '管理员创建',
};

export const ACTION_LABELS: Record<string, string> = {
  created: '创建工单',
  advanced: '流转阶段',
  approved: '审批通过',
  rejected: '审批驳回',
  closed: '关闭工单',
  reopened: '重新打开',
  assigned: '变更负责人',
  commented: '添加评论',
  'zabbix.recovery': 'Zabbix 告警恢复',
  'zabbix.repeat': 'Zabbix 重复告警',
  'zabbix.reopened': 'Zabbix 告警重开',
};

export function percent(part: number, total: number) {
  if (!total) return 0;
  return Math.round((part / total) * 1000) / 10;
}
