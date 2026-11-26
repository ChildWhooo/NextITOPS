import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertCircle,
  Check,
  CheckCircle2,
  ChevronDown,
  ExternalLink,
  Inbox,
  Mail,
  MessageSquareText,
  MessagesSquare,
  RefreshCw,
  Send,
  Settings2,
  ShieldCheck,
  Sparkles,
  Users,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { api, buildQuery } from '@/lib/api';
import { usePageSize } from '@/lib/pageSize';
import { usePageTitle } from '@/lib/hooks';
import { useAuth } from '@/context/AuthContext';
import { cn, formatDate, relativeTime } from '@/lib/utils';
import type { NotificationChannel, NotificationLog } from '@/lib/types';
import {
  Badge,
  Button,
  Checkbox,
  EmptyState,
  Field,
  IconButton,
  Input,
  Modal,
  PageHeader,
  Pagination,
  PageSizeSelect,
  SectionHeading,
  Skeleton,
  Toggle,
} from '@/components/ui';

const CHANNEL_META: Record<string, { title: string; icon: any; color: string; bg: string; description: string }> = {
  email: {
    title: 'SMTP 邮件',
    icon: Mail,
    color: 'text-blue-600',
    bg: 'bg-blue-50',
    description: '通过企业 SMTP 服务器发送邮件，直达请求人与负责人邮箱。',
  },
  feishu: {
    title: '飞书机器人',
    icon: MessageSquareText,
    color: 'text-sky-600',
    bg: 'bg-sky-50',
    description: '群机器人 Webhook 推送，支持 @ 已绑定 open_id 的成员。',
  },
  wecom: {
    title: '企业微信机器人',
    icon: Send,
    color: 'text-emerald-600',
    bg: 'bg-emerald-50',
    description: '企业微信群机器人推送，支持 @ 已绑定 userid 的成员。',
  },
};

const STATUS_META: Record<string, { label: string; className: string }> = {
  success: { label: '发送成功', className: 'bg-emerald-50 text-emerald-700 ring-emerald-600/15' },
  failed: { label: '发送失败', className: 'bg-rose-50 text-rose-700 ring-rose-600/15' },
  skipped: { label: '已跳过', className: 'bg-amber-50 text-amber-700 ring-amber-600/15' },
};

