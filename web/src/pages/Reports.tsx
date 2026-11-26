import { useEffect, useMemo, useState } from 'react';
import {
  ArrowRight, BarChart3, FileSpreadsheet, FolderOpen, Link2, Pencil, Play, Save,
  Sparkles, Trash2, Upload,
} from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { usePageTitle } from '@/lib/hooks';
import { Button, Field, Input, Modal, PageHeader, PageSizeSelect, Pagination, Skeleton } from '@/components/ui';
import { DateTextInput } from '@/components/DateTextInput';
import { cn } from '@/lib/utils';

const OPTION_LABELS: Record<string, string> = {
  in_use: '使用中', idle: '闲置', maintenance: '维护中', retired: '已退役', planned: '规划中', offline: '已下线',
  critical: '紧急', high: '高', medium: '中', low: '低', production: '生产', staging: '预发布', test: '测试', dr: '灾备',
  incident: '事件', problem: '问题', change: '变更', new: '新建', in_progress: '处理中', pending_approval: '待审批', resolved: '已解决', closed: '已关闭', cancelled: '已取消',
};
const optionLabel = (value: string) => OPTION_LABELS[value] || value;

function cellText(row: Record<string, unknown>, column: ReportColumn) {
  const value = row[column.key];
  if (value === null || value === undefined || value === '') return '—';
  const text = String(value);
  return column.type === 'select' ? optionLabel(text) : text;
}

type Mode = 'asset' | 'ticket' | 'related';
type Direction = 'outgoing' | 'incoming';
type OutputMode = 'related' | 'both' | 'seed';

interface ReportField {
  key: string;
  label: string;
  type: string;
  options?: string[];
  ci_type_id?: number;
  show_in_list?: boolean;
}

interface RelationDef {
  code: string;
  name: string;
  reverse_name: string;
  from_type_id: number | null;
  to_type_id: number | null;
  from_type_name?: string | null;
  to_type_name?: string | null;
  from_type_code?: string | null;
  to_type_code?: string | null;
}

interface ReportFieldsPayload {
  assets: ReportField[];
  tickets: ReportField[];
  ci_types: Array<{ id: number; code: string; name: string }>;
  global_fields?: ReportField[];
  custom_fields?: ReportField[];
  extra_fields?: ReportField[];
  relations?: RelationDef[];
}

interface Filter {
  field: string;
  operator: string;
  value: string;
}

interface ReportColumn {
  key: string;
  label: string;
  type?: string;
  role?: 'seed' | 'related';
}

interface RelatedConfig {
  sourceType: string;
  targetTypes: string[];
  relationCode: string;
  direction: Direction;
  outputMode: OutputMode;
  seedFields: string[];
  relatedFields: string[];
  targetCiIds?: number[];
  seedCiIds?: number[];
}

interface ReportTemplate {
  id: string;
  name: string;
  mode: Mode;
  selected: string[];
  filters: Filter[];
  ciType: string;
  assetTypeIds?: number[];
  sourceType: string;
  targetTypes: string[];
  targetType?: string;
  relationCode: string;
  direction: Direction;
  outputMode: OutputMode;
  seedFields: string[];
  relatedFields: string[];
  targetCiIds?: number[];
  seedCiIds?: number[];
  prompt: string;
  updatedAt: string;
}

const TEMPLATE_STORAGE_KEY = 'nextitops_report_templates';
const EMPTY_FIELDS: ReportFieldsPayload = { assets: [], tickets: [], ci_types: [], global_fields: [], custom_fields: [], extra_fields: [], relations: [] };
const DEFAULT_FIELDS = ['asset_no', 'name', 'type_name', 'status', 'ip_address'];
const DEFAULT_SEED_FIELDS = ['asset_no', 'name'];
const EXAMPLE_PROMPTS = [
  '所有安装了软件为 nginx 的主机（版本不限定）',
  '查询所有主机（物理机+虚拟机）的 MAC 地址',
  '查找张三负责的未完成的变更工单',
  '型号为 NX-2000 的服务器承载的业务',
  '所有服务器安装的操作系统',
];

function createEmptyConfig(): RelatedConfig {
  return { sourceType: '', targetTypes: [], relationCode: '', direction: 'incoming', outputMode: 'related', seedFields: [], relatedFields: [] };
}

function normalizeTargetTypes(value: unknown, legacy?: string): string[] {
  const values = Array.isArray(value) ? value : legacy ? [legacy] : [];
  return [...new Set(values.map((item) => String(item || '')).filter(Boolean))];
}

function normalizeTemplate(template: Partial<ReportTemplate>): ReportTemplate | null {
  if (!template?.id || !template?.name) return null;
  const mode: Mode = template.mode || (template.selected?.some((key) => key.startsWith('ticket')) ? 'ticket' : 'asset');
  return {
    id: template.id,
    name: template.name,
    mode,
    selected: template.selected || [],
    filters: template.filters || [],
    ciType: template.ciType || '',
    assetTypeIds: template.assetTypeIds || [],
    sourceType: template.sourceType || '',
    targetTypes: normalizeTargetTypes(template.targetTypes, template.targetType),
    relationCode: template.relationCode || '',
    direction: template.direction || 'incoming',
    outputMode: template.outputMode || 'related',
    seedFields: template.seedFields || [],
    relatedFields: template.relatedFields || [],
    targetCiIds: Array.isArray(template.targetCiIds) ? template.targetCiIds : undefined,
    seedCiIds: Array.isArray(template.seedCiIds) ? template.seedCiIds : undefined,
    prompt: template.prompt || '',
    updatedAt: template.updatedAt || new Date().toISOString(),
  };
}

