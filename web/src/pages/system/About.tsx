import { useEffect, useState } from 'react';
import { CheckCircle2, ChevronDown, ChevronRight, Code2, ExternalLink, GitBranch, ShieldCheck, Sparkles } from 'lucide-react';
import { api } from '@/lib/api';
import { usePageTitle } from '@/lib/hooks';
import { useSidebarThemeMode } from '@/lib/useSidebarTheme';
import { useBranding } from '@/context/BrandingContext';
import { Button, Modal, PageHeader } from '@/components/ui';
import { cn } from '@/lib/utils';
import { APP_VERSION, IS_BETA } from '@/lib/version';


const RELEASE_NOTES = [
  '统一 CMDB 资产模型：23 项基础字段支持按 CI 类型配置显示与隐藏，支持扩展字段、资产克隆、资产关系与业务承载。',
  '数据中心与机柜：标准地图、高德地图、数据中心链路状态、机柜 U 位视图、设备上架与容量管理。',
  'IT 服务流程：事件、问题、变更、审批、SLA、自定义流程、工单汇总筛选、删除审批与审计。',
  '监控自动化：Zabbix 7 接入、告警自动建单、告警恢复自动关单、通知中心与链路状态自动恢复。',
  '网络 IP 资产：CMDB IP 汇总、手工 IP、批量导入、网段标签/VLAN、IP 抢占与历史记录。',
  '平台安全与运维：RBAC、登录安全、密码策略、无操作自动注销、审计日志、隐私协议、备份与恢复。',
];

// 生产发版说明只保留主要功能里程碑，不记录修复、调参或界面细节。
const PROD_MILESTONES = [
  {
    version: '1.0.0.20261126',
    date: '2026-11-26',
    title: '首个公开版本',
    summary: 'NextITOps 首个公开版本，提供开箱即用的轻量 ITSM 与 CMDB 平台。',
    items: [
      '统一 CMDB 资产模型、扩展字段、资产关系、资产拓扑、数据中心与机柜 U 位管理',
      '事件、问题、变更、审批、SLA 与自定义流程设计，支持工单全生命周期管理',
      '网络 IP 资产汇总、网段管理、手工登记、批量导入与 IP 历史记录',
      'Zabbix 7 告警接入、主机与资产清单同步、软件/MAC/操作系统归集、告警自动建单与恢复关单',
      '自定义报表支持关联资产查询、规则式自然语言查询、动态字段、分页与 CSV 导出',
      'RBAC、登录安全、密码策略、隐私协议、审计日志、通知中心与维护公告',
      'Ant Design 风格界面、浅色导航、多套彩色主题、明暗主题卡片与 2K/4K 自适应布局',
      '支持 SQLite 开发环境，以及 MySQL 8.4、PostgreSQL 16/17 生产部署',
    ],
  },
];

const DEV_MILESTONES = [];

