import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import {
  AlertCircle,
  ArrowRight,
  ArrowRightLeft,
  Boxes,
  CheckCircle2,
  ChevronDown,
  Download,
  FileSpreadsheet,
  Filter,
  Layers3,
  ListChecks,
  Pencil,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  ShieldCheck,
  Trash2,
  Upload,
  UploadCloud,
  DownloadCloud,
  X,
  type LucideIcon,
} from 'lucide-react';
import { toast } from 'sonner';
import { api, buildQuery, downloadFile } from '@/lib/api';
import { RichTextEditor } from '@/components/RichText';
import { usePageTitle, useDebounce } from '@/lib/hooks';
import { useAuth } from '@/context/AuthContext';
import {
  CI_STATUS_META,
  CRITICALITY_META,
  ENVIRONMENT_META,
  cn,
  formatCurrency,
  formatDate,
  relativeTime,
} from '@/lib/utils';
import type { CI, CIField, CIType, User } from '@/lib/types';
import { Avatar, Badge, Button, Checkbox, ConfirmDialog, EmptyState, Field, IconButton, Input, Modal, PageHeader, PageSizeSelect, Pagination, SearchInput, Spinner, TableSkeleton } from '@/components/ui';
import { DynamicIcon } from '@/components/DynamicIcon';
import { DateInput } from '@/components/DateInput';
import { notifyDataChanged } from '@/lib/refresh';
import { usePageSize } from '@/lib/pageSize';
import { BASIC_FIELDS, basicFieldVisible, getBasicFieldConfig } from '@/lib/ciBasicFields';
import { SearchSelect } from '@/components/SearchSelect';
import { SortableTh } from '@/components/SortableTh';

type CmdbListSnapshot = {
  search: string;
  status: string;
  criticality: string;
  owner: string;
  filters: Array<{ field: string; op: 'contains' | 'equals'; value: string }>;
  page: number;
  pageSize: number;
  sortBy: string;
  sortDir: 'asc' | 'desc';
};

const listSnapshotKey = (typeCode: string) => `nextitops_cmdb_list:${typeCode || 'all'}`;

function readListSnapshot(typeCode: string): CmdbListSnapshot | null {
  try {
    const raw = sessionStorage.getItem(listSnapshotKey(typeCode));
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<CmdbListSnapshot>;
    return {
      search: typeof value.search === 'string' ? value.search : '',
      status: typeof value.status === 'string' ? value.status : '',
      criticality: typeof value.criticality === 'string' ? value.criticality : '',
      owner: typeof value.owner === 'string' ? value.owner : '',
      filters: Array.isArray(value.filters) ? value.filters.filter((item) => item && typeof item.field === 'string') : [],
      page: Number(value.page) > 0 ? Number(value.page) : 1,
      pageSize: Number(value.pageSize) > 0 ? Number(value.pageSize) : 20,
      sortBy: typeof value.sortBy === 'string' && value.sortBy ? value.sortBy : 'asset_no',
      sortDir: value.sortDir === 'desc' ? 'desc' : 'asc',
    };
  } catch {
    return null;
  }
}

const EMPTY_FORM: Record<string, any> = {  asset_no: '',
  name: '',
  ci_type_id: '',
  status: 'in_use',
  criticality: 'medium',
  environment: 'production',
  owner_id: '',
  department: '',
  location: '',
  vendor: '',
  model: '',
  serial_no: '',
  ip_address: '',
  mac_address: '',
  bmc_address: '',
  os_name: '',
  cpu: '',
  memory: '',
  disk: '',
  purchase_date: '',
  warranty_end: '',
  cost: 0,
  description: '',
  attributes: {},
};