function typeCode(types: ReportFieldsPayload['ci_types'], id: string | number) {
  return types.find((type) => Number(type.id) === Number(id))?.code || '';
}

function inferDirection(relation: RelationDef, sourceTypeId: string): Direction {
  const source = Number(sourceTypeId);
  if (relation.from_type_id && Number(relation.from_type_id) !== source) return 'incoming';
  if (relation.to_type_id && Number(relation.to_type_id) === source) return 'incoming';
  if (relation.from_type_id && Number(relation.from_type_id) === source) return 'outgoing';
  return 'outgoing';
}

export default function ReportsPage() {
  usePageTitle('自定义报表');
  const [mode, setMode] = useState<Mode>('asset');
  const [fields, setFields] = useState<ReportFieldsPayload>(EMPTY_FIELDS);
  const [selected, setSelected] = useState<string[]>(['asset_no', 'name', 'vendor', 'purchase_date', 'warranty_end']);
  const [ciType, setCiType] = useState('');
  const [assetTypeIds, setAssetTypeIds] = useState<number[]>([]);
  const [filters, setFilters] = useState<Filter[]>([]);
  const [related, setRelated] = useState<RelatedConfig>(createEmptyConfig());
  const [prompt, setPrompt] = useState('');
  const [parsing, setParsing] = useState(false);
  const [interpretation, setInterpretation] = useState<string[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [columns, setColumns] = useState<ReportColumn[]>([]);
  const [reportLabel, setReportLabel] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [templates, setTemplates] = useState<ReportTemplate[]>([]);
  const [templateOpen, setTemplateOpen] = useState(false);
  const [saveOpen, setSaveOpen] = useState(false);
  const [templateName, setTemplateName] = useState('');
  const [editingTemplateId, setEditingTemplateId] = useState<string | null>(null);

  useEffect(() => {
    api.get<{ data: ReportFieldsPayload }>('/api/reports/fields')
      .then((response) => {
        const data = response.data;
        setFields({
          ...EMPTY_FIELDS,
          ...data,
          global_fields: data.global_fields || data.assets || [],
          custom_fields: data.custom_fields || [],
          extra_fields: data.extra_fields || [],
          relations: data.relations || [],
        });
        const source = data.ci_types.find((type) => type.code === 'software')?.id?.toString() || '';
        if (source) initializeRelated(source, data);
      })
      .catch((error) => toast.error(error.message))
      .finally(() => setLoading(false));
    try {
      const stored = JSON.parse(localStorage.getItem(TEMPLATE_STORAGE_KEY) || '[]');
      if (Array.isArray(stored)) setTemplates(stored.map(normalizeTemplate).filter(Boolean) as ReportTemplate[]);
    } catch { setTemplates([]); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const sourceTypeOptions = fields.ci_types;
  const sourceFields = useMemo(() => {
    if (!related.sourceType) return fields.global_fields || [];
    return fieldsForType(related.sourceType);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fields, related.sourceType]);
  const targetFields = useMemo(() => {
    const seen = new Set<string>();
    const result: ReportField[] = [];
    for (const typeId of related.targetTypes) {
      for (const field of fieldsForType(typeId)) {
        if (seen.has(field.key)) continue;
        seen.add(field.key);
        result.push(field);
      }
    }
    return result;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fields, related.targetTypes]);
  const assetAvailable = useMemo(() => {
    const typeIds = assetTypeIds.length ? assetTypeIds.map(String) : ciType ? [ciType] : [];
    const seen = new Set<string>();
    const result: ReportField[] = [];
    const push = (field: ReportField) => {
      if (seen.has(field.key)) return;
      seen.add(field.key);
      result.push(field);
    };
    if (!typeIds.length) {
      for (const field of fields.global_fields || []) push(field);
      for (const field of fields.extra_fields || []) push(field);
      for (const field of fields.custom_fields || []) push(field);
    } else {
      for (const typeId of typeIds) for (const field of fieldsForType(typeId)) push(field);
    }
    return result;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fields, ciType, assetTypeIds]);
  const available = mode === 'ticket' ? fields.tickets : mode === 'related' ? sourceFields : assetAvailable;
  const activeFields = useMemo<ReportColumn[]>(() => available.filter((field) => selected.includes(field.key)).map((field) => ({ key: field.key, label: field.label, type: field.type })), [available, selected]);
  const displayColumns = mode === 'related' ? columns : activeFields;
  const relationOptions = useMemo(() => (fields.relations || []).filter((relation) => {
    if (!related.sourceType) return true;
    const source = Number(related.sourceType);
    return !relation.from_type_id || !relation.to_type_id || Number(relation.from_type_id) === source || Number(relation.to_type_id) === source;
  }), [fields.relations, related.sourceType]);
  const selectedRelation = relationOptions.find((relation) => relation.code === related.relationCode) || null;
  const relationLabel = (relation: RelationDef) => {
    const direction = inferDirection(relation, related.sourceType);
    const relationName = direction === 'incoming' ? relation.reverse_name || relation.name : relation.name;
    const sourceName = fields.ci_types.find((type) => String(type.id) === related.sourceType)?.name || '源资产';
    const targetName = related.targetTypes
      .map((id) => fields.ci_types.find((type) => String(type.id) === id)?.name)
      .filter(Boolean)
      .join('、') || '关联资产';
    return `${sourceName} → ${targetName} · ${relationName}`;
  };
  const targetOptions = useMemo(() => {
    if (!selectedRelation) return fields.ci_types.filter((type) => String(type.id) !== related.sourceType);
    const fixed = related.direction === 'outgoing' ? selectedRelation.to_type_id : selectedRelation.from_type_id;
    if (fixed) return fields.ci_types.filter((type) => Number(type.id) === Number(fixed));
    return fields.ci_types.filter((type) => String(type.id) !== related.sourceType);
  }, [fields.ci_types, related.direction, related.sourceType, selectedRelation]);
  const fixedTargetId = selectedRelation
    ? (related.direction === 'outgoing' ? selectedRelation.to_type_id : selectedRelation.from_type_id)
    : null;

  function fieldsForType(typeId: string | number): ReportField[] {
    if (!typeId) return [...(fields.global_fields || []), ...(fields.extra_fields || [])];
    const custom = (fields.custom_fields || []).filter((field) => Number(field.ci_type_id) === Number(typeId));
    return [...(fields.global_fields || []), ...(fields.extra_fields || []), ...custom];
  }

  function defaultFieldsForType(typeId: string | number): string[] {
    const type = typeCode(fields.ci_types, typeId);
    const custom = fieldsForType(typeId).filter((field) => field.show_in_list).map((field) => field.key);
    if (type === 'business') return ['asset_no', 'name', 'type_name', 'status', 'attr:business_code', 'attr:business_owner', 'attr:user_count', 'attr:service_level', ...custom];
    if (type === 'software' || type === 'os') return ['asset_no', 'name', 'type_name', 'status', 'attr:version', ...custom];
    if (type === 'server' || type === 'vm') return [...DEFAULT_FIELDS, 'model', 'environment', 'location', ...custom];
    return [...DEFAULT_FIELDS, ...custom];
  }

  function defaultTargetTypes(sourceType: string, relation: RelationDef | null, direction: Direction, data = fields): string[] {
    const fixed = relation ? (direction === 'outgoing' ? relation.to_type_id : relation.from_type_id) : null;
    if (fixed) return [String(fixed)];
    const sourceCode = typeCode(data.ci_types, sourceType);
    if (sourceCode === 'software') {
      return ['server', 'vm']
        .map((code) => data.ci_types.find((type) => type.code === code)?.id)
        .filter(Boolean)
        .map(String);
    }
    const fallbackCode = sourceCode === 'business' ? 'server' : 'business';
    const fallback = data.ci_types.find((type) => type.code === fallbackCode)
      || data.ci_types.find((type) => String(type.id) !== sourceType);
    return fallback ? [String(fallback.id)] : [];
  }

  function initializeRelated(sourceType: string, data = fields) {
    if (!sourceType) return;
    const source = Number(sourceType);
    const relations = data.relations || [];
    const preferred = relations.find((relation) => relation.code === 'software_installed' && Number(relation.to_type_id) === source)
      || relations.find((relation) => relation.code === 'business_runs_on' && Number(relation.from_type_id) === source)
      || relations.find((relation) => (relation.from_type_id && Number(relation.from_type_id) === source) || (relation.to_type_id && Number(relation.to_type_id) === source));
    if (!preferred) return;
    const direction = inferDirection(preferred, sourceType);
    const targets = defaultTargetTypes(sourceType, preferred, direction, data);
    setRelated({
      sourceType,
      targetTypes: targets,
      relationCode: preferred.code,
      direction,
      outputMode: 'related',
      seedFields: [],
      relatedFields: defaultFieldsForTypesWith(targets, data),
    });
  }

  function defaultFieldsForTypesWith(typeIds: string[], data: ReportFieldsPayload): string[] {
    const result: string[] = [];
    for (const typeId of typeIds) {
      for (const key of defaultFieldsForTypeWith(typeId, data)) {
        if (!result.includes(key)) result.push(key);
      }
    }
    return result;
  }

  function defaultFieldsForTypes(typeIds: string[]): string[] {
    const result: string[] = [];
    for (const typeId of typeIds) {
      for (const key of defaultFieldsForType(typeId)) {
        if (!result.includes(key)) result.push(key);
      }
    }
    return result;
  }

  function defaultFieldsForTypeWith(typeId: string, data: ReportFieldsPayload): string[] {
    const type = typeCode(data.ci_types, typeId);
    const custom = [...(data.global_fields || []), ...(data.custom_fields || []).filter((field) => Number(field.ci_type_id) === Number(typeId))]
      .filter((field) => field.show_in_list).map((field) => field.key);
    if (type === 'business') return ['asset_no', 'name', 'type_name', 'status', 'attr:business_code', 'attr:business_owner', 'attr:user_count', 'attr:service_level', ...custom];
    if (type === 'software' || type === 'os') return ['asset_no', 'name', 'type_name', 'status', 'attr:version', ...custom];
    return [...DEFAULT_FIELDS, 'model', 'environment', 'location', ...custom];
  }

  function changeSourceType(value: string) {
    setRelated((current) => ({ ...current, sourceType: value, targetTypes: [], relationCode: '', relatedFields: [] }));
    setFilters([]);
    setRows([]);
    setColumns([]);
    if (value) initializeRelated(value);
  }

  function applyRelation(relation: RelationDef) {
    const direction = inferDirection(relation, related.sourceType);
    const targets = defaultTargetTypes(related.sourceType, relation, direction);
    setRelated((current) => ({
      ...current,
      relationCode: relation.code,
      direction,
      targetTypes: targets,
      relatedFields: defaultFieldsForTypes(targets),
      seedFields: [],
    }));
  }

  function changeDirection(direction: Direction) {
    if (!selectedRelation) return;
    const fixed = direction === 'outgoing' ? selectedRelation.to_type_id : selectedRelation.from_type_id;
    const allowed = new Set(fields.ci_types.filter((type) => String(type.id) !== related.sourceType).map((type) => String(type.id)));
    const targets = fixed
      ? [String(fixed)]
      : related.targetTypes.filter((id) => allowed.has(id)).length
        ? related.targetTypes.filter((id) => allowed.has(id))
        : defaultTargetTypes(related.sourceType, selectedRelation, direction);
    setRelated((current) => ({ ...current, direction, targetTypes: targets, relatedFields: defaultFieldsForTypes(targets) }));
  }

  function toggleTargetType(typeId: string) {
    setRelated((current) => {
      const selected = current.targetTypes.includes(typeId);
      const next = selected ? current.targetTypes.filter((id) => id !== typeId) : [...current.targetTypes, typeId];
      if (!next.length) return current;
      return { ...current, targetTypes: next, relatedFields: defaultFieldsForTypes(next) };
    });
  }

  const toggle = (key: string) => setSelected((current) => current.includes(key) ? current.filter((item) => item !== key) : [...current, key]);
  const toggleRelatedField = (role: 'seed' | 'related', key: string) => {
    setRelated((current) => {
      const list = role === 'seed' ? current.seedFields : current.relatedFields;
      const next = list.includes(key) ? list.filter((item) => item !== key) : [...list, key];
      return role === 'seed' ? { ...current, seedFields: next } : { ...current, relatedFields: next };
    });
  };

  const switchMode = (next: Mode) => {
    setMode(next);
    setRows([]);
    setColumns([]);
    setPage(1);
    setFilters([]);
    setCiType('');
    setAssetTypeIds([]);
    setInterpretation([]);
    setWarnings([]);
    if (next === 'asset') setSelected(['asset_no', 'name', 'vendor', 'purchase_date', 'warranty_end']);
    if (next === 'ticket') setSelected(['ticket_no', 'type', 'title', 'status', 'created_at']);
    if (next === 'related' && !related.sourceType) {
      const source = fields.ci_types.find((type) => type.code === 'software')?.id?.toString() || '';
      if (source) initializeRelated(source);
    }
  };

  const executeData = async (source: 'asset' | 'ticket', reportFields: string[], filterList: Filter[], typeIds: number[] = []) => {
    if (!reportFields.length) return toast.error('请至少选择一个字段');
    setRunning(true);
    try {
      const response = await api.post<{ data: Record<string, unknown>[] }>('/api/reports/data', {
        source,
        fields: reportFields,
        filters: filterList,
        ci_type_ids: typeIds.length ? typeIds : undefined,
        ci_type_id: !typeIds.length && ciType ? Number(ciType) : undefined,
      });
      setRows(response.data || []);
      setColumns([]);
      setReportLabel(source === 'ticket' ? 'IT 流程' : 'IT 资产');
      setPage(1);
      toast.success(`已生成 ${response.data?.length || 0} 条报表数据`);
    } catch (error: any) { toast.error(error.message); } finally { setRunning(false); }
  };

  const runLegacy = () => {
    const typeIds = mode === 'asset' ? (assetTypeIds.length ? assetTypeIds : ciType ? [Number(ciType)] : []) : [];
    return executeData(mode === 'ticket' ? 'ticket' : 'asset', selected, filters, typeIds);
  };

  const executeRelated = async (config: RelatedConfig, filterList: Filter[]) => {
    if (!config.sourceType || !config.relationCode || !config.targetTypes.length) return toast.error('请选择源资产类型、关联关系和目标类型');
    if (config.outputMode !== 'seed' && !config.relatedFields.length) return toast.error('请至少选择一个关联输出字段');
    setRunning(true);
    try {
      const response = await api.post<{ data: Record<string, unknown>[]; columns: ReportColumn[]; total: number; relation?: { source_type_name: string; target_type_name: string } }>('/api/reports/related', {
        source_type_id: Number(config.sourceType),
        filters: filterList,
        seed_ci_ids: config.seedCiIds !== undefined ? config.seedCiIds : undefined,
        relation_code: config.relationCode,
        direction: config.direction,
        target_type_id: Number(config.targetTypes[0]),
        target_type_ids: config.targetTypes.map(Number),
        target_ci_ids: config.targetCiIds !== undefined ? config.targetCiIds : undefined,
        output_mode: config.outputMode,
        seed_fields: config.seedFields,
        related_fields: config.relatedFields,
      });
      setRows(response.data || []);
      setColumns(response.columns || []);
      setReportLabel(response.relation ? `${response.relation.source_type_name} → ${response.relation.target_type_name}` : '关联资产');
      setPage(1);
      toast.success(`已生成 ${response.total || 0} 条关联资产数据`);
    } catch (error: any) { toast.error(error.message); } finally { setRunning(false); }
  };

  const run = () => mode === 'related' ? executeRelated(related, filters) : runLegacy();

  const parsePrompt = async () => {
    const value = prompt.trim();
    if (!value) return toast.error('请输入自然语言查询');
    setParsing(true);
    try {
      const response = await api.post<{ mode?: Mode; query: any; interpretation: string[]; warnings: string[] }>('/api/reports/parse', { prompt: value });
      const query = response.query;
      if (response.mode === 'asset' || response.mode === 'ticket') {
        const nextMode = response.mode;
        setMode(nextMode);
        setSelected(query.fields || []);
        setFilters(query.filters || []);
        setCiType('');
        setAssetTypeIds(nextMode === 'asset' ? (query.ci_type_ids || []) : []);
        setInterpretation(response.interpretation || []);
        setWarnings(response.warnings || []);
        setRows([]);
        setColumns([]);
        await executeData(nextMode, query.fields || [], query.filters || [], query.ci_type_ids || []);
        return;
      }
      const config: RelatedConfig = {
        sourceType: String(query.source_type_id),
        targetTypes: normalizeTargetTypes(query.target_type_ids, query.target_type_id ? String(query.target_type_id) : undefined),
        relationCode: query.relation_code,
        direction: query.direction,
        outputMode: query.output_mode || 'related',
        seedFields: query.seed_fields || [],
        relatedFields: query.related_fields || [],
        targetCiIds: query.target_ci_ids,
        seedCiIds: query.seed_ci_ids,
      };
      setMode('related');
      setRelated(config);
      setAssetTypeIds([]);
      setFilters(query.filters || []);
      setInterpretation(response.interpretation || []);
      setWarnings(response.warnings || []);
      setRows([]);
      setColumns([]);
      await executeRelated(config, query.filters || []);
    } catch (error: any) {
      toast.error(error.message);
      setInterpretation([]);
      setWarnings([]);
    } finally { setParsing(false); }
  };

  const exportCsv = () => {
    if (!rows.length || !displayColumns.length) return toast.error('请先生成报表');
    const header = displayColumns.map((field) => field.label);
    const csv = [header, ...rows.map((row) => displayColumns.map((field) => `"${cellText(row, field).replaceAll('"', '""')}"`))].map((line) => line.join(',')).join('\n');
    const blob = new Blob([`\ufeff${csv}`], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${reportLabel || '自定义报表'}_${new Date().toISOString().slice(0, 10).replaceAll('-', '')}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const reset = () => {
    setRows([]);
    setColumns([]);
    setPage(1);
    setInterpretation([]);
    setWarnings([]);
    toast.success('已清空结果');
  };

  const openSaveTemplate = (template?: ReportTemplate) => {
    if (template) {
      setMode(template.mode);
      setSelected(template.selected);
      setFilters(template.filters || []);
      setCiType(template.ciType || '');
      setAssetTypeIds(template.assetTypeIds || []);
      setRelated({
        sourceType: template.sourceType || '',
        targetTypes: normalizeTargetTypes(template.targetTypes, template.targetType),
        relationCode: template.relationCode || '',
        direction: template.direction || 'incoming',
        outputMode: template.outputMode || 'related',
        seedFields: template.seedFields || [],
        relatedFields: template.relatedFields || [],
        targetCiIds: template.targetCiIds,
        seedCiIds: template.seedCiIds,
      });
      setPrompt(template.prompt || '');
    }
    setEditingTemplateId(template?.id || null);
    setTemplateName(template?.name || '');
    setSaveOpen(true);
  };

  const saveTemplate = () => {
    const name = templateName.trim();
    if (!name) return toast.error('请输入模板名称');
    const now = new Date().toISOString();
    const payload: ReportTemplate = {
      id: editingTemplateId || crypto.randomUUID(),
      name,
      mode,
      selected,
      filters,
      ciType,
      assetTypeIds,
      sourceType: related.sourceType,
      targetTypes: related.targetTypes,
      relationCode: related.relationCode,
      direction: related.direction,
      outputMode: related.outputMode,
      seedFields: related.seedFields,
      relatedFields: related.relatedFields,
      targetCiIds: related.targetCiIds,
      seedCiIds: related.seedCiIds,
      prompt,
      updatedAt: now,
    };
    const next = editingTemplateId
      ? templates.map((template) => template.id === editingTemplateId ? payload : template)
      : [payload, ...templates];
    setTemplates(next);
    localStorage.setItem(TEMPLATE_STORAGE_KEY, JSON.stringify(next));
    setSaveOpen(false);
    toast.success(editingTemplateId ? '模板已更新' : '模板已保存');
  };

  const applyTemplate = (template: ReportTemplate) => {
    setMode(template.mode);
    setSelected(template.selected || []);
    setFilters(template.filters || []);
    setCiType(template.ciType || '');
    setRelated({
      sourceType: template.sourceType || '',
      targetTypes: normalizeTargetTypes(template.targetTypes, template.targetType),
      relationCode: template.relationCode || '',
      direction: template.direction || 'incoming',
      outputMode: template.outputMode || 'related',
      seedFields: template.seedFields || [],
      relatedFields: template.relatedFields || [],
    });
    setPrompt(template.prompt || '');
    setRows([]);
    setColumns([]);
    setPage(1);
    setTemplateOpen(false);
    toast.success(`已打开模板「${template.name}」`);
  };

  const deleteTemplate = (id: string) => {
    const next = templates.filter((template) => template.id !== id);
    setTemplates(next);
    localStorage.setItem(TEMPLATE_STORAGE_KEY, JSON.stringify(next));
    toast.success('模板已删除');
  };

  const filtersEditor = (
    <div className="mt-3 border-t border-slate-100 pt-3">
      <div className="mb-2 flex items-center justify-between"><p className="text-[10.5px] font-medium text-slate-600">筛选条件</p><button onClick={() => setFilters((current) => [...current, { field: available[0]?.key || '', operator: available[0]?.type === 'select' ? 'in' : available[0]?.type === 'date' ? 'equals' : 'contains', value: '' }])} className="text-[9.5px] text-brand-600">+ 添加条件</button></div>
      <div className="space-y-2">
        {filters.length ? filters.map((filter, index) => {
          const filterField = available.find((field) => field.key === filter.field);
          const selectedValues = filter.value.split(',').filter(Boolean);
          return (
            <div key={index} className="rounded-lg border border-slate-200 p-2">
              <div className="flex items-center gap-1.5">
                <select className="input-base h-7 min-w-0 flex-1 px-1 text-[9.5px]" value={filter.field} onChange={(event) => {
                  const nextField = available.find((field) => field.key === event.target.value);
                  setFilters((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, field: event.target.value, value: '', operator: nextField?.type === 'select' ? 'in' : nextField?.type === 'date' ? 'equals' : nextField?.type === 'number' ? 'gte' : 'contains' } : item));
                }}>
                  {available.map((field) => <option key={field.key} value={field.key}>{field.label}</option>)}
                </select>
                <select className="input-base h-7 w-[62px] px-1 text-[9.5px]" value={filter.operator} onChange={(event) => setFilters((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, operator: event.target.value } : item))}>
                  <option value="equals">等于</option><option value="not_equals">不等于</option><option value="contains">包含</option><option value="in">属于</option><option value="gt">大于</option><option value="gte">大于等于</option><option value="lt">小于</option><option value="lte">小于等于</option><option value="empty">为空</option><option value="not_empty">不为空</option>
                </select>
                <button onClick={() => setFilters((current) => current.filter((_, itemIndex) => itemIndex !== index))} className="text-slate-300 hover:text-rose-500" aria-label="删除筛选条件">×</button>
              </div>
              {!['empty', 'not_empty'].includes(filter.operator) ? (
                filterField?.type === 'date' ? <div className="mt-1"><DateTextInput value={filter.value} onChange={(value) => setFilters((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, value } : item))} className="h-7 text-[9.5px]" /></div>
                  : filterField?.type === 'select' && filterField.options?.length ? (
                    <div className="mt-1 max-h-[160px] min-h-[80px] overflow-auto rounded-lg border border-slate-200 bg-white p-1" style={{ resize: 'vertical' }}>
                      {filterField.options.map((option: string) => {
                        const checked = selectedValues.includes(option);
                        return (
                          <label key={option} className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-[9.5px] text-slate-600 hover:bg-slate-50">
                            <input type="checkbox" className="accent-brand-600" checked={checked} onChange={() => {
                              const values = checked ? selectedValues.filter((value) => value !== option) : [...selectedValues, option];
                              setFilters((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, operator: 'in', value: values.join(',') } : item));
                            }} />
                            {optionLabel(option)}
                          </label>
                        );
                      })}
                    </div>
                  ) : <input className="input-base mt-1 h-7 text-[9.5px]" value={filter.value} onChange={(event) => setFilters((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, value: event.target.value } : item))} placeholder={filterField?.type === 'number' ? '输入数值' : '输入关键字（支持包含）'} />
              ) : null}
              {filterField?.type === 'select' && filterField.options?.length && !['empty', 'not_empty'].includes(filter.operator) ? <p className="mt-1 text-[8.5px] text-slate-400">可多选</p> : null}
            </div>
          );
        }) : <p className="rounded-lg border border-dashed border-slate-200 px-2.5 py-3 text-center text-[9.5px] text-slate-400">未设置筛选条件，默认查询全部</p>}
      </div>
    </div>
  );

  return (
    <div className="animate-enter">
      <PageHeader eyebrow="Custom reports" title="自定义报表" description="自由组合资产、关联资产与字段；也可以直接用一句话描述想要的清单。" actions={<div className="flex items-center gap-2"><Button variant="secondary" size="sm" icon={FolderOpen} onClick={() => setTemplateOpen(true)}>模板库</Button><Button variant="secondary" size="sm" icon={Save} onClick={() => openSaveTemplate()}>保存模板</Button><Button variant="secondary" size="sm" icon={Upload} onClick={exportCsv}>导出 CSV</Button><Button variant="ghost" size="sm" onClick={reset}>清空</Button></div>} />

      <div className="card mb-3 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-1.5 text-[14px] font-semibold text-[#1f2329]"><Sparkles className="h-3.5 w-3.5 text-brand-500" /> 智能查询</h2>
            <p className="mt-1 text-[12px] text-[#4e5969]">用自然语言描述输入和输出，系统把它转换成可编辑的关联查询。例如：所有安装了 nginx 的服务器。</p>
          </div>
          <span className="rounded bg-white px-2 py-1 text-[11px] text-brand-700 ring-1 ring-brand-200">规则解析 · 可继续调整</span>
        </div>
        <div className="mt-3 flex flex-col gap-2 lg:flex-row">
          <textarea className="input-base h-[62px] flex-1 resize-y text-[11px]" rows={2} value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder="例如：请输出所有安装了软件为 nginx，版本不限定，所有主机的信息" onKeyDown={(event) => { if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) parsePrompt(); }} />
          <Button className="shrink-0 lg:h-[62px] lg:self-stretch" icon={Sparkles} loading={parsing} onClick={parsePrompt}>解析并生成</Button>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] text-[#86909c]">试试：</span>
          {EXAMPLE_PROMPTS.map((example) => <button key={example} onClick={() => setPrompt(example)} className="rounded bg-[#f7f8fa] px-2 py-0.5 text-[11px] text-[#4e5969] ring-1 ring-[#e5e6eb] hover:text-brand-600">{example}</button>)}
        </div>
        {interpretation.length ? <div className="mt-3 flex flex-wrap items-center gap-1.5">{interpretation.map((item) => <span key={item} className="inline-flex items-center gap-1 rounded-full bg-white px-2 py-1 text-[9px] text-slate-600 ring-1 ring-slate-200"><ArrowRight className="h-2.5 w-2.5 text-brand-500" />{item}</span>)}</div> : null}
        {warnings.length ? <p className="mt-2 text-[9.5px] text-amber-600">{warnings.join('；')}</p> : null}
      </div>

      <div className="grid gap-3 xl:grid-cols-[350px_1fr]">
        <div className="card h-fit p-4">
          <div className="mb-3 grid grid-cols-3 rounded-lg bg-slate-100 p-0.5">
            {[{ value: 'asset', label: '资产清单' }, { value: 'related', label: '关联资产' }, { value: 'ticket', label: '流程工单' }].map((item) => <button key={item.value} onClick={() => switchMode(item.value as Mode)} className={cn('rounded-md px-1.5 py-1.5 text-[10px] font-medium', mode === item.value ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500')}>{item.label}</button>)}
          </div>

          {mode === 'asset' ? <Field label="资产类型"><select className="input-base" value={ciType} onChange={(event) => { const value = event.target.value; setCiType(value); setAssetTypeIds([]); setSelected(value ? defaultFieldsForType(value) : DEFAULT_FIELDS); }}><option value="">全部类型</option>{fields.ci_types.map((type) => <option key={type.id} value={type.id}>{type.name}</option>)}</select>{assetTypeIds.length ? <p className="mt-1 text-[9px] text-brand-600">智能查询已限定：{assetTypeIds.map((id) => fields.ci_types.find((type) => type.id === id)?.name).filter(Boolean).join('、')}</p> : null}</Field> : null}

          {mode === 'related' ? (
            <div className="space-y-2.5">
              <Field label="从哪类资产出发" hint="先筛选源资产，再沿关系找关联资产">
                <select className="input-base" value={related.sourceType} onChange={(event) => changeSourceType(event.target.value)}>
                  <option value="">请选择资产类型</option>
                  {sourceTypeOptions.map((type) => <option key={type.id} value={type.id}>{type.name}</option>)}
                </select>
              </Field>
              <Field label="关联关系">
                <select className="input-base" value={related.relationCode} onChange={(event) => {
                  const relation = relationOptions.find((item) => item.code === event.target.value);
                  if (relation) applyRelation(relation);
                }}>
                  <option value="">请选择关系</option>
                  {relationOptions.map((relation) => <option key={relation.code} value={relation.code}>{relationLabel(relation)}</option>)}
                </select>
              </Field>
              <Field label="查询方向">
                <select className="input-base" value={related.direction} onChange={(event) => changeDirection(event.target.value as Direction)}>
                  <option value="incoming">反向（关联资产 → 源）</option>
                  <option value="outgoing">正向（源 → 关联资产）</option>
                </select>
              </Field>
              <Field label="输出资产类型" hint="可多选；「主机」同时包含服务器和虚拟机">
                <div className="mb-1.5 flex items-start justify-between gap-2 px-1">
                  <p className="text-[9px] leading-4 text-slate-500">已选：<span className="font-medium text-brand-700">{related.targetTypes.length ? related.targetTypes.map((id) => fields.ci_types.find((type) => String(type.id) === id)?.name || id).join('、') : '未选择'}</span></p>
                  <span className="shrink-0 text-[9px] text-slate-400">{related.targetTypes.length} 项</span>
                </div>
                <div className="max-h-[132px] overflow-y-auto rounded-lg border border-slate-200 bg-white p-1.5">
                  {targetOptions.length ? targetOptions.map((type) => (
                    <label key={type.id} className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 text-[9.5px] text-slate-600 hover:bg-slate-50">
                      <input
                        type="checkbox"
                        className="accent-brand-600"
                        checked={related.targetTypes.includes(String(type.id))}
                        disabled={Boolean(fixedTargetId)}
                        onChange={() => toggleTargetType(String(type.id))}
                      />
                      {type.name}
                    </label>
                  )) : <p className="px-1 py-2 text-[9.5px] text-slate-400">请先选择关联关系</p>}
                </div>
              </Field>
              <Field label="输出方式">
                <div className="grid grid-cols-3 gap-1 rounded-lg border border-slate-200 bg-slate-50 p-1">
                  {[{ value: 'related', label: '仅关联' }, { value: 'both', label: '源+关联' }, { value: 'seed', label: '仅源' }].map((item) => <button key={item.value} type="button" onClick={() => setRelated((current) => ({ ...current, outputMode: item.value as OutputMode }))} className={cn('rounded-md px-1 py-1 text-[9.5px]', related.outputMode === item.value ? 'bg-white text-brand-700 shadow-sm' : 'text-slate-500')}>{item.label}</button>)}
                </div>
              </Field>
              <div className="rounded-xl border border-brand-100 bg-brand-50/40 p-2.5">
                <div className="mb-1 flex items-center justify-between"><p className="text-[10px] font-medium text-slate-700">关联字段</p><button onClick={() => setRelated((current) => ({ ...current, relatedFields: defaultFieldsForTypes(current.targetTypes) }))} className="text-[9px] text-brand-600">恢复默认</button></div>
                <div className="max-h-[150px] overflow-y-auto rounded-lg border border-white bg-white/80 p-1.5">
                  {targetFields.length ? targetFields.map((field) => <label key={field.key} className="flex cursor-pointer items-center gap-2 rounded px-1 py-0.5 text-[9.5px] text-slate-600 hover:bg-slate-50"><input type="checkbox" className="accent-brand-600" checked={related.relatedFields.includes(field.key)} onChange={() => toggleRelatedField('related', field.key)} />{field.label}</label>) : <p className="px-1 py-2 text-[9.5px] text-slate-400">请先选择输出资产类型</p>}
                </div>
              </div>
              {related.outputMode !== 'related' ? <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-2.5"><div className="mb-1 flex items-center justify-between"><p className="text-[10px] font-medium text-slate-700">源资产字段</p><span className="text-[8.5px] text-slate-400">与关联字段同时输出</span></div><div className="max-h-[120px] overflow-y-auto rounded-lg border border-white bg-white/80 p-1.5">{sourceFields.map((field) => <label key={field.key} className="flex cursor-pointer items-center gap-2 rounded px-1 py-0.5 text-[9.5px] text-slate-600 hover:bg-slate-50"><input type="checkbox" className="accent-brand-600" checked={related.seedFields.includes(field.key)} onChange={() => toggleRelatedField('seed', field.key)} />{field.label}</label>)}</div></div> : null}
            </div>
          ) : null}

          {mode === 'related' ? filtersEditor : null}
          {mode !== 'related' ? filtersEditor : null}

          {mode !== 'related' ? <div className="mt-3 border-t border-slate-100 pt-3"><div className="mb-2 flex items-center justify-between"><p className="text-[10.5px] font-medium text-slate-600">输出字段</p><button onClick={() => setSelected(available.map((field) => field.key))} className="text-[9.5px] text-brand-600">全选</button></div>{loading ? <Skeleton className="h-40" /> : <div className="max-h-[330px] space-y-0.5 overflow-y-auto">{available.map((field) => <label key={field.key} className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-[10.5px] text-slate-600 hover:bg-slate-50"><input type="checkbox" checked={selected.includes(field.key)} onChange={() => toggle(field.key)} className="accent-brand-600" />{field.label}</label>)}</div>}</div> : null}

          <Button className="mt-3 w-full" size="sm" icon={Play} loading={running} onClick={run}>{mode === 'related' ? '查询关联资产' : '生成报表'}</Button>
          {mode === 'related' ? <p className="mt-2 flex items-start gap-1 text-[8.5px] leading-relaxed text-slate-400"><Link2 className="mt-0.5 h-2.5 w-2.5 shrink-0" /> 结果按关系去重展示；一条源资产可对应多条关联资产。</p> : null}
        </div>

        <div className="card min-w-0 overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#eef1f6] px-4 py-3">
            <div><h2 className="flex items-center gap-1.5 text-[12.5px] font-semibold text-slate-800"><FileSpreadsheet className="h-3.5 w-3.5 text-brand-500" /> 报表预览</h2><p className="mt-0.5 text-[9.5px] text-slate-400">{reportLabel ? `${reportLabel} · ` : ''}共 {rows.length} 条数据{rows.length > pageSize ? `，当前第 ${page} 页` : ''}</p></div>
            <span className="text-[9.5px] text-slate-400">{displayColumns.length} 个字段</span>
          </div>
          {rows.length ? <div className="overflow-auto"><table className="data-table min-w-max"><thead><tr>{displayColumns.map((field) => <th key={field.key}>{field.label}</th>)}</tr></thead><tbody>{rows.slice((page - 1) * pageSize, page * pageSize).map((row, index) => <tr key={index}>{displayColumns.map((field) => <td key={field.key} className="max-w-[260px] truncate text-[10.5px]">{cellText(row, field)}</td>)}</tr>)}</tbody></table></div> : <div className="flex flex-col items-center justify-center py-24 text-center"><BarChart3 className="h-8 w-8 text-slate-200" /><p className="mt-2 text-[11px] text-slate-400">{mode === 'related' ? '配置源资产、关联关系和输出字段，或直接用上面的自然语言查询' : '选择字段后点击「生成报表」'}</p></div>}
          {rows.length ? <div className="flex flex-col items-center justify-between gap-2 border-t border-[#eef1f6] px-4 py-2 sm:flex-row"><PageSizeSelect value={pageSize} onChange={(size) => { setPageSize(size); setPage(1); }} /><Pagination page={page} pageSize={pageSize} total={rows.length} onChange={setPage} /></div> : null}
        </div>
      </div>

      <Modal open={saveOpen} onClose={() => setSaveOpen(false)} title={editingTemplateId ? '编辑报表模板' : '保存报表模板'} description="保存当前模式、数据源、关联关系、输出字段和全部筛选条件。" icon={Save} size="sm" footer={<><Button variant="secondary" size="sm" onClick={() => setSaveOpen(false)}>取消</Button><Button size="sm" onClick={saveTemplate}>{editingTemplateId ? '保存修改' : '保存模板'}</Button></>}>
        <Field label="模板名称" required><Input value={templateName} onChange={(event) => setTemplateName(event.target.value)} placeholder="例如：安装了 nginx 的主机清单" autoFocus /></Field>
        <p className="mt-2 text-[9.5px] text-slate-400">当前：{mode === 'asset' ? '资产清单' : mode === 'ticket' ? '流程工单' : '关联资产'} · {mode === 'related' ? `${related.relatedFields.length} 个输出字段` : `${selected.length} 个输出字段`} · {filters.length} 个筛选条件</p>
      </Modal>

      <Modal open={templateOpen} onClose={() => setTemplateOpen(false)} title="报表模板库" description="打开、编辑或删除已保存的报表模板。" icon={FolderOpen} size="md" footer={<Button variant="secondary" size="sm" onClick={() => setTemplateOpen(false)}>关闭</Button>}>
        {templates.length ? <div className="space-y-2">{templates.map((template) => <div key={template.id} className="flex items-center gap-2 rounded-xl border border-slate-200 p-3"><div className="min-w-0 flex-1"><p className="truncate text-[11.5px] font-medium text-slate-700">{template.name}</p><p className="mt-0.5 text-[9px] text-slate-400">{template.mode === 'asset' ? '资产清单' : template.mode === 'ticket' ? '流程工单' : '关联资产'} · {(template.mode === 'related' ? template.relatedFields : template.selected).length} 字段 · {template.filters?.length || 0} 条件 · {new Date(template.updatedAt).toLocaleDateString()}</p></div><Button variant="ghost" size="xs" onClick={() => applyTemplate(template)}>打开</Button><button onClick={() => openSaveTemplate(template)} className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600" aria-label="编辑模板"><Pencil className="h-3.5 w-3.5" /></button><button onClick={() => deleteTemplate(template.id)} className="rounded p-1 text-slate-400 hover:bg-rose-50 hover:text-rose-600" aria-label="删除模板"><Trash2 className="h-3.5 w-3.5" /></button></div>)}</div> : <p className="py-10 text-center text-[11px] text-slate-400">还没有保存的模板，请先在报表页配置条件后保存。</p>}
      </Modal>
    </div>
  );
}