export default function NotificationsPage() {
  usePageTitle('通知设置');
  const { user } = useAuth();
  const [channels, setChannels] = useState<NotificationChannel[]>([]);
  const [eventDefs, setEventDefs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<NotificationChannel | null>(null);
  const [form, setForm] = useState<Record<string, any>>({});
  const [saving, setSaving] = useState(false);
  const [testingId, setTestingId] = useState<number | null>(null);
  const [testingInModal, setTestingInModal] = useState(false);

  const [logs, setLogs] = useState<NotificationLog[]>([]);
  const [logTotal, setLogTotal] = useState(0);
  const [logPage, setLogPage] = useState(1);
  const [pageSize, setPageSize] = usePageSize('notification-logs');
  const [logStatus, setLogStatus] = useState('');
  const [logChannel, setLogChannel] = useState('');
  const [logsLoading, setLogsLoading] = useState(true);
  const [logDetail, setLogDetail] = useState<NotificationLog | null>(null);

  const loadChannels = async () => {
    setLoading(true);
    try {
      const response = await api.get<{ data: NotificationChannel[]; events: any[] }>('/api/notifications/channels');
      setChannels(response.data);
      setEventDefs(response.events);
    } catch (error: any) {
      toast.error(error.message);
    } finally {
      setLoading(false);
    }
  };

  const loadLogs = async () => {
    setLogsLoading(true);
    try {
      const response = await api.get<{ data: NotificationLog[]; pagination: { total: number } }>(
        `/api/notifications/logs${buildQuery({ page: logPage, pageSize, status: logStatus, channel_type: logChannel })}`,
      );
      setLogs(response.data);
      setLogTotal(response.pagination.total);
    } catch (error: any) {
      toast.error(error.message);
    } finally {
      setLogsLoading(false);
    }
  };

  useEffect(() => {
    loadChannels();
  }, []);

  useEffect(() => {
    loadLogs();
  }, [logPage, logStatus, logChannel, pageSize]);

  useEffect(() => {
    setLogPage(1);
  }, [logStatus, logChannel]);

  const eventLabel = (code: string) => eventDefs.find((event) => event.code === code)?.label || code;

  const groupedEvents = useMemo(
    () =>
      eventDefs.reduce<Record<string, any[]>>((groups, event) => {
        groups[event.group] = groups[event.group] || [];
        groups[event.group].push(event);
        return groups;
      }, {}),
    [eventDefs],
  );

  const openConfig = (channel: NotificationChannel) => {
    setEditing(channel);
    setForm({
      name: channel.name,
      enabled: channel.enabled,
      events: [...channel.events],
      config: { ...channel.config },
    });
  };

  const saveChannel = async () => {
    if (!editing) return;
    setSaving(true);
    try {
      const response = await api.put<{ data: NotificationChannel }>(`/api/notifications/channels/${editing.id}`, form);
      setChannels((current) => current.map((channel) => (channel.id === editing.id ? response.data : channel)));
      toast.success('通知渠道已保存');
      setEditing(null);
      await loadLogs();
    } catch (error: any) {
      toast.error(error.message);
    } finally {
      setSaving(false);
    }
  };

  const toggleChannel = async (channel: NotificationChannel) => {
    try {
      const response = await api.put<{ data: NotificationChannel }>(`/api/notifications/channels/${channel.id}`, {
        enabled: !channel.enabled,
      });
      setChannels((current) => current.map((item) => (item.id === channel.id ? response.data : item)));
      toast.success(response.data.enabled ? '通知渠道已启用' : '通知渠道已停用');
    } catch (error: any) {
      toast.error(error.message);
    }
  };

  const testChannel = async (channel: NotificationChannel, inModal = false) => {
    if (inModal) setTestingInModal(true);
    else setTestingId(channel.id);
    try {
      const response = await api.post<{ status: string; error?: string; channel: NotificationChannel }>(
        `/api/notifications/channels/${channel.id}/test`,
        { recipient: user?.email || '' },
      );
      if (response.status === 'success') toast.success(`${channel.name} 测试通知已发送`);
      else toast.error(response.error || '测试通知未能发送，请检查配置');
      setChannels((current) => current.map((item) => (item.id === channel.id ? response.channel : item)));
      if (editing?.id === channel.id) setEditing(response.channel);
      await loadLogs();
    } catch (error: any) {
      toast.error(error.message);
    } finally {
      setTestingId(null);
      setTestingInModal(false);
    }
  };

  const toggleEvent = (code: string) => {
    setForm((current) => ({
      ...current,
      events: current.events.includes(code) ? current.events.filter((item: string) => item !== code) : [...current.events, code],
    }));
  };

  const toggleEventGroup = (events: any[]) => {
    const codes = events.map((event) => event.code);
    const allSelected = codes.every((code) => form.events.includes(code));
    setForm((current) => ({
      ...current,
      events: allSelected ? current.events.filter((code: string) => !codes.includes(code)) : [...new Set([...current.events, ...codes])],
    }));
  };

  const updateConfig = (key: string, value: any) => {
    setForm((current) => ({ ...current, config: { ...current.config, [key]: value } }));
  };

  const channelConfigured = (channel: NotificationChannel) =>
    channel.type === 'email' ? Boolean(channel.config.host) : Boolean(channel.config.webhook);

  return (
    <div className="animate-enter">
      <PageHeader
        eyebrow="Notification hub"
        title="通知设置"
        description="管理员可选择飞书、企业微信或 SMTP 邮件通道，将工单与告警动态推送给请求人、负责人和运维团队。"
        actions={<Button variant="secondary" size="sm" icon={RefreshCw} onClick={() => { loadChannels(); loadLogs(); }} loading={loading}>刷新</Button>}
      />

      <div className="mb-3.5 flex flex-col gap-2 rounded-xl border border-brand-200 bg-white px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-start gap-2.5">
          <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-brand-600 text-white"><Sparkles className="h-3.5 w-3.5" /></span>
          <div>
            <p className="text-[11.5px] font-semibold text-brand-700">通知对象自动匹配工单请求人、负责人</p>
            <p className="mt-0.5 text-[10px] leading-relaxed text-brand-700/70">
              邮件发送至用户邮箱；飞书 / 企业微信通过群机器人推送，并在用户管理绑定 open_id / userid 后自动 @ 到人。
            </p>
          </div>
        </div>
        <Link to="/system/users" className="flex shrink-0 items-center gap-1 text-[10.5px] font-medium text-brand-700 hover:text-brand-800">
          <Users className="h-3.5 w-3.5" /> 配置用户通知账号 <ExternalLink className="h-3 w-3" />
        </Link>
      </div>

      <div className="grid grid-cols-1 gap-3.5 lg:grid-cols-3">
        {loading
          ? [1, 2, 3].map((item) => <Skeleton key={item} className="h-[260px]" />)
          : channels.map((channel) => {
              const meta = CHANNEL_META[channel.type] || CHANNEL_META.email;
              const Icon = meta.icon;
              const configured = channelConfigured(channel);
              return (
                <div key={channel.id} className={cn('card overflow-hidden transition', channel.enabled && 'ring-1 ring-brand-200')}>
                  <div className="p-4">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2.5">
                        <span className={cn('flex h-10 w-10 items-center justify-center rounded-xl', meta.bg, meta.color)}><Icon className="h-5 w-5" /></span>
                        <div>
                          <div className="flex items-center gap-1.5">
                            <h3 className="text-[13px] font-semibold text-slate-800">{channel.name}</h3>
                            <Badge className={channel.enabled ? 'bg-emerald-50 text-emerald-700 ring-emerald-600/15' : 'bg-slate-100 text-slate-500 ring-slate-500/10'} dot={channel.enabled ? 'bg-emerald-500' : 'bg-slate-400'}>
                              {channel.enabled ? '已启用' : '未启用'}
                            </Badge>
                          </div>
                          <p className="mt-0.5 text-[9px] text-slate-400">{meta.title}</p>
                        </div>
                      </div>
                      <Toggle checked={channel.enabled} onChange={() => toggleChannel(channel)} label={`启用${channel.name}`} />
                    </div>
                    <p className="mt-3 min-h-[34px] text-[10.5px] leading-relaxed text-slate-500">{meta.description}</p>
                    <div className="mt-3 rounded-lg bg-slate-50 px-2.5 py-2">
                      <div className="flex items-center justify-between text-[9.5px] text-slate-400">
                        <span>配置状态</span>
                        <span className={configured ? 'font-medium text-emerald-600' : 'font-medium text-amber-600'}>{configured ? '配置完整' : '待配置'}</span>
                      </div>
                      <p className="mt-1 truncate font-mono text-[9px] text-slate-500">
                        {channel.type === 'email'
                          ? channel.config.host || 'SMTP 服务器未配置'
                          : channel.config.webhook
                            ? (() => { try { return new URL(channel.config.webhook).host; } catch { return 'Webhook 已配置'; } })()
                            : 'Webhook 地址未配置'}
                      </p>
                    </div>
                    <div className="mt-3 flex items-center justify-between text-[9.5px] text-slate-400">
                      <span>{channel.events.length} / {eventDefs.length} 类事件</span>
                      <span>{channel.last_test_at ? `测试：${relativeTime(channel.last_test_at)}` : '尚未测试'}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 border-t border-[#eef1f6] bg-[#fbfcfe] px-4 py-2.5">
                    <Button variant="secondary" size="xs" icon={Settings2} onClick={() => openConfig(channel)}>配置</Button>
                    <Button variant="ghost" size="xs" icon={Send} loading={testingId === channel.id} onClick={() => testChannel(channel)} disabled={!configured}>发送测试</Button>
                    {channel.last_test_status === 'failed' ? <span className="ml-auto flex items-center gap-1 text-[9px] text-rose-500"><AlertCircle className="h-3 w-3" />上次失败</span> : null}
                  </div>
                </div>
              );
            })}
      </div>

      <div className="card mt-3.5 overflow-hidden">
        <div className="flex flex-col gap-3 border-b border-[#eef1f6] p-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-[13px] font-semibold text-slate-800">发送日志</h2>
            <p className="mt-0.5 text-[10px] text-slate-400">记录每一次通知的渠道、目标、结果与错误信息。</p>
          </div>
          <div className="flex items-center gap-2">
            <select className="input-base h-9 w-auto text-[11px]" value={logChannel} onChange={(event) => setLogChannel(event.target.value)}>
              <option value="">全部渠道</option>
              <option value="email">SMTP 邮件</option>
              <option value="feishu">飞书</option>
              <option value="wecom">企业微信</option>
            </select>
            <select className="input-base h-9 w-auto text-[11px]" value={logStatus} onChange={(event) => setLogStatus(event.target.value)}>
              <option value="">全部结果</option>
              <option value="success">成功</option>
              <option value="failed">失败</option>
              <option value="skipped">跳过</option>
            </select>
            <Button variant="ghost" size="xs" icon={RefreshCw} onClick={loadLogs} loading={logsLoading}>刷新</Button>
          </div>
        </div>
        {logsLoading ? (
          <div className="space-y-2 p-4">{[1, 2, 3].map((item) => <Skeleton key={item} className="h-12" />)}</div>
        ) : logs.length ? (
          <>
            <div className="table-wrap">
              <table className="data-table">
                <thead><tr><th>时间</th><th>渠道</th><th>事件</th><th>通知内容</th><th>目标</th><th>结果</th></tr></thead>
                <tbody>
                  {logs.map((log) => {
                    const status = STATUS_META[log.status] || STATUS_META.failed;
                    return (
                      <tr key={log.id} className="group cursor-pointer" onClick={() => setLogDetail(log)}>
                        <td className="whitespace-nowrap"><p className="text-[10.5px] text-slate-600">{formatDate(log.created_at, 'MM-DD HH:mm:ss')}</p><p className="mt-0.5 text-[9px] text-slate-400">{relativeTime(log.created_at)}</p></td>
                        <td>
                          <Badge className={log.channel_type === 'email' ? 'bg-blue-50 text-blue-700 ring-blue-600/15' : log.channel_type === 'feishu' ? 'bg-sky-50 text-sky-700 ring-sky-600/15' : 'bg-emerald-50 text-emerald-700 ring-emerald-600/15'}>
                            {log.channel_name || CHANNEL_META[log.channel_type]?.title || log.channel_type}
                          </Badge>
                        </td>
                        <td className="text-[10.5px] text-slate-500">{eventLabel(log.event_type)}</td>
                        <td><p className="max-w-[330px] truncate text-[11px] text-slate-600">{log.title}</p>{log.error ? <p className="mt-0.5 max-w-[330px] truncate text-[9px] text-rose-500">{log.error}</p> : null}</td>
                        <td><p className="max-w-[180px] truncate font-mono text-[9px] text-slate-400">{log.target || '—'}</p></td>
                        <td><Badge className={status.className}>{status.label}</Badge></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="flex flex-col items-center justify-between gap-2 border-t border-[#eef1f6] px-4 py-2 sm:flex-row"><PageSizeSelect value={pageSize} onChange={setPageSize} /><Pagination page={logPage} pageSize={pageSize} total={logTotal} onChange={setLogPage} /></div>
          </>
        ) : (
          <EmptyState title="尚无通知日志" description="启用通知渠道并触发工单事件后，发送记录会显示在这里。" icon={Inbox} className="py-12" />
        )}
      </div>

      <Modal
        open={Boolean(editing)}
        onClose={() => setEditing(null)}
        title={editing ? `配置 ${editing.name}` : '配置通知渠道'}
        description={editing ? CHANNEL_META[editing.type]?.description : ''}
        icon={MessagesSquare}
        size="md"
        resizable={false}
        footer={
          <>
            <Button variant="ghost" size="sm" icon={Send} loading={testingInModal} onClick={() => editing && testChannel(editing, true)} className="mr-auto">发送测试</Button>
            <Button variant="secondary" size="sm" onClick={() => setEditing(null)}>取消</Button>
            <Button size="sm" loading={saving} onClick={saveChannel}>保存配置</Button>
          </>
        }
      >
        {editing ? (
          <div className="space-y-4">
            <div className="flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50/60 px-3.5 py-2.5">
              <div>
                <p className="text-[11.5px] font-medium text-slate-700">启用此通知渠道</p>
                <p className="mt-0.5 text-[9.5px] text-slate-400">启用后，匹配事件将在工单创建、流转与告警恢复时自动发送。</p>
              </div>
              <Toggle checked={Boolean(form.enabled)} onChange={(checked) => setForm((current) => ({ ...current, enabled: checked }))} />
            </div>

            <Field label="渠道名称"><Input value={form.name || ''} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} /></Field>

            {editing.type === 'email' ? (
              <div className="space-y-3">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <Field label="SMTP 服务器" required><Input value={form.config.host || ''} onChange={(event) => updateConfig('host', event.target.value)} placeholder="smtp.example.com" className="font-mono text-[11px]" /></Field>
                  <Field label="端口"><Input type="number" value={form.config.port || 465} onChange={(event) => updateConfig('port', Number(event.target.value))} /></Field>
                  <Field label="发件人"><Input value={form.config.from || ''} onChange={(event) => updateConfig('from', event.target.value)} placeholder="NextITOps <noreply@example.com>" /></Field>
                  <Field label="SMTP 用户名"><Input value={form.config.user || ''} onChange={(event) => updateConfig('user', event.target.value)} placeholder="noreply@example.com" /></Field>
                  <Field label="SMTP 密码 / 授权码" hint={editing.config.hasPassword ? '已配置，留空保持原密码' : '部分邮箱需使用独立授权码'}>
                    <Input type="password" value={form.config.password || ''} onChange={(event) => updateConfig('password', event.target.value)} placeholder={editing.config.hasPassword ? '••••••••（留空不修改）' : '输入授权码'} autoComplete="new-password" />
                  </Field>
                  <Field label="附加收件人" hint="可选，逗号分隔，例如运维邮件组">
                    <Input value={form.config.extraRecipients || ''} onChange={(event) => updateConfig('extraRecipients', event.target.value)} placeholder="ops@example.com" />
                  </Field>
                </div>
                <label className="flex items-center justify-between rounded-xl border border-slate-200 px-3 py-2.5">
                  <div><p className="text-[11px] font-medium text-slate-700">SSL / TLS 加密</p><p className="text-[9px] text-slate-400">465 端口通常启用；587 STARTTLS 可关闭此项</p></div>
                  <Toggle checked={Boolean(form.config.secure)} onChange={(checked) => updateConfig('secure', checked)} />
                </label>
              </div>
            ) : (
              <div className="space-y-3">
                <Field
                  label="群机器人 Webhook"
                  required
                  hint={editing.type === 'feishu' ? '飞书群 → 设置 → 群机器人 → 添加自定义机器人' : '企业微信群 → 群机器人 → 添加机器人，复制 Webhook 地址'}
                >
                  <Input value={form.config.webhook || ''} onChange={(event) => updateConfig('webhook', event.target.value)} placeholder={editing.type === 'feishu' ? 'https://open.feishu.cn/open-apis/bot/v2/hook/...' : 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=...'} className="font-mono text-[10.5px]" />
                </Field>
                <label className="flex items-center justify-between rounded-xl border border-slate-200 px-3 py-2.5">
                  <div><p className="text-[11px] font-medium text-slate-700">自动 @ 相关用户</p><p className="text-[9px] text-slate-400">需在用户管理中填写 {editing.type === 'feishu' ? '飞书 open_id' : '企业微信 userid'}</p></div>
                  <Toggle checked={Boolean(form.config.mentionUsers)} onChange={(checked) => updateConfig('mentionUsers', checked)} />
                </label>
              </div>
            )}

            <div>
              <div className="mb-2 flex items-center justify-between">
                <div>
                  <p className="text-[11.5px] font-semibold text-slate-700">通知事件</p>
                  <p className="mt-0.5 text-[9.5px] text-slate-400">选择此渠道需要发送的事件，已选 {form.events?.length || 0} 项。</p>
                </div>
                <div className="flex items-center gap-2">
                  <button onClick={() => setForm((current) => ({ ...current, events: eventDefs.map((event) => event.code) }))} className="text-[9.5px] font-medium text-brand-600">全选</button>
                  <span className="text-slate-200">/</span>
                  <button onClick={() => setForm((current) => ({ ...current, events: [] }))} className="text-[9.5px] text-slate-400 hover:text-slate-600">清空</button>
                </div>
              </div>
              <div className="space-y-2.5">
                {Object.entries(groupedEvents).map(([group, groupEvents]) => {
                  const allSelected = groupEvents.every((event) => form.events?.includes(event.code));
                  return (
                    <div key={group} className="rounded-xl border border-slate-200">
                      <div className="flex items-center justify-between border-b border-slate-100 px-3 py-2">
                        <span className="text-[10.5px] font-medium text-slate-600">{group}通知</span>
                        <button onClick={() => toggleEventGroup(groupEvents)} className={cn('flex items-center gap-1 text-[9.5px]', allSelected ? 'text-brand-600' : 'text-slate-400')}>
                          <span className={cn('flex h-3.5 w-3.5 items-center justify-center rounded border', allSelected ? 'border-brand-500 bg-brand-500 text-white' : 'border-slate-300')}>{allSelected ? <Check className="h-2.5 w-2.5" /> : null}</span>
                          全选
                        </button>
                      </div>
                      <div className="grid grid-cols-1 gap-1 p-2 sm:grid-cols-2">
                        {groupEvents.map((event) => (
                          <button key={event.code} type="button" onClick={() => toggleEvent(event.code)} className={cn('flex items-start gap-2 rounded-lg px-2 py-1.5 text-left transition', form.events?.includes(event.code) ? 'bg-brand-50/70' : 'hover:bg-slate-50')}>
                            <span className={cn('mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border', form.events?.includes(event.code) ? 'border-brand-500 bg-brand-500 text-white' : 'border-slate-300 bg-white')}>{form.events?.includes(event.code) ? <Check className="h-3 w-3" /> : null}</span>
                            <span className="min-w-0">
                              <span className="block text-[10.5px] font-medium text-slate-600">{event.label}</span>
                              <span className="block text-[9px] text-slate-400">{event.description}</span>
                            </span>
                          </button>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        ) : null}
      </Modal>

      <Modal
        open={Boolean(logDetail)}
        onClose={() => setLogDetail(null)}
        title="通知发送详情"
        description={logDetail ? `${logDetail.channel_name} · ${formatDate(logDetail.created_at, 'YYYY/MM/DD HH:mm:ss')}` : ''}
        icon={MessagesSquare}
        size="md"
        footer={<Button variant="secondary" size="sm" onClick={() => setLogDetail(null)}>关闭</Button>}
      >
        {logDetail ? (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Badge className={STATUS_META[logDetail.status]?.className}>{STATUS_META[logDetail.status]?.label}</Badge>
              <span className="text-[10px] text-slate-400">{eventLabel(logDetail.event_type)}</span>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <FieldView label="标题" value={logDetail.title} />
              <FieldView label="目标" value={logDetail.target || '—'} />
            </div>
            {logDetail.error ? (
              <div className="rounded-lg border border-rose-100 bg-rose-50 p-3 text-[10.5px] leading-relaxed text-rose-700">{logDetail.error}</div>
            ) : null}
            <div>
              <p className="mb-1.5 text-[10px] font-medium text-slate-400">发送内容</p>
              <pre className="custom-scroll max-h-64 overflow-auto whitespace-pre-wrap rounded-xl bg-slate-900 p-3.5 font-mono text-[9.5px] leading-relaxed text-slate-300">{logDetail.content || '—'}</pre>
            </div>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}

function FieldView({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[9px] font-medium uppercase tracking-wider text-slate-400">{label}</p>
      <p className="mt-1 break-words text-[11px] text-slate-600">{value}</p>
    </div>
  );
}