const OPEN_SOURCE = [
  { name: 'Node.js', version: '24.x', note: 'JavaScript 运行时', url: 'https://nodejs.org/en/download/releases' },
  { name: 'Fastify', version: '5.6.x', note: '后端 Web 框架', url: 'https://github.com/fastify/fastify/releases' },
  { name: '@fastify/cors', version: '11.1.x', note: '跨域请求支持', url: 'https://github.com/fastify/fastify-cors/releases' },
  { name: '@fastify/multipart', version: '9.2.x', note: '文件上传', url: 'https://github.com/fastify/fastify-multipart/releases' },
  { name: '@fastify/static', version: '8.2.x', note: '静态资源服务', url: 'https://github.com/fastify/fastify-static/releases' },
  { name: 'Knex.js', version: '3.1.x', note: 'SQL 查询与迁移', url: 'https://github.com/knex/knex/releases' },
  { name: 'mysql2', version: '3.15.x', note: 'MySQL 驱动', url: 'https://github.com/sidorares/node-mysql2/releases' },
  { name: 'pg', version: '8.16.x', note: 'PostgreSQL 驱动', url: 'https://github.com/brianc/node-postgres/releases' },
  { name: 'better-sqlite3', version: '12.4.x', note: '本地/开发数据库', url: 'https://github.com/WiseLibs/better-sqlite3/releases' },
  { name: 'dotenv', version: '17.2.x', note: '环境变量加载', url: 'https://github.com/motdotla/dotenv/releases' },
  { name: 'React', version: '19.2.x', note: '前端 UI 框架', url: 'https://github.com/facebook/react/releases' },
  { name: 'React DOM', version: '19.2.x', note: 'React DOM 渲染', url: 'https://github.com/facebook/react/releases' },
  { name: 'React Router', version: '7.9.x', note: '前端路由', url: 'https://github.com/remix-run/react-router/releases' },
  { name: 'Vite', version: '7.1.x', note: '前端构建工具', url: 'https://github.com/vitejs/vite/releases' },
  { name: 'TypeScript', version: '5.9.x', note: '类型系统', url: 'https://github.com/microsoft/TypeScript/releases' },
  { name: 'Tailwind CSS', version: '4.1.x', note: '样式框架', url: 'https://github.com/tailwindlabs/tailwindcss/releases' },
  { name: '@tailwindcss/vite', version: '4.1.x', note: 'Tailwind Vite 插件', url: 'https://github.com/tailwindlabs/tailwindcss/releases' },
  { name: '@vitejs/plugin-react', version: '5.1.x', note: 'React Vite 插件', url: 'https://github.com/vitejs/vite-plugin-react/releases' },
  { name: 'concurrently', version: '9.2.x', note: '开发脚本并行运行', url: 'https://github.com/open-cli-tools/concurrently/releases' },
  { name: 'playwright-core', version: '1.56.x', note: '浏览器自动化验证', url: 'https://github.com/microsoft/playwright/releases' },
  { name: 'tailwind-merge', version: '3.4.x', note: 'Tailwind 类名合并', url: 'https://github.com/dcastil/tailwind-merge/releases' },
  { name: 'clsx', version: '2.1.x', note: '条件类名拼接', url: 'https://github.com/lukeed/clsx/releases' },
  { name: 'Lucide', version: '0.552.x', note: '图标库', url: 'https://github.com/lucide-icons/lucide/releases' },
  { name: 'Recharts', version: '2.15.x', note: '图表组件', url: 'https://github.com/recharts/recharts/releases' },
  { name: 'Sonner', version: '2.0.x', note: '消息提示', url: 'https://github.com/emilkowalski/sonner/releases' },
  { name: 'Zod', version: '3.25.x', note: '参数校验', url: 'https://github.com/colinhacks/zod/releases' },
  { name: 'ExcelJS', version: '4.4.x', note: 'Excel 导入导出', url: 'https://github.com/exceljs/exceljs/releases' },
  { name: 'Nodemailer', version: '10.3.x', note: 'SMTP 邮件通知', url: 'https://github.com/nodemailer/nodemailer/releases' },
  { name: 'Day.js', version: '1.11.x', note: '日期处理', url: 'https://github.com/iamkun/dayjs/releases' },
  { name: 'bcryptjs', version: '3.0.x', note: '密码哈希', url: 'https://github.com/dcodeIO/bcrypt.js/releases' },
  { name: 'jsonwebtoken', version: '9.0.x', note: 'JWT 会话', url: 'https://github.com/auth0/node-jsonwebtoken/releases' },
];

const EXTERNAL_APIS = [
  { name: '高德 JS API', version: '2.0', note: '在线地图与定位服务', url: 'https://lbs.amap.com/api/javascript-api-v2/summary' },
  { name: 'Zabbix API', version: '7.x', note: '监控告警、主机与触发器同步', url: 'https://www.zabbix.com/documentation/current/en/manual/api' },
  { name: '飞书开放平台', version: 'Webhook / API', note: '飞书机器人告警与工单通知', url: 'https://open.feishu.cn/document/client-docs/bot-v3/add-custom-bot' },
  { name: '企业微信 API', version: 'Webhook / API', note: '企业微信机器人与用户通知', url: 'https://developer.work.weixin.qq.com/document/path/91770' },
  { name: 'SMTP', version: 'RFC 5321', note: '邮件服务器通知协议', url: 'https://www.rfc-editor.org/rfc/rfc5321' },
  { name: 'Syslog', version: 'RFC 5424 / 3164', note: '审计日志远程转发协议', url: 'https://www.rfc-editor.org/rfc/rfc5424' },
  { name: 'MySQL', version: '8.4 LTS', note: '可选生产数据库', url: 'https://dev.mysql.com/doc/relnotes/mysql/8.4/en/' },
  { name: 'PostgreSQL', version: '16 / 17', note: '可选生产数据库', url: 'https://www.postgresql.org/docs/release/' },
];

