import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import {
  Activity,
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  Cable,
  CalendarDays,
  CircleDollarSign,
  Clock3,
  Copy,
  ExternalLink,
  GitPullRequest,
  History,
  Link2,
  MapPin,
  Network,
  Package,
  Pencil,
  Plus,
  RefreshCw,
  Server,
  ShieldCheck,
  Trash2,
  UserRound,
  Wrench,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { RichTextContent } from '@/components/RichText';
import { usePageTitle } from '@/lib/hooks';
import { usePageSize } from '@/lib/pageSize';
import { useAuth } from '@/context/AuthContext';
import {
  CI_STATUS_META,
  CRITICALITY_META,
  ENVIRONMENT_META,
  RELATION_LABELS,
  TICKET_STATUS_META,
  TICKET_TYPE_META,
  cn,
  formatCurrency,
  formatDate,
  relativeTime,
} from '@/lib/utils';
import type { CI, CINetworkPort, CIRelation, CIRelationType } from '@/lib/types';
import {
  Avatar,
  Badge,
  Button,
  ConfirmDialog,
  EmptyState,
  Field,
  IconButton,
  InfoGrid,
  Input,
  Modal,
  PageHeader,
  PageSizeSelect,
  Pagination,
  SearchInput,
  SectionHeading,
  Skeleton,
  Spinner,
} from '@/components/ui';
import { DynamicIcon } from '@/components/DynamicIcon';
import { basicFieldVisible } from '@/lib/ciBasicFields';
import {
  findRelationRule,
  getRelationRules,
  relationTargetMatchesRule,
  relationTypeMatchesRule,
} from '@/lib/ciRelations';

const PORT_TYPE_LABELS: Record<string, string> = {
  ethernet: '以太网',
  fiber: '光纤',
  rj45: 'RJ45',
  sfp: 'SFP',
  sfp_plus: 'SFP+',
  bmc: 'BMC / 带外',
  management: '管理口',
  console: 'Console',
  power: '电源',
};

type SoftwareInventoryRow = {
  id: number;
  asset_no: string;
  name: string;
  status?: string;
  version: string;
  source: 'zabbix' | 'manual';
  relation_id?: number;
};

type SoftwareFilterState = {
  query: string;
  source: 'all' | 'zabbix' | 'manual';
  page: number;
  pageSize: number;
};

function readSoftwareFilters(id?: string): SoftwareFilterState {
  const fallback: SoftwareFilterState = { query: '', source: 'all', page: 1, pageSize: 20 };
  if (!id) return fallback;
  try {
    const raw = sessionStorage.getItem(`nextitops_ci_software:${id}`);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    return {
      query: typeof parsed.query === 'string' ? parsed.query : '',
      source: ['all', 'zabbix', 'manual'].includes(parsed.source) ? parsed.source : 'all',
      page: Number(parsed.page) > 0 ? Number(parsed.page) : 1,
      pageSize: Number(parsed.pageSize) > 0 ? Number(parsed.pageSize) : 20,
    };
  } catch {
    return fallback;
  }
}

function ciRefDisplay(value: unknown, references?: Record<string, { name?: string }>): string {
  if (Array.isArray(value)) {
    return value.map((item) => ciRefDisplay(item, references)).filter((item) => item !== '—').join('、') || '—';
  }
  if (value === null || value === undefined || value === '') return '—';
  const reference = references?.[String(value)];
  return reference?.name || `已失效引用 #${value}`;
}

export default function CIDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { can } = useAuth();
  const [ci, setCi] = useState<CI | null>(null);
  const [loading, setLoading] = useState(true);
  const [relationOpen, setRelationOpen] = useState(false);
  const [relationTargets, setRelationTargets] = useState<string[]>([]);
  const [relationType, setRelationType] = useState('depends_on');
  const [relationDescription, setRelationDescription] = useState('');
  const [relationSearch, setRelationSearch] = useState('');
  const [relationOptions, setRelationOptions] = useState<CI[]>([]);
  const [savingRelation, setSavingRelation] = useState(false);
  const [deleteRelation, setDeleteRelation] = useState<CIRelation | null>(null);
  const [selectedRelations, setSelectedRelations] = useState<number[]>([]);
  const [bulkRelationOpen, setBulkRelationOpen] = useState(false);
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [relationTypes, setRelationTypes] = useState<CIRelationType[]>([]);
  const [switchOptions, setSwitchOptions] = useState<CI[]>([]);
  const [changesOpen, setChangesOpen] = useState(false);
  const [changes, setChanges] = useState<any[]>([]);
  const [accessOpen, setAccessOpen] = useState(false);
  const [accessData, setAccessData] = useState<any>(null);
  const [accessManager, setAccessManager] = useState('');
  const [accessGrants, setAccessGrants] = useState<Set<number>>(new Set());
  const [accessEditGrants, setAccessEditGrants] = useState<Set<number>>(new Set());
  const [accessSaving, setAccessSaving] = useState(false);
  const [cloneOpen, setCloneOpen] = useState(false);
  const [cloneSaving, setCloneSaving] = useState(false);
  const [cloneForm, setCloneForm] = useState({ asset_no: '', name: '' });

  const [softwarePage, setSoftwarePage] = useState(() => readSoftwareFilters(id).page);
  const [softwarePageSize, setSoftwarePageSize] = usePageSize('ci-software');
  const [softwareQuery, setSoftwareQuery] = useState(() => readSoftwareFilters(id).query);
  const [softwareSource, setSoftwareSource] = useState<'all' | 'zabbix' | 'manual'>(() => readSoftwareFilters(id).source);
  const [softwareData, setSoftwareData] = useState<SoftwareInventoryRow[]>([]);
  const [softwareTotal, setSoftwareTotal] = useState(0);
  const [softwareLoading, setSoftwareLoading] = useState(false);
  const softwareFilterId = useRef(id);
  const restoringSoftwareFilters = useRef(false);

  const [portOpen, setPortOpen] = useState(false);
  const [editingPort, setEditingPort] = useState<CINetworkPort | null>(null);
  const [portForm, setPortForm] = useState<Record<string, any>>({});
  const [savingPort, setSavingPort] = useState(false);
  const [deletePortTarget, setDeletePortTarget] = useState<CINetworkPort | null>(null);
  const [deletingPort, setDeletingPort] = useState(false);

  usePageTitle(ci ? `${ci.asset_no} · ${ci.name}` : '资产详情');

  const load = async () => {
    setLoading(true);
    try {
      const response = await api.get<{ data: CI }>(`/api/cis/${id}`);
      setCi(response.data);
    } catch (error: any) {
      toast.error(error.message);
      navigate('/cmdb', { replace: true });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [id]);

  useEffect(() => {
    const saved = readSoftwareFilters(id);
    restoringSoftwareFilters.current = true;
    setSoftwareQuery(saved.query);
    setSoftwareSource(saved.source);
    setSoftwarePage(saved.page);
    setSoftwarePageSize(saved.pageSize);
    const timer = window.setTimeout(() => { restoringSoftwareFilters.current = false; }, 0);
    return () => window.clearTimeout(timer);
  }, [id, setSoftwarePageSize]);

  useEffect(() => {
    if (!id || restoringSoftwareFilters.current) return;
    try {
      sessionStorage.setItem(`nextitops_ci_software:${id}`, JSON.stringify({
        query: softwareQuery,
        source: softwareSource,
        page: softwarePage,
        pageSize: softwarePageSize,
      }));
    } catch {
      // Ignore storage quota/private-mode failures; filtering still works.
    }
  }, [id, softwarePage, softwarePageSize, softwareQuery, softwareSource]);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      setSoftwareLoading(true);
      try {
        const params = new URLSearchParams({
          page: String(softwarePage),
          pageSize: String(softwarePageSize),
          source: softwareSource,
        });
        if (softwareQuery.trim()) params.set('q', softwareQuery.trim());
        const response = await api.get<{
          data: SoftwareInventoryRow[];
          pagination: { page: number; pageSize: number; total: number };
        }>(`/api/cis/${id}/software?${params.toString()}`);
        if (!cancelled) {
          setSoftwareData(response.data || []);
          setSoftwareTotal(response.pagination?.total || 0);
        }
      } catch (error: any) {
        if (!cancelled) toast.error(error.message);
      } finally {
        if (!cancelled) setSoftwareLoading(false);
      }
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [id, softwarePage, softwarePageSize, softwareQuery, softwareSource]);

  useEffect(() => {
    api.get<{ data: CIRelationType[] }>('/api/ci-relation-types?enabled=true').then((response) => setRelationTypes(response.data)).catch(() => {});
    api.get<{ data: CI[] }>('/api/cis/options?limit=500&types=network,patch_panel,security,server,storage,industrial').then((response) => setSwitchOptions(response.data)).catch(() => {});
  }, []);

  useEffect(() => {
    if (!relationOpen) return;
    const targetTypes = findRelationRule(getRelationRules(ci?.type_code), relationType)?.targets || [];
    const typeQuery = targetTypes.length ? `&types=${encodeURIComponent(targetTypes.join(','))}` : '';
    let cancelled = false;
    const timer = setTimeout(() => {
      api
        .get<{ data: CI[] }>(`/api/cis/options?q=${encodeURIComponent(relationSearch)}&limit=500${typeQuery}`)
        .then((response) => {
          if (!cancelled) setRelationOptions(response.data.filter((item) => item.id !== ci?.id));
        })
        .catch(() => {});
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [relationSearch, relationOpen, ci?.id, ci?.type_code, relationType]);

  const fieldsByGroup = useMemo(() => {
    if (!ci?.fields) return {};
    return ci.fields.reduce<Record<string, typeof ci.fields>>((groups, field) => {
      const group = field.group_name || '扩展属性';
      groups[group] = groups[group] || [];
      groups[group].push(field);
      return groups;
    }, {});
  }, [ci]);

  const warranties = useMemo(() => {
    if (!ci?.warranty_end) return null;
    const days = Math.ceil((new Date(ci.warranty_end).getTime() - Date.now()) / 86400000);
    if (days < 0) return { label: `已过保 ${Math.abs(days)} 天`, tone: 'text-rose-600 bg-rose-50' };
    if (days < 90) return { label: `${days} 天后到期`, tone: 'text-amber-700 bg-amber-50' };
    return { label: `${days} 天后到期`, tone: 'text-emerald-700 bg-emerald-50' };
  }, [ci?.warranty_end]);
  const relationRules = getRelationRules(ci?.type_code);

  useEffect(() => {
    if (!relationOpen || !relationRules?.length) return;
    if (!relationRules.some((rule) => rule.code === relationType)) setRelationType(relationRules[0].code);
  }, [relationOpen, relationType, ci?.type_code, relationTypes.length]);

  const submitRelation = async () => {
    if (!relationTargets.length) return toast.error('请选择要关联的 CI');
    const rule = findRelationRule(relationRules, relationType);
    if (!rule) return toast.error('当前 CI 类型不支持该关系');
    setSavingRelation(true);
    try {
      for (const target of relationTargets) {
        const payload = {
          target_ci_id: Number(rule.reverse ? id : target),
          relation_type: relationType,
          description: relationDescription,
        };
        await api.post(`/api/cis/${rule.reverse ? target : id}/relations`, payload);
      }
      toast.success(`已建立 ${relationTargets.length} 条 CI 关系`);
      setRelationOpen(false);
      setRelationTargets([]);
      setRelationSearch('');
      setRelationDescription('');
      await load();
    } catch (error: any) {
      toast.error(error.message);
    } finally {
      setSavingRelation(false);
    }
  };

  const confirmDeleteRelation = async () => {
    if (!deleteRelation) return;
    setDeleting(true);
    try {
      await api.delete(`/api/cis/${id}/relations/${deleteRelation.id}`);
      toast.success('关系已移除');
      setDeleteRelation(null);
      await load();
    } catch (error: any) {
      toast.error(error.message);
    } finally {
      setDeleting(false);
    }
  };

  const confirmBulkDeleteRelations = async () => {
    if (!selectedRelations.length) return;
    setBulkDeleting(true);
    try {
      for (const relationId of selectedRelations) await api.delete(`/api/cis/${id}/relations/${relationId}`);
      toast.success(`已移除 ${selectedRelations.length} 条关系`);
      setSelectedRelations([]);
      setBulkRelationOpen(false);
      await load();
    } catch (error: any) {
      toast.error(error.message);
    } finally {
      setBulkDeleting(false);
    }
  };

  const openPortModal = (port?: CINetworkPort) => {
    setEditingPort(port || null);
    setPortForm({
      port_name: port?.port_name || '',
      port_type: port?.port_type || (ci?.type_code === 'patch_panel' ? 'rj45' : 'ethernet'),
      mac_address: port?.mac_address || '',
      speed_mbps: port?.speed_mbps || 10000,
      current_speed_mbps: port?.current_speed_mbps || 10000,
      connected_switch_id: port?.connected_switch_id || '',
      connected_switch_port: port?.connected_switch_port || '',
      link_status: port?.link_status || 'up',
      notes: port?.notes || '',
    });
    setPortOpen(true);
  };

  const savePort = async () => {
    if (!portForm.port_name?.trim()) return toast.error('请填写端口名称');
    setSavingPort(true);
    try {
      const payload = {
        ...portForm,
        speed_mbps: Number(portForm.speed_mbps || 0),
        current_speed_mbps: Number(portForm.current_speed_mbps || 0),
        connected_switch_id: portForm.connected_switch_id ? Number(portForm.connected_switch_id) : null,
      };
      if (editingPort) await api.put(`/api/cis/${id}/ports/${editingPort.id}`, payload);
      else await api.post(`/api/cis/${id}/ports`, payload);
      toast.success(editingPort ? '端口已更新' : '端口已添加');
      setPortOpen(false);
      await load();
    } catch (error: any) {
      toast.error(error.message);
    } finally {
      setSavingPort(false);
    }
  };

  const confirmDeletePort = async () => {
    if (!deletePortTarget) return;
    setDeletingPort(true);
    try {
      await api.delete(`/api/cis/${id}/ports/${deletePortTarget.id}`);
      toast.success('端口已删除');
      setDeletePortTarget(null);
      await load();
    } catch (error: any) {
      toast.error(error.message);
    } finally {
      setDeletingPort(false);
    }
  };

  if (loading || !ci) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-48" />
        <div className="card p-6"><Skeleton className="h-28 w-full" /></div>
        <div className="grid gap-4 lg:grid-cols-3"><Skeleton className="h-72 lg:col-span-2" /><Skeleton className="h-72" /></div>
      </div>
    );
  }

  const status = CI_STATUS_META[ci.status] || CI_STATUS_META.idle;
  const level = CRITICALITY_META[ci.criticality] || CRITICALITY_META.medium;
  const environment = ENVIRONMENT_META[ci.environment] || ENVIRONMENT_META.production;
  const allRelations = [...(ci.relations || []), ...(ci.incoming_relations || [])];
  const compatibleRelationTypes = relationTypes.filter((type) => relationTypeMatchesRule(type, findRelationRule(relationRules, type.code), ci.ci_type_id));
  const selectedRelationType = relationTypes.find((type) => type.code === relationType);
  const selectedRule = findRelationRule(relationRules, relationType);
  const compatibleTargetOptions = relationOptions.filter((item) => relationTargetMatchesRule(selectedRule, selectedRelationType, item.ci_type_id, item.type_code));
  const showNetworkSection = Boolean(ci.bmc_address || ci.ports?.length || ['server', 'network', 'security'].includes(ci.type_code || ''));

  return (
    <div className="animate-enter">
      <button onClick={() => {
        const listState = location.state as { listType?: string } | null;
        const backType = listState?.listType !== undefined ? listState.listType : (ci.type_code || '');
        navigate(`/cmdb${backType ? `?type=${encodeURIComponent(backType)}` : ''}`, { state: { restoreList: true } });
      }} className="mb-3 flex items-center gap-1.5 text-[11.5px] font-medium text-slate-500 hover:text-slate-800">
        <ArrowLeft className="h-3.5 w-3.5" /> 返回资产列表
      </button>

      <div className="card relative overflow-hidden">
        <div className="relative flex flex-col gap-4 p-5 sm:flex-row sm:items-start sm:justify-between sm:p-6">
          <div className="flex items-start gap-4">
            <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-lg text-white" style={{ background: ci.type_color || '#2c68ff' }}>
              <DynamicIcon name={ci.type_icon} className="h-7 w-7" />
            </span>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-[22px] font-semibold tracking-[-0.02em] text-slate-900">{ci.name}</h1>
                <Badge className={status.className} dot={status.dot}>{status.label}</Badge>
                <Badge className={level.className}>{level.label}</Badge>
                <Badge className={environment.className}>{environment.label}</Badge>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11px] text-slate-500">
                <span className="font-mono font-medium text-slate-600">{ci.asset_no}</span>
                <span className="flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full" style={{ background: ci.type_color }} />{ci.type_name}</span>
                {ci.ip_address && basicFieldVisible(ci.type_code, 'ip_address') ? <span className="font-mono">{ci.ip_address}</span> : null}
                {basicFieldVisible(ci.type_code, 'location') ? <span className="flex items-center gap-1"><MapPin className="h-3 w-3 text-slate-400" />{ci.location || '未设置位置'}</span> : null}
                <span className="flex items-center gap-1"><Clock3 className="h-3 w-3 text-slate-400" />更新于 {relativeTime(ci.updated_at)}</span>
              </div>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Button variant="ghost" size="sm" icon={ShieldCheck} onClick={async () => {
              const response = await api.get<{ data: any }>(`/api/cis/${id}/access`);
              setAccessData(response.data);
              setAccessManager(String(response.data.asset_manager_id || ''));
              setAccessGrants(new Set((response.data.acl || []).map((item: any) => item.user_id)));
              setAccessEditGrants(new Set((response.data.acl || []).filter((item: any) => item.can_edit).map((item: any) => item.user_id)));
              setAccessOpen(true);
            }}>资产授权</Button>
            <Button variant="ghost" size="sm" icon={History} onClick={async () => {
              if (!changesOpen && !changes.length) {
                const response = await api.get<{ data: any[] }>(`/api/cis/${id}/changes`);
                setChanges(response.data || []);
              }
              setChangesOpen((value) => !value);
            }}>{changesOpen ? '收起变更记录' : '变更记录'}</Button>
            {can('cmdb.edit') ? (
              <Button variant="ghost" size="sm" icon={Copy} onClick={() => { setCloneForm({ asset_no: `${ci.asset_no}-COPY`, name: `${ci.name} 副本` }); setCloneOpen(true); }}>克隆</Button>
            ) : null}
            {can('cmdb.edit') ? (
              <Button variant="secondary" size="sm" icon={Pencil} onClick={() => navigate(`/cmdb?type=${ci.type_code}&edit=${ci.id}`)}>编辑资产</Button>
            ) : null}
            {can('cmdb.edit') ? (
              <Button size="sm" icon={Link2} onClick={() => setRelationOpen(true)}>添加关系</Button>
            ) : null}
          </div>
        </div>
        <div className="grid grid-cols-2 divide-x divide-y divide-[#eef1f6] border-t border-[#eef1f6] sm:grid-cols-4 sm:divide-y-0">
          {basicFieldVisible(ci.type_code, 'owner_id') ? <SummaryCell label="负责人" value={ci.owner_name || '未分配'} sub={ci.department || '—'} icon={UserRound} /> : null}
          {basicFieldVisible(ci.type_code, 'ip_address') ? <SummaryCell label="业务地址" value={ci.ip_address || '—'} sub={ci.bmc_address ? `BMC ${ci.bmc_address}` : ci.mac_address || '未录入 MAC'} icon={Server} mono /> : null}
          {basicFieldVisible(ci.type_code, 'warranty_end') ? <SummaryCell label="保修状态" value={warranties?.label || '未录入'} sub={ci.warranty_end ? formatDate(ci.warranty_end, 'YYYY/MM/DD') : '—'} icon={ShieldCheck} valueClass={warranties?.tone.split(' ')[0]} /> : null}
          {basicFieldVisible(ci.type_code, 'cost') ? <SummaryCell label="资产价值" value={formatCurrency(ci.cost)} sub={`采购 ${formatDate(ci.purchase_date, 'YYYY/MM/DD')}`} icon={CircleDollarSign} /> : null}
        </div>
      </div>

      {changesOpen ? (
        <div className="mb-3.5 card overflow-hidden">
          <SectionHeading title="变更记录" description="默认隐藏，仅展示资产字段的实际变化" />
          <div className="max-h-[320px] overflow-y-auto divide-y divide-slate-100">
            {changes.length ? changes.map((change) => (
              <div key={change.id} className="px-5 py-3">
                <div className="flex flex-wrap items-center gap-2 text-[10px] text-slate-400">
                  <span className="rounded bg-slate-100 px-1.5 py-0.5 font-medium text-slate-600">{change.source === 'change_ticket' ? '变更流程' : '手工修改'}</span>
                  <span>{change.actor_name || '系统'}</span>
                  <span>· {formatDate(change.created_at)}</span>
                  {change.ticket_no ? <Link to={`/tickets/change/${change.ticket_id}`} className="font-medium text-brand-600 hover:text-brand-700">{change.ticket_no} · {change.ticket_title}</Link> : null}
                </div>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {Object.entries(change.changes || {}).map(([key, value]: [string, any]) => (
                    <span key={key} className="rounded-md bg-slate-50 px-2 py-1 text-[9.5px] text-slate-500">{key}: {String(value.from ?? '—')} → {String(value.to ?? '—')}</span>
                  ))}
                </div>
              </div>
            )) : <p className="px-5 py-8 text-center text-[10.5px] text-slate-400">暂无变更记录。</p>}
          </div>
        </div>
      ) : null}

      <div className="mt-3.5 grid grid-cols-1 gap-3.5 xl:grid-cols-12">
        <div className="space-y-3.5 xl:col-span-8">
          <div className="card overflow-hidden">
            <SectionHeading title="技术配置" description="设备与配置项的核心技术参数" />
            <div className="p-5">
              <InfoGrid
                columns={3}
                items={[
                  { key: 'vendor', label: '厂商', value: ci.vendor },
                  { key: 'model', label: '型号', value: ci.model },
                  { key: 'serial_no', label: '序列号', value: <span className="font-mono text-[12px]">{ci.serial_no || '—'}</span> },
                  { key: 'os_name', label: '操作系统', value: ci.os_name },
                  { key: 'cpu', label: 'CPU', value: ci.cpu },
                  { key: 'memory', label: '内存', value: ci.memory },
                  { key: 'disk', label: '磁盘', value: ci.disk },
                  { key: 'bmc_address', label: 'BMC 管理地址', value: <span className="font-mono text-[12px]">{ci.bmc_address || '—'}</span> },
                  { key: 'environment', label: '环境', value: environment.label },
                  { key: 'location', label: '位置', value: ci.location },
                ].filter((item) => basicFieldVisible(ci.type_code, item.key))}
              />
            </div>
          </div>

          {showNetworkSection ? (
            <div className="card overflow-hidden">
              <SectionHeading
                title="网络与带外管理"
                description="业务地址、BMC 管理地址与服务器 / 网络设备端口链路"
                action={can('cmdb.edit') ? <Button variant="ghost" size="xs" icon={Plus} onClick={() => openPortModal()}>添加端口</Button> : null}
              />
              <div className="grid grid-cols-1 gap-3 border-b border-slate-100 p-5 sm:grid-cols-3">
                {basicFieldVisible(ci.type_code, 'ip_address') ? <div className="rounded-xl border border-slate-100 bg-slate-50/60 px-3 py-2.5">
                  <p className="text-[9px] text-slate-400">业务地址</p>
                  <p className="mt-1 font-mono text-[12px] font-medium text-slate-700">{ci.ip_address || '—'}</p>
                </div> : null}
                <div className="rounded-xl border border-amber-100 bg-amber-50/50 px-3 py-2.5">
                  <p className="text-[9px] text-amber-600">BMC / 带外管理</p>
                  <p className="mt-1 font-mono text-[12px] font-medium text-amber-800">{ci.bmc_address || '未配置'}</p>
                </div>
                <div className="rounded-xl border border-slate-100 bg-slate-50/60 px-3 py-2.5">
                  <p className="text-[9px] text-slate-400">端口数量</p>
                  <p className="mt-1 text-[12px] font-medium text-slate-700">{ci.ports?.length || 0} 个 · {ci.ports?.filter((port) => port.link_status === 'up').length || 0} 个在线</p>
                </div>
              </div>
              {ci.ports?.length ? (
                <div className="table-wrap">
                  <table className="data-table">
                    <thead><tr><th>端口</th><th>速率 / 当前</th><th>链路</th><th>对端设备 / 端口</th><th>数据来源</th><th>最近同步</th><th className="text-right">操作</th></tr></thead>
                    <tbody>
                      {ci.ports.map((port) => {
                        const linkMeta = port.link_status === 'up'
                          ? { label: 'UP', className: 'bg-emerald-50 text-emerald-700 ring-emerald-600/15', dot: 'bg-emerald-500' }
                          : port.link_status === 'down'
                            ? { label: 'DOWN', className: 'bg-rose-50 text-rose-700 ring-rose-600/15', dot: 'bg-rose-500' }
                            : { label: '未知', className: 'bg-slate-100 text-slate-500 ring-slate-500/10', dot: 'bg-slate-400' };
                        return (
                          <tr key={port.id} className="group">
                            <td>
                              <div className="flex items-center gap-2">
                                <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-brand-50 text-brand-600"><Cable className="h-3.5 w-3.5" /></span>
                                <div><p className="font-mono text-[11px] font-medium text-slate-700">{port.port_name}</p><p className="text-[9px] text-slate-400">{PORT_TYPE_LABELS[port.port_type] || port.port_type}{port.mac_address ? ` · ${port.mac_address}` : ''}</p></div>
                              </div>
                            </td>
                            <td><p className="text-[10.5px] text-slate-600">{formatSpeed(port.speed_mbps)} / {formatSpeed(port.current_speed_mbps)}</p><p className="text-[9px] text-slate-400">协商 / 当前</p></td>
                            <td><Badge className={linkMeta.className} dot={linkMeta.dot}>{linkMeta.label}</Badge></td>
                            <td>
                              {port.connected_switch_id ? (
                                <Link to={`/cmdb/${port.connected_switch_id}`} className="text-[10.5px] font-medium text-brand-600 hover:text-brand-700">{port.switch_asset_no || port.switch_name}</Link>
                              ) : <span className="text-[10px] text-slate-300">未连接</span>}
                              <p className="mt-0.5 font-mono text-[9px] text-slate-400">{port.connected_switch_port || '—'}</p>
                            </td>
                            <td><Badge className={port.source === 'zabbix' || port.source === 'zabbix-agent' ? 'bg-orange-50 text-orange-700 ring-orange-600/15' : 'bg-slate-100 text-slate-600 ring-slate-500/10'}>{port.source === 'zabbix-agent' ? 'Zabbix Agent' : port.source === 'zabbix' ? 'Zabbix SNMP' : '手工维护'}</Badge></td>
                            <td className="whitespace-nowrap text-[9.5px] text-slate-400">{port.last_synced_at ? relativeTime(port.last_synced_at) : '—'}</td>
                            <td>
                              {can('cmdb.edit') ? (
                                <div className="flex items-center justify-end gap-0.5 opacity-0 transition group-hover:opacity-100">
                                  <IconButton icon={Pencil} label="编辑端口" onClick={() => openPortModal(port)} />
                                  <IconButton icon={Trash2} label="删除端口" variant="danger" onClick={() => setDeletePortTarget(port)} />
                                </div>
                              ) : null}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center px-5 py-9 text-center">
                  <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-50 text-slate-400"><Network className="h-4.5 w-4.5" /></span>
                  <p className="mt-2 text-[11px] font-medium text-slate-600">尚未录入端口链路</p>
                  <p className="mt-1 max-w-md text-[9.5px] leading-relaxed text-slate-400">可手工添加服务器、配线架、网络与安全设备端口的连接关系，或通过 Zabbix SNMP 端口 Webhook 自动同步速率、链路状态和连接信息。</p>
                </div>
              )}
            </div>
          ) : null}

          {Object.keys(fieldsByGroup).length ? (
            <div className="card overflow-hidden">
              <SectionHeading title="扩展属性" description="由 CMDB 模型动态定义的字段" />
              <div className="divide-y divide-slate-100">
                {Object.entries(fieldsByGroup).map(([group, fields]) => (
                  <div key={group} className="p-5">
                    <p className="mb-3 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-400">{group}</p>
                    <InfoGrid
                      columns={3}
                      items={(fields || []).map((field) => ({
                        label: field.label,
                        value: field.field_type === 'ci_ref'
                          ? ciRefDisplay(ci.attributes?.[field.field_key], ci.reference_values)
                          : Array.isArray(ci.attributes?.[field.field_key])
                            ? ci.attributes[field.field_key].join('、')
                            : ci.attributes?.[field.field_key] || '—',
                      }))}
                    />
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {['server', 'vm'].includes(ci.type_code || '') ? (
            <div className="card overflow-hidden">
              <SectionHeading
                title="已安装软件"
                description="从Zabbix Agent自动获取的软件清单将同步后自动关联当前资产，人工维护的软件需自行创建CI关系"
                action={<Badge className="bg-orange-50 text-orange-700 ring-orange-600/15">{softwareTotal} 个</Badge>}
              />
              <div className="flex flex-wrap items-center gap-2 border-b border-[#eef1f6] px-4 py-3">
                <SearchInput
                  value={softwareQuery}
                  onChange={(value) => { setSoftwareQuery(value); setSoftwarePage(1); }}
                  placeholder="搜索软件名称或资产编号..."
                  className="min-w-[220px] flex-1"
                />
                <select
                  value={softwareSource}
                  onChange={(event) => {
                    setSoftwareSource(event.target.value as 'all' | 'zabbix' | 'manual');
                    setSoftwarePage(1);
                  }}
                  aria-label="筛选软件来源"
                  className="h-9 rounded-lg border border-slate-200 bg-white px-2.5 text-[11px] text-slate-600 outline-none focus:border-brand-400"
                >
                  <option value="all">全部来源</option>
                  <option value="zabbix">Zabbix Agent</option>
                  <option value="manual">人工创建</option>
                </select>
                <PageSizeSelect
                  value={softwarePageSize}
                  onChange={(size) => { setSoftwarePageSize(size); setSoftwarePage(1); }}
                />
              </div>
              {softwareLoading ? (
                <div className="flex items-center justify-center gap-2 py-10 text-[11px] text-slate-400">
                  <Spinner className="h-4 w-4" /> 正在加载软件清单...
                </div>
              ) : softwareData.length ? (
                <>
                  <div className="divide-y divide-[#f0f2f7]">
                    {softwareData.map((software) => (
                      <Link key={`${software.id}-${software.relation_id || 0}`} to={`/cmdb/${software.id}`} className="group flex items-center gap-3 px-5 py-2.5 transition hover:bg-[#fafbff]">
                        <span className={cn(
                          'flex h-7 w-7 shrink-0 items-center justify-center rounded-lg',
                          software.source === 'zabbix' ? 'bg-orange-50 text-orange-600' : 'bg-sky-50 text-sky-600',
                        )}><Package className="h-3.5 w-3.5" /></span>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <p className="truncate text-[11.5px] font-medium text-slate-700 group-hover:text-brand-700">{software.name}</p>
                            <Badge className={software.source === 'zabbix'
                              ? 'shrink-0 bg-orange-50 text-orange-700 ring-orange-600/15'
                              : 'shrink-0 bg-sky-50 text-sky-700 ring-sky-600/15'}>
                              {software.source === 'zabbix' ? 'Zabbix Agent' : '人工'}
                            </Badge>
                          </div>
                          <p className="mt-0.5 font-mono text-[9px] text-slate-400">{software.asset_no}</p>
                        </div>
                        <span className="max-w-[35%] truncate rounded-md bg-slate-100 px-2 py-1 font-mono text-[9.5px] text-slate-600">{software.version || '版本未知'}</span>
                        <ArrowRight className="h-3.5 w-3.5 shrink-0 text-slate-300 group-hover:text-brand-500" />
                      </Link>
                    ))}
                  </div>
                  <div className="border-t border-[#eef1f6]">
                    <Pagination
                      page={softwarePage}
                      pageSize={softwarePageSize}
                      total={softwareTotal}
                      onChange={setSoftwarePage}
                    />
                  </div>
                </>
              ) : (
                <EmptyState
                  title={softwareQuery || softwareSource !== 'all' ? '没有匹配的软件' : '尚未关联软件'}
                  description={softwareQuery || softwareSource !== 'all'
                    ? '调整搜索关键词或来源筛选后重试。'
                    : '在 Zabbix 集成中同步资产清单，或手工创建软件 CI 并建立安装关系。'}
                  icon={Package}
                  className="py-10"
                />
              )}
            </div>
          ) : null}

          <div className="card overflow-hidden">
            <SectionHeading
              title="配置项关系"
              description={`共 ${allRelations.length} 条上下游关系`}
              action={can('cmdb.edit') ? <div className="flex items-center gap-1"><button onClick={() => setSelectedRelations(selectedRelations.length === allRelations.length ? [] : allRelations.map((relation) => relation.id))} className="rounded px-1.5 py-1 text-[9.5px] text-slate-500 hover:bg-slate-50">{selectedRelations.length === allRelations.length && allRelations.length ? '取消全选' : '全选'}</button>{selectedRelations.length ? <Button variant="danger" size="xs" icon={Trash2} onClick={() => setBulkRelationOpen(true)}>删除 {selectedRelations.length}</Button> : null}<Button variant="ghost" size="xs" icon={Plus} onClick={() => setRelationOpen(true)}>添加</Button></div> : null}
            />
            {allRelations.length ? (
              <div className="divide-y divide-[#f0f2f7]">
                {allRelations.map((relation) => {
                  const outgoing = relation.direction !== 'incoming';
                  const targetId = outgoing ? relation.target_ci_id : relation.source_ci_id;
                  const name = outgoing ? relation.target_name : relation.source_name;
                  const assetNo = outgoing ? relation.target_asset_no : relation.source_asset_no;
                  const typeName = outgoing ? relation.target_type_name : relation.source_type_name;
                  const typeColor = outgoing ? relation.target_type_color : relation.source_type_color;
                  const relatedStatus = outgoing ? relation.target_status : relation.source_status;
                  const relatedStatusMeta = relatedStatus === 'in_use'
                    ? { label: '使用中', color: '#22c55e' }
                    : relatedStatus === 'offline'
                      ? { label: '已下线', color: '#94a3b8' }
                      : relatedStatus === 'idle'
                        ? { label: '空闲', color: '#f59e0b' }
                        : relatedStatus === 'reserved'
                          ? { label: '预留', color: '#3b82f6' }
                          : { label: '未知', color: typeColor || '#94a3b8' };
                  const currentRuleLabel = findRelationRule(relationRules, relation.relation_type)?.label;
                  return (
                    <div key={`${relation.direction}-${relation.id}`} className="group flex items-center gap-3 px-5 py-3">
                      {can('cmdb.edit') ? <input type="checkbox" checked={selectedRelations.includes(relation.id)} onChange={() => setSelectedRelations((current) => current.includes(relation.id) ? current.filter((item) => item !== relation.id) : [...current, relation.id])} className="h-3.5 w-3.5 rounded border-slate-300" /> : null}
                      <span className={cn('flex h-7 w-7 shrink-0 items-center justify-center rounded-lg', outgoing ? 'bg-brand-50 text-brand-600' : 'bg-violet-50 text-violet-600')}>
                        {outgoing ? <ArrowUpRight className="h-3.5 w-3.5" /> : <Link2 className="h-3.5 w-3.5" />}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <span className="rounded px-1.5 py-0.5 text-[9px] font-medium text-white" style={{ background: relation.relation_type_color || '#64748b' }}>
                            {currentRuleLabel || (outgoing ? relation.relation_forward_label : relation.relation_reverse_label || RELATION_LABELS[relation.relation_type] || relation.relation_type)}
                          </span>
                          <Link to={`/cmdb/${targetId}`} className="truncate text-[12px] font-medium text-slate-700 hover:text-brand-700">{name}</Link>
                        </div>
                        <p className="mt-0.5 font-mono text-[9.5px] text-slate-400">{assetNo} · {typeName}{relation.description ? ` · ${relation.description}` : ''}</p>
                      </div>
                      <span
                        className="h-2 w-2 shrink-0 rounded-full"
                        style={{ background: relatedStatusMeta.color }}
                        title={`关联资产状态：${relatedStatusMeta.label}`}
                        aria-label={`关联资产状态：${relatedStatusMeta.label}`}
                      />
                      <Link to={`/cmdb/${targetId}`} className="opacity-0 transition group-hover:opacity-100"><IconButton icon={ArrowRight} label="打开" /></Link>
                      {can('cmdb.edit') ? (
                        <button onClick={() => setDeleteRelation(relation)} className="rounded-lg p-1.5 text-slate-300 opacity-0 transition hover:bg-rose-50 hover:text-rose-500 group-hover:opacity-100" title="移除关系">
                          <X className="h-3.5 w-3.5" />
                        </button>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            ) : (
              <EmptyState title="尚未建立关系" description="关联上下游 CI，形成业务影响链。" icon={Link2} className="py-10" action={can('cmdb.edit') ? <Button variant="secondary" size="sm" icon={Plus} onClick={() => setRelationOpen(true)}>添加关系</Button> : undefined} />
            )}
          </div>

          <div className="card overflow-hidden">
            <SectionHeading title="关联工单" description="引用该 CI 的事件、问题与变更" />
            {ci.tickets?.length ? (
              <div className="divide-y divide-[#f0f2f7]">
                {ci.tickets.map((ticket: any) => {
                  const typeMeta = TICKET_TYPE_META[ticket.type];
                  const statusMeta = TICKET_STATUS_META[ticket.status];
                  return (
                    <Link key={ticket.id} to={`/tickets/${ticket.type}/${ticket.id}`} className="group flex items-center gap-3 px-5 py-3 transition hover:bg-[#fafbff]">
                      <span className={cn('flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-white', typeMeta?.soft)}>
                        {ticket.type === 'incident' ? <ZapIcon /> : <GitPullRequest className="h-3.5 w-3.5" />}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[11.5px] font-medium text-slate-700 group-hover:text-brand-700">{ticket.title}</p>
                        <p className="mt-0.5 font-mono text-[9.5px] text-slate-400">{ticket.ticket_no}</p>
                      </div>
                      <Badge className={statusMeta?.className} dot={statusMeta?.dot}>{statusMeta?.label}</Badge>
                      <ArrowRight className="h-3.5 w-3.5 text-slate-300 group-hover:text-brand-500" />
                    </Link>
                  );
                })}
              </div>
            ) : (
              <EmptyState title="暂无关联工单" description="当事件或变更关联此 CI 后会显示在这里。" icon={GitPullRequest} className="py-10" />
            )}
          </div>
        </div>

        <div className="space-y-3.5 xl:col-span-4">
          <div className="card overflow-hidden">
            <SectionHeading title="归属信息" />
            <div className="p-5">
              <div className="mb-4 flex items-center gap-3 rounded-xl bg-slate-50 p-3">
                <Avatar name={ci.owner_name || '未分配'} src={ci.owner_avatar_url} size="lg" color="#4f6ef7" />
                <div>
                  <p className="text-[12px] font-semibold text-slate-700">{ci.owner_name || '未分配负责人'}</p>
                  <p className="mt-0.5 text-[10px] text-slate-400">{ci.owner_department || ci.department || '—'}</p>
                </div>
              </div>
              <dl className="space-y-3">
                <DetailLine label="所属部门" value={ci.department || '—'} />
                <DetailLine label="运行环境" value={environment.label} />
                <DetailLine label="位置" value={ci.location || '—'} />
                <DetailLine label="创建时间" value={formatDate(ci.created_at)} />
                <DetailLine label="最近更新" value={formatDate(ci.updated_at)} />
              </dl>
            </div>
          </div>

          {ci.placement ? (
            <div className="card overflow-hidden">
              <SectionHeading title="机柜位置" description="设备上架位置与 U 位占用" action={<Link to={`/cmdb/racks?rack=${ci.placement.rack_id}`} className="text-[10px] font-medium text-brand-600">查看机柜</Link>} />
              <div className="p-5">
                <div className="rounded-xl border border-brand-100 bg-brand-50/60 p-3">
                  <p className="text-[9px] text-brand-700/60">{ci.placement.datacenter_name || '未分配数据中心'}</p>
                  <Link to={`/cmdb/racks?rack=${ci.placement.rack_id}`} className="mt-1 block text-[12px] font-semibold text-brand-900 hover:text-brand-700">{ci.placement.rack_asset_no} · {ci.placement.rack_name}</Link>
                  <p className="mt-1 font-mono text-[11px] font-medium text-brand-700">{ci.placement.start_u}U{ci.placement.u_height > 1 ? `–${ci.placement.start_u + ci.placement.u_height - 1}U` : ''} · {ci.placement.u_height}U</p>
                </div>
              </div>
            </div>
          ) : null}

          <div className="card overflow-hidden">
            <SectionHeading title="生命周期" />
            <div className="p-5">
              <div className="space-y-4">
                <LifecycleItem icon={CalendarDays} label="采购日期" value={formatDate(ci.purchase_date, 'YYYY/MM/DD')} />
                <LifecycleItem icon={ShieldCheck} label="保修到期" value={ci.warranty_end ? formatDate(ci.warranty_end, 'YYYY/MM/DD') : '—'} badge={warranties?.label} tone={warranties?.tone} />
                <LifecycleItem icon={Wrench} label="当前状态" value={status.label} />
                <LifecycleItem icon={CircleDollarSign} label="资产原值" value={formatCurrency(ci.cost)} />
              </div>
            </div>
          </div>

          {ci.description ? (
            <div className="card overflow-hidden">
              <SectionHeading title="资产说明" />
              <div className="p-5 text-[11.5px] leading-6 text-slate-500"><RichTextContent html={ci.description} /></div>
            </div>
          ) : null}

          <div className="card overflow-hidden">
            <SectionHeading title="变更轨迹" description="来自审计日志" />
            {ci.history?.length ? (
              <div className="space-y-3 p-5">
                {ci.history.slice(0, 6).map((item: any) => (
                  <div key={item.id} className="flex gap-2.5">
                    <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-400"><Activity className="h-2.5 w-2.5" /></span>
                    <div>
                      <p className="text-[10.5px] leading-snug text-slate-600">{item.summary}</p>
                      <p className="mt-0.5 text-[9px] text-slate-400">{item.actor_name} · {relativeTime(item.created_at)}</p>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="px-5 py-6 text-[10.5px] text-slate-400">暂无变更记录。</p>
            )}
          </div>
        </div>
      </div>

      <Modal
        open={portOpen}
        onClose={() => setPortOpen(false)}
        title={editingPort ? `编辑端口 · ${editingPort.port_name}` : '添加网络端口'}
        description="维护服务器、配线架、网络与安全设备的端口物理链路。Zabbix SNMP 同步的数据会显示来源并保留最近同步时间。"
        icon={Cable}
        size="md"
        footer={<><Button variant="secondary" size="sm" onClick={() => setPortOpen(false)}>取消</Button><Button size="sm" loading={savingPort} onClick={savePort}>{editingPort ? '保存端口' : '添加端口'}</Button></>}
      >
        <div className="space-y-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="端口名称" required><input className="input-base font-mono" value={portForm.port_name || ''} onChange={(event) => setPortForm((current) => ({ ...current, port_name: event.target.value }))} placeholder="eth0 / GE1/0/1" /></Field>
            <Field label="端口类型">
              <select className="input-base" value={portForm.port_type} onChange={(event) => setPortForm((current) => ({ ...current, port_type: event.target.value }))}>
                <option value="ethernet">以太网</option><option value="fiber">光纤</option><option value="rj45">RJ45</option><option value="sfp">SFP</option><option value="sfp_plus">SFP+</option><option value="bmc">BMC / 带外</option><option value="management">管理口</option><option value="console">Console</option><option value="power">电源</option>
              </select>
            </Field>
            <Field label="MAC 地址"><input className="input-base font-mono" value={portForm.mac_address || ''} onChange={(event) => setPortForm((current) => ({ ...current, mac_address: event.target.value }))} placeholder="00:1A:2B:3C:4D:5E" /></Field>
            <Field label="链路状态">
              <select className="input-base" value={portForm.link_status} onChange={(event) => setPortForm((current) => ({ ...current, link_status: event.target.value }))}>
                <option value="up">UP · 已连通</option><option value="down">DOWN · 中断</option><option value="unknown">未知</option>
              </select>
            </Field>
            <Field label="端口速率 (Mbps)"><input type="number" min="0" className="input-base" value={portForm.speed_mbps} onChange={(event) => setPortForm((current) => ({ ...current, speed_mbps: event.target.value }))} placeholder="10000" /></Field>
            <Field label="当前协商速率 (Mbps)"><input type="number" min="0" className="input-base" value={portForm.current_speed_mbps} onChange={(event) => setPortForm((current) => ({ ...current, current_speed_mbps: event.target.value }))} placeholder="10000" /></Field>
            <Field label="连接设备">
              <select className="input-base" value={portForm.connected_switch_id} onChange={(event) => setPortForm((current) => ({ ...current, connected_switch_id: event.target.value }))}>
                <option value="">未连接 / 未知</option>
                {switchOptions.filter((device) => device.id !== ci?.id).map((device) => <option key={device.id} value={device.id}>{device.asset_no} · {device.name}</option>)}
              </select>
            </Field>
            <Field label="对端设备端口"><input className="input-base font-mono" value={portForm.connected_switch_port || ''} onChange={(event) => setPortForm((current) => ({ ...current, connected_switch_port: event.target.value }))} placeholder="GE1/0/1 / XGE1/0/24" /></Field>
          </div>
          <Field label="备注"><input className="input-base" value={portForm.notes || ''} onChange={(event) => setPortForm((current) => ({ ...current, notes: event.target.value }))} placeholder="链路用途、VLAN 或备注" /></Field>
          <p className="rounded-lg bg-slate-50 px-3 py-2 text-[9.5px] leading-relaxed text-slate-500">如需 Zabbix 自动同步，请通过 Zabbix 集成中的「端口数据 Webhook」推送端口快照，数据会按主机名 / IP 自动匹配到对应 CI。</p>
        </div>
      </Modal>

      <ConfirmDialog
        open={Boolean(deletePortTarget)}
        onClose={() => setDeletePortTarget(null)}
        onConfirm={confirmDeletePort}
        loading={deletingPort}
        title="删除网络端口"
        confirmText="删除端口"
        description={<>确定删除端口「{deletePortTarget?.port_name}」及其链路信息吗？</>}
      />

      <Modal
        open={relationOpen}
        onClose={() => setRelationOpen(false)}
        title="添加 CI 关系"
        description={`建立 ${ci.asset_no} 与其他配置项之间的依赖或归属关系。`}
        icon={Link2}
        size="md"
        footer={
          <>
            <Button variant="secondary" size="sm" onClick={() => setRelationOpen(false)}>取消</Button>
            <Button size="sm" loading={savingRelation} onClick={submitRelation}>建立关系{relationTargets.length ? ` (${relationTargets.length})` : ''}</Button>
          </>
        }
      >
        <div className="space-y-3">
          <Field label="关系类型" hint="按物理连接、操作系统、虚拟化与存储路径推荐；关系仍由「关系模型」统一约束">
            <select className="input-base" value={relationType} onChange={(event) => { setRelationType(event.target.value); setRelationTargets([]); }}>
              {compatibleRelationTypes.map((option) => <option key={option.code} value={option.code}>{findRelationRule(relationRules, option.code)?.label || option.name}</option>)}
            </select>
          </Field>
          <Field label={selectedRule?.reverse ? '源 CI' : '目标 CI'} required hint={selectedRule?.reverse ? '选择该关系的源 CI，可多选；关系将以所选资产为源、当前资产为目标建立' : '可多选：输入名称或资产编号搜索，连续点选多个目标'}>
            <div className="mb-2 flex items-center justify-between">
              <span className="text-[9.5px] text-slate-400">当前匹配 {compatibleTargetOptions.length} 项</span>
              <button type="button" onClick={() => {
                const ids = compatibleTargetOptions.map((option) => String(option.id));
                const allSelected = ids.length > 0 && ids.every((id) => relationTargets.includes(id));
                setRelationTargets(allSelected ? relationTargets.filter((id) => !ids.includes(id)) : [...new Set([...relationTargets, ...ids])]);
              }} className="text-[9.5px] font-medium text-brand-600 hover:text-brand-700">{compatibleTargetOptions.length > 0 && compatibleTargetOptions.every((option) => relationTargets.includes(String(option.id))) ? '取消全选' : '全选当前结果'}</button>
            </div>
            <input className="input-base" value={relationSearch} onChange={(event) => setRelationSearch(event.target.value)} placeholder="搜索配置项…" />
            <div className="custom-scroll mt-2 max-h-52 space-y-1 overflow-y-auto rounded-xl border border-slate-200 p-1">
              {compatibleTargetOptions.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => setRelationTargets((current) => current.includes(String(option.id)) ? current.filter((item) => item !== String(option.id)) : [...current, String(option.id)])}
                  className={cn('flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left transition', relationTargets.includes(String(option.id)) ? 'bg-brand-50 ring-1 ring-brand-200' : 'hover:bg-slate-50')}
                >
                  <span className="h-6 w-6 shrink-0 rounded-md text-white" style={{ background: option.type_color || '#4f6ef7' }} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[11.5px] font-medium text-slate-700">{option.name}</span>
                    <span className="block font-mono text-[9px] text-slate-400">{option.asset_no}</span>
                  </span>
                  {relationTargets.includes(String(option.id)) ? <ShieldCheck className="h-3.5 w-3.5 text-brand-600" /> : null}
                </button>
              ))}
              {!compatibleTargetOptions.length ? <p className="px-3 py-4 text-center text-[10.5px] text-slate-400">没有符合该关系类型的目标 CI</p> : null}
            </div>
          </Field>
          <Field label="关系说明" hint="会显示在 CI 详情和拓扑连线说明中">
            <input className="input-base" value={relationDescription} onChange={(event) => setRelationDescription(event.target.value)} placeholder={selectedRule?.hint || '可选，说明该关系的业务含义'} />
          </Field>
        </div>
      </Modal>

      <ConfirmDialog
        open={Boolean(deleteRelation)}
        onClose={() => setDeleteRelation(null)}
        onConfirm={confirmDeleteRelation}
        loading={deleting}
        title="移除 CI 关系"
        confirmText="移除"
        description="确定要移除该配置项关系吗？不会删除任何 CI 数据。"
      />
      <ConfirmDialog
        open={bulkRelationOpen}
        onClose={() => setBulkRelationOpen(false)}
        onConfirm={confirmBulkDeleteRelations}
        loading={bulkDeleting}
        title="批量移除 CI 关系"
        confirmText="批量移除"
        description={`确定移除选中的 ${selectedRelations.length} 条配置项关系吗？不会删除任何 CI 数据。`}
      />

      <Modal open={cloneOpen} onClose={() => setCloneOpen(false)} title="克隆资产" description="复制当前资产的类型、属性与归属信息；资产编号必须唯一。" icon={Copy} size="sm" footer={<><Button variant="secondary" size="sm" onClick={() => setCloneOpen(false)}>取消</Button><Button size="sm" loading={cloneSaving} onClick={async () => { setCloneSaving(true); try { await api.post<{ data: any }>(`/api/cis/${id}/clone`, cloneForm); toast.success('资产已克隆'); setCloneOpen(false); navigate(`/cmdb?type=${ci.type_code}`); } catch (error: any) { toast.error(error.message); } finally { setCloneSaving(false); } }}>克隆资产</Button></>}>
        <div className="space-y-3">
          <Field label="新资产编号" required><Input value={cloneForm.asset_no} onChange={(event) => setCloneForm((current) => ({ ...current, asset_no: event.target.value }))} className="font-mono text-[11px]" /></Field>
          <Field label="新资产名称" required><Input value={cloneForm.name} onChange={(event) => setCloneForm((current) => ({ ...current, name: event.target.value }))} /></Field>
        </div>
      </Modal>

      <Modal open={accessOpen} onClose={() => setAccessOpen(false)} title="资产授权" description="设置资产管理员，并授权其他用户查看或编辑该资产。" icon={ShieldCheck} size="md" footer={<><Button variant="secondary" size="sm" onClick={() => setAccessOpen(false)}>取消</Button><Button size="sm" loading={accessSaving} onClick={async () => {
        setAccessSaving(true);
        try {
          await api.put(`/api/cis/${id}/access`, {
            asset_manager_id: accessManager ? Number(accessManager) : null,
            grants: [...accessGrants].map((userId) => ({ user_id: userId, can_edit: accessEditGrants.has(userId) })),
          });
          toast.success('资产授权已保存');
          setAccessOpen(false);
        } catch (error: any) { toast.error(error.message); } finally { setAccessSaving(false); }
      }}>保存授权</Button></>}>
        <div className="space-y-3">
          <Field label="资产管理员">
            <select className="input-base" value={accessManager} onChange={(event) => setAccessManager(event.target.value)}>
              <option value="">未指定</option>
              {(accessData?.users || []).map((user: any) => <option key={user.id} value={user.id}>{user.name} · {user.username}</option>)}
            </select>
          </Field>
          <div className="max-h-[320px] space-y-1 overflow-y-auto rounded-xl border border-slate-200 p-2">
            {(accessData?.users || []).filter((user: any) => String(user.id) !== accessManager).map((user: any) => (
              <div key={user.id} className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-slate-50">
                <input type="checkbox" checked={accessGrants.has(user.id)} onChange={(event) => setAccessGrants((current) => { const next = new Set(current); if (event.target.checked) next.add(user.id); else next.delete(user.id); return next; })} />
                <span className="min-w-0 flex-1 text-[10.5px] text-slate-600">{user.name} <span className="text-slate-400">{user.username}</span></span>
                <label className="flex items-center gap-1 text-[9px] text-slate-400"><input type="checkbox" disabled={!accessGrants.has(user.id)} checked={accessEditGrants.has(user.id)} onChange={(event) => setAccessEditGrants((current) => { const next = new Set(current); if (event.target.checked) next.add(user.id); else next.delete(user.id); return next; })} />可编辑</label>
              </div>
            ))}
          </div>
        </div>
      </Modal>
    </div>
  );
}

function formatSpeed(mbps?: number) {
  const value = Number(mbps || 0);
  if (!value) return '—';
  if (value >= 100000) return `${Math.round(value / 1000)}G`;
  if (value >= 1000) return `${(value / 1000).toFixed(value % 1000 === 0 ? 0 : 1)}G`;
  return `${value}M`;
}

function SummaryCell({ label, value, sub, icon: Icon, valueClass, mono }: { label: string; value: string; sub: string; icon: any; valueClass?: string; mono?: boolean }) {
  return (
    <div className="flex items-center gap-3 px-5 py-3.5">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-50 text-slate-400"><Icon className="h-4 w-4" /></span>
      <div className="min-w-0">
        <p className="text-[9.5px] font-medium uppercase tracking-wider text-slate-400">{label}</p>
        <p className={cn('mt-0.5 truncate text-[12px] font-semibold text-slate-700', valueClass, mono && 'font-mono')}>{value}</p>
        <p className="mt-0.5 truncate text-[9px] text-slate-400">{sub}</p>
      </div>
    </div>
  );
}

function DetailLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-3 text-[11px]">
      <dt className="shrink-0 text-slate-400">{label}</dt>
      <dd className="text-right text-slate-600">{value}</dd>
    </div>
  );
}

function LifecycleItem({ icon: Icon, label, value, badge, tone }: { icon: any; label: string; value: string; badge?: string; tone?: string }) {
  return (
    <div className="flex items-start gap-3">
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-slate-50 text-slate-400"><Icon className="h-3.5 w-3.5" /></span>
      <div className="min-w-0 flex-1">
        <p className="text-[9.5px] text-slate-400">{label}</p>
        <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
          <p className="text-[11.5px] font-medium text-slate-700">{value}</p>
          {badge ? <span className={cn('rounded px-1.5 py-0.5 text-[8.5px] font-medium', tone)}>{badge}</span> : null}
        </div>
      </div>
    </div>
  );
}

function ZapIcon() {
  return <Activity className="h-3.5 w-3.5" />;
}
