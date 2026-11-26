import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  AlertCircle,
  ArrowRight,
  BellRing,
  Boxes,
  CheckCircle2,
  ChevronDown,
  Clipboard,
  Clock3,
  Cpu,
  ExternalLink,
  Eye,
  EyeOff,
  FileJson,
  KeyRound,
  Link2,
  ListChecks,
  Network,
  Pencil,
  Play,
  Plus,
  Radar,
  RefreshCw,
  RotateCw,
  Search,
  Server,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  Wifi,
  WifiOff,
  X,
  Zap,
} from 'lucide-react';
import { toast } from 'sonner';
import { api, buildQuery } from '@/lib/api';
import { usePageTitle, useDebounce } from '@/lib/hooks';
import { usePageSize } from '@/lib/pageSize';
import { useAuth } from '@/context/AuthContext';
import {
  SEVERITY_META,
  cn,
  formatDate,
  relativeTime,
} from '@/lib/utils';
import type { CIType, User, Workflow, ZabbixEvent, ZabbixIntegration } from '@/lib/types';
import {
  Badge,
  Button,
  ConfirmDialog,
  CopyButton,
  EmptyState,
  Field,
  IconButton,
  Input,
  Modal,
  PageHeader,
  Pagination,
  PageSizeSelect,
  SectionHeading,
  SearchInput,
  Skeleton,
  Spinner,
  Toggle,
} from '@/components/ui';

const FIELD_LABELS: Record<string, string> = {
  severity: '严重级别',
  host: '主机名',
  host_ip: '主机 IP',
  event_name: '告警名称',
  tag: '标签',
};

const OPERATOR_LABELS: Record<string, string> = {
  equals: '等于',
  not_equals: '不等于',
  contains: '包含',
  not_contains: '不包含',
  in: '属于（逗号分隔）',
  not_in: '不属于（逗号分隔）',
  gte: '大于等于',
  lte: '小于等于',
  exists: '存在',
  not_exists: '不存在',
};

const PROCESSING_META: Record<string, { label: string; className: string }> = {
  received: { label: '处理中', className: 'bg-sky-50 text-sky-700 ring-sky-600/15' },
  ticket_created: { label: '已创建事件', className: 'bg-emerald-50 text-emerald-700 ring-emerald-600/15' },
  deduplicated: { label: '已去重关联', className: 'bg-blue-50 text-blue-700 ring-blue-600/15' },
  ignored: { label: '已忽略', className: 'bg-slate-100 text-slate-600 ring-slate-500/10' },
  recovery_notice: { label: '恢复通知', className: 'bg-teal-50 text-teal-700 ring-teal-600/15' },
  recovery_unmatched: { label: '恢复未匹配', className: 'bg-amber-50 text-amber-700 ring-amber-600/15' },
};

const BLANK_CONDITION = { field: 'severity', operator: 'gte', value: 'average' };
const SEVERITY_DETAILS: Record<string, { en: string; desc: string; rank: number }> = {
  not_classified: { en: 'Not classified', desc: '未分类，通常不用于告警过滤', rank: 0 },
  information: { en: 'Information', desc: '信息提示，不影响业务', rank: 1 },
  warning: { en: 'Warning', desc: '警告，需要关注', rank: 2 },
  average: { en: 'Average', desc: '一般严重，建议尽快处理', rank: 3 },
  high: { en: 'High', desc: '高严重，影响业务运行', rank: 4 },
  disaster: { en: 'Disaster', desc: '灾难，业务中断或重大故障', rank: 5 },
};
const DEFAULT_OS_RULES = [
  { pattern: 'el6', name: 'Redhat6' },
  { pattern: 'el7', name: 'CentOS7' },
  { pattern: 'el8', name: 'CentOS8' },
  { pattern: 'el9', name: 'RockyLinux8' },
];

interface ZabbixTypeMapping {
  id: number;
  zabbix_value: string;
  ci_type_id: number;
  description: string;
  enabled: boolean;
  ci_type_code: string;
  ci_type_name: string;
  ci_type_color?: string;
  ci_type_icon?: string;
}

interface ZabbixBuiltinTypeMapping {
  ci_type_code: string;
  ci_type_name: string;
  ci_type_color?: string;
  ci_type_icon?: string;
  ci_type_enabled?: boolean;
  values: string[];
}

interface ZabbixTypeMappingForm {
  id?: number;
  zabbix_value: string;
  ci_type_id: string;
  description: string;
  enabled: boolean;
}

interface ZabbixInventoryItemDiagnostic {
  itemid: string;
  name: string;
  key: string;
  value_type: number;
  lastvalue_length: number;
  lastvalue_bytes: number;
  text_limit_bytes: number;
  looks_truncated: boolean;
  records: number;
  normalized: number;
  empty_names: number;
  sample: string[];
}

interface ZabbixInventoryHostDiagnostic {
  ci_id: number;
  asset_no: string;
  name: string;
  type_code: string;
  ip_address: string;
  zabbix_host_id: string;
  software_items: ZabbixInventoryItemDiagnostic[];
  mac_items: ZabbixInventoryItemDiagnostic[];
  software_item_count: number;
  software_records: number;
  software_normalized: number;
  software_empty_names: number;
  software_truncated_items: number;
  software_linked: number;
  software_missing: number;
  software_sync_skipped?: boolean;
  software_sync_error?: string;
  software_asset_errors?: Array<{ name?: string; asset_no?: string; message?: string }>;
  mac_item_count: number;
  mac_records: number;
  mac_normalized: number;
  mac_truncated_items: number;
}

interface ZabbixInventoryDiagnostics {
  hosts: number;
  hosts_matched: number;
  hosts_page: number;
  page: number;
  page_size: number;
  pages: number;
  issue?: string;
  software_items: number;
  software_records: number;
  software_normalized: number;
  software_linked: number;
  software_missing: number;
  mac_items: number;
  mac_records: number;
  mac_normalized: number;
  search_errors: Array<{ search: string; message: string }>;
  hosts_detail: ZabbixInventoryHostDiagnostic[];
}