export default function AboutPage() {
  usePageTitle('关于系统');
  const { branding } = useBranding();
  const dark = useSidebarThemeMode() === 'dark';
  const [health, setHealth] = useState<any>(null);
  const [softwareOpen, setSoftwareOpen] = useState(false);
  const [expandedVersion, setExpandedVersion] = useState('');
  const visibleReleases = PROD_MILESTONES;
  const activeExpanded = visibleReleases.some((release) => release.version === expandedVersion) ? expandedVersion : (visibleReleases[0]?.version || '');
  useEffect(() => { api.get<any>('/api/health').then(setHealth).catch(() => {}); }, []);

  return (
    <div className="animate-enter">
      <PageHeader eyebrow="About" title="关于系统" description={IS_BETA ? '开发预览版本、系统能力概览与开源软件说明。' : '正式生产版本、系统能力概览与开源软件说明。'} />
      <div className="grid gap-3.5 xl:grid-cols-12">
        <div className="card self-start overflow-hidden xl:col-span-4">
          <div
            className={cn('relative overflow-hidden border-b p-5', dark ? 'border-white/10 text-white' : 'border-[#e5e6eb] bg-[#fafafa] text-[#1f2329]')}
            style={dark ? { background: 'var(--sidebar-bg)', borderColor: 'var(--sidebar-border)', color: 'var(--sidebar-text)' } : undefined}
          >
            <div className={cn('pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_18%_0%,var(--theme-primary-light),transparent_52%)]', dark ? 'opacity-20' : 'opacity-80')} />
            <div className="relative flex items-center gap-3">
              <span className={cn('flex h-14 w-14 items-center justify-center overflow-hidden rounded-lg border', dark ? 'border-white/10 bg-white/10' : 'border-[#e5e6eb] bg-white')}>
                {branding.system_logo ? <img src={branding.system_logo} alt="" className="h-full w-full object-contain" /> : <Sparkles className={cn('h-6 w-6', dark ? 'text-brand-500' : 'text-brand-600')} />}
              </span>
              <div><p className="text-[18px] font-semibold">{branding.system_name}</p><p className={cn('text-[9px] uppercase tracking-[0.2em]', dark ? 'text-slate-400' : 'text-[#86909c]')} style={dark ? { color: 'var(--sidebar-muted)' } : undefined}>ITSM & CMDB</p></div>
            </div>
            <p className="relative mt-5 font-mono text-[22px] font-semibold tracking-tight">v{APP_VERSION}</p>
            <p className={cn('relative mt-1 text-[10px]', IS_BETA ? (dark ? 'text-amber-400' : 'text-amber-600') : (dark ? 'text-slate-400' : 'text-[#86909c]'))} style={dark && !IS_BETA ? { color: 'var(--sidebar-muted)' } : undefined}>{IS_BETA ? 'Beta 开发预览版本' : '正式生产版本'}</p>
          </div>
          <div className="space-y-3 p-5 text-[10.5px] text-slate-500">
            <div className="flex items-center justify-between"><span>运行状态</span><span className="flex items-center gap-1 font-medium text-emerald-600"><CheckCircle2 className="h-3.5 w-3.5" />{health?.ok ? '正常' : '检查中'}</span></div>
            <div className="flex items-center justify-between"><span>数据库</span><span className="font-mono text-slate-600">{health?.database || '—'}</span></div>
            <div className="flex items-center justify-between"><span>安全基线</span><span className="flex items-center gap-1 text-emerald-600"><ShieldCheck className="h-3.5 w-3.5" />已启用</span></div>
            <Button variant="secondary" size="sm" icon={Code2} className="mt-2 w-full border-brand-200 text-brand-700 hover:border-brand-300 hover:bg-brand-50" onClick={() => setSoftwareOpen(true)}>开源软件说明</Button>
          </div>
        </div>
        <div className="card overflow-hidden xl:col-span-8">
          <div className="divide-y divide-slate-100">
            {visibleReleases.map((release, index) => {
              const expanded = activeExpanded === release.version;
              return (
                <div key={release.version}>
                  <button onClick={() => setExpandedVersion(expanded ? '' : release.version)} className="flex w-full items-center justify-between gap-3 px-5 py-3.5 text-left hover:bg-slate-50">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="flex items-center gap-1.5 text-[13px] font-semibold text-slate-800"><GitBranch className="h-3.5 w-3.5 text-brand-500" /> v{release.version}</h2>
                        {index === 0 ? <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-[8.5px] font-medium text-emerald-700">最新</span> : null}
                        <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[8.5px] text-slate-500">{release.title}</span>
                      </div>
                      <p className="mt-0.5 text-[9.5px] text-slate-400">{release.date}</p>
                    </div>
                    {expanded ? <ChevronDown className="h-4 w-4 shrink-0 text-slate-400" /> : <ChevronRight className="h-4 w-4 shrink-0 text-slate-400" />}
                  </button>
                  {expanded ? <div className="space-y-3 px-5 pb-5">
                    {release.summary ? <p className="rounded-lg bg-slate-50 px-3 py-2 text-[9.5px] leading-relaxed text-slate-500">{release.summary}</p> : null}
                    {release.items.map((item, itemIndex) => (
                      <div key={itemIndex} className="flex items-start gap-2.5 text-[11px] leading-relaxed text-slate-600">
                        <span className="mt-1 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-brand-50 text-[8px] font-semibold text-brand-600">{itemIndex + 1}</span>
                        <span>{item}</span>
                      </div>
                    ))}
                  </div> : null}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <Modal open={softwareOpen} onClose={() => setSoftwareOpen(false)} title="开源软件与外部 API 说明" description="包含系统使用的开源组件、基础框架、数据库驱动及外部 API；点击名称查看官方版本说明或文档。" icon={Code2} size="lg" resizable={false} footer={<Button variant="secondary" size="sm" onClick={() => setSoftwareOpen(false)}>关闭</Button>}>
        <div className="max-h-[520px] space-y-4 overflow-auto">
          <section>
            <h3 className="sticky top-0 z-10 bg-white py-1 text-[11px] font-semibold text-slate-700">开源组件与框架</h3>
            <div className="divide-y divide-slate-100">
              {OPEN_SOURCE.map((item) => (
                <a key={item.name} href={item.url} target="_blank" rel="noreferrer" className="flex items-center justify-between gap-3 px-1 py-2.5 hover:bg-slate-50">
                  <div><p className="text-[11.5px] font-medium text-slate-700">{item.name}</p><p className="text-[9px] text-slate-400">{item.note}</p></div>
                  <div className="flex items-center gap-2"><span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[9px] text-slate-600">{item.version}</span><ExternalLink className="h-3 w-3 text-slate-300" /></div>
                </a>
              ))}
            </div>
          </section>
          <section>
            <h3 className="sticky top-0 z-10 bg-white py-1 text-[11px] font-semibold text-slate-700">外部 API 与协议</h3>
            <p className="mb-1 text-[9px] leading-relaxed text-slate-400">外部服务不随发布包分发，其版本与可用性由对应服务提供方决定；仅在管理员配置后调用。</p>
            <div className="divide-y divide-slate-100">
              {EXTERNAL_APIS.map((item) => (
                <a key={item.name} href={item.url} target="_blank" rel="noreferrer" className="flex items-center justify-between gap-3 px-1 py-2.5 hover:bg-slate-50">
                  <div><p className="text-[11.5px] font-medium text-slate-700">{item.name}</p><p className="text-[9px] text-slate-400">{item.note}</p></div>
                  <div className="flex items-center gap-2"><span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[9px] text-slate-600">{item.version}</span><ExternalLink className="h-3 w-3 text-slate-300" /></div>
                </a>
              ))}
            </div>
          </section>
        </div>
      </Modal>
    </div>
  );
}