export default function CMDBPage() {
  usePageTitle('配置管理');
  const { can } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const typeCode = searchParams.get('type') || '';
  const restoreList = Boolean((location.state as { restoreList?: boolean } | null)?.restoreList);
  const [initialSnapshot] = useState(() => restoreList ? readListSnapshot(typeCode) : null);
  const snapshotKey = listSnapshotKey(typeCode);
  const restoredSnapshotRef = useRef(false);
  const [types, setTypes] = useState<CIType[]>([]);
  const [typeDetail, setTypeDetail] = useState<CIType | null>(null);
  const [users, setUsers] = useState<User[]>([]);
  const [rows, setRows] = useState<CI[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(initialSnapshot?.page ?? 1);
  const [sortBy, setSortBy] = useState(initialSnapshot?.sortBy ?? 'asset_no');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>(initialSnapshot?.sortDir ?? 'asc');
  const toggleSort = (field: string) => {
    if (sortBy === field) setSortDir((current) => current === 'asc' ? 'desc' : 'asc');
    else { setSortBy(field); setSortDir('asc'); }
    setPage(1);
  };
  const [loading, setLoading] = useState(true);
  const [typesLoading, setTypesLoading] = useState(true);
  const [, setBasicConfigVersion] = useState(0);
  const [search, setSearch] = useState(initialSnapshot?.search ?? '');
  const debouncedSearch = useDebounce(search, 320);
  const [status, setStatus] = useState(initialSnapshot?.status ?? '');
  const [criticality, setCriticality] = useState(initialSnapshot?.criticality ?? '');
  const [owner, setOwner] = useState(initialSnapshot?.owner ?? '');
  const [filters, setFilters] = useState<Array<{ field: string; op: 'contains' | 'equals'; value: string }>>(initialSnapshot?.filters ?? []);
  const [filterOpen, setFilterOpen] = useState(false);
  const [pageSize, setPageSize] = usePageSize('cmdb');
  const skipPageResetRef = useRef(Boolean(initialSnapshot));
  const previousTypeRef = useRef(typeCode);

  useEffect(() => {
    if (previousTypeRef.current === typeCode) return;
    previousTypeRef.current = typeCode;
    setSearch('');
  }, [typeCode]);

  useEffect(() => {
    if (initialSnapshot?.pageSize) setPageSize(initialSnapshot.pageSize);
  }, []);

  useEffect(() => {
    if (restoredSnapshotRef.current) return;
    restoredSnapshotRef.current = true;
    if (restoreList) {
      sessionStorage.removeItem(snapshotKey);
      navigate(`${location.pathname}${location.search}`, { replace: true, state: null });
    } else {
      sessionStorage.removeItem(snapshotKey);
    }
  }, []);

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<CI | null>(null);
  const [form, setForm] = useState<Record<string, any>>(EMPTY_FORM);
  const [formFields, setFormFields] = useState<CIField[]>([]);
  const [formLoading, setFormLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');

  const [importOpen, setImportOpen] = useState(false);
  const [importType, setImportType] = useState('server');
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importMode, setImportMode] = useState<'upsert' | 'create'>('upsert');
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<any>(null);
  const [dragging, setDragging] = useState(false);
  const [ipAddressCount, setIpAddressCount] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [deleteTarget, setDeleteTarget] = useState<CI | null>(null);
  const [deleting, setDeleting] = useState(false);

  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [bulkEditOpen, setBulkEditOpen] = useState(false);
  const [bulkForm, setBulkForm] = useState<Record<string, string>>({
    status: '',
    criticality: '',
    environment: '',
    owner_id: '',
    department: '',
    location: '',
  });
  const [bulkSaving, setBulkSaving] = useState(false);
  const [bulkFields, setBulkFields] = useState<CIField[]>([]);
  const [bulkAttributes, setBulkAttributes] = useState<Record<string, any>>({});
  const [convertOpen, setConvertOpen] = useState(false);
  const [convertTargetId, setConvertTargetId] = useState('');
  const [convertSaving, setConvertSaving] = useState(false);
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [approvalsOpen, setApprovalsOpen] = useState(false);
  const [approvals, setApprovals] = useState<any[]>([]);
  const [approvalLoading, setApprovalLoading] = useState(false);
  const [accessBulkOpen, setAccessBulkOpen] = useState(false);
  const [accessManager, setAccessManager] = useState('');
  const [accessGrants, setAccessGrants] = useState<Set<number>>(new Set());
  const [accessEditGrants, setAccessEditGrants] = useState<Set<number>>(new Set());
  const [accessSaving, setAccessSaving] = useState(false);

  const selectedType = types.find((item) => item.code === typeCode);
  const totalAll = types.reduce((sum, item) => sum + (item.ci_count || 0), 0);
  const canEditCis = can('cmdb.edit');
  const selectedRows = rows.filter((row) => selectedIds.has(row.id));
  const selectedTypeIds = new Set(selectedRows.map((row) => row.ci_type_id));
  const bulkMixedTypes = selectedTypeIds.size > 1;
  const bulkTypeCode = types.find((type) => Number(type.id) === Number(selectedRows[0]?.ci_type_id))?.code || typeCode;
  const convertSourceType = types.find((type) => Number(type.id) === Number(selectedRows[0]?.ci_type_id));
  const convertTargetTypes = types.filter((type) => type.enabled && Number(type.id) !== Number(convertSourceType?.id));
  const convertTargetType = convertTargetTypes.find((type) => Number(type.id) === Number(convertTargetId));
  const bulkBaseVisible = (key: string) => basicFieldVisible(bulkTypeCode, key);
  const pageIds = rows.map((row) => row.id);
  const allPageSelected = pageIds.length > 0 && pageIds.every((id) => selectedIds.has(id));
  const somePageSelected = pageIds.some((id) => selectedIds.has(id));

  const loadTypes = async () => {
    setTypesLoading(true);
    try {
      const response = await api.get<{ data: CIType[]; total: number }>('/api/ci-types');
      setTypes(response.data);
    } finally {
      setTypesLoading(false);
    }
  };

  const loadUsers = async () => {
    const response = await api.get<{ data: User[] }>('/api/users');
    setUsers(response.data);
  };

  useEffect(() => {
    loadTypes().catch((error) => toast.error(error.message));
    loadUsers().catch(() => {});
    api.get<{ data: Array<{ count: number }> }>('/api/ip-inventory').then((response) => setIpAddressCount((response.data || []).reduce((sum, group) => sum + group.count, 0))).catch(() => {});
  }, []);

  useEffect(() => {
    const handler = () => loadTypes().catch(() => {});
    window.addEventListener('nextitops:preferences-changed', handler);
    return () => window.removeEventListener('nextitops:preferences-changed', handler);
  }, []);

  useEffect(() => {
    const handler = () => setBasicConfigVersion((value) => value + 1);
    window.addEventListener('nextitops:ci-basic-fields-changed', handler);
    return () => window.removeEventListener('nextitops:ci-basic-fields-changed', handler);
  }, []);

  useEffect(() => {
    if (!typeCode) {
      setTypeDetail(null);
      return;
    }
    let active = true;
    api
      .get<{ data: CIType }>(`/api/ci-types/${typeCode}`)
      .then((response) => active && setTypeDetail(response.data))
      .catch(() => active && setTypeDetail(null));
    return () => {
      active = false;
    };
  }, [typeCode]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    const query = buildQuery({
      type: typeCode,
      q: debouncedSearch,
      status,
      criticality,
      owner_id: owner,
      filters: filters.length ? JSON.stringify(filters) : undefined,
      page,
      pageSize,
      sortBy,
      sortDir,
    });
    api
      .get<{ data: CI[]; pagination: { total: number } }>(`/api/cis${query}`)
      .then((response) => {
        if (!active) return;
        setRows(response.data);
        setTotal(response.pagination.total);
      })
      .catch((error) => active && toast.error(error.message))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [typeCode, debouncedSearch, status, criticality, owner, filters, page, pageSize, sortBy, sortDir]);

  useEffect(() => {
    if (skipPageResetRef.current) {
      skipPageResetRef.current = false;
      return;
    }
    setPage(1);
    setSelectedIds(new Set());
  }, [typeCode, debouncedSearch, status, criticality, owner, filters, pageSize]);

  useEffect(() => {
    setSelectedIds(new Set());
  }, [page]);

  useEffect(() => {
    if (searchParams.get('new') === '1' && can('cmdb.edit') && types.length) {
      openCreate();
      const next = new URLSearchParams(searchParams);
      next.delete('new');
      setSearchParams(next, { replace: true });
    }
  }, [searchParams.get('new'), types.length]);

  useEffect(() => {
    const editId = searchParams.get('edit');
    if (!editId || !types.length || !can('cmdb.edit')) return;
    api
      .get<{ data: CI }>(`/api/cis/${editId}`)
      .then((response) => openEdit(response.data))
      .catch((error) => toast.error(error.message))
      .finally(() => {
        const next = new URLSearchParams(searchParams);
        next.delete('edit');
        setSearchParams(next, { replace: true });
      });
  }, [searchParams.get('edit'), types.length]);

  const setType = (code: string) => {
    if (code === typeCode) return;
    const next = new URLSearchParams(searchParams);
    if (code) next.set('type', code);
    else next.delete('type');
    setSearchParams(next);
    setSearch('');
    setPage(1);
  };

  const openDetail = (id: number, listType = typeCode) => {
    const snapshot: CmdbListSnapshot = {
      search,
      status,
      criticality,
      owner,
      filters,
      page,
      pageSize,
      sortBy,
      sortDir,
    };
    try {
      sessionStorage.setItem(listSnapshotKey(listType), JSON.stringify(snapshot));
    } catch {
      // Ignore storage quota/private-mode failures; navigation still works.
    }
    navigate(`/cmdb/${id}`, { state: { listType } });
  };

  const refresh = async () => {
    await loadTypes();
    const query = buildQuery({ type: typeCode, q: debouncedSearch, status, criticality, owner_id: owner, filters: filters.length ? JSON.stringify(filters) : undefined, page, pageSize });
    const response = await api.get<{ data: CI[]; pagination: { total: number } }>(`/api/cis${query}`);
    setRows(response.data);
    setTotal(response.pagination.total);
  };

  const loadFieldsForType = async (ciTypeId: number | string) => {
    if (!ciTypeId) return [];
    const response = await api.get<{ data: CIType }>(`/api/ci-types/${ciTypeId}`);
    return response.data.fields || [];
  };

  const openCreate = () => {
    const initialType = selectedType || types[0];
    const defaultTypeId = initialType?.id || '';
    setEditing(null);
    setForm({
      ...EMPTY_FORM,
      ci_type_id: form.ci_type_id || defaultTypeId,
      department: users.find((item) => item.username === 'zhangwei')?.department || '',
    });
    setFormError('');
    setFormOpen(true);
    if (defaultTypeId) {
      loadFieldsForType(defaultTypeId)
        .then((fields) => setFormFields(fields))
        .catch(() => setFormFields([]));
    }
  };

  const openEdit = async (ci: CI) => {
    setEditing(ci);
    setForm({
      ...EMPTY_FORM,
      ...ci,
      owner_id: ci.owner_id || '',
      attributes: ci.attributes || {},
    });
    setFormError('');
    setFormOpen(true);
    try {
      setFormFields(await loadFieldsForType(ci.ci_type_id));
    } catch {
      setFormFields([]);
    }
  };

  const onTypeChange = async (value: string) => {
    setForm((current) => ({ ...current, ci_type_id: Number(value), attributes: {} }));
    try {
      setFormFields(await loadFieldsForType(value));
    } catch {
      setFormFields([]);
    }
  };

  const save = async () => {
    setFormError('');
    if (!form.ci_type_id) return setFormError('请选择 CI 类型');
    const formType = types.find((item) => Number(item.id) === Number(form.ci_type_id));
    const basicConfig = getBasicFieldConfig(formType?.code);
    if (!basicConfig.asset_no?.hidden && !form.asset_no?.trim()) return setFormError('请填写资产编号');
    if (!basicConfig.name?.hidden && !form.name?.trim()) return setFormError('请填写资产名称');
    setSaving(true);
    try {
      const payload = {
        ...form,
        ci_type_id: Number(form.ci_type_id),
        owner_id: form.owner_id ? Number(form.owner_id) : null,
        cost: Number(form.cost || 0),
        attributes: form.attributes || {},
      };
      if (editing) {
        await api.put(`/api/cis/${editing.id}`, payload);
        toast.success('CI 已更新');
        notifyDataChanged();
        setFormOpen(false);
        await refresh();
        if (typeCode) loadTypeDetail();
      } else {
        const response = await api.post<{ data: CI }>('/api/cis', payload);
        toast.success('CI 已创建');
        notifyDataChanged();
        setFormOpen(false);
        await loadTypes();
        const createdType = types.find((item) => item.id === Number(form.ci_type_id));
        if (createdType?.code && createdType.code !== typeCode) setType(createdType.code);
        openDetail(response.data.id, typeCode);
      }
    } catch (error: any) {
      setFormError(error.message);
    } finally {
      setSaving(false);
    }
  };

  const loadTypeDetail = () => {
    if (!typeCode) return;
    api.get<{ data: CIType }>(`/api/ci-types/${typeCode}`).then((response) => setTypeDetail(response.data)).catch(() => {});
  };

  const loadApprovals = async () => {
    setApprovalLoading(true);
    try {
      const response = await api.get<{ data: any[] }>('/api/ci-deletion-requests?status=pending');
      setApprovals(response.data);
    } catch {
      setApprovals([]);
    } finally {
      setApprovalLoading(false);
    }
  };

  const reviewApproval = async (id: number, action: 'approve' | 'reject') => {
    try {
      await api.post(`/api/ci-deletion-requests/${id}/${action}`, { comment: action === 'approve' ? '审批通过' : '审批驳回' });
      toast.success(action === 'approve' ? '已通过删除申请' : '已驳回删除申请');
      await Promise.all([loadApprovals(), loadTypes(), refresh()]);
      notifyDataChanged();
    } catch (error: any) { toast.error(error.message); }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const response = await api.delete<any>(`/api/cis/${deleteTarget.id}`);
      toast.success(response?.pending_approval ? `删除申请已提交：${deleteTarget.asset_no}` : `已删除 ${deleteTarget.asset_no}`);
      notifyDataChanged();
      setDeleteTarget(null);
      await Promise.all([loadTypes(), refresh()]);
    } catch (error: any) {
      toast.error(error.message);
    } finally {
      setDeleting(false);
    }
  };

  const clearSelection = () => setSelectedIds(new Set());

  const toggleRowSelection = (id: number, checked: boolean) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  const togglePageSelection = (checked: boolean) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      for (const id of pageIds) {
        if (checked) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  };

  const openBulkEdit = async () => {
    if (!selectedRows.length) return;
    if (bulkMixedTypes) {
      toast.error('批量修改仅支持同一 CI 类型，请先按类型筛选');
      return;
    }
    setBulkForm({
      status: '', criticality: '', environment: '', owner_id: '', department: '', location: '',
      vendor: '', model: '', serial_no: '', bmc_address: '', mac_address: '', os_name: '', cpu: '', memory: '', disk: '', description: '',
    });
    setBulkAttributes({});
    setBulkEditOpen(true);
    try {
      setBulkFields(await loadFieldsForType(selectedRows[0].ci_type_id));
    } catch {
      setBulkFields([]);
    }
  };

  const saveBulkEdit = async () => {
    const values: Record<string, any> = {};
    if (bulkForm.status) values.status = bulkForm.status;
    if (bulkForm.criticality) values.criticality = bulkForm.criticality;
    if (bulkForm.environment) values.environment = bulkForm.environment;
    if (bulkForm.owner_id === '__none__') values.owner_id = null;
    else if (bulkForm.owner_id) values.owner_id = Number(bulkForm.owner_id);
    if (bulkForm.department.trim()) values.department = bulkForm.department.trim();
    if (bulkForm.location.trim()) values.location = bulkForm.location.trim();
    for (const key of ['vendor', 'model', 'serial_no', 'bmc_address', 'mac_address', 'os_name', 'cpu', 'memory', 'disk', 'purchase_date', 'warranty_end', 'cost', 'description']) {
      if (String(bulkForm[key] || '').trim()) values[key] = String(bulkForm[key]).trim();
    }
    const attributes = Object.fromEntries(Object.entries(bulkAttributes).filter(([, value]) => value !== '' && value !== undefined && value !== null));
    if (Object.keys(attributes).length) values.attributes = attributes;
    if (!Object.keys(values).length) {
      toast.error('请至少选择一个要修改的字段');
      return;
    }
    setBulkSaving(true);
    try {
      const response = await api.post<any>('/api/cis/bulk', {
        ids: [...selectedIds],
        action: 'update',
        values,
      });
      toast.success(`已批量更新 ${response.updated} 个 CI`);
      notifyDataChanged();
      setBulkEditOpen(false);
      clearSelection();
      await Promise.all([loadTypes(), refresh()]);
    } catch (error: any) {
      toast.error(error.message);
    } finally {
      setBulkSaving(false);
    }
  };

  const openBulkConvert = () => {
    if (!selectedRows.length) return;
    if (bulkMixedTypes) {
      toast.error('批量转换仅支持同一 CI 类型，请先按类型筛选');
      return;
    }
    setConvertTargetId('');
    setConvertOpen(true);
  };

  const saveBulkConvert = async () => {
    if (!convertTargetType) {
      toast.error('请选择目标 CI 类型');
      return;
    }
    setConvertSaving(true);
    try {
      const response = await api.post<any>('/api/cis/bulk', {
        ids: [...selectedIds],
        action: 'convert',
        target_type_id: convertTargetType.id,
      });
      toast.success(`已将 ${response.converted} 个 CI 转换为「${convertTargetType.name}」`);
      notifyDataChanged();
      setConvertOpen(false);
      clearSelection();
      await Promise.all([loadTypes(), refresh()]);
    } catch (error: any) {
      toast.error(error.message);
    } finally {
      setConvertSaving(false);
    }
  };

  const confirmBulkDelete = async () => {
    if (!selectedIds.size) return;
    setBulkDeleting(true);
    try {
      const response = await api.post<any>('/api/cis/bulk', { ids: [...selectedIds], action: 'delete' });
      toast.success(response?.pending_approval ? `已提交 ${response.requested} 个 CI 删除申请` : `已批量删除 ${response.deleted} 个 CI`);
      notifyDataChanged();
      setBulkDeleteOpen(false);
      clearSelection();
      await loadTypes();
      if (page === 1) await refresh();
      else setPage(1);
    } catch (error: any) {
      toast.error(error.message);
    } finally {
      setBulkDeleting(false);
    }
  };

  const openImport = () => {
    setImportType(typeCode || types[0]?.code || 'server');
    setImportFile(null);
    setImportResult(null);
    setImportOpen(true);
  };

  const downloadTemplate = async () => {
    try {
      await downloadFile(`/api/cis/template?type=${importType}`, 'CI导入模板.xlsx');
      toast.success('模板已下载');
    } catch (error: any) {
      toast.error(error.message);
    }
  };

  const exportCurrent = async () => {
    if (!typeCode) {
      toast.info('请先在类型卡片中选择一个 CI 类型后再导出');
      return;
    }
    try {
      const filename = await downloadFile(
        `/api/cis/export${buildQuery({ type: typeCode, q: debouncedSearch, status, criticality })}`,
        `${selectedType?.name || 'CI'}_资产.xlsx`,
      );
      toast.success(`已导出 ${filename}`);
    } catch (error: any) {
      toast.error(error.message);
    }
  };

  const runImport = async () => {
    if (!importFile) return toast.error('请选择 .xlsx 文件');
    setImporting(true);
    setImportResult(null);
    try {
      const data = new FormData();
      data.append('file', importFile);
      const response = await api.post<any>(`/api/cis/import${buildQuery({ type: importType, mode: importMode })}`, data);
      setImportResult(response);
      await Promise.all([loadTypes(), refresh()]);
      if (response.failed === 0) toast.success(`导入完成：新建 ${response.created}，更新 ${response.updated}`);
      else toast.warning(`导入完成，但有 ${response.failed} 行失败`);
    } catch (error: any) {
      const details = error.details || {};
      if (Array.isArray(details.errors) && details.errors.length) {
        setImportResult({ created: 0, updated: 0, failed: details.errors.length, errors: details.errors, validation: true });
      }
      toast.error(error.message);
    } finally {
      setImporting(false);
    }
  };

  const activeFilters = [status, criticality, owner, search].filter(Boolean).length + filters.length;
  const filterFields = [
    ...BASIC_FIELDS.filter(([key]) => basicFieldVisible(typeCode, key)).map(([key, label]) => ({ value: key, label })),
    ...(typeDetail?.fields || []).map((field) => ({ value: `attr.${field.field_key}`, label: field.label })),
  ];
  const basicListConfig = getBasicFieldConfig(typeCode);
  const listLabel = (key: string, label: string) => key === 'location' ? '位置 / IP' : key === 'owner_id' ? '负责人' : label;
  const listField = (key: string) => key === 'owner_id'
    ? 'owner_name'
    : key === 'location'
      ? (basicFieldVisible(typeCode, 'ip_address') ? 'ip_address' : 'location')
      : key;
  const customListFields = typeDetail?.fields?.filter((field) => field.show_in_list) || [];
  const listColumns = [
    ...(!typeCode ? [{ key: 'type_name', label: '类型', field: 'type_name' }] : []),
    ...BASIC_FIELDS
      .filter(([key]) => !['asset_no', 'name', 'ci_type_id'].includes(key) && basicListConfig[key]?.list)
      .map(([key, label]) => ({ key, label: listLabel(key, label), field: listField(key) })),
    ...customListFields.map((field) => ({ key: `attr:${field.field_key}`, label: field.label, field: `attr:${field.field_key}` })),
    { key: 'updated_at', label: '更新时间', field: 'updated_at' },
  ];

  return (
    <div className="animate-enter">
      <PageHeader
        eyebrow="Configuration Management"
        title="配置管理数据库"
        description="统一管理服务器、网络、安全、机房与软件等 CI，维护资产关系、生命周期与业务影响。"
        actions={
          <>
            {can('cmdb.import') ? (
              <Button variant="secondary" size="sm" icon={Download} onClick={openImport}>
                导入
              </Button>
            ) : null}
            {can('cmdb.import') ? (
              <Button variant="secondary" size="sm" icon={Upload} onClick={exportCurrent} disabled={!typeCode}>
                导出
              </Button>
            ) : null}
            {can('cmdb.edit') ? (
              <Button size="sm" icon={Plus} onClick={openCreate}>
                新建 CI
              </Button>
            ) : null}
          </>
        }
      />

      {!typeCode ? (
      <div className="mb-3.5 grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-5">
        <button
          onClick={() => setType('')}
          className={cn(
            'group flex h-[76px] items-center gap-3 rounded-xl border px-3 text-left transition',
            !typeCode ? 'border-brand-300 bg-brand-50 ring-2 ring-brand-100' : 'border-[#e7eaf1] bg-white hover:border-brand-300 hover:bg-brand-50/40',
          )}
        >
          <span className={cn('flex h-11 w-11 shrink-0 items-center justify-center rounded-xl', !typeCode ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-500')}>
            <Layers3 className="h-5 w-5" />
          </span>
          <span className="min-w-0">
            <span className="block text-[15px] font-semibold text-slate-800">全部资产</span>
            <span className="mt-0.5 block text-[11px] text-slate-400">{totalAll} 个 CI</span>
          </span>
        </button>
        {typesLoading
          ? Array.from({ length: 8 }).map((_, index) => <div key={index} className="h-[76px] animate-pulse rounded-xl border border-[#e7eaf1] bg-white" />)
          : types.map((type) => {
              const selected = type.code === typeCode;
              return (
                <button
                  key={type.id}
                  onClick={() => type.code === 'ip' ? navigate('/cmdb/ips') : setType(type.code)}
                  className={cn(
                    'group flex h-[76px] items-center gap-3 rounded-xl border px-3 text-left transition',
                    selected ? 'border-brand-300 bg-brand-50 ring-2 ring-brand-100' : 'border-[#e7eaf1] bg-white hover:border-brand-300 hover:bg-brand-50/40 hover:shadow-sm',
                  )}
                >
                  <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-white" style={{ background: type.color }}>
                    <DynamicIcon name={type.icon} className="h-5 w-5" />
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-[15px] font-semibold text-slate-800">{type.name}</span>
                    <span className="mt-0.5 block text-[11px] text-slate-400">{type.code === 'ip' ? `${ipAddressCount} 个 IP` : `${type.ci_count || 0} 个 CI`}</span>
                  </span>
                </button>
              );
            })}
        {can('cmdb.model_manage') ? (
          <button onClick={() => navigate('/cmdb/model?new=1')} className="group flex h-[76px] items-center gap-3 rounded-xl border border-dashed border-slate-300 bg-white/70 px-3 text-left transition hover:border-brand-300 hover:bg-brand-50/40">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-500 group-hover:bg-brand-100 group-hover:text-brand-600"><Plus className="h-5 w-5" /></span>
            <span className="min-w-0"><span className="block text-[15px] font-semibold text-slate-800">新增资产类型</span><span className="mt-0.5 block text-[11px] text-slate-400">定义后自动出现在资产菜单</span></span>
          </button>
        ) : null}
      </div>
      ) : null}

      <div className="card overflow-hidden">
        <div className="flex flex-col gap-3 border-b border-[#edf0f6] p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-2">
              <h2 className="text-[14px] font-semibold text-slate-800">{selectedType ? selectedType.name : '全部配置项'}</h2>
              <span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[9.5px] font-medium text-slate-500">{total} 条</span>
              {selectedType ? <p className="hidden text-[10.5px] text-slate-400 lg:block">· {selectedType.description}</p> : null}
            </div>
            <div className="flex items-center gap-2">
              <Button variant="secondary" size="sm" icon={ShieldCheck} onClick={() => { setApprovalsOpen(true); loadApprovals(); }}>删除审批</Button>
              <Button variant="ghost" size="sm" icon={RefreshCw} onClick={refresh} loading={loading}>刷新</Button>
            </div>
          </div>
          <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
            <SearchInput value={search} onChange={setSearch} placeholder="搜索资产编号、名称、IP、型号或位置…" className="w-full lg:w-[340px]" />
            <div className="flex flex-1 flex-wrap items-center gap-2">
              <select className="input-base h-9 w-auto min-w-[110px] text-[12px]" value={status} onChange={(event) => setStatus(event.target.value)}>
                <option value="">全部状态</option>
                {Object.entries(CI_STATUS_META).map(([value, meta]) => <option key={value} value={value}>{meta.label}</option>)}
              </select>
              <select className="input-base h-9 w-auto min-w-[110px] text-[12px]" value={criticality} onChange={(event) => setCriticality(event.target.value)}>
                <option value="">全部级别</option>
                {Object.entries(CRITICALITY_META).map(([value, meta]) => <option key={value} value={value}>{meta.label}</option>)}
              </select>
              <select className="input-base h-9 w-auto min-w-[120px] text-[12px]" value={owner} onChange={(event) => setOwner(event.target.value)}>
                <option value="">全部负责人</option>
                {users.filter((user) => user.status === 'active' && !['admin', 'auditor'].includes(String((user as any).role_code || ''))).map((user) => <option key={user.id} value={user.id}>{user.name}</option>)}
              </select>
              <Button variant={filterOpen || filters.length ? 'secondary' : 'ghost'} size="sm" icon={Filter} onClick={() => setFilterOpen((value) => !value)}>筛选{filters.length ? ` (${filters.length})` : ''}</Button>
              {activeFilters ? (
                <button
                  onClick={() => { setSearch(''); setStatus(''); setCriticality(''); setOwner(''); setFilters([]); }}
                  className="flex h-9 items-center gap-1 rounded-lg px-2 text-[11px] text-slate-500 hover:bg-slate-100"
                >
                  <RotateCcw className="h-3 w-3" /> 清除
                </button>
              ) : null}
            </div>
          </div>
          {filterOpen ? (
            <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-3">
              <div className="mb-2 flex items-center justify-between"><p className="text-[11px] font-medium text-slate-700">自定义筛选字段 <span className="font-normal text-slate-400">（随 CI 模型字段自动变化）</span></p><button onClick={() => setFilters((current) => [...current, { field: 'location', op: 'contains', value: '' }])} className="text-[10px] font-medium text-brand-600 hover:text-brand-800">+ 添加条件</button></div>
              {filters.length ? <div className="space-y-2">{filters.map((filter, index) => (
                <div key={index} className="flex flex-wrap items-center gap-2">
                  <select className="input-base h-8 w-[150px] text-[11px]" value={filter.field} onChange={(event) => setFilters((current) => current.map((item, i) => i === index ? { ...item, field: event.target.value } : item))}>
                    {filterFields.map((field) => <option key={field.value} value={field.value}>{field.label}</option>)}
                  </select>
                  <select className="input-base h-8 w-[90px] text-[11px]" value={filter.op} onChange={(event) => setFilters((current) => current.map((item, i) => i === index ? { ...item, op: event.target.value as 'contains' | 'equals' } : item))}>
                    <option value="contains">包含</option><option value="equals">等于</option>
                  </select>
                  <Input className="h-8 w-[190px] text-[11px]" value={filter.value} onChange={(event) => setFilters((current) => current.map((item, i) => i === index ? { ...item, value: event.target.value } : item))} placeholder="输入筛选值" />
                  <button onClick={() => setFilters((current) => current.filter((_, i) => i !== index))} className="rounded p-1 text-slate-400 hover:bg-white hover:text-rose-500" aria-label="删除筛选条件"><X className="h-3.5 w-3.5" /></button>
                </div>
              ))}</div> : <p className="text-[10px] text-slate-400">点击「添加条件」按位置、IP、厂商或当前 CI 类型的扩展字段筛选。</p>}
            </div>
          ) : null}
        </div>

        {canEditCis && selectedIds.size > 0 ? (
          <div className="animate-enter-fast mx-4 mb-3 flex flex-col gap-2 rounded-md border border-[#dbe7ff] bg-[#eff4ff] px-3.5 py-2.5 sm:flex-row sm:items-center">
            <div className="flex min-w-0 flex-1 items-center gap-2">
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-brand-600 text-white"><ListChecks className="h-3.5 w-3.5" /></span>
              <div className="min-w-0">
                <p className="text-[11.5px] font-semibold text-brand-900">已选择 {selectedIds.size} 个 CI</p>
                <p className="mt-0.5 truncate text-[9.5px] text-brand-700/65">
                  {bulkMixedTypes ? '包含多种 CI 类型，仅支持批量删除；类型转换需先按类型筛选' : `类型：${selectedRows[0]?.type_name || selectedType?.name || '—'} · 可批量修改或转换同类资产`}
                </p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <Button variant="secondary" size="xs" icon={ListChecks} onClick={openBulkEdit} disabled={bulkMixedTypes}>批量修改</Button>
              <Button variant="secondary" size="xs" icon={ArrowRightLeft} onClick={openBulkConvert} disabled={bulkMixedTypes}>转换类型</Button>
              <Button variant="secondary" size="xs" icon={ShieldCheck} onClick={() => setAccessBulkOpen(true)}>批量授权</Button>
              <Button variant="secondary" size="xs" icon={Trash2} className="text-rose-600 hover:bg-rose-50" onClick={() => setBulkDeleteOpen(true)}>批量删除</Button>
              <button onClick={clearSelection} className="flex h-7 items-center gap-1 rounded-lg px-2 text-[10.5px] text-slate-500 hover:bg-white/70">
                <X className="h-3 w-3" /> 取消选择
              </button>
            </div>
          </div>
        ) : null}

        {loading ? (
          <TableSkeleton rows={7} cols={6} />
        ) : rows.length ? (
          <>
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    {canEditCis ? (
                      <th className="w-10 pl-4 pr-0">
                        <Checkbox checked={allPageSelected} indeterminate={somePageSelected && !allPageSelected} onChange={togglePageSelection} label="" />
                      </th>
                    ) : null}
                    <SortableTh label="资产" field="asset_no" sortBy={sortBy} sortDir={sortDir} onSort={toggleSort} className="min-w-[240px]" />
                    {listColumns.map((column) => column.field
                      ? <SortableTh key={column.key} label={column.label} field={column.field} sortBy={sortBy} sortDir={sortDir} onSort={toggleSort} />
                      : <th key={column.key}>{column.label}</th>)}
                    <th className="w-[92px] text-right">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((ci) => {
                    const ciStatus = CI_STATUS_META[ci.status] || CI_STATUS_META.idle;
                    const level = CRITICALITY_META[ci.criticality] || CRITICALITY_META.medium;
                    return (
                      <tr key={ci.id} className={cn('group cursor-pointer', selectedIds.has(ci.id) && 'bg-brand-50/45')} onClick={() => openDetail(ci.id)}>
                        {canEditCis ? (
                          <td className="w-10 pl-4 pr-0">
                            <Checkbox checked={selectedIds.has(ci.id)} onChange={(checked) => toggleRowSelection(ci.id, checked)} label="" />
                          </td>
                        ) : null}
                        <td>
                          <div className="flex items-center gap-3">
                            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg" style={{ background: `${ci.type_color || '#4f6ef7'}14`, color: ci.type_color || '#4f6ef7' }}>
                              <DynamicIcon name={ci.type_icon} className="h-4 w-4" />
                            </span>
                            <div className="min-w-0">
                              <p className="truncate text-[12.5px] font-medium text-slate-700 group-hover:text-brand-700">{ci.name}</p>
                              <p className="mt-0.5 font-mono text-[9.5px] text-slate-400">{ci.asset_no}</p>
                            </div>
                          </div>
                        </td>
                        {listColumns.map((column) => {
                          if (column.key === 'type_name') return <td key={column.key}><span className="inline-flex items-center gap-1.5 text-[11px] text-slate-500"><span className="h-1.5 w-1.5 rounded-full" style={{ background: ci.type_color }} />{ci.type_name}</span></td>;
                          if (column.key === 'status') return <td key={column.key}><Badge className={ciStatus.className} dot={ciStatus.dot}>{ciStatus.label}</Badge></td>;
                          if (column.key === 'criticality') return <td key={column.key}><Badge className={level.className}>{level.label}</Badge></td>;
                          if (column.key === 'environment') {
                            const rawEnvironment = String(ci.environment || '').trim().toLowerCase();
                            const environment = ENVIRONMENT_META[rawEnvironment] || {
                              label: rawEnvironment === '生产环境' || rawEnvironment === 'prod' ? '生产环境' : rawEnvironment === '测试环境' ? '测试环境' : rawEnvironment === '预发布' ? '预发布' : rawEnvironment === '灾备环境' ? '灾备环境' : (ci.environment || '—'),
                              className: rawEnvironment === '生产环境' || rawEnvironment === 'prod' ? 'bg-rose-50 text-rose-700 ring-rose-600/15' : 'bg-slate-100 text-slate-600 ring-slate-500/10',
                            };
                            return <td key={column.key}><Badge className={environment.className}>{environment.label}</Badge></td>;
                          }
                          if (column.key === 'owner_id') return <td key={column.key}><span className="flex items-center gap-1.5 text-[11px] text-slate-500"><Avatar name={ci.owner_name || '未分配'} src={ci.owner_avatar_url} size="xs" color="#94a3b8" /><span className="max-w-[70px] truncate">{ci.owner_name || '未分配'}</span></span></td>;
                          if (column.key === 'location') return <td key={column.key}><p className="max-w-[190px] truncate text-[11px] text-slate-500">{ci.location || '—'}</p><p className="mt-0.5 font-mono text-[9.5px] text-slate-400">{ci.ip_address || '无 IP'}</p></td>;
                          if (column.key === 'updated_at') return <td key={column.key} className="whitespace-nowrap text-[10.5px] text-slate-400">{relativeTime(ci.updated_at)}</td>;
                          if (!column.key.startsWith('attr:')) {
                            const value = (ci as any)[column.key];
                            return <td key={column.key} className="max-w-[180px] truncate text-[11px] text-slate-500">{value || '—'}</td>;
                          }
                          const attributeKey = column.key.replace(/^attr:/, '');
                          const value = ci.attributes?.[attributeKey];
                          return <td key={column.key} className="max-w-[140px] truncate text-[11px] text-slate-500">{Array.isArray(value) ? value.join('、') : value || '—'}</td>;
                        })}
                        <td>
                          <div className="flex items-center justify-end gap-0.5 opacity-0 transition group-hover:opacity-100">
                            {can('cmdb.edit') ? (
                              <>
                                <IconButton icon={Pencil} label="编辑" onClick={(event) => { event.stopPropagation(); openEdit(ci); }} />
                                <IconButton icon={Trash2} label="删除" variant="danger" onClick={(event) => { event.stopPropagation(); setDeleteTarget(ci); }} />
                              </>
                            ) : (
                              <ArrowRight className="h-3.5 w-3.5 text-slate-300" />
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="flex flex-col items-center justify-between gap-2 border-t border-[#eef1f6] px-4 py-2 sm:flex-row">
              <PageSizeSelect value={pageSize} onChange={setPageSize} />
              <Pagination page={page} pageSize={pageSize} total={total} onChange={setPage} />
            </div>
          </>
        ) : (
          <EmptyState
            title={activeFilters ? '没有匹配的配置项' : '该类型下还没有配置项'}
            description={activeFilters ? '调整搜索或筛选条件后再试。' : '可以通过新建 CI 或 Excel 批量导入开始建立资产台账。'}
            icon={Boxes}
            action={
              can('cmdb.edit') ? <Button size="sm" icon={Plus} onClick={openCreate}>新建 CI</Button> : undefined
            }
          />
        )}
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 px-1 text-[10px] text-slate-400">
        <span>资产数据来自统一 CMDB 模型，支持自定义字段扩展与 Excel 双向流转。</span>
        <span className="flex items-center gap-1.5"><span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> 数据已同步 · {formatDate(new Date().toISOString(), 'HH:mm')}</span>
      </div>

      <CIModal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        editing={editing}
        form={form}
        setForm={setForm}
        fields={formFields}
        types={types}
        users={users}
        onTypeChange={onTypeChange}
        onSave={save}
        saving={saving}
        error={formError}
      />

      <ImportModal
        open={importOpen}
        onClose={() => setImportOpen(false)}
        types={types}
        importType={importType}
        setImportType={setImportType}
        file={importFile}
        setFile={setImportFile}
        mode={importMode}
        setMode={setImportMode}
        dragging={dragging}
        setDragging={setDragging}
        fileInputRef={fileInputRef}
        onTemplate={downloadTemplate}
        onImport={runImport}
        importing={importing}
        result={importResult}
      />

      <Modal
        open={bulkEditOpen}
        onClose={() => setBulkEditOpen(false)}
        title={`批量修改 ${selectedIds.size} 个 CI`}
        description="仅修改你填写或选择的字段，留空表示保持原值。批量修改仅支持同一 CI 类型。"
        icon={ListChecks}
        size="md"
        footer={
          <>
            <Button variant="secondary" size="sm" onClick={() => setBulkEditOpen(false)}>取消</Button>
            <Button size="sm" loading={bulkSaving} onClick={saveBulkEdit}>应用修改</Button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="rounded-xl border border-brand-100 bg-brand-50/60 px-3 py-2.5">
            <p className="text-[10px] text-brand-700/70">已选资产</p>
            <p className="mt-1 text-[11px] font-medium text-brand-900">
              {selectedRows.slice(0, 3).map((row) => row.asset_no).join('、')}
              {selectedRows.length > 3 ? ` 等 ${selectedRows.length} 个` : ''}
            </p>
            <p className="mt-1 text-[9.5px] text-brand-700/60">类型：{selectedRows[0]?.type_name || '—'} · 修改将写入审计日志</p>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {bulkBaseVisible('status') ? <Field label="状态">
              <SearchSelect value={bulkForm.status} onChange={(value) => setBulkForm((current) => ({ ...current, status: value }))} options={[{ value: '', label: '不修改' }, ...Object.entries(CI_STATUS_META).map(([value, meta]) => ({ value, label: meta.label }))]} />
            </Field> : null}
            {bulkBaseVisible('criticality') ? <Field label="关键级别">
              <SearchSelect value={bulkForm.criticality} onChange={(value) => setBulkForm((current) => ({ ...current, criticality: value }))} options={[{ value: '', label: '不修改' }, ...Object.entries(CRITICALITY_META).map(([value, meta]) => ({ value, label: meta.label }))]} />
            </Field> : null}
            {bulkBaseVisible('environment') ? <Field label="运行环境">
              <SearchSelect value={bulkForm.environment} onChange={(value) => setBulkForm((current) => ({ ...current, environment: value }))} options={[{ value: '', label: '不修改' }, ...Object.entries(ENVIRONMENT_META).map(([value, meta]) => ({ value, label: meta.label }))]} />
            </Field> : null}
            {bulkBaseVisible('owner_id') ? <Field label="负责人">
              <SearchSelect value={bulkForm.owner_id} onChange={(value) => setBulkForm((current) => ({ ...current, owner_id: value }))} options={[{ value: '', label: '不修改' }, { value: '__none__', label: '清空负责人' }, ...users.filter((user) => user.status === 'active' && !['admin', 'auditor'].includes(String((user as any).role_code || ''))).map((user) => ({ value: String(user.id), label: user.name, description: user.department || '' }))]} />
            </Field> : null}
            {bulkBaseVisible('department') ? <Field label="所属部门" hint="留空不修改">
              <Input value={bulkForm.department} onChange={(event) => setBulkForm((current) => ({ ...current, department: event.target.value }))} placeholder="批量设置部门" />
            </Field> : null}
            {bulkBaseVisible('location') ? <Field label="位置" hint="留空不修改">
              <Input value={bulkForm.location} onChange={(event) => setBulkForm((current) => ({ ...current, location: event.target.value }))} placeholder="批量设置机房 / 机柜位置" />
            </Field> : null}
            {[
              ['vendor', '厂商'], ['model', '型号'], ['serial_no', '序列号'], ['bmc_address', 'BMC 管理地址'],
              ['mac_address', 'MAC 地址'], ['os_name', '操作系统'], ['cpu', 'CPU'], ['memory', '内存'], ['disk', '磁盘'], ['purchase_date', '采购日期'], ['warranty_end', '保修到期'], ['cost', '资产价值'], ['description', '描述'],
            ].filter(([key]) => bulkBaseVisible(key)).map(([key, label]) => (
              <Field key={key} label={label} hint="留空不修改">
                <Input value={bulkForm[key] || ''} onChange={(event) => setBulkForm((current) => ({ ...current, [key]: event.target.value }))} placeholder={`批量设置${label}`} />
              </Field>
            ))}
          </div>
          {bulkFields.length ? (
            <div className="mt-4 border-t border-slate-100 pt-4">
              <p className="mb-3 text-[11px] font-medium text-slate-700">自定义扩展字段</p>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {bulkFields.map((field) => (
                  <DynamicField
                    key={field.id}
                    field={field}
                    value={bulkAttributes[field.field_key]}
                    onChange={(value) => setBulkAttributes((current) => ({ ...current, [field.field_key]: value }))}
                    emptyLabel="不修改"
                  />
                ))}
              </div>
            </div>
          ) : null}
        </div>
      </Modal>

      <Modal
        open={convertOpen}
        onClose={() => setConvertOpen(false)}
        title={`转换 ${selectedIds.size} 个 CI 的类型`}
        description="将同一类型的资产批量转换为另一种 CI 类型；资产编号、名称与已有属性都会保留。"
        icon={ArrowRightLeft}
        size="md"
        footer={
          <>
            <Button variant="secondary" size="sm" onClick={() => setConvertOpen(false)}>取消</Button>
            <Button size="sm" loading={convertSaving} disabled={!convertTargetType} onClick={saveBulkConvert}>确认转换</Button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="grid grid-cols-1 items-center gap-3 rounded-xl border border-brand-100 bg-brand-50/60 p-3 sm:grid-cols-[1fr_auto_1fr]">
            <div>
              <p className="text-[10px] text-brand-700/60">当前类型</p>
              <p className="mt-1 text-[12px] font-semibold text-brand-900">{convertSourceType?.name || selectedRows[0]?.type_name || '—'}</p>
              <p className="mt-0.5 text-[9.5px] text-brand-700/60">{selectedIds.size} 个资产</p>
            </div>
            <ArrowRightLeft className="hidden h-4 w-4 text-brand-400 sm:block" />
            <div>
              <p className="text-[10px] text-brand-700/60">目标类型</p>
              <p className="mt-1 text-[12px] font-semibold text-brand-900">{convertTargetType?.name || '待选择'}</p>
              <p className="mt-0.5 text-[9.5px] text-brand-700/60">{convertTargetType ? `${convertTargetType.field_count || 0} 个扩展字段` : '请选择'}</p>
            </div>
          </div>
          <Field label="目标 CI 类型" hint="仅列出已启用的类型；转换后可在资产详情继续补充目标类型字段">
            <select className="input-base" value={convertTargetId} onChange={(event) => setConvertTargetId(event.target.value)}>
              <option value="">选择目标类型…</option>
              {convertTargetTypes.map((type) => (
                <option key={type.id} value={type.id}>{type.name}（{type.code}）</option>
              ))}
            </select>
          </Field>
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-[10px] leading-relaxed text-amber-800">
            <p className="font-medium">转换前请确认</p>
            <p className="mt-1">只改变 CI 类型，不删除资产，也不会自动删除已有关系；转换后请检查关系、位置与目标类型的必填扩展字段。原扩展字段值会保留在资产属性中，但只展示目标类型定义的字段。</p>
            {convertSourceType?.rackable && convertTargetType && !convertTargetType.rackable ? <p className="mt-1 font-medium">目标类型不支持机柜上架，已上架资产需要先下架。</p> : null}
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        open={bulkDeleteOpen}
        onClose={() => setBulkDeleteOpen(false)}
        onConfirm={confirmBulkDelete}
        loading={bulkDeleting}
        title={`批量删除 ${selectedIds.size} 个 CI`}
        confirmText="确认批量删除"
        description={
          <>
            确定删除已选择的 <strong>{selectedIds.size}</strong> 个配置项吗？其关联关系与工单关联会一并移除。
            <br />
            此操作不可撤销，建议先导出资产备份。
          </>
        }
      />

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onClose={() => setDeleteTarget(null)}
        onConfirm={confirmDelete}
        loading={deleting}
        title="删除配置项"
        confirmText="确认删除"
        description={
          <>
            确定要删除 <strong>{deleteTarget?.asset_no}</strong>（{deleteTarget?.name}）吗？
            <br />
            与该 CI 关联的关系和工单关联也会被移除，此操作不可撤销。
          </>
        }
      />
      <Modal open={accessBulkOpen} onClose={() => setAccessBulkOpen(false)} title="批量资产授权" description={`为已选择的 ${selectedIds.size} 个资产设置资产管理员和访问权限。`} icon={ShieldCheck} size="md" footer={<><Button variant="secondary" size="sm" onClick={() => setAccessBulkOpen(false)}>取消</Button><Button size="sm" loading={accessSaving} onClick={async () => {
        setAccessSaving(true);
        try {
          await api.post('/api/cis/bulk-access', { ids: [...selectedIds], asset_manager_id: accessManager ? Number(accessManager) : null, grants: [...accessGrants].map((userId) => ({ user_id: userId, can_edit: accessEditGrants.has(userId) })) });
          toast.success('批量授权已保存'); setAccessBulkOpen(false); clearSelection();
        } catch (error: any) { toast.error(error.message); } finally { setAccessSaving(false); }
      }}>保存授权</Button></>}>
        <div className="space-y-3">
          <Field label="资产管理员"><select className="input-base" value={accessManager} onChange={(event) => setAccessManager(event.target.value)}><option value="">未指定</option>{users.map((user) => <option key={user.id} value={user.id}>{user.name} · {user.username}</option>)}</select></Field>
          <div className="max-h-[320px] space-y-1 overflow-y-auto rounded-xl border border-slate-200 p-2">
            {users.filter((user) => String(user.id) !== accessManager).map((user) => (
              <div key={user.id} className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-slate-50">
                <input type="checkbox" checked={accessGrants.has(user.id)} onChange={(event) => setAccessGrants((current) => { const next = new Set(current); if (event.target.checked) next.add(user.id); else next.delete(user.id); return next; })} />
                <span className="min-w-0 flex-1 text-[10.5px] text-slate-600">{user.name} <span className="text-slate-400">{user.username}</span></span>
                <label className="flex items-center gap-1 text-[9px] text-slate-400"><input type="checkbox" disabled={!accessGrants.has(user.id)} checked={accessEditGrants.has(user.id)} onChange={(event) => setAccessEditGrants((current) => { const next = new Set(current); if (event.target.checked) next.add(user.id); else next.delete(user.id); return next; })} />可编辑</label>
              </div>
            ))}
          </div>
        </div>
      </Modal>

      <Modal open={approvalsOpen} onClose={() => setApprovalsOpen(false)} title="CI 删除审批" description="审批通过后才会真正删除配置项；超级管理员可直接删除。" icon={ShieldCheck} size="md" footer={<Button variant="secondary" size="sm" onClick={() => setApprovalsOpen(false)}>关闭</Button>}>
        {approvalLoading ? <Spinner /> : approvals.length ? <div className="space-y-2">{approvals.map((item) => (
          <div key={item.id} className="flex flex-col gap-2 rounded-xl border border-slate-200 p-3 sm:flex-row sm:items-center">
            <div className="min-w-0 flex-1"><p className="text-[11.5px] font-medium text-slate-700">{item.ci_asset_no} · {item.ci_name}</p><p className="mt-0.5 text-[10px] text-slate-400">{item.ci_type_name} · 申请人 {item.requester_name || '—'} · {formatDate(item.created_at)}</p>{item.reason ? <p className="mt-1 text-[10px] text-slate-500">{item.reason}</p> : null}</div>
            <div className="flex shrink-0 gap-1.5"><Button size="xs" onClick={() => reviewApproval(item.id, 'approve')}>通过</Button><Button size="xs" variant="secondary" onClick={() => reviewApproval(item.id, 'reject')}>驳回</Button></div>
          </div>
        ))}</div> : <EmptyState title="暂无待审批删除申请" description="非管理员发起的 CI 删除会出现在这里。" icon={ShieldCheck} className="py-10" />}
      </Modal>
    </div>
  );
}

function CIModal({
  open,
  onClose,
  editing,
  form,
  setForm,
  fields,
  types,
  users,
  onTypeChange,
  onSave,
  saving,
  error,
}: {
  open: boolean;
  onClose: () => void;
  editing: CI | null;
  form: Record<string, any>;
  setForm: (updater: any) => void;
  fields: CIField[];
  types: CIType[];
  users: User[];
  onTypeChange: (value: string) => void;
  onSave: () => void;
  saving: boolean;
  error: string;
}) {
  const update = (key: string, value: any) => setForm((current: any) => ({ ...current, [key]: value }));
  const formTypeCode = types.find((item) => Number(item.id) === Number(form.ci_type_id))?.code;
  const showField = (key: string) => basicFieldVisible(formTypeCode, key);
  const updateAttr = (key: string, value: any) =>
    setForm((current: any) => ({ ...current, attributes: { ...(current.attributes || {}), [key]: value } }));

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="xl"
      resizable
      closeOnBackdrop={false}
      title={editing ? `编辑配置项 · ${editing.asset_no}` : '新建配置项'}
      description="维护基础信息、归属、技术配置和扩展属性；带 * 的字段为必填。"
      icon={editing ? Pencil : Plus}
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={onClose}>取消</Button>
          <Button size="sm" loading={saving} onClick={onSave}>{editing ? '保存修改' : '创建 CI'}</Button>
        </>
      }
    >
      {error ? (
        <div className="mb-4 flex items-start gap-2 rounded-xl border border-rose-100 bg-rose-50 px-3 py-2.5 text-[12px] text-rose-700">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /> {error}
        </div>
      ) : null}

      <div className="space-y-5">
        <FormSection title="基本信息" description="资产标识与分类信息">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <Field label="CI 类型" required>
              <SearchSelect value={String(form.ci_type_id || '')} onChange={onTypeChange} placeholder="选择类型" options={types.map((type) => ({ value: String(type.id), label: type.name, description: type.code }))} />
            </Field>
            {showField('asset_no') ? <Field label="资产编号" required>
              <Input value={form.asset_no} onChange={(event) => update('asset_no', event.target.value)} placeholder="如 SRV-PROD-001" className="font-mono" />
            </Field> : null}
            {showField('name') ? <Field label="资产名称" required>
              <Input value={form.name} onChange={(event) => update('name', event.target.value)} placeholder="业务可识别的资产名称" />
            </Field> : null}
            {showField('status') ? <Field label="状态">
              <SearchSelect value={String(form.status || '')} onChange={(value) => update('status', value)} options={Object.entries(CI_STATUS_META).map(([value, meta]) => ({ value, label: meta.label }))} />
            </Field> : null}
            {showField('criticality') ? <Field label="关键级别">
              <SearchSelect value={String(form.criticality || '')} onChange={(value) => update('criticality', value)} options={Object.entries(CRITICALITY_META).map(([value, meta]) => ({ value, label: meta.label }))} />
            </Field> : null}
            {showField('environment') ? <Field label="运行环境">
              <SearchSelect value={String(form.environment || '')} onChange={(value) => update('environment', value)} options={Object.entries(ENVIRONMENT_META).map(([value, meta]) => ({ value, label: meta.label }))} />
            </Field> : null}
          </div>
        </FormSection>

        <FormSection title="归属与生命周期" description="责任人和资产运营信息">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {showField('owner_id') ? <Field label="负责人">
              <SearchSelect value={String(form.owner_id || '')} onChange={(value) => update('owner_id', value)} placeholder="未分配" options={[{ value: '', label: '未分配' }, ...users.filter((user) => user.status === 'active' && !['admin', 'auditor'].includes(String((user as any).role_code || ''))).map((user) => ({ value: String(user.id), label: user.name, description: `${user.department || ''} ${user.username}`.trim() }))]} />
            </Field> : null}
            {showField('department') ? <Field label="所属部门">
              <Input value={form.department} onChange={(event) => update('department', event.target.value)} placeholder="如 IT 运维中心" />
            </Field> : null}
            {showField('location') ? <Field label="位置">
              <Input value={form.location} onChange={(event) => update('location', event.target.value)} placeholder="机房 / 机柜 / 云区域" />
            </Field> : null}
            {showField('purchase_date') ? <Field label="采购日期">
              <DateInput value={form.purchase_date || ''} onChange={(value) => update('purchase_date', value)} />
            </Field> : null}
            {showField('warranty_end') ? <Field label="保修到期">
              <DateInput value={form.warranty_end || ''} onChange={(value) => update('warranty_end', value)} />
            </Field> : null}
            {showField('cost') ? <Field label="资产价值 (¥)">
              <Input type="number" min="0" step="0.01" value={form.cost} onChange={(event) => update('cost', event.target.value)} placeholder="0.00" />
            </Field> : null}
          </div>
        </FormSection>

        <FormSection title="设备与配置" description="硬件、网络与软件层面的关键配置">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {showField('vendor') ? <Field label="厂商"><Input value={form.vendor} onChange={(event) => update('vendor', event.target.value)} placeholder="Northstar / Aeris / Aegis / Vertex" /></Field> : null}
            {showField('model') ? <Field label="型号"><Input value={form.model} onChange={(event) => update('model', event.target.value)} placeholder="设备型号" /></Field> : null}
            {showField('serial_no') ? <Field label="序列号"><Input value={form.serial_no} onChange={(event) => update('serial_no', event.target.value)} placeholder="SN / 资产序列号" className="font-mono" /></Field> : null}
            {showField('ip_address') ? <Field label="IP 地址"><Input value={form.ip_address} onChange={(event) => update('ip_address', event.target.value)} placeholder="10.20.1.11" className="font-mono" /></Field> : null}
            {showField('mac_address') ? <Field label="MAC 地址"><Input value={form.mac_address} onChange={(event) => update('mac_address', event.target.value)} placeholder="00:1A:2B:..." className="font-mono" /></Field> : null}
            {showField('bmc_address') ? <Field label="BMC 管理地址"><Input value={form.bmc_address} onChange={(event) => update('bmc_address', event.target.value)} placeholder="BMC / 带外管理地址" className="font-mono" /></Field> : null}
            {showField('os_name') ? <Field label="操作系统"><Input value={form.os_name} onChange={(event) => update('os_name', event.target.value)} placeholder="openEuler / 麒麟 / 统信 UOS" /></Field> : null}
            {showField('cpu') ? <Field label="CPU"><Input value={form.cpu} onChange={(event) => update('cpu', event.target.value)} placeholder="2 × 64C 通用处理器" /></Field> : null}
            {showField('memory') ? <Field label="内存"><Input value={form.memory} onChange={(event) => update('memory', event.target.value)} placeholder="256 GB" /></Field> : null}
            {showField('disk') ? <Field label="磁盘"><Input value={form.disk} onChange={(event) => update('disk', event.target.value)} placeholder="2 × 1.92TB NVMe RAID1" /></Field> : null}
          </div>
        </FormSection>

        <FormSection title="扩展属性" description="由 CI 模型定义，可按需扩展">
          {fields.length ? (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {fields.map((field) => (
                <DynamicField
                  key={field.id}
                  field={field}
                  value={form.attributes?.[field.field_key]}
                  onChange={(value) => updateAttr(field.field_key, value)}
                />
              ))}
            </div>
          ) : (
            <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/50 px-4 py-5 text-center text-[11px] text-slate-400">
              当前类型暂无扩展字段，可在「CI 模型」中按需添加。
            </div>
          )}
        </FormSection>

        {showField('description') ? <FormSection title="备注" description="补充说明、业务用途或维护提示">
          <RichTextEditor value={form.description} onChange={(description) => update('description', description)} placeholder="描述该配置项的业务用途、责任边界或特殊说明…" minHeight={88} />
        </FormSection> : null}
      </div>
    </Modal>
  );
}

function FormSection({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <section>
      <div className="mb-3 flex items-center gap-2 border-b border-slate-100 pb-2">
        <span className="h-3 w-0.5 rounded-full bg-brand-500" />
        <h3 className="text-[12px] font-semibold text-slate-800">{title}</h3>
        {description ? <span className="text-[10px] text-slate-400">· {description}</span> : null}
      </div>
      {children}
    </section>
  );
}

function CIRefField({ field, value, onChange, emptyLabel = '请选择' }: { field: CIField; value: any; onChange: (value: any) => void; emptyLabel?: string }) {
  const [items, setItems] = useState<CI[]>([]);
  const [loading, setLoading] = useState(true);
  const typeCodes = (field.options || []).join(',');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const query = typeCodes ? `&types=${encodeURIComponent(typeCodes)}` : '';
    api.get<{ data: CI[] }>(`/api/cis/options?limit=500${query}`)
      .then((response) => {
        if (!cancelled) setItems(response.data || []);
      })
      .catch(() => {
        if (!cancelled) setItems([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [typeCodes]);

  const selectedId = String(value ?? '');
  const options: Array<{ value: string; label: string; description?: string }> = [
    { value: '', label: emptyLabel },
    ...items.map((item) => ({ value: String(item.id), label: item.name, description: `${item.asset_no} · ${item.type_name || item.type_code || ''}` })),
  ];
  if (selectedId && !options.some((option) => option.value === selectedId)) {
    options.push({ value: selectedId, label: `已关联资产 #${selectedId}`, description: '原关联资产已不在候选列表中，请重新选择' });
  }

  return (
    <Field label={field.label} required={field.required} hint={loading ? '正在加载候选资产…' : '从符合类型的资产中选择'}>
      <SearchSelect value={selectedId} onChange={onChange} placeholder={emptyLabel} options={options} />
    </Field>
  );
}

function DynamicField({ field, value, onChange, emptyLabel }: { field: CIField; value: any; onChange: (value: any) => void; emptyLabel?: string }) {
  if (field.field_type === 'ci_ref') {
    return <CIRefField field={field} value={value} onChange={onChange} emptyLabel={emptyLabel} />;
  }
  if (field.field_type === 'select') {
    return (
      <Field label={field.label} required={field.required}>
        <SearchSelect value={String(value || '')} onChange={onChange} placeholder="请选择" options={[{ value: '', label: '请选择' }, ...field.options.map((option) => ({ value: option, label: option }))]} />
      </Field>
    );
  }
  if (field.field_type === 'multiselect') {
    const values = Array.isArray(value) ? value : value ? String(value).split(',') : [];
    return (
      <Field label={field.label} required={field.required} hint="可多选">
        <div className="flex min-h-10 flex-wrap items-center gap-1.5 rounded-xl border border-[#dfe4ee] bg-white px-2 py-1.5">
          {field.options.map((option) => {
            const active = values.includes(option);
            return (
              <button
                key={option}
                type="button"
                onClick={() => onChange(active ? values.filter((item: string) => item !== option) : [...values, option])}
                className={cn('rounded-md px-2 py-1 text-[10.5px] transition', active ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200')}
              >
                {option}
              </button>
            );
          })}
        </div>
      </Field>
    );
  }
  if (field.field_type === 'textarea') {
    return (
      <Field label={field.label} required={field.required} className="sm:col-span-2 lg:col-span-3">
        <textarea className="input-base min-h-[72px]" value={value || ''} onChange={(event) => onChange(event.target.value)} placeholder={field.placeholder} />
      </Field>
    );
  }
  if (field.field_type === 'date') {
    return (
      <Field label={field.label} required={field.required}>
        <DateInput value={value || ''} onChange={onChange} />
      </Field>
    );
  }
  return (
    <Field label={field.label} required={field.required}>
      <Input
        type={field.field_type === 'number' ? 'number' : 'text'}
        value={value ?? ''}
        onChange={(event) => onChange(event.target.value)}
        placeholder={field.placeholder || `请输入${field.label}`}
      />
    </Field>
  );
}

function ImportModal({
  open,
  onClose,
  types,
  importType,
  setImportType,
  file,
  setFile,
  mode,
  setMode,
  dragging,
  setDragging,
  fileInputRef,
  onTemplate,
  onImport,
  importing,
  result,
}: {
  open: boolean;
  onClose: () => void;
  types: CIType[];
  importType: string;
  setImportType: (value: string) => void;
  file: File | null;
  setFile: (value: File | null) => void;
  mode: 'upsert' | 'create';
  setMode: (value: 'upsert' | 'create') => void;
  dragging: boolean;
  setDragging: (value: boolean) => void;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  onTemplate: () => void;
  onImport: () => void;
  importing: boolean;
  result: any;
}) {
  const type = types.find((item) => item.code === importType);
  return (
    <Modal
      open={open}
      onClose={onClose}
      size="md"
      resizable
      title="Excel 批量导入"
      description="按 CI 类型下载标准模板，填写后导入；资产编号用于匹配新增或更新。"
      icon={FileSpreadsheet}
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={onClose}>关闭</Button>
          <Button size="sm" icon={Download} onClick={onImport} loading={importing} disabled={!file || Boolean(result?.failed === 0 && result?.created + result?.updated > 0)}>
            {result ? '重新导入' : '开始导入'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="CI 类型">
            <select className="input-base" value={importType} onChange={(event) => { setImportType(event.target.value); setFile(null); }}>
              {types.map((item) => <option key={item.id} value={item.code}>{item.name}（{item.ci_count || 0}）</option>)}
            </select>
          </Field>
          <Field label="导入模式">
            <select className="input-base" value={mode} onChange={(event) => setMode(event.target.value as any)}>
              <option value="upsert">新增 + 更新（按资产编号）</option>
              <option value="create">仅新增（跳过重复）</option>
            </select>
          </Field>
        </div>

        <div className="flex items-center justify-between rounded-xl border border-brand-100 bg-brand-50/50 px-3 py-2.5">
          <div>
            <p className="text-[11.5px] font-medium text-brand-800">先下载 {type?.name || 'CI'} 导入模板</p>
            <p className="mt-0.5 text-[10px] text-brand-600/70">包含基础字段、扩展字段与填写说明，建议不要修改表头。</p>
          </div>
          <Button variant="secondary" size="sm" icon={Download} onClick={onTemplate}>下载模板</Button>
        </div>

        <div
          onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDragging(false);
            const dropped = event.dataTransfer.files?.[0];
            if (dropped?.name.toLowerCase().endsWith('.xlsx')) setFile(dropped);
            else toast.error('仅支持 .xlsx 文件');
          }}
          onClick={() => fileInputRef.current?.click()}
          className={cn(
            'flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed px-6 py-8 text-center transition',
            dragging ? 'border-brand-400 bg-brand-50' : file ? 'border-emerald-200 bg-emerald-50/40' : 'border-slate-200 bg-slate-50/50 hover:border-slate-300 hover:bg-slate-50',
          )}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            className="hidden"
            onChange={(event) => {
              const selected = event.target.files?.[0];
              if (selected) setFile(selected);
            }}
          />
          {file ? (
            <>
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-100 text-emerald-600"><CheckCircle2 className="h-5 w-5" /></span>
              <p className="mt-2.5 text-[12px] font-medium text-slate-700">{file.name}</p>
              <p className="mt-1 text-[10px] text-slate-400">{(file.size / 1024).toFixed(1)} KB · 点击重新选择</p>
            </>
          ) : (
            <>
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-white text-slate-400 shadow-sm"><DownloadCloud className="h-5 w-5" /></span>
              <p className="mt-2.5 text-[12px] font-medium text-slate-700">拖拽 .xlsx 文件到这里，或点击选择</p>
              <p className="mt-1 text-[10px] text-slate-400">单文件不超过 10MB，单次最多 2000 行</p>
            </>
          )}
        </div>

        {result ? (
          <div className="rounded-xl border border-slate-200 p-3.5">
            <div className="flex items-center justify-between">
              <p className="text-[12px] font-semibold text-slate-800">导入结果</p>
              <span className={cn('rounded-md px-2 py-0.5 text-[10px] font-medium', result.failed ? 'bg-amber-50 text-amber-700' : 'bg-emerald-50 text-emerald-700')}>
                {result.validation ? '校验失败' : result.failed ? '部分成功' : '全部成功'}
              </span>
            </div>
            <div className="mt-3 grid grid-cols-3 gap-2 text-center">
              <div className="rounded-lg bg-slate-50 px-2 py-2"><p className="text-[18px] font-semibold text-slate-800">{result.created}</p><p className="text-[9.5px] text-slate-400">新建</p></div>
              <div className="rounded-lg bg-slate-50 px-2 py-2"><p className="text-[18px] font-semibold text-slate-800">{result.updated}</p><p className="text-[9.5px] text-slate-400">更新</p></div>
              <div className={cn('rounded-lg px-2 py-2', result.failed ? 'bg-rose-50' : 'bg-slate-50')}><p className={cn('text-[18px] font-semibold', result.failed ? 'text-rose-600' : 'text-slate-800')}>{result.failed}</p><p className="text-[9.5px] text-slate-400">失败</p></div>
            </div>
            {result.errors?.length ? (
              <div className="custom-scroll mt-3 max-h-36 overflow-y-auto rounded-lg border border-rose-100 bg-rose-50/50">
                {result.errors.map((error: any, index: number) => (
                  <div key={index} className="flex gap-2 border-b border-rose-100/60 px-2.5 py-1.5 text-[10px] last:border-0">
                    <span className="shrink-0 font-mono text-rose-400">第 {error.row} 行</span>
                    <span className="text-rose-700">{error.message}</span>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </Modal>
  );
}