export default function ZabbixPage() {
  usePageTitle('Zabbix 集成');
  const { user } = useAuth();
  const navigate = useNavigate();
  const [integrations, setIntegrations] = useState<ZabbixIntegration[]>([]);
  const [webhookBase, setWebhookBase] = useState('');
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [severities, setSeverities] = useState<any[]>([]);

  const [events, setEvents] = useState<ZabbixEvent[]>([]);
  const [eventTotal, setEventTotal] = useState(0);
  const [eventPage, setEventPage] = useState(1);
  const [pageSize, setPageSize] = usePageSize('zabbix-events');
  const [eventLoading, setEventLoading] = useState(true);
  const [eventSeverity, setEventSeverity] = useState('');
  const [eventStatus, setEventStatus] = useState('');
  const [eventSearch, setEventSearch] = useState('');
  const debouncedEventSearch = useDebounce(eventSearch, 300);

  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<ZabbixIntegration | null>(null);
  const [form, setForm] = useState<Record<string, any>>({});
  const [saving, setSaving] = useState(false);

  const [testing, setTesting] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [hostSyncing, setHostSyncing] = useState(false);
  const [specSyncing, setSpecSyncing] = useState(false);
  const [inventorySyncing, setInventorySyncing] = useState(false);
  const [inventorySummary, setInventorySummary] = useState<{ hosts: number; software: number; macs: number; last_sync_at?: string | null } | null>(null);
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false);
  const [diagnosticsLoading, setDiagnosticsLoading] = useState(false);
  const [diagnostics, setDiagnostics] = useState<ZabbixInventoryDiagnostics | null>(null);
  const [diagnosticsPage, setDiagnosticsPage] = useState(1);
  const [diagnosticsPageSize, setDiagnosticsPageSize] = usePageSize('zabbix-inventory-diagnostics');
  const [diagnosticsQuery, setDiagnosticsQuery] = useState('');
  const [diagnosticsType, setDiagnosticsType] = useState('');
  const [diagnosticsIssue, setDiagnosticsIssue] = useState('');
  const [candidatesOpen, setCandidatesOpen] = useState(false);
  const [candidates, setCandidates] = useState<any[]>([]);
  const [candidateTypes, setCandidateTypes] = useState<Record<number, string>>({});
  const [candidateSaving, setCandidateSaving] = useState(false);
  const [candidateSearch, setCandidateSearch] = useState('');
  const [candidateStatus, setCandidateStatus] = useState<'pending' | 'ignored'>('pending');
  const candidateQuery = useDebounce(candidateSearch, 300);
  const [candidatePage, setCandidatePage] = useState(1);
  const [candidatePageSize, setCandidatePageSize] = usePageSize('zabbix-candidates');
  const [candidateTotal, setCandidateTotal] = useState(0);
  const [mappingOpen, setMappingOpen] = useState(false);
  const [osRules, setOsRules] = useState<Array<{ pattern: string; name: string }>>(DEFAULT_OS_RULES);
  const [mappingSaving, setMappingSaving] = useState(false);
  const [hostMappingOpen, setHostMappingOpen] = useState(false);
  const [hostTypeMappings, setHostTypeMappings] = useState<ZabbixTypeMapping[]>([]);
  const [builtinTypeMappings, setBuiltinTypeMappings] = useState<ZabbixBuiltinTypeMapping[]>([]);
  const [ciTypes, setCiTypes] = useState<CIType[]>([]);
  const [hostMappingLoading, setHostMappingLoading] = useState(false);
  const [hostMappingForm, setHostMappingForm] = useState<ZabbixTypeMappingForm | null>(null);
  const [hostMappingSaving, setHostMappingSaving] = useState(false);
  const [hostMappingDelete, setHostMappingDelete] = useState<ZabbixTypeMapping | null>(null);
  const [hostMappingDeleting, setHostMappingDeleting] = useState(false);
  const [syncConfigOpen, setSyncConfigOpen] = useState(false);
  const [syncConfig, setSyncConfig] = useState({ alert_minutes: 0, host_minutes: 5, specs_minutes: 5, inventory_minutes: 60 });
  const [syncConfigSaving, setSyncConfigSaving] = useState(false);
  const [candidateLoading, setCandidateLoading] = useState(false);
  const [simulating, setSimulating] = useState(false);
  const [eventDetail, setEventDetail] = useState<ZabbixEvent | null>(null);
  const [eventDetailLoading, setEventDetailLoading] = useState(false);
  const [confirmAction, setConfirmAction] = useState<null | 'delete' | 'secret'>(null);
  const [confirmLoading, setConfirmLoading] = useState(false);
  const [showSecret, setShowSecret] = useState(false);

  const selected = integrations.find((item) => item.id === selectedId) || null;
  const selectedWorkflow = workflows.find((item) => item.id === selected?.workflow_id);
  const selectedAssignee = users.find((item) => item.id === selected?.default_assignee_id);

  const loadIntegrations = async () => {
    setLoading(true);
    try {
      const response = await api.get<{ data: ZabbixIntegration[]; severities: any[]; webhook_base: string }>('/api/integrations/zabbix');
      setIntegrations(response.data);
      setSeverities(response.severities || []);
      setWebhookBase(response.webhook_base || '');
      if (!selectedId || !response.data.find((item) => item.id === selectedId)) setSelectedId(response.data[0]?.id || null);
    } catch (error: any) {
      toast.error(error.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadIntegrations();
    api.get<{ data: Workflow[] }>('/api/workflows?type=incident').then((response) => setWorkflows(response.data)).catch(() => {});
    api.get<{ data: User[] }>('/api/users').then((response) => setUsers(response.data.filter((item) => item.status === 'active'))).catch(() => {});
    api.get<{ data: ZabbixTypeMapping[]; builtin?: ZabbixBuiltinTypeMapping[] }>('/api/zabbix/type-mappings').then((response) => {
      setHostTypeMappings(response.data || []);
      setBuiltinTypeMappings(response.builtin || []);
    }).catch(() => {});
  }, []);

  const loadEvents = async () => {
    setEventLoading(true);
    try {
      const response = await api.get<{ data: ZabbixEvent[]; pagination: { total: number } }>(
        `/api/integrations/zabbix/events${buildQuery({
          integration_id: selectedId,
          severity: eventSeverity,
          processing_status: eventStatus,
          q: debouncedEventSearch,
          page: eventPage,
          pageSize,
        })}`,
      );
      setEvents(response.data);
      setEventTotal(response.pagination.total);
    } catch (error: any) {
      toast.error(error.message);
    } finally {
      setEventLoading(false);
    }
  };

  const loadInventorySummary = async (id: number | null = selectedId) => {
    if (!id) { setInventorySummary(null); return; }
    try {
      const response = await api.get<{ data: { hosts: number; software: number; macs: number; last_sync_at?: string | null } }>(`/api/integrations/zabbix/${id}/inventory-summary`);
      setInventorySummary(response.data);
    } catch {
      setInventorySummary(null);
    }
  };

  useEffect(() => {
    loadInventorySummary(selectedId);
  }, [selectedId]);

  useEffect(() => {
    if (selectedId) loadEvents();
  }, [selectedId, eventSeverity, eventStatus, debouncedEventSearch, eventPage, pageSize]);

  useEffect(() => {
    setEventPage(1);
  }, [selectedId, eventSeverity, eventStatus, debouncedEventSearch]);

  const openCreate = () => {
    setEditing(null);
    setForm({
      name: '',
      base_url: '',
      api_token: '',
      enabled: true,
      workflow_id: workflows.find((item) => item.is_default)?.id || workflows[0]?.id || '',
      default_assignee_id: users.find((item) => item.username === 'zhangwei')?.id || '',
      severity_threshold: 'warning',
      create_only_on_problem: true,
      reopen_resolved: true,
      conditions: [{ ...BLANK_CONDITION }],
    });
    setEditorOpen(true);
  };

  const openEdit = (integration: ZabbixIntegration) => {
    setEditing(integration);
    setForm({
      name: integration.name,
      base_url: integration.base_url,
      api_token: '',
      enabled: integration.enabled,
      workflow_id: integration.workflow_id || '',
      default_assignee_id: integration.default_assignee_id || '',
      severity_threshold: integration.severity_threshold,
      create_only_on_problem: integration.create_only_on_problem,
      reopen_resolved: integration.reopen_resolved,
      conditions: (integration.conditions || []).map((condition) => ({ ...condition })),
    });
    setEditorOpen(true);
  };

  const save = async () => {
    if (!form.name?.trim()) return toast.error('请填写集成名称');
    if (!form.base_url?.trim()) return toast.error('请填写 Zabbix 地址');
    setSaving(true);
    try {
      const payload = {
        ...form,
        enabled: Boolean(form.enabled),
        create_only_on_problem: Boolean(form.create_only_on_problem),
        reopen_resolved: Boolean(form.reopen_resolved),
        workflow_id: form.workflow_id ? Number(form.workflow_id) : null,
        default_assignee_id: form.default_assignee_id ? Number(form.default_assignee_id) : null,
      };
      if (editing) {
        await api.put(`/api/integrations/zabbix/${editing.id}`, payload);
        toast.success('集成配置已更新');
      } else {
        const response = await api.post<{ data: ZabbixIntegration }>('/api/integrations/zabbix', payload);
        toast.success('Zabbix 集成已创建');
        setSelectedId(response.data.id);
      }
      setEditorOpen(false);
      await loadIntegrations();
      await loadEvents();
    } catch (error: any) {
      toast.error(error.message);
    } finally {
      setSaving(false);
    }
  };

  const loadCandidates = async () => {
    if (!selected) return;
    setCandidateLoading(true);
    try {
      const response = await api.get<{ data: any[]; pagination: { total: number } }>(`/api/integrations/zabbix/${selected.id}/host-candidates${buildQuery({ q: candidateQuery, page: candidatePage, pageSize: candidatePageSize, status: candidateStatus })}`);
      setCandidates(response.data);
      setCandidateTotal(response.pagination?.total || 0);
      setCandidateTypes(Object.fromEntries(response.data.map((item) => [item.id, item.ci_type_code || 'server'])));
    } catch (error: any) {
      toast.error(error.message);
    } finally {
      setCandidateLoading(false);
    }
  };

  useEffect(() => {
    if (candidatesOpen) loadCandidates();
  }, [candidatesOpen, selected?.id, candidateQuery, candidatePage, candidatePageSize, candidateStatus]);

  useEffect(() => {
    setCandidatePage(1);
  }, [candidateQuery, candidatePageSize, candidateStatus]);

  const syncHosts = async () => {
    if (!selected) return;
    setHostSyncing(true);
    try {
      const response = await api.post<any>(`/api/integrations/zabbix/${selected.id}/sync-hosts`);
      toast.success(`主机同步：新增 ${response.created}，更新 ${response.updated}，待确认 ${response.pending}，下线 ${response.offline}`);
      await loadCandidates();
    } catch (error: any) {
      toast.error(error.message);
    } finally {
      setHostSyncing(false);
    }
  };

  const openOsMappings = async () => {
    setMappingOpen(true);
    try {
      const response = await api.get<{ data: Array<{ pattern: string; name: string }> }>('/api/system/zabbix-os-mappings');
      setOsRules(response.data?.length ? response.data : DEFAULT_OS_RULES);
    } catch {
      setOsRules(DEFAULT_OS_RULES);
    }
  };

  const saveOsMappings = async () => {
    setMappingSaving(true);
    try {
      await api.put('/api/system/zabbix-os-mappings', { rules: osRules.filter((rule) => rule.pattern.trim() && rule.name.trim()) });
      toast.success('操作系统映射已保存');
      setMappingOpen(false);
    } catch (error: any) {
      toast.error(error.message);
    } finally {
      setMappingSaving(false);
    }
  };

  const loadHostMappingData = async () => {
    setHostMappingLoading(true);
    try {
      const [mappingResponse, typesResponse] = await Promise.all([
        api.get<{ data: ZabbixTypeMapping[]; builtin?: ZabbixBuiltinTypeMapping[] }>('/api/zabbix/type-mappings'),
        api.get<{ data: CIType[] }>('/api/ci-types'),
      ]);
      setHostTypeMappings(mappingResponse.data || []);
      setBuiltinTypeMappings(mappingResponse.builtin || []);
      setCiTypes((typesResponse.data || []).filter((type) => type.enabled));
    } catch (error: any) {
      toast.error(error.message);
    } finally {
      setHostMappingLoading(false);
    }
  };

  const openHostMappings = () => {
    setHostMappingOpen(true);
    setHostMappingForm(null);
    loadHostMappingData();
  };

  const saveHostMapping = async () => {
    if (!hostMappingForm) return;
    if (!hostMappingForm.zabbix_value.trim()) {
      toast.error('请输入 Zabbix 类型值');
      return;
    }
    if (!hostMappingForm.ci_type_id) {
      toast.error('请选择目标 CI 类型');
      return;
    }
    setHostMappingSaving(true);
    try {
      const payload = {
        zabbix_value: hostMappingForm.zabbix_value.trim(),
        ci_type_id: Number(hostMappingForm.ci_type_id),
        description: hostMappingForm.description.trim(),
        enabled: hostMappingForm.enabled,
      };
      if (hostMappingForm.id) await api.put(`/api/zabbix/type-mappings/${hostMappingForm.id}`, payload);
      else await api.post('/api/zabbix/type-mappings', payload);
      toast.success(hostMappingForm.id ? '类型映射已更新' : '类型映射已添加');
      setHostMappingForm(null);
      await loadHostMappingData();
    } catch (error: any) {
      toast.error(error.message);
    } finally {
      setHostMappingSaving(false);
    }
  };

  const deleteHostMapping = async () => {
    if (!hostMappingDelete) return;
    setHostMappingDeleting(true);
    try {
      await api.delete(`/api/zabbix/type-mappings/${hostMappingDelete.id}`);
      toast.success('类型映射已删除');
      setHostMappingDelete(null);
      await loadHostMappingData();
    } catch (error: any) {
      toast.error(error.message);
    } finally {
      setHostMappingDeleting(false);
    }
  };

  const openSyncConfig = async () => {
    setSyncConfigOpen(true);
    try {
      const response = await api.get<{ data: any }>('/api/system/zabbix-sync-config');
      setSyncConfig(response.data);
    } catch {}
  };

  const saveSyncConfig = async () => {
    setSyncConfigSaving(true);
    try {
      await api.put('/api/system/zabbix-sync-config', syncConfig);
      toast.success('同步频率已保存');
      setSyncConfigOpen(false);
    } catch (error: any) {
      toast.error(error.message);
    } finally {
      setSyncConfigSaving(false);
    }
  };

  const syncHostSpecs = async () => {
    if (!selected) return;
    setSpecSyncing(true);
    try {
      const response = await api.post<any>(`/api/integrations/zabbix/${selected.id}/sync-host-specs`);
      toast.success(`主机配置同步：更新 ${response.updated} 台，跳过 ${response.skipped} 台`);
    } catch (error: any) {
      toast.error(error.message);
    } finally {
      setSpecSyncing(false);
    }
  };

  const syncInventory = async () => {
    if (!selected) return;
    setInventorySyncing(true);
    try {
      const response = await api.post<any>(`/api/integrations/zabbix/${selected.id}/sync-inventory`);
      const verifiedText = response.software_expected ? `，关联 ${response.software_verified || 0}/${response.software_expected}` : '';
      toast.success(`资产清单同步：主机 ${response.hosts} 台，新软件 ${response.software_created} 个${verifiedText}，MAC ${response.macs} 个`);
      if (response.software_missing) toast.warning(`有 ${response.software_missing} 条软件未成功关联，请重试同步或查看诊断。`, { duration: 7000 });
      if (response.software_retyped) toast.success(`已修正 ${response.software_retyped} 个软件资产的类型，之前因类型异常未显示在软件清单中。`, { duration: 9000 });
      if (response.software_fallback) toast.warning(`有 ${response.software_fallback} 个软件包原记录无法直接创建，已使用占位资产保留原始名称/版本；可在诊断中查看。`, { duration: 9000 });
      if (response.warnings?.length) toast.warning(`已跳过 ${response.truncated || response.warnings.length} 台截断主机：${response.warnings[0]}${response.warnings.length > 1 ? ` 等 ${response.warnings.length} 条` : ''}`, { duration: 7000 });
      if (response.failed_hosts?.length) {
        toast.warning(`已跳过 ${response.failed_hosts.length} 台软件资产创建失败的主机：${response.failed_hosts.slice(0, 3).join('、')}${response.failed_hosts.length > 3 ? ' 等' : ''}；其他主机已继续同步，原有关联已保留`, { duration: 9000 });
        const firstAssetError = response.asset_errors?.[0];
        if (firstAssetError) {
          toast.error(`软件资产创建失败示例：${firstAssetError.name}：${String(firstAssetError.message || '').slice(0, 180)}`, { duration: 10000 });
        }
      } else if (response.errors?.length) {
        toast.error(`部分主机同步失败：${response.errors.slice(0, 3).join('；')}`);
      }
      await loadInventorySummary(selected.id);
      await loadIntegrations();
    } catch (error: any) {
      toast.error(error.message);
    } finally {
      setInventorySyncing(false);
    }
  };

  const openInventoryDiagnostics = () => {
    if (!selected) return;
    setDiagnosticsPage(1);
    setDiagnosticsQuery('');
    setDiagnosticsType('');
    setDiagnosticsIssue('');
    setDiagnosticsOpen(true);
  };

  useEffect(() => {
    if (!diagnosticsOpen || !selectedId) return undefined;
    let cancelled = false;
    setDiagnostics(null);
    setDiagnosticsLoading(true);
    const query = buildQuery({
      page: diagnosticsPage,
      page_size: diagnosticsPageSize,
      q: diagnosticsQuery,
      ci_type: diagnosticsType,
      issue: diagnosticsIssue,
      _ts: Date.now(),
    });
    api.get<ZabbixInventoryDiagnostics & { ok: boolean }>(
      `/api/integrations/zabbix/${selectedId}/inventory-diagnostics${query}`,
      { cache: 'no-store' },
    )
      .then((response) => {
        if (cancelled) return;
        setDiagnostics(response);
        if (response.page !== diagnosticsPage) setDiagnosticsPage(response.page);
      })
      .catch((error: any) => {
        if (cancelled) return;
        setDiagnostics(null);
        toast.error(error.message);
      })
      .finally(() => {
        if (!cancelled) setDiagnosticsLoading(false);
      });
    return () => { cancelled = true; };
  }, [diagnosticsOpen, selectedId, diagnosticsPage, diagnosticsPageSize, diagnosticsQuery, diagnosticsType, diagnosticsIssue]);

  const approveCandidate = async (candidate: any, ciTypeCode: string) => {
    try {
      await api.post(`/api/integrations/zabbix/${selected?.id}/host-candidates/${candidate.id}/approve`, { ci_type_code: ciTypeCode });
      toast.success(`已确认主机 ${candidate.host_name}`);
      await loadCandidates();
    } catch (error: any) {
      toast.error(error.message);
    }
  };

  const saveCandidates = async () => {
    if (!selected || !candidates.length) return;
    setCandidateSaving(true);
    try {
      const response = await api.post<{ data: Array<{ id: number; ok: boolean; message?: string }> }>(
        `/api/integrations/zabbix/${selected.id}/host-candidates/batch-approve`,
        { items: candidates.map((candidate) => ({ id: candidate.id, ci_type_code: candidateTypes[candidate.id] || 'server' })) },
      );
      const failed = response.data.filter((item) => !item.ok);
      if (failed.length) toast.error(`部分主机添加失败：${failed.slice(0, 3).map((item) => item.message).join('；')}`);
      else toast.success(`已确认 ${response.data.length} 台主机`);
      await loadCandidates();
    } catch (error: any) {
      toast.error(error.message);
    } finally {
      setCandidateSaving(false);
    }
  };

  const ignoreCandidate = async (candidate: any) => {
    try {
      await api.post(`/api/integrations/zabbix/${selected?.id}/host-candidates/${candidate.id}/ignore`);
      toast.success(`已忽略主机 ${candidate.host_name}`);
      await loadCandidates();
    } catch (error: any) {
      toast.error(error.message);
    }
  };

  const restoreCandidate = async (candidate: any) => {
    try {
      await api.post(`/api/integrations/zabbix/${selected?.id}/host-candidates/${candidate.id}/restore`);
      toast.success(`已将 ${candidate.host_name} 恢复为待确认`);
      await loadCandidates();
    } catch (error: any) {
      toast.error(error.message);
    }
  };

  const testConnection = async () => {
    if (!selected) return;
    setTesting(true);
    try {
      const response = await api.post<any>(`/api/integrations/zabbix/${selected.id}/test`);
      toast.success(`连接成功 · Zabbix ${response.version}${response.host_count !== null ? ` · ${response.host_count} 台主机` : ''} · ${response.latency_ms}ms`);
      await loadIntegrations();
    } catch (error: any) {
      toast.error(error.message);
      await loadIntegrations();
    } finally {
      setTesting(false);
    }
  };

  const syncNow = async () => {
    if (!selected) return;
    setSyncing(true);
    try {
      const response = await api.post<any>(`/api/integrations/zabbix/${selected.id}/sync`);
      toast.success(`同步完成：拉取 ${response.fetched} 条，新建事件 ${response.created} 条，去重 ${response.deduplicated} 条`);
      await Promise.all([loadIntegrations(), loadEvents()]);
    } catch (error: any) {
      toast.error(error.message);
    } finally {
      setSyncing(false);
    }
  };

  const simulate = async () => {
    if (!selected) return;
    setSimulating(true);
    try {
      const response = await api.post<any>(`/api/integrations/zabbix/${selected.id}/simulate`);
      if (response.ticket_no) toast.success(`模拟告警已生成事件 ${response.ticket_no}`);
      else toast.info(`模拟告警已接收：${response.reason || response.action}`);
      await Promise.all([loadIntegrations(), loadEvents()]);
    } catch (error: any) {
      toast.error(error.message);
    } finally {
      setSimulating(false);
    }
  };

  const openEvent = async (event: ZabbixEvent) => {
    setEventDetailLoading(true);
    setEventDetail(event);
    try {
      const response = await api.get<{ data: ZabbixEvent }>(`/api/integrations/zabbix/events/${event.id}`);
      setEventDetail(response.data);
    } catch (error: any) {
      toast.error(error.message);
    } finally {
      setEventDetailLoading(false);
    }
  };

  const runConfirm = async () => {
    if (!selected || !confirmAction) return;
    setConfirmLoading(true);
    try {
      if (confirmAction === 'delete') {
        await api.delete(`/api/integrations/zabbix/${selected.id}`);
        toast.success('集成已删除');
        setSelectedId(null);
        await loadIntegrations();
      } else {
        const response = await api.post<{ data: { webhook_secret: string } }>(`/api/integrations/zabbix/${selected.id}/regenerate-secret`);
        toast.success('Webhook 密钥已重置');
        setConfirmAction(null);
        await loadIntegrations();
      }
      setConfirmAction(null);
    } catch (error: any) {
      toast.error(error.message);
    } finally {
      setConfirmLoading(false);
    }
  };

  const addCondition = () => setForm((current) => ({ ...current, conditions: [...(current.conditions || []), { ...BLANK_CONDITION }] }));
  const removeCondition = (index: number) => setForm((current) => ({ ...current, conditions: (current.conditions || []).filter((_: any, i: number) => i !== index) }));
  const updateCondition = (index: number, key: string, value: string) =>
    setForm((current) => ({
      ...current,
      conditions: (current.conditions || []).map((condition: any, i: number) => (i === index ? { ...condition, [key]: value } : condition)),
    }));

  const webhookUrl = webhookBase ? `${webhookBase}/zbx_to_itsm` : `${window.location.origin}/api/webhooks/zabbix/zbx_to_itsm`;

  return (
    <div className="animate-enter">
      <PageHeader
        eyebrow="Automation & monitoring"
        title="Zabbix 7 集成"
        description="通过条件过滤接收 Zabbix 告警，自动去重、匹配 CI，并按事件流程生成可跟踪的工单。"
        actions={
          <>
            <Link to="/alerts"><Button variant="secondary" size="sm" icon={BellRing}>告警中心</Button></Link>
            <Button variant="secondary" size="sm" icon={Settings2} onClick={openOsMappings}>OS 映射</Button>
            <Button variant="secondary" size="sm" icon={Link2} onClick={openHostMappings}>类型映射</Button>
            <Button variant="secondary" size="sm" icon={Clock3} onClick={openSyncConfig}>同步频率</Button>
            <Button size="sm" icon={Plus} onClick={openCreate}>新增集成</Button>
          </>
        }
      />

      <div className="grid grid-cols-1 gap-3.5 xl:grid-cols-12">
        <div className="card overflow-hidden xl:col-span-4">
          <div className="flex items-center justify-between border-b border-[#eef1f6] px-4 py-3.5">
            <div>
              <h2 className="text-[13px] font-semibold text-slate-800">监控源</h2>
              <p className="mt-0.5 text-[10px] text-slate-400">{integrations.length} 个 Zabbix 实例</p>
            </div>
            <Button variant="ghost" size="xs" icon={Plus} onClick={openCreate}>添加</Button>
          </div>
          {loading ? (
            <div className="space-y-2 p-3">{[1, 2].map((item) => <Skeleton key={item} className="h-28 w-full" />)}</div>
          ) : integrations.length ? (
            <div className="space-y-1 p-2">
              {integrations.map((integration) => {
                const connected = integration.last_test_status === 'success';
                return (
                  <button
                    key={integration.id}
                    onClick={() => setSelectedId(integration.id)}
                    className={cn('w-full rounded-lg border p-3 text-left transition', selectedId === integration.id ? 'border-brand-200 bg-brand-50' : 'border-transparent hover:border-[#e5e6eb] hover:bg-[#fafafa]')}
                  >
                    <div className="flex items-start gap-2.5">
                      <span className={cn('flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-white', integration.enabled ? 'bg-gradient-to-br from-rose-500 to-orange-500' : 'bg-slate-300')}>
                        <Radar className="h-4 w-4" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <p className="truncate text-[12px] font-medium text-slate-700">{integration.name}</p>
                          <span className={cn('h-1.5 w-1.5 rounded-full', integration.enabled ? 'bg-emerald-500' : 'bg-slate-300')} />
                        </div>
                        <p className="mt-0.5 truncate font-mono text-[9px] text-slate-400">{integration.base_url}</p>
                        <div className="mt-1.5 flex items-center gap-2 text-[9px] text-slate-400">
                          <span>{integration.event_count || 0} 事件</span>
                          <span>·</span>
                          <span>{integration.ticket_count || 0} 工单</span>
                          <span className="ml-auto">{connected ? '连接正常' : integration.last_test_at ? '连接异常' : '未测试'}</span>
                        </div>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          ) : (
            <EmptyState title="尚未接入 Zabbix" description="添加 Zabbix 7 实例并配置 Webhook，开始自动接单。" icon={Radar} className="py-12" action={<Button size="sm" icon={Plus} onClick={openCreate}>添加集成</Button>} />
          )}
          <div className="m-2 rounded-xl border border-dashed border-slate-200 bg-slate-50/60 p-3">
            <div className="flex items-start gap-2">
              <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-brand-500" />
              <p className="text-[9.5px] leading-relaxed text-slate-500">支持 Webhook 推送与主动同步两种模式；告警可自动关联 CMDB 主机并映射优先级。</p>
            </div>
          </div>
        </div>

        <div className="space-y-3.5 xl:col-span-8">
          {selected ? (
            <>
              <div className="card overflow-hidden">
                <div className="border-b border-[#eef1f6] p-5">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="flex items-start gap-3">
                      <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-rose-500 to-orange-500 text-white shadow-sm">
                        <Radar className="h-5 w-5" />
                      </span>
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <h2 className="text-[17px] font-semibold text-slate-900">{selected.name}</h2>
                          <Badge className={selected.enabled ? 'bg-emerald-50 text-emerald-700 ring-emerald-600/15' : 'bg-slate-100 text-slate-500 ring-slate-500/10'} dot={selected.enabled ? 'bg-emerald-500' : 'bg-slate-400'}>
                            {selected.enabled ? '已启用' : '已停用'}
                          </Badge>
                          {selected.last_test_status === 'success' ? <Badge className="bg-white text-brand-700 ring-brand-200" icon={Wifi}>连接正常</Badge> : selected.last_test_at ? <Badge className="bg-rose-50 text-rose-600 ring-rose-600/10" icon={WifiOff}>连接异常</Badge> : null}
                        </div>
                        <p className="mt-1 font-mono text-[10px] text-slate-400">{selected.base_url}</p>
                        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[9.5px] text-slate-400">
                          <span>触发流程：{selectedWorkflow?.name || '默认事件流程'}</span>
                          <span>·</span>
                          <span>默认负责人：{selectedAssignee?.name || '未指定'}</span>
                          <span>·</span>
                          <span>最近测试：{selected.last_test_at ? relativeTime(selected.last_test_at) : '未测试'}</span>
                        </div>
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Button variant="secondary" size="sm" icon={Settings2} onClick={() => openEdit(selected)}>配置</Button>
                      <IconButton icon={Trash2} label="删除集成" variant="danger" onClick={() => setConfirmAction('delete')} />
                    </div>
                  </div>
                </div>
                <div className="grid grid-cols-2 divide-x divide-[#eef1f6] sm:grid-cols-4">
                  <Metric label="接收事件" value={String(selected.event_count || 0)} />
                  <Metric label="生成工单" value={String(selected.ticket_count || 0)} />
                  <Metric label="严重阈值" value={SEVERITY_META[selected.severity_threshold]?.label || selected.severity_threshold} />
                  <Metric label="最近同步" value={selected.last_sync_at ? relativeTime(selected.last_sync_at) : '未同步'} />
                </div>
                <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[#eef1f6] bg-[#fbfcfe] px-5 py-3">
                  <div className="flex items-center gap-2 text-[10px] text-slate-500">
                    {selected.last_test_status === 'success' ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" /> : <AlertCircle className="h-3.5 w-3.5 text-amber-500" />}
                    {selected.last_test_status === 'success' ? 'API 连接正常，可执行主动同步。' : '尚未验证 API 连接，请先填写有效地址与 Token。'}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button variant="secondary" size="sm" icon={RotateCw} loading={testing} onClick={testConnection}>测试连接</Button>
                    <Button variant="secondary" size="sm" icon={RefreshCw} loading={syncing} onClick={syncNow}>立即同步告警消息</Button>
                    <Button variant="secondary" size="sm" icon={Server} loading={hostSyncing} onClick={syncHosts}>同步主机</Button>
                    <Button variant="secondary" size="sm" icon={Cpu} loading={specSyncing} onClick={syncHostSpecs}>同步主机配置</Button>
                    <Button variant="soft" size="sm" icon={ListChecks} onClick={() => { setCandidatesOpen(true); loadCandidates(); }}>待确认主机</Button>
                    <Button variant="soft" size="sm" icon={Play} loading={simulating} onClick={simulate}>模拟告警</Button>
                  </div>
                </div>
              </div>

              <div className="card overflow-hidden">
                <SectionHeading
                  title="资产清单"
                  description="通过 Zabbix Agent 同步服务器与虚拟机的物理 MAC、已安装软件及版本。"
                  action={<div className="flex flex-wrap items-center gap-2"><Button variant="soft" size="sm" icon={FileJson} loading={diagnosticsLoading} onClick={openInventoryDiagnostics}>诊断</Button><Button variant="secondary" size="sm" icon={Boxes} loading={inventorySyncing} onClick={syncInventory}>同步资产清单</Button></div>}
                />
                <div className="grid grid-cols-3 divide-x divide-[#eef1f6]">
                  <Metric label="已关联主机" value={String(inventorySummary?.hosts || 0)} />
                  <Metric label="软件条目" value={String(inventorySummary?.software || 0)} />
                  <Metric label="MAC 地址" value={String(inventorySummary?.macs || 0)} />
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[#eef1f6] bg-[#fbfcfe] px-5 py-3 text-[10px] text-slate-500">
                  <span>软件会自动写入资产清单并关联对应 CI；默认不在资产拓扑中展示。</span>
                  <span>最近同步：{inventorySummary?.last_sync_at ? relativeTime(inventorySummary.last_sync_at) : '未同步'}</span>
                </div>
              </div>

              <div className="card overflow-hidden">
                <SectionHeading title="Webhook 接入" description="在 Zabbix 7 中配置 Webhook 媒体类型，推送告警至此地址。" action={<KeyRound className="h-4 w-4 text-slate-300" />} />
                <div className="space-y-3 p-5">
                  <div>
                    <label className="label">Webhook URL</label>
                    <div className="flex items-stretch gap-2">
                      <code className="flex min-h-10 min-w-0 flex-1 items-center break-all rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 font-mono text-[10px] leading-relaxed text-slate-600">{webhookUrl || '创建后自动生成'}</code>
                      <CopyButton value={webhookUrl} className="h-10 shrink-0" />
                    </div>
                    <p className="mt-1.5 text-[9.5px] text-slate-400">该标准地址固定不变；集成密钥通过请求头或详情页独立地址校验。</p>
                  </div>
                  <div>
                    <label className="label">Webhook 密钥</label>
                    <div className="flex items-stretch gap-2">
                      <code className="flex min-h-10 min-w-0 flex-1 items-center break-all rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 font-mono text-[10px] leading-relaxed text-slate-600">{showSecret ? (selected?.webhook_secret || '—') : '••••••••••••••••'}</code>
                      <Button variant="secondary" size="xs" className="h-10 shrink-0" icon={showSecret ? EyeOff : Eye} onClick={() => setShowSecret((value) => !value)}>{showSecret ? '隐藏' : '显示'}</Button>
                      <CopyButton value={selected?.webhook_secret || ''} className="h-10 shrink-0" />
                    </div>
                  </div>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                    <MiniSetting label="认证方式" value="URL Secret" icon={ShieldCheck} />
                    <MiniSetting label="事件格式" value="Zabbix 7 JSON" icon={FileJson} />
                    <MiniSetting label="去重维度" value="event_id + 状态" icon={SlidersHorizontal} />
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button variant="secondary" size="sm" icon={KeyRound} onClick={() => setConfirmAction('secret')}>重置 Webhook 密钥</Button>
                  </div>
                </div>
              </div>

              <div className="card overflow-hidden">
                <SectionHeading title="过滤条件" description="仅当严重级别和全部条件命中时才创建事件。" action={<Badge className="bg-white text-brand-700 ring-brand-200">{selected.conditions.length} 条规则</Badge>} />
                <div className="p-5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-md border border-[#e5e6eb] bg-white px-2.5 py-1.5 text-[10.5px] text-[#4e5969]">
                      严重级别 <span className="mx-1 font-mono text-[9px] text-[#86909c]">≥</span> <span className="font-medium text-[#1f2329]">{SEVERITY_META[selected.severity_threshold]?.label || selected.severity_threshold}</span>
                    </span>
                    {selected.conditions.map((condition, index) => (
                      <span key={index} className="rounded-md border border-brand-200 bg-white px-2.5 py-1.5 text-[10.5px] text-brand-700">
                        {FIELD_LABELS[condition.field] || condition.field} <span className="mx-1 font-mono text-[9px] text-brand-600">{OPERATOR_LABELS[condition.operator] || condition.operator}</span>
                        <span className="font-medium">{condition.value || '—'}</span>
                      </span>
                    ))}
                    <span className="text-[10px] text-slate-400">AND 逻辑</span>
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                    <MiniToggle label="仅处理 PROBLEM" enabled={selected.create_only_on_problem} />
                    <MiniToggle label="自动重开已解决事件" enabled={selected.reopen_resolved} />
                    <MiniToggle label="去重合并告警" enabled />
                    <MiniToggle label="自动匹配 CMDB" enabled />
                  </div>
                </div>
              </div>

              <div className="card overflow-hidden">
                <SectionHeading
                  title="主机类型映射"
                  description="将 Zabbix 主机标签 cmdb.type 的值映射为 CMDB CI 类型；自定义映射优先于内置识别规则。"
                  action={<Button variant="soft" size="xs" icon={Link2} onClick={openHostMappings}>管理映射</Button>}
                />
                <div className="p-4">
                  {hostTypeMappings.length ? (
                    <div className="space-y-1.5">
                      {hostTypeMappings.slice(0, 4).map((mapping) => (
                        <div key={mapping.id} className="flex items-center gap-2 rounded-lg border border-slate-100 bg-slate-50/60 px-2.5 py-1.5">
                          <code className="min-w-0 flex-1 truncate font-mono text-[10px] text-slate-600">{mapping.zabbix_value}</code>
                          <ArrowRight className="h-3 w-3 shrink-0 text-slate-300" />
                          <span className="shrink-0 text-[10.5px] font-medium text-slate-700">{mapping.ci_type_name}</span>
                          <Badge className={mapping.enabled ? 'bg-emerald-50 text-emerald-700 ring-emerald-600/15' : 'bg-slate-100 text-slate-500 ring-slate-500/10'}>
                            {mapping.enabled ? '启用' : '停用'}
                          </Badge>
                        </div>
                      ))}
                      {hostTypeMappings.length > 4 ? <p className="pt-1 text-[9.5px] text-slate-400">另有 {hostTypeMappings.length - 4} 条映射，点击「管理映射」查看全部。</p> : null}
                    </div>
                  ) : (
                    <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50/50 px-3 py-3">
                      <p className="text-[10.5px] leading-relaxed text-slate-500">暂无自定义映射，当前使用系统内置识别规则（{builtinTypeMappings.length} 类）。</p>
                      <p className="mt-1 text-[9.5px] leading-relaxed text-slate-400">{builtinTypeMappings.length ? builtinTypeMappings.map((mapping) => mapping.ci_type_name).join('、') : '服务器、存储、网络设备、安全设备、虚拟化宿主机、虚拟化平台、虚拟机'}。</p>
                      <p className="mt-1 text-[9.5px] text-slate-400">在 Zabbix 主机上添加标签 cmdb.type=xxx，并在映射中把 xxx 指向具体 CI 类型即可。</p>
                    </div>
                  )}
                </div>
              </div>

              <details className="group card overflow-hidden">
                <summary className="flex cursor-pointer list-none items-center justify-between px-5 py-3.5 [&::-webkit-details-marker]:hidden">
                  <div>
                    <h3 className="text-[12.5px] font-semibold text-slate-800">Zabbix 7 对接说明</h3>
                    <p className="mt-0.5 text-[10px] text-slate-400">媒体类型 Webhook 参数与请求示例</p>
                  </div>
                  <ChevronDown className="h-4 w-4 text-slate-400 transition group-open:rotate-180" />
                </summary>
                <div className="border-t border-slate-100 bg-slate-50/50 px-5 py-4 text-[10.5px] leading-relaxed text-slate-600">
                  <p className="font-medium text-slate-700">配置步骤</p>
                  <ol className="mt-1.5 list-decimal space-y-1 pl-4">
                    <li>在 Zabbix 7 中创建「Webhook」类型的媒体类型，URL 填写上方地址。</li>
                    <li>脚本将告警序列化为 JSON，至少包含 <code className="rounded bg-white px-1 font-mono text-[9px]">event.id</code>、<code className="rounded bg-white px-1 font-mono text-[9px]">event.name</code>、<code className="rounded bg-white px-1 font-mono text-[9px]">event.severity</code>、<code className="rounded bg-white px-1 font-mono text-[9px]">host.host</code>。</li>
                    <li>为用户配置该媒体类型与触发器动作；平台将按条件评估并自动创建事件工单。</li>
                    <li>如使用 API Token 主动同步，请在配置中填写 Token 并测试连接。</li>
                  </ol>
                  <p className="mt-3 font-medium text-slate-700">请求示例</p>
                  <pre className="mt-1.5 overflow-x-auto rounded-lg bg-ink-900 p-3 font-mono text-[9px] leading-relaxed text-slate-300">{`POST ${webhookUrl || '/api/webhooks/zabbix/<secret>'}
Content-Type: application/json

{
  "event": {
    "id": "48291",
    "name": "CPU utilization is too high",
    "severity": "High",
    "status": "PROBLEM",
    "tags": [{ "tag": "service", "value": "erp" }]
  },
  "host": { "host": "SRV-PROD-001", "ip": "10.20.1.11" },
  "trigger": { "triggerid": "31870" }
}`}</pre>
                </div>
              </details>
            </>
          ) : (
            <div className="card"><EmptyState title="选择或新建一个集成" description="配置 Zabbix 7 地址与 Webhook 后即可接收告警。" icon={Radar} className="py-24" action={<Button size="sm" icon={Plus} onClick={openCreate}>新增集成</Button>} /></div>
          )}
        </div>
      </div>

      <div className="card mt-3.5 overflow-hidden">
        <div className="flex flex-col gap-3 border-b border-[#eef1f6] p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-[13px] font-semibold text-slate-800">告警事件流水</h2>
              <p className="mt-0.5 text-[10px] text-slate-400">来自 Webhook 与主动同步的全部事件，含被条件过滤的记录。</p>
            </div>
            <Link to="/alerts" className="flex items-center gap-1 text-[10.5px] font-medium text-brand-600 hover:text-brand-700">进入告警中心 <ArrowRight className="h-3 w-3" /></Link>
          </div>
          <div className="flex flex-col gap-2 lg:flex-row">
            <SearchInput value={eventSearch} onChange={setEventSearch} placeholder="搜索告警名称、主机或事件 ID…" className="w-full lg:w-[320px]" />
            <select className="input-base h-9 w-auto min-w-[120px] text-[12px]" value={eventSeverity} onChange={(event) => setEventSeverity(event.target.value)}>
              <option value="">全部级别</option>
              {Object.entries(SEVERITY_META).map(([value, meta]) => <option key={value} value={value}>{meta.label}</option>)}
            </select>
            <select className="input-base h-9 w-auto min-w-[130px] text-[12px]" value={eventStatus} onChange={(event) => setEventStatus(event.target.value)}>
              <option value="">全部处理状态</option>
              {Object.entries(PROCESSING_META).map(([value, meta]) => <option key={value} value={value}>{meta.label}</option>)}
            </select>
            <span className="ml-auto hidden items-center text-[10px] text-slate-400 sm:flex">共 {eventTotal} 条事件</span>
          </div>
        </div>
        {eventLoading ? (
          <div className="space-y-2 p-4">{[1, 2, 3].map((item) => <Skeleton key={item} className="h-12 w-full" />)}</div>
        ) : events.length ? (
          <>
            <div className="table-wrap">
              <table className="data-table">
                <thead><tr><th>事件</th><th>严重级别</th><th>主机</th><th>处理状态</th><th>关联工单</th><th>接收时间</th><th></th></tr></thead>
                <tbody>
                  {events.map((event) => {
                    const severity = SEVERITY_META[event.severity] || SEVERITY_META.warning;
                    const processing = PROCESSING_META[event.processing_status] || PROCESSING_META.received;
                    return (
                      <tr key={event.id} className="group cursor-pointer" onClick={() => openEvent(event)}>
                        <td>
                          <div className="flex items-start gap-2.5">
                            <span className={cn('mt-1 h-2 w-2 shrink-0 rounded-full', severity.dot)} />
                            <div className="min-w-0">
                              <p className="max-w-[390px] truncate text-[11.5px] font-medium text-slate-700">{event.event_name}</p>
                              <p className="mt-0.5 font-mono text-[9px] text-slate-400">#{event.event_id} · {event.event_status}</p>
                            </div>
                          </div>
                        </td>
                        <td><Badge className={severity.className} dot={severity.dot}>{severity.label}</Badge></td>
                        <td><p className="text-[10.5px] text-slate-600">{event.host_name || '—'}</p><p className="font-mono text-[9px] text-slate-400">{event.host_ip}</p></td>
                        <td><Badge className={processing.className}>{processing.label}</Badge></td>
                        <td>{event.ticket_no ? <Link to={`/tickets/incident/${event.ticket_id}`} className="font-mono text-[10px] font-medium text-brand-600 hover:text-brand-700">{event.ticket_no}</Link> : <span className="text-[10px] text-slate-300">—</span>}</td>
                        <td className="whitespace-nowrap text-[10px] text-slate-400">{relativeTime(event.received_at)}</td>
                        <td><ArrowRight className="h-3.5 w-3.5 text-slate-300 transition group-hover:text-brand-500" /></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="flex flex-col items-center justify-between gap-2 border-t border-[#eef1f6] px-4 py-2 sm:flex-row"><PageSizeSelect value={pageSize} onChange={setPageSize} /><Pagination page={eventPage} pageSize={pageSize} total={eventTotal} onChange={setEventPage} /></div>
          </>
        ) : (
          <EmptyState title="尚未接收到告警" description="触发 Zabbix 告警或点击「模拟告警」测试接入流程。" icon={BellRing} className="py-12" />
        )}
      </div>

      <Modal
        open={syncConfigOpen}
        onClose={() => setSyncConfigOpen(false)}
        title="Zabbix 自动同步频率"
        description="设置告警、主机发现、主机配置和资产清单的自动同步间隔；设为 0 表示关闭该项自动同步。"
        icon={Clock3}
        size="md"
        resizable={false}
        footer={<><Button variant="secondary" size="sm" onClick={() => setSyncConfigOpen(false)}>取消</Button><Button size="sm" loading={syncConfigSaving} onClick={saveSyncConfig}>保存</Button></>}
      >
        <div className="space-y-3">
          <Field label="告警消息同步（分钟）" hint="0 表示关闭自动告警同步，仅手工点击立即同步或由 Zabbix 使用 Webhook 媒介自动推送">
            <Input type="number" min="0" max="1440" value={syncConfig.alert_minutes} onChange={(event) => setSyncConfig((current) => ({ ...current, alert_minutes: Number(event.target.value) }))} />
          </Field>
          <Field label="主机数据同步（分钟）" hint="0 表示关闭自动同步，仅人工点击同步主机；1–1440 为自动间隔">
            <Input type="number" min="0" max="1440" value={syncConfig.host_minutes} onChange={(event) => setSyncConfig((current) => ({ ...current, host_minutes: Number(event.target.value) }))} />
          </Field>
          <Field label="主机配置同步（分钟）" hint="0 表示关闭自动同步，仅人工点击同步主机配置；1–1440 为自动间隔">
            <Input type="number" min="0" max="1440" value={syncConfig.specs_minutes} onChange={(event) => setSyncConfig((current) => ({ ...current, specs_minutes: Number(event.target.value) }))} />
          </Field>
          <Field label="资产清单同步（分钟）" hint="同步 Agent 上报的软件清单和物理 MAC；0 表示仅人工同步，建议 60–1440">
            <Input type="number" min="0" max="1440" value={syncConfig.inventory_minutes} onChange={(event) => setSyncConfig((current) => ({ ...current, inventory_minutes: Number(event.target.value) }))} />
          </Field>
          <p className="text-[10px] text-slate-400">修改后由后台调度器读取，最多约 1 分钟后生效。</p>
        </div>
      </Modal>

      <Modal
        open={hostMappingOpen}
        onClose={() => setHostMappingOpen(false)}
        title="Zabbix 主机类型映射"
        description="把 Zabbix 主机标签 cmdb.type 的原始值映射到 CMDB CI 类型；自定义映射优先于内置识别规则。"
        icon={Link2}
        size="lg"
        resizable={false}
        footer={<Button variant="secondary" size="sm" onClick={() => setHostMappingOpen(false)}>关闭</Button>}
      >
        <div className="space-y-3">
          <div className="rounded-lg border border-brand-200 bg-white px-3 py-2.5 text-[10px] leading-relaxed text-brand-700">
            读取主机标签 <code className="rounded bg-white/70 px-1 py-0.5 font-mono text-[9.5px]">cmdb.type</code>、<code className="rounded bg-white/70 px-1 py-0.5 font-mono text-[9.5px]">cmdb_type</code>、<code className="rounded bg-white/70 px-1 py-0.5 font-mono text-[9.5px]">host_type</code>、<code className="rounded bg-white/70 px-1 py-0.5 font-mono text-[9.5px]">type</code>、<code className="rounded bg-white/70 px-1 py-0.5 font-mono text-[9.5px]">device_type</code>。值按忽略大小写精确匹配；没有命中自定义映射时，继续使用内置别名识别。修改后从下一次主机同步开始生效。
          </div>
          <div className="flex items-center justify-between gap-2">
            <p className="text-[11px] font-medium text-slate-700">现有自定义映射 <span className="font-normal text-slate-400">（{hostTypeMappings.length}）</span></p>
            <Button variant="secondary" size="xs" icon={Plus} onClick={() => setHostMappingForm({ zabbix_value: '', ci_type_id: '', description: '', enabled: true })}>新增映射</Button>
          </div>

          {hostMappingForm ? (
            <div className="rounded-lg border border-brand-200 bg-white p-3">
              <div className="mb-2 flex items-center justify-between">
                <p className="text-[11px] font-semibold text-brand-700">{hostMappingForm.id ? '编辑类型映射' : '新增类型映射'}</p>
                <button className="rounded p-1 text-slate-400 hover:bg-white hover:text-slate-600" onClick={() => setHostMappingForm(null)} aria-label="关闭表单"><X className="h-3.5 w-3.5" /></button>
              </div>
              <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                <Field label="Zabbix 类型值" hint="cmdb.type 标签的原始值，例如 vmware-esxi、linux-server">
                  <Input value={hostMappingForm.zabbix_value} onChange={(event) => setHostMappingForm((current) => current ? { ...current, zabbix_value: event.target.value } : current)} placeholder="例如 vmware-esxi" />
                </Field>
                <Field label="映射到 CI 类型">
                  <select className="input-base" value={hostMappingForm.ci_type_id} onChange={(event) => setHostMappingForm((current) => current ? { ...current, ci_type_id: event.target.value } : current)}>
                    <option value="">选择 CI 类型…</option>
                    {ciTypes.map((type) => <option key={type.id} value={type.id}>{type.name}（{type.code}）</option>)}
                  </select>
                </Field>
                <Field label="备注" hint="可选，说明该取值的来源或用途">
                  <Input value={hostMappingForm.description} onChange={(event) => setHostMappingForm((current) => current ? { ...current, description: event.target.value } : current)} placeholder="例如：总部 ESXi 宿主机标签" />
                </Field>
                <Field label="状态" hint="停用后立即回退到内置识别规则">
                  <div className="flex h-9 items-center gap-2">
                    <Toggle checked={hostMappingForm.enabled} onChange={(checked) => setHostMappingForm((current) => current ? { ...current, enabled: checked } : current)} />
                    <span className="text-[10.5px] text-slate-500">{hostMappingForm.enabled ? '启用' : '停用'}</span>
                  </div>
                </Field>
              </div>
              <div className="mt-2 flex justify-end gap-2">
                <Button variant="secondary" size="xs" onClick={() => setHostMappingForm(null)}>取消</Button>
                <Button size="xs" loading={hostMappingSaving} onClick={saveHostMapping}>{hostMappingForm.id ? '保存修改' : '添加映射'}</Button>
              </div>
            </div>
          ) : null}

          {hostMappingLoading ? <Spinner /> : hostTypeMappings.length ? (
            <div className="overflow-hidden rounded-xl border border-slate-200">
              <table className="w-full text-left">
                <thead className="bg-slate-50/80 text-[9.5px] uppercase tracking-wide text-slate-400">
                  <tr><th className="px-3 py-2 font-medium">Zabbix 值</th><th className="px-3 py-2 font-medium">CI 类型</th><th className="px-3 py-2 font-medium">备注</th><th className="px-3 py-2 font-medium">状态</th><th className="px-3 py-2 text-right font-medium">操作</th></tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {hostTypeMappings.map((mapping) => (
                    <tr key={mapping.id} className="text-[10.5px] text-slate-600 hover:bg-slate-50/60">
                      <td className="px-3 py-2"><code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] text-slate-700">{mapping.zabbix_value}</code></td>
                      <td className="px-3 py-2"><span className="font-medium text-slate-700">{mapping.ci_type_name}</span><span className="ml-1.5 font-mono text-[9px] text-slate-400">{mapping.ci_type_code}</span></td>
                      <td className="max-w-[220px] truncate px-3 py-2 text-slate-500" title={mapping.description}>{mapping.description || '—'}</td>
                      <td className="px-3 py-2"><Badge className={mapping.enabled ? 'bg-emerald-50 text-emerald-700 ring-emerald-600/15' : 'bg-slate-100 text-slate-500 ring-slate-500/10'}>{mapping.enabled ? '启用' : '停用'}</Badge></td>
                      <td className="px-3 py-2"><div className="flex items-center justify-end gap-1"><IconButton icon={Pencil} label="编辑" onClick={() => setHostMappingForm({ id: mapping.id, zabbix_value: mapping.zabbix_value, ci_type_id: String(mapping.ci_type_id), description: mapping.description || '', enabled: mapping.enabled })} /><IconButton icon={Trash2} label="删除" variant="danger" onClick={() => setHostMappingDelete(mapping)} /></div></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState title="暂无自定义类型映射" description="当前使用下方系统内置识别规则；添加映射后可把自定义的 cmdb.type 值指向任意已启用 CI 类型。" icon={Link2} className="py-8" />
          )}
          <div className="mt-4 overflow-hidden rounded-xl border border-slate-200">
            <div className="flex items-start justify-between gap-3 border-b border-slate-100 bg-slate-50/70 px-3 py-2.5">
              <div>
                <p className="text-[11px] font-medium text-slate-700">系统内置识别映射 <span className="font-normal text-slate-400">（{builtinTypeMappings.length} 类）</span></p>
                <p className="mt-0.5 text-[9.5px] leading-relaxed text-slate-400">未命中上方自定义映射时，按以下内置别名回退识别；内置规则只读，不可编辑。</p>
              </div>
              <Badge className="shrink-0 bg-slate-100 text-slate-500 ring-slate-500/10">只读</Badge>
            </div>
            {hostMappingLoading ? <div className="flex justify-center px-3 py-5"><Spinner /></div> : builtinTypeMappings.length ? (
              <div className="grid gap-2 p-3 sm:grid-cols-2">
                {builtinTypeMappings.map((mapping) => (
                  <div key={mapping.ci_type_code} className="rounded-lg border border-slate-100 bg-white p-2.5">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: mapping.ci_type_color || '#94a3b8' }} />
                      <span className="text-[10.5px] font-semibold text-slate-700">{mapping.ci_type_name}</span>
                      <span className="font-mono text-[9px] text-slate-400">{mapping.ci_type_code}</span>
                      {mapping.ci_type_enabled === false ? <Badge className="bg-slate-100 text-slate-500 ring-slate-500/10">类型已停用</Badge> : null}
                    </div>
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {mapping.values.map((value) => <code key={value} className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[9.5px] text-slate-600">{value}</code>)}
                    </div>
                  </div>
                ))}
              </div>
            ) : <p className="px-3 py-4 text-[10px] text-slate-400">暂无内置规则数据，请刷新后重试。</p>}
          </div>
          <p className="text-[9.5px] leading-relaxed text-slate-400">内置识别覆盖服务器、存储、网络设备、安全设备、虚拟化宿主机、虚拟化平台与虚拟机；同名值存在自定义映射时，自定义映射优先。同一 Zabbix 值只能配置一条自定义映射，重复保存会提示冲突。</p>
        </div>
      </Modal>

      <Modal
        open={mappingOpen}
        onClose={() => setMappingOpen(false)}
        title="操作系统取值映射"
        description="按 Zabbix system.sw.os 原始值中的关键字映射为 CMDB 操作系统名称；内核版本会自动解析。"
        icon={Settings2}
        size="md"
        resizable={false}
        footer={<><Button variant="secondary" size="sm" onClick={() => setMappingOpen(false)}>取消</Button><Button size="sm" loading={mappingSaving} onClick={saveOsMappings}>保存映射</Button></>}
      >
        <div className="space-y-3">
          <p className="text-[10px] text-slate-400">例如：el7 → CentOS7；Windows 会自动提取 Windows Server 2016 Standard 等名称。</p>
          {osRules.map((rule, index) => (
            <div key={index} className="flex items-center gap-2">
              <Input value={rule.pattern} onChange={(event) => setOsRules((current) => current.map((item, i) => i === index ? { ...item, pattern: event.target.value } : item))} placeholder="原始值关键字，如 el7" className="flex-1" />
              <span className="text-slate-300">→</span>
              <Input value={rule.name} onChange={(event) => setOsRules((current) => current.map((item, i) => i === index ? { ...item, name: event.target.value } : item))} placeholder="显示名称，如 CentOS7" className="flex-1" />
              <IconButton icon={Trash2} label="删除" variant="danger" onClick={() => setOsRules((current) => current.filter((_, i) => i !== index))} />
            </div>
          ))}
          <Button variant="secondary" size="sm" icon={Plus} onClick={() => setOsRules((current) => [...current, { pattern: '', name: '' }])}>添加规则</Button>
        </div>
      </Modal>

      <Modal
        open={candidatesOpen}
        onClose={() => setCandidatesOpen(false)}
        title="Zabbix 主机确认"
        description="已确认或已忽略的主机不会在后续同步中重复出现；可切换到“已忽略”恢复误操作。"
        icon={Server}
        size="lg"
        resizable={false}
        footer={<><Button variant="secondary" size="sm" onClick={() => setCandidatesOpen(false)}>关闭</Button>{candidateStatus === 'pending' ? <Button size="sm" loading={candidateSaving} disabled={!candidates.length} onClick={saveCandidates}>保存确认</Button> : null}</>}
      >
        <div className="mb-3 space-y-3">
          <div className="flex items-center gap-1 rounded-md border border-[#e5e6eb] bg-[#fafafa] p-1">
            {([['pending', '待确认'], ['ignored', '已忽略']] as const).map(([value, label]) => (
              <button key={value} type="button" onClick={() => setCandidateStatus(value)} className={cn('rounded px-3 py-1 text-[10px] font-medium transition', candidateStatus === value ? 'bg-white text-brand-700 shadow-sm' : 'text-[#4e5969] hover:text-[#1f2329]')}>
                {label}
              </button>
            ))}
            <span className="ml-auto pr-2 text-[10px] text-slate-400">共 {candidateTotal} 台</span>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <SearchInput value={candidateSearch} onChange={setCandidateSearch} placeholder="搜索主机名、显示名或 IP…" className="w-full sm:w-[280px]" />
            {candidateStatus === 'pending' ? <div className="flex items-center gap-2">
              <span className="text-[10px] text-slate-400">批量设置类型</span>
              <select className="input-base h-8 w-auto text-[10px]" defaultValue="" onChange={(event) => { if (!event.target.value) return; setCandidateTypes(Object.fromEntries(candidates.map((candidate) => [candidate.id, event.target.value]))); }}>
                <option value="">选择类型…</option>
                <option value="server">服务器</option>
                <option value="storage">存储</option>
                <option value="network">网络设备</option>
                <option value="security">信息安全设备</option>
                <option value="vm">虚拟机</option>
                <option value="virtualization_host">虚拟化宿主机</option>
                <option value="virtualization">虚拟化平台</option>
              </select>
            </div> : <span className="text-[10px] text-slate-400">恢复后将重新进入待确认列表</span>}
          </div>
        </div>
        {candidateLoading ? <Spinner /> : candidates.length ? (
          <div className="space-y-2">
            {candidates.map((candidate) => (
              <div key={candidate.id} className="rounded-lg border border-[#e5e6eb] p-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-[12px] font-medium text-slate-800">{candidate.display_name || candidate.host_name}</p>
                    <p className="mt-0.5 font-mono text-[9.5px] text-slate-400">{candidate.host_name} · {candidate.ip_address || '无 IP'} · 识别类型 {candidate.zabbix_type || '未识别'}</p>
                    <p className="mt-1 text-[9.5px] text-amber-600">{candidate.reason || '待确认'}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    {candidateStatus === 'pending' ? <>
                      <select className="input-base h-8 w-auto text-[10px]" value={candidateTypes[candidate.id] || 'server'} onChange={(event) => setCandidateTypes((current) => ({ ...current, [candidate.id]: event.target.value }))}>
                        <option value="server">服务器</option>
                        <option value="storage">存储</option>
                        <option value="network">网络设备</option>
                        <option value="security">信息安全设备</option>
                        <option value="vm">虚拟机</option>
                        <option value="virtualization_host">虚拟化宿主机</option>
                        <option value="virtualization">虚拟化平台</option>
                      </select>
                      <Button size="xs" variant="secondary" onClick={() => ignoreCandidate(candidate)}>忽略</Button>
                    </> : <Button size="xs" variant="secondary" onClick={() => restoreCandidate(candidate)}>恢复为待确认</Button>}
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : <EmptyState title={candidateStatus === 'ignored' ? '暂无已忽略主机' : '暂无待确认主机'} description={candidateStatus === 'ignored' ? '被忽略的主机会保留在这里，可随时恢复。' : '同步 Zabbix 主机后，需要人工确认的记录会出现在这里。'} icon={Server} className="py-12" />}
        <div className="mt-4 flex flex-col items-center justify-between gap-2 border-t border-[#f0f0f0] pt-3 sm:flex-row">
          <PageSizeSelect value={candidatePageSize} onChange={setCandidatePageSize} />
          <Pagination page={candidatePage} pageSize={candidatePageSize} total={candidateTotal} onChange={setCandidatePage} />
        </div>
      </Modal>

      <Modal
        open={editorOpen}
        onClose={() => setEditorOpen(false)}
        title={editing ? '编辑 Zabbix 集成' : '新增 Zabbix 7 集成'}
        description="配置 API 连接、默认事件流程与告警过滤条件。"
        icon={Radar}
        size="lg"
        resizable={false}
        footer={<><Button variant="secondary" size="sm" onClick={() => setEditorOpen(false)}>取消</Button><Button size="sm" loading={saving} onClick={save}>{editing ? '保存配置' : '创建集成'}</Button></>}
      >
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="集成名称" required><Input value={form.name || ''} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} placeholder="如 生产环境 Zabbix" /></Field>
            <Field label="Zabbix 地址" required hint="例如 http://10.0.0.10/zabbix">
              <Input value={form.base_url || ''} onChange={(event) => setForm((current) => ({ ...current, base_url: event.target.value }))} placeholder="https://zabbix.example.com" className="font-mono text-[11px]" />
            </Field>
            <Field label="API Token" hint={editing?.has_token ? '已配置 Token，留空保持原值' : '用于主动同步与连接测试，可稍后配置'}>
              <Input type="password" value={form.api_token || ''} onChange={(event) => setForm((current) => ({ ...current, api_token: event.target.value }))} placeholder={editing?.has_token ? '••••••••（留空不修改）' : '输入 Zabbix API Token'} autoComplete="new-password" />
            </Field>
            <Field label="默认事件流程">
              <select className="input-base" value={form.workflow_id || ''} onChange={(event) => setForm((current) => ({ ...current, workflow_id: event.target.value }))}>
                <option value="">使用默认事件流程</option>
                {workflows.filter((item) => item.is_active).map((workflow) => <option key={workflow.id} value={workflow.id}>{workflow.name}</option>)}
              </select>
            </Field>
            <Field label="默认负责人">
              <select className="input-base" value={form.default_assignee_id || ''} onChange={(event) => setForm((current) => ({ ...current, default_assignee_id: event.target.value }))}>
                <option value="">不指定</option>
                {users.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.department}</option>)}
              </select>
            </Field>
            <Field label="最低严重级别" hint="低于该级别的告警会被忽略">
              <select className="input-base" value={form.severity_threshold || 'warning'} onChange={(event) => setForm((current) => ({ ...current, severity_threshold: event.target.value }))}>
                {Object.entries(SEVERITY_META).map(([value, meta]) => <option key={value} value={value}>{meta.label} ({SEVERITY_DETAILS[value]?.en || value}) — {SEVERITY_DETAILS[value]?.desc || ''}</option>)}
              </select>
            </Field>
          </div>

          <div className="rounded-xl border border-slate-200">
            <div className="flex items-center justify-between border-b border-slate-100 px-3.5 py-2.5">
              <div>
                <p className="text-[11.5px] font-medium text-slate-700">过滤条件</p>
                <p className="mt-0.5 text-[9px] text-slate-400">全部条件同时满足才接收，空条件表示全部接收。</p>
              </div>
              <Button variant="secondary" size="xs" icon={Plus} onClick={addCondition}>添加条件</Button>
            </div>
            <div className="space-y-2 p-3">
              {(form.conditions || []).map((condition: any, index: number) => (
                <div key={index} className="flex flex-col gap-2 sm:flex-row">
                  <select className="input-base h-9 text-[11px] sm:w-[130px]" value={condition.field} onChange={(event) => updateCondition(index, 'field', event.target.value)}>
                    {Object.entries(FIELD_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                  </select>
                  <select className="input-base h-9 text-[11px] sm:w-[150px]" value={condition.operator} onChange={(event) => updateCondition(index, 'operator', event.target.value)}>
                    {Object.entries(OPERATOR_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                  </select>
                  {condition.field === 'severity' ? (
                    <select className="input-base h-9 flex-1 text-[11px]" value={condition.value} onChange={(event) => updateCondition(index, 'value', event.target.value)}>
                      {Object.entries(SEVERITY_META).map(([value, meta]) => <option key={value} value={value}>{meta.label} ({SEVERITY_DETAILS[value]?.en || value})</option>)}
                    </select>
                  ) : <Input className="h-9 flex-1 text-[11px]" value={condition.value || ''} onChange={(event) => updateCondition(index, 'value', event.target.value)} placeholder="条件值" />}
                  <IconButton icon={Trash2} label="删除条件" variant="danger" onClick={() => removeCondition(index)} />
                </div>
              ))}
              {!form.conditions?.length ? <p className="py-3 text-center text-[10px] text-slate-400">未设置额外条件，将接收所有达到严重阈值的告警。</p> : null}
              <div className="rounded-lg bg-slate-50 px-3 py-2 text-[9px] leading-relaxed text-slate-500">
                <p className="font-medium text-slate-600">Zabbix 默认严重级别（从低到高）</p>
                <p className="mt-1">{Object.entries(SEVERITY_DETAILS).map(([key, value]) => `${value.rank} ${SEVERITY_META[key]?.label || key} / ${value.en}`).join(' · ')}</p>
                <p className="mt-1">严重级别条件选择「≥」时，表示该级别及以上；选择「=」时只匹配该级别。</p>
                <p className="mt-1">「包含 / 不包含」支持多个关键字，用英文逗号、中文逗号或竖线分隔。例如主机名不包含 UAT、Test、测试：选择「不包含」，填写 <code className="font-mono">UAT,Test,测试</code>，表示三个关键字都未出现时才命中。</p>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <label className="flex items-center justify-between rounded-xl border border-slate-200 px-3 py-2.5">
              <div><p className="text-[11px] font-medium text-slate-700">启用集成</p><p className="text-[9px] text-slate-400">停用后 Webhook 拒绝接收</p></div>
              <Toggle checked={Boolean(form.enabled)} onChange={(checked) => setForm((current) => ({ ...current, enabled: checked }))} />
            </label>
            <label className="flex items-center justify-between rounded-xl border border-slate-200 px-3 py-2.5">
              <div><p className="text-[11px] font-medium text-slate-700">仅处理 PROBLEM</p><p className="text-[9px] text-slate-400">忽略 RECOVERY 事件</p></div>
              <Toggle checked={Boolean(form.create_only_on_problem)} onChange={(checked) => setForm((current) => ({ ...current, create_only_on_problem: checked }))} />
            </label>
            <label className="flex items-center justify-between rounded-xl border border-slate-200 px-3 py-2.5">
              <div><p className="text-[11px] font-medium text-slate-700">告警重开事件</p><p className="text-[9px] text-slate-400">已解决工单再次告警时自动重开</p></div>
              <Toggle checked={Boolean(form.reopen_resolved)} onChange={(checked) => setForm((current) => ({ ...current, reopen_resolved: checked }))} />
            </label>
          </div>
          <p className="flex items-start gap-1.5 rounded-lg bg-slate-50 px-3 py-2 text-[9.5px] leading-relaxed text-slate-500">
            <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-500" />
            Webhook 密钥将在保存时自动生成，URL 可在详情页复制。平台会记录所有接收事件，被过滤的告警会标记为「已忽略」。
          </p>
        </div>
      </Modal>

      <Modal
        open={Boolean(eventDetail)}
        onClose={() => setEventDetail(null)}
        title={eventDetail?.event_name || '告警详情'}
        description={eventDetail ? `事件 #${eventDetail.event_id} · ${eventDetail.host_name || '未知主机'}` : ''}
        icon={BellRing}
        size="lg"
        footer={<Button variant="secondary" size="sm" onClick={() => setEventDetail(null)}>关闭</Button>}
      >
        {eventDetailLoading ? <div className="space-y-2"><Skeleton className="h-20 w-full" /><Skeleton className="h-40 w-full" /></div> : eventDetail ? (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              {(() => {
                const severity = SEVERITY_META[eventDetail.severity] || SEVERITY_META.warning;
                const processing = PROCESSING_META[eventDetail.processing_status] || PROCESSING_META.received;
                return <><Badge className={severity.className} dot={severity.dot}>{severity.label}</Badge><Badge className={processing.className}>{processing.label}</Badge><Badge className={eventDetail.event_status === 'RECOVERY' ? 'bg-teal-50 text-teal-700 ring-teal-600/15' : 'bg-rose-50 text-rose-700 ring-rose-600/15'}>{eventDetail.event_status}</Badge></>;
              })()}
              {eventDetail.ticket_no ? <Link to={`/tickets/incident/${eventDetail.ticket_id}`} className="ml-auto flex items-center gap-1 font-mono text-[10.5px] font-medium text-brand-600">查看 {eventDetail.ticket_no} <ExternalLink className="h-3 w-3" /></Link> : null}
            </div>
            <InfoBlock label="处理说明" value={eventDetail.processing_note || '—'} />
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <InfoBlock label="主机" value={eventDetail.host_name || '—'} />
              <InfoBlock label="IP" value={eventDetail.host_ip || '—'} mono />
              <InfoBlock label="触发 ID" value={eventDetail.trigger_id || '—'} mono />
              <InfoBlock label="接收时间" value={formatDate(eventDetail.received_at)} />
            </div>
            {eventDetail.tags?.length ? (
              <div>
                <p className="mb-1.5 text-[10px] font-medium text-slate-400">标签</p>
                <div className="flex flex-wrap gap-1.5">
                  {eventDetail.tags.map((tag, index) => <span key={index} className="rounded-md bg-slate-100 px-2 py-1 font-mono text-[9.5px] text-slate-600">{tag.tag}{tag.value ? `=${tag.value}` : ''}</span>)}
                </div>
              </div>
            ) : null}
            <div>
              <p className="mb-1.5 text-[10px] font-medium text-slate-400">原始 Payload</p>
              <pre className="custom-scroll max-h-72 overflow-auto rounded-xl bg-ink-900 p-3.5 font-mono text-[9.5px] leading-relaxed text-slate-300">{JSON.stringify(eventDetail.payload || {}, null, 2)}</pre>
            </div>
          </div>
        ) : null}
      </Modal>

      <Modal
        open={diagnosticsOpen}
        onClose={() => setDiagnosticsOpen(false)}
        title="资产清单诊断"
        description="只读检查 Zabbix 监控项与解析结果，不写入资产；用于定位同步不完整。"
        icon={FileJson}
        size="xl"
        footer={<div className="flex w-full flex-wrap items-center justify-between gap-3">
          {diagnostics ? <Pagination page={diagnostics.page} pageSize={diagnostics.page_size} total={diagnostics.hosts_matched} onChange={setDiagnosticsPage} /> : <span />}
          <Button variant="secondary" size="sm" onClick={() => setDiagnosticsOpen(false)}>关闭</Button>
        </div>}
      >
        {!diagnostics && diagnosticsLoading ? (
          <div className="space-y-2"><Skeleton className="h-24 w-full" /><Skeleton className="h-40 w-full" /></div>
        ) : diagnostics ? (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <DiagnosticMetric label="已关联主机" value={diagnostics.hosts} />
              <DiagnosticMetric label="筛选后主机" value={diagnostics.hosts_matched} />
              <DiagnosticMetric label="原始软件记录" value={diagnostics.software_records} />
              <DiagnosticMetric label="去重后软件" value={diagnostics.software_normalized} />
            </div>
            <div className="flex flex-wrap items-center gap-2 text-[10px] text-slate-500">
              <Badge className="bg-white text-brand-700 ring-brand-200">软件监控项 {diagnostics.software_items}</Badge>
              <Badge className="bg-emerald-50 text-emerald-700 ring-emerald-600/15">已关联 {diagnostics.software_linked}</Badge>
              <Badge className={diagnostics.software_missing ? 'bg-amber-50 text-amber-700 ring-amber-600/15' : 'bg-emerald-50 text-emerald-700 ring-emerald-600/15'}>
                缺少关联 {diagnostics.software_missing}
              </Badge>
              <Badge className="bg-white text-brand-700 ring-brand-200">MAC 监控项 {diagnostics.mac_items}</Badge>
              <Badge className="bg-white text-brand-700 ring-brand-200">MAC 记录 {diagnostics.mac_records}</Badge>
              <span>诊断时间：{new Date().toLocaleString()}</span>
            </div>
            {diagnostics.search_errors?.length ? (
              <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[10px] leading-relaxed text-amber-800">
                <p className="font-medium">部分 Zabbix 查询失败，当前结果可能不完整：</p>
                {diagnostics.search_errors.map((error, index) => <p key={index} className="mt-1 font-mono">{error.search}: {error.message}</p>)}
              </div>
            ) : null}
            <div className="rounded-xl border border-slate-200 bg-slate-50/60 px-3 py-2 text-[9.5px] leading-relaxed text-slate-500">
              对比方法：Zabbix 中主机「软件清单」监控项的最新值条数应接近「原始软件记录」。若原始记录明显偏少，检查监控项最新值是否被截断；若原始记录正常但去重后偏少，检查重名同版本；若两者都正常但资产列表偏少，检查下方每台主机的 item 详情与同步错误。
            </div>
            <div className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white px-2.5 py-2">
              <SearchInput
                value={diagnosticsQuery}
                onChange={(value) => { setDiagnosticsQuery(value); setDiagnosticsPage(1); }}
                placeholder="筛选资产名称、资产编号、IP 或 hostid…"
                className="min-w-[200px] flex-1"
              />
              <select
                value={diagnosticsType}
                onChange={(event) => { setDiagnosticsType(event.target.value); setDiagnosticsPage(1); }}
                className="h-8 rounded-lg border border-slate-200 bg-white px-2 text-[10px] text-slate-600 outline-none focus:border-brand-400"
                aria-label="筛选资产类型"
              >
                <option value="">全部类型</option>
                <option value="server">服务器</option>
                <option value="vm">虚拟机</option>
              </select>
              <select
                value={diagnosticsIssue}
                onChange={(event) => { setDiagnosticsIssue(event.target.value); setDiagnosticsPage(1); }}
                className="h-8 rounded-lg border border-slate-200 bg-white px-2 text-[10px] text-slate-600 outline-none focus:border-brand-400"
                aria-label="筛选异常类型"
              >
                <option value="">全部数据</option>
                <option value="abnormal">仅异常</option>
                <option value="truncated">异常截断</option>
                <option value="missing">关联缺失</option>
              </select>
              <PageSizeSelect value={diagnosticsPageSize} onChange={(size) => { setDiagnosticsPageSize(size); setDiagnosticsPage(1); }} />
              {diagnosticsLoading ? <Spinner className="h-3.5 w-3.5 text-slate-400" /> : null}
              <span className="text-[9.5px] text-slate-400">第 {diagnostics.page}/{diagnostics.pages} 页 · 筛选后 {diagnostics.hosts_matched} 台</span>
            </div>
            <div className="custom-scroll max-h-[52vh] space-y-3 overflow-y-auto pr-1">
              {!diagnostics.hosts_detail.length ? (
                <EmptyState title="没有匹配的资产" description="调整资产名称、编号、IP 或类型筛选条件后重试。" icon={FileJson} className="py-8" />
              ) : null}
              {diagnostics.hosts_detail.map((host) => (
                <div key={host.ci_id} className="rounded-xl border border-slate-200">
                  <div className="flex flex-wrap items-start justify-between gap-2 border-b border-slate-100 px-3 py-2.5">
                    <div className="min-w-0">
                      <p className="truncate text-[11px] font-medium text-slate-700">{host.name}</p>
                      <p className="mt-0.5 font-mono text-[9px] text-slate-400">
                        {host.asset_no} · {host.type_code === 'vm' ? '虚拟机' : '服务器'} · {host.ip_address || '未录入 IP'} · hostid {host.zabbix_host_id || '—'}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Badge className="bg-slate-100 text-slate-600 ring-slate-500/10">软件 {host.software_item_count} 项</Badge>
                      <Badge className={host.software_truncated_items ? 'bg-amber-50 text-amber-700 ring-amber-600/15' : 'bg-emerald-50 text-emerald-700 ring-emerald-600/15'}>
                        {host.software_truncated_items ? `${host.software_truncated_items} 个疑似截断` : '未发现截断'}
                      </Badge>
                      {host.software_sync_skipped ? <Badge className="bg-rose-50 text-rose-700 ring-rose-600/15">上次同步跳过</Badge> : null}
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2 px-3 py-2 text-[9.5px] text-slate-500 sm:grid-cols-3">
                    <span>原始 {host.software_records}</span>
                    <span>去重 {host.software_normalized}</span>
                    <span className={host.software_missing ? 'text-amber-700' : ''}>已关联 {host.software_linked} · 缺少 {host.software_missing}</span>
                    <span>空名称 {host.software_empty_names}</span>
                    <span>MAC {host.mac_normalized}/{host.mac_records}</span>
                  </div>
                  {host.software_sync_skipped ? (
                    <div className="mx-3 mb-2 rounded-lg border border-rose-200 bg-rose-50 px-2.5 py-2 text-[9px] leading-relaxed text-rose-800">
                      上次同步因软件资产创建失败而跳过了该主机，原有关系被保留。{host.software_sync_error ? `原因：${host.software_sync_error}` : ''}
                      {host.software_asset_errors?.length ? (
                        <ul className="mt-1 space-y-0.5">
                          {host.software_asset_errors.map((error, index) => (
                            <li key={`${error.asset_no || error.name || 'error'}-${index}`} className="truncate">
                              {error.name || error.asset_no || '未知软件'}：{error.message || '资产创建失败'}
                            </li>
                          ))}
                        </ul>
                      ) : null}
                    </div>
                  ) : null}
                  {host.software_missing ? (
                    <div className="mx-3 mb-2 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-2 text-[9px] leading-relaxed text-amber-800">
                      诊断读取到 {host.software_normalized} 条去重软件，但当前只关联了 {host.software_linked} 条，缺少 {host.software_missing} 条。重新执行「同步资产清单」会补齐缺失关系；若仍不足，请查看同步错误。
                    </div>
                  ) : null}
                  {host.software_truncated_items ? (
                    <div className="mx-3 mb-2 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-2 text-[9px] leading-relaxed text-amber-800">
                      Zabbix Text 监控项上限 64KB，该主机软件清单已被截断。同步时会<strong>跳过该主机的软件清单并保留已有关系</strong>，避免用不完整结果删除资产；请在 Zabbix 侧缩短输出或按包名前缀拆分监控项。
                    </div>
                  ) : null}
                  <div className="space-y-1.5 border-t border-slate-100 px-3 py-2">
                    {host.software_items.map((item) => (
                      <div key={item.itemid} className="rounded-lg bg-slate-50 px-2.5 py-1.5">
                        <div className="flex flex-wrap items-center justify-between gap-1.5">
                          <span className="truncate font-mono text-[9px] text-slate-600" title={item.key}>{item.key}</span>
                          <span className="shrink-0 text-[9px] text-slate-400">{item.lastvalue_bytes.toLocaleString()} / {(item.text_limit_bytes || 65536).toLocaleString()} 字节 · {item.records} 条 → {item.normalized} 条</span>
                        </div>
                        {item.looks_truncated ? <p className="mt-1 text-[9px] text-amber-700">已达到 Zabbix Text 监控项 64KB 上限，JSON 不完整，API 无法恢复被截断的字节。</p> : null}
                        {item.records === 0 && host.software_item_count > 1 && /\^\[[A-Z]+\]/.test(item.key) ? <p className="mt-1 text-[9px] text-amber-700">该监控项未返回数据；Linux 包名通常为小写，`^[L]` 区分大小写，建议改为 `^[lL]` 或 `^[l]`。</p> : null}
                        {item.empty_names ? <p className="mt-1 text-[9px] text-rose-600">{item.empty_names} 条记录缺少软件名称。</p> : null}
                        {item.sample.length ? <p className="mt-1 truncate text-[9px] text-slate-400">示例：{item.sample.join('、')}</p> : null}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : <EmptyState title="暂无诊断数据" description="请先选择 Zabbix 集成并重试诊断。" icon={FileJson} className="py-10" />}
      </Modal>

      <ConfirmDialog
        open={Boolean(hostMappingDelete)}
        onClose={() => setHostMappingDelete(null)}
        onConfirm={deleteHostMapping}
        loading={hostMappingDeleting}
        danger
        title="删除类型映射"
        confirmText="确认删除"
        description={<>确定删除 <code className="rounded bg-slate-100 px-1 py-0.5 font-mono text-[11px]">{hostMappingDelete?.zabbix_value}</code> 到「{hostMappingDelete?.ci_type_name}」的映射吗？删除后该值将回退到内置识别规则。</>}
      />

      <ConfirmDialog
        open={Boolean(confirmAction)}
        onClose={() => setConfirmAction(null)}
        onConfirm={runConfirm}
        loading={confirmLoading}
        danger
        title={confirmAction === 'delete' ? '删除 Zabbix 集成' : '重置 Webhook 密钥'}
        confirmText={confirmAction === 'delete' ? '确认删除' : '确认重置'}
        description={
          confirmAction === 'delete'
            ? '删除后该集成将无法接收告警，历史事件仍会保留。确定要删除吗？'
            : '重置后旧密钥将立即失效，标准 Webhook 地址保持不变；请同步更新 Zabbix 媒体类型中的密钥。'
        }
      />
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="px-4 py-3.5">
      <p className="text-[9px] text-slate-400">{label}</p>
      <p className="mt-0.5 truncate text-[12.5px] font-semibold text-slate-700">{value}</p>
    </div>
  );
}

function DiagnosticMetric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-slate-100 bg-slate-50/60 px-3 py-2.5">
      <p className="text-[9px] text-slate-400">{label}</p>
      <p className="mt-0.5 text-[16px] font-semibold text-slate-700">{value}</p>
    </div>
  );
}

function MiniSetting({ label, value, icon: Icon }: { label: string; value: string; icon: any }) {
  return (
    <div className="flex items-center gap-2.5 rounded-xl border border-slate-100 bg-slate-50/60 px-3 py-2">
      <Icon className="h-3.5 w-3.5 text-slate-400" />
      <div><p className="text-[8.5px] text-slate-400">{label}</p><p className="text-[10.5px] font-medium text-slate-600">{value}</p></div>
    </div>
  );
}

function MiniToggle({ label, enabled }: { label: string; enabled: boolean }) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-slate-100 px-2.5 py-2">
      <span className={cn('flex h-4 w-4 items-center justify-center rounded-full', enabled ? 'bg-emerald-100 text-emerald-600' : 'bg-slate-100 text-slate-400')}>
        {enabled ? <CheckCircle2 className="h-2.5 w-2.5" /> : <X className="h-2.5 w-2.5" />}
      </span>
      <span className="text-[9.5px] text-slate-500">{label}</span>
    </div>
  );
}

function InfoBlock({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <p className="text-[9px] font-medium uppercase tracking-wider text-slate-400">{label}</p>
      <p className={cn('mt-1 text-[11px] text-slate-600', mono && 'font-mono')}>{value}</p>
    </div>
  );
}
