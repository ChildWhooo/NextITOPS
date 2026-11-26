import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Check,
  Database,
  GripVertical,
  Layers3,
  ListChecks,
  ListFilter,
  Pencil,
  Plus,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { usePageTitle } from '@/lib/hooks';
import {
  cn,
} from '@/lib/utils';
import type { CIField, CIType } from '@/lib/types';
import {
  Badge,
  Button,
  Checkbox,
  ConfirmDialog,
  EmptyState,
  Field,
  IconButton,
  Input,
  Modal,
  PageHeader,
  Spinner,
  TableSkeleton,
  Toggle,
} from '@/components/ui';
import { DynamicIcon, ICON_OPTIONS } from '@/components/DynamicIcon';
import { BASIC_FIELDS, getBasicFieldConfig, loadBasicFields, saveBasicFields as persistBasicFields, type BasicFieldConfig } from '@/lib/ciBasicFields';

const FIELD_TYPES = [  { value: 'text', label: '单行文本' },
  { value: 'textarea', label: '多行文本' },
  { value: 'number', label: '数字' },
  { value: 'date', label: '日期' },
  { value: 'select', label: '单选' },
  { value: 'multiselect', label: '多选' },
  { value: 'ci_ref', label: '关联 CI' },
];

const COLOR_OPTIONS = [
  '#4f6ef7', '#0ea5e9', '#0ea5a4', '#8b5cf6', '#f59e0b', '#f43f5e', '#64748b', '#d946ef',
  '#10b981', '#14b8a6', '#f97316', '#ef4444', '#84cc16', '#06b6d4', '#a855f7', '#e11d48',
  '#0f766e', '#b45309', '#4338ca', '#be123c',
];

const TYPE_TEMPLATE = {
  code: '',
  name: '',
  icon: 'Box',
  color: '#4f6ef7',
  description: '',
  sort_order: 99,
  enabled: true,
  rackable: false,
};

const FIELD_TEMPLATE = {
  field_key: '',
  label: '',
  field_type: 'text',
  optionsText: '',
  placeholder: '',
  group_name: '扩展属性',
  required: false,
  show_in_list: false,
  sort_order: 99,
};

export default function CIModelPage() {
  usePageTitle('CI 模型');
  const [types, setTypes] = useState<CIType[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [detail, setDetail] = useState<CIType | null>(null);
  const [loadingTypes, setLoadingTypes] = useState(true);
  const [loadingDetail, setLoadingDetail] = useState(false);

  const [typeModal, setTypeModal] = useState(false);
  const [editingType, setEditingType] = useState<CIType | null>(null);
  const [typeForm, setTypeForm] = useState<Record<string, any>>(TYPE_TEMPLATE);
  const [savingType, setSavingType] = useState(false);

  const [fieldModal, setFieldModal] = useState(false);
  const [editingField, setEditingField] = useState<CIField | null>(null);
  const [fieldForm, setFieldForm] = useState<Record<string, any>>(FIELD_TEMPLATE);
  const [savingField, setSavingField] = useState(false);

  const [deleteTypeTarget, setDeleteTypeTarget] = useState<CIType | null>(null);
  const [deleteFieldTarget, setDeleteFieldTarget] = useState<CIField | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [selectedFieldIds, setSelectedFieldIds] = useState<Set<number>>(new Set());
  const [searchParams, setSearchParams] = useSearchParams();
  const [fieldBulkDeleteOpen, setFieldBulkDeleteOpen] = useState(false);
  const [fieldBulkDeleting, setFieldBulkDeleting] = useState(false);
  const [basicOpen, setBasicOpen] = useState(false);
  const [fieldsInfoOpen, setFieldsInfoOpen] = useState(false);
  const [basicConfig, setBasicConfig] = useState<BasicFieldConfig>(() => getBasicFieldConfig(detail?.code));
  const [basicSaving, setBasicSaving] = useState(false);
  const saveBasicFields = async () => {
    if (!detail?.code) return;
    setBasicSaving(true);
    try {
      await persistBasicFields(detail.code, basicConfig);
      setBasicOpen(false);
      toast.success('基础字段配置已保存（全局生效）');
    } catch (error: any) {
      toast.error(error.message || '基础字段配置保存失败');
    } finally {
      setBasicSaving(false);
    }
  };
  useEffect(() => {
    loadBasicFields().then(() => { if (detail?.code) setBasicConfig(getBasicFieldConfig(detail.code)); }).catch(() => {});
  }, [detail?.code]);
  const hiddenCount = Object.values(basicConfig).filter((item) => item.hidden).length;

  const fields = detail?.fields || [];
  const allFieldsSelected = fields.length > 0 && fields.every((field) => selectedFieldIds.has(field.id));
  const someFieldsSelected = fields.some((field) => selectedFieldIds.has(field.id));

  const loadTypes = async (preferredId?: number) => {
    setLoadingTypes(true);
    try {
      const response = await api.get<{ data: CIType[] }>('/api/ci-types');
      setTypes(response.data);
      const nextId = preferredId || selectedId || response.data[0]?.id || null;
      setSelectedId(nextId);
    } finally {
      setLoadingTypes(false);
    }
  };

  const loadDetail = async (id: number) => {
    setLoadingDetail(true);
    try {
      const response = await api.get<{ data: CIType }>(`/api/ci-types/${id}`);
      setDetail(response.data);
    } finally {
      setLoadingDetail(false);
    }
  };

  useEffect(() => {
    loadTypes();
  }, []);

  useEffect(() => {
    if (selectedId) loadDetail(selectedId);
    setSelectedFieldIds(new Set());
  }, [selectedId]);

  const openCreateType = () => {
    setEditingType(null);
    setTypeForm({ ...TYPE_TEMPLATE, sort_order: types.length + 1 });
    setTypeModal(true);
  };

  useEffect(() => {
    if (searchParams.get('new') !== '1') return;
    openCreateType();
    const next = new URLSearchParams(searchParams);
    next.delete('new');
    setSearchParams(next, { replace: true });
  }, [searchParams.get('new'), types.length]);

  const openEditType = (type: CIType) => {
    setEditingType(type);
    setTypeForm({
      code: type.code,
      name: type.name,
      icon: type.icon,
      color: type.color,
      description: type.description,
      sort_order: type.sort_order,
      enabled: type.enabled,
      rackable: Boolean(type.rackable),
    });
    setTypeModal(true);
  };

  const saveType = async () => {
    if (!typeForm.name.trim()) return toast.error('请填写类型名称');
    if (!editingType && !typeForm.code.trim()) return toast.error('请填写类型编码');
    setSavingType(true);
    try {
      if (editingType) {
        await api.put(`/api/ci-types/${editingType.id}`, {
          name: typeForm.name,
          icon: typeForm.icon,
          color: typeForm.color,
          description: typeForm.description,
          sort_order: Number(typeForm.sort_order),
          enabled: typeForm.enabled,
          rackable: Boolean(typeForm.rackable),
        });
        toast.success('CI 类型已更新');
        window.dispatchEvent(new Event('nextitops:ci-types-changed'));
        await loadTypes(editingType.id);
        await loadDetail(editingType.id);
      } else {
        const response = await api.post<{ data: CIType }>('/api/ci-types', {
          ...typeForm,
          sort_order: Number(typeForm.sort_order),
        });
        toast.success('CI 类型已创建');
        window.dispatchEvent(new Event('nextitops:ci-types-changed'));
        setTypeModal(false);
        await loadTypes(response.data.id);
      }
      setTypeModal(false);
      setTypes((current) => current);
    } catch (error: any) {
      toast.error(error.message);
    } finally {
      setSavingType(false);
    }
  };

  const openCreateField = () => {
    setEditingField(null);
    setFieldForm({ ...FIELD_TEMPLATE, sort_order: (detail?.fields?.length || 0) + 1 });
    setFieldModal(true);
  };

  const openEditField = (field: CIField) => {
    setEditingField(field);
    setFieldForm({
      field_key: field.field_key,
      label: field.label,
      field_type: field.field_type,
      optionsText: (field.options || []).join(', '),
      placeholder: field.placeholder,
      group_name: field.group_name,
      required: field.required,
      show_in_list: field.show_in_list,
      sort_order: field.sort_order,
    });
    setFieldModal(true);
  };

  const saveField = async () => {
    if (!fieldForm.label.trim()) return toast.error('请填写字段名称');
    if (!editingField && !fieldForm.field_key.trim()) return toast.error('请填写字段标识');
    const options = fieldForm.optionsText
      .split(/[,，]/)
      .map((item: string) => item.trim())
      .filter(Boolean);
    if (['select', 'multiselect'].includes(fieldForm.field_type) && !options.length) {
      return toast.error('单选/多选字段至少需要一个选项');
    }
    if (fieldForm.field_type === 'ci_ref' && !options.length) {
      return toast.error('关联 CI 字段至少需要一个目标类型 code');
    }
    setSavingField(true);
    try {
      const payload = {
        label: fieldForm.label,
        field_type: fieldForm.field_type,
        options,
        placeholder: fieldForm.placeholder,
        group_name: fieldForm.group_name || '扩展属性',
        required: Boolean(fieldForm.required),
        show_in_list: Boolean(fieldForm.show_in_list),
        sort_order: Number(fieldForm.sort_order || 99),
      };
      if (editingField) {
        await api.put(`/api/ci-fields/${editingField.id}`, payload);
        toast.success('扩展字段已更新');
      } else {
        await api.post(`/api/ci-types/${selectedId}/fields`, { ...payload, field_key: fieldForm.field_key });
        toast.success('扩展字段已添加');
      }
      setFieldModal(false);
      await Promise.all([loadDetail(selectedId!), loadTypes(selectedId!)]);
    } catch (error: any) {
      toast.error(error.message);
    } finally {
      setSavingField(false);
    }
  };

  const confirmDeleteType = async () => {
    if (!deleteTypeTarget) return;
    setDeleting(true);
    try {
      await api.delete(`/api/ci-types/${deleteTypeTarget.id}`);
      toast.success('CI 类型已删除');
      window.dispatchEvent(new Event('nextitops:ci-types-changed'));
      setDeleteTypeTarget(null);
      await loadTypes();
    } catch (error: any) {
      toast.error(error.message);
    } finally {
      setDeleting(false);
    }
  };

  const confirmDeleteField = async () => {
    if (!deleteFieldTarget) return;
    setDeleting(true);
    try {
      await api.delete(`/api/ci-fields/${deleteFieldTarget.id}`);
      toast.success('扩展字段已删除');
      setDeleteFieldTarget(null);
      await Promise.all([loadDetail(selectedId!), loadTypes(selectedId!)]);
    } catch (error: any) {
      toast.error(error.message);
    } finally {
      setDeleting(false);
    }
  };

  const confirmBulkDeleteFields = async () => {
    if (!selectedFieldIds.size) return;
    setFieldBulkDeleting(true);
    try {
      const response = await api.post<any>('/api/ci-fields/bulk-delete', { ids: [...selectedFieldIds] });
      toast.success(`已批量删除 ${response.deleted} 个扩展字段`);
      setFieldBulkDeleteOpen(false);
      setSelectedFieldIds(new Set());
      await Promise.all([loadDetail(selectedId!), loadTypes(selectedId!)]);
    } catch (error: any) {
      toast.error(error.message);
    } finally {
      setFieldBulkDeleting(false);
    }
  };

  const moveField = async (field: CIField, direction: -1 | 1) => {
    const fields = [...(detail?.fields || [])];
    const index = fields.findIndex((item) => item.id === field.id);
    const target = fields[index + direction];
    if (!target) return;
    try {
      await Promise.all([
        api.put(`/api/ci-fields/${field.id}`, { sort_order: target.sort_order }),
        api.put(`/api/ci-fields/${target.id}`, { sort_order: field.sort_order }),
      ]);
      await loadDetail(selectedId!);
    } catch (error: any) {
      toast.error(error.message);
    }
  };

  return (
    <div className="animate-enter">
      <PageHeader
        eyebrow="Data model"
        title="CI 模型配置"
        description="定义配置项类型与扩展字段，保持 CMDB 与业务演进同步。基础字段由系统统一管理。"
        actions={<Button size="sm" icon={Plus} onClick={openCreateType}>新增 CI 类型</Button>}
      />

      <div className="grid grid-cols-1 gap-3.5 xl:grid-cols-12">
        <div className="card overflow-hidden xl:col-span-4">
          <div className="flex items-center justify-between border-b border-[#eef1f6] px-4 py-3.5">
            <div>
              <h2 className="text-[13px] font-semibold text-slate-800">配置项类型</h2>
              <p className="mt-0.5 text-[10px] text-slate-400">{types.length} 个类型 · {types.reduce((sum, item) => sum + (item.ci_count || 0), 0)} 个 CI</p>
            </div>
            <Button variant="ghost" size="xs" icon={Plus} onClick={openCreateType}>添加</Button>
          </div>
          {loadingTypes ? (
            <div className="p-3"><TableSkeleton rows={5} cols={3} /></div>
          ) : (
            <div className="space-y-1 p-2">
              {types.map((type) => (
                <button
                  key={type.id}
                  onClick={() => setSelectedId(type.id)}
                  className={cn(
                    'group flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition',
                    selectedId === type.id ? 'border-brand-200 bg-brand-50/70' : 'border-transparent hover:border-slate-200 hover:bg-slate-50',
                  )}
                >
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-white" style={{ background: type.color }}>
                    <DynamicIcon name={type.icon} className="h-4 w-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="truncate text-[12px] font-medium text-slate-700">{type.name}</span>
                      {type.builtin ? <span className="rounded bg-slate-100 px-1 py-0.5 text-[8px] text-slate-400">内置</span> : <span className="rounded bg-violet-50 px-1 py-0.5 text-[8px] text-violet-600">自定义</span>}
                    </div>
                    <p className="mt-0.5 font-mono text-[9px] text-slate-400">{type.code}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-[12px] font-semibold text-slate-700">{type.ci_count || 0}</p>
                    <p className="text-[8.5px] text-slate-400">CI · {BASIC_FIELDS.length - Object.values(getBasicFieldConfig(type.code)).filter((item) => item.hidden).length + (type.field_count || 0)} 字段</p>
                  </div>
                </button>
              ))}
            </div>
          )}
          <div className="m-2 rounded-xl border border-dashed border-slate-200 bg-slate-50/70 p-3">
            <div className="flex items-start gap-2">
              <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-brand-500" />
              <p className="text-[9.5px] leading-relaxed text-slate-500">
                新增类型后可自由扩展字段；字段会同时出现在 CI 表单、详情与 Excel 模板中，无需改代码。
              </p>
            </div>
          </div>
        </div>

        <div className="xl:col-span-8">
          {loadingDetail || !detail ? (
            <div className="card p-5"><TableSkeleton rows={6} cols={4} /></div>
          ) : (
            <>
              <div className="card overflow-hidden">
                <div className="relative border-b border-[#eef1f6] p-5">
                  <div className="absolute inset-0 opacity-[0.07]" style={{ background: `linear-gradient(120deg, ${detail.color}, transparent)` }} />
                  <div className="relative flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="flex items-start gap-3">
                      <span className="flex h-11 w-11 items-center justify-center rounded-xl text-white shadow-sm" style={{ background: detail.color }}>
                        <DynamicIcon name={detail.icon} className="h-5 w-5" />
                      </span>
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <h2 className="text-[17px] font-semibold text-slate-900">{detail.name}</h2>
                          <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[9px] text-slate-500">{detail.code}</span>
                          {detail.builtin ? <Badge className="bg-slate-100 text-slate-500 ring-slate-500/10">内置类型</Badge> : <Badge className="bg-violet-50 text-violet-700 ring-violet-600/15">自定义类型</Badge>}
                          {!detail.enabled ? <Badge className="bg-amber-50 text-amber-700 ring-amber-600/15">已停用</Badge> : null}
                        </div>
                        <p className="mt-1 max-w-xl text-[11px] leading-relaxed text-slate-500">{detail.description || '暂无类型描述'}</p>
                        <div className="mt-2 flex items-center gap-3 text-[10px] text-slate-400">
                          <span>{detail.ci_count} 个配置项</span>
                          <span>·</span>
                          <span>{detail.fields?.length || 0} 个扩展字段</span>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <Button variant="secondary" size="sm" icon={Pencil} onClick={() => openEditType(detail)}>编辑类型</Button>
                      {!detail.builtin ? (
                        <IconButton icon={Trash2} label="删除类型" variant="danger" onClick={() => setDeleteTypeTarget(detail)} />
                      ) : null}
                    </div>
                  </div>
                </div>

                <div className="flex flex-col gap-3 border-b border-[#eef1f6] px-5 py-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <h3 className="text-[12.5px] font-semibold text-slate-800">扩展字段</h3>
                    <p className="mt-0.5 text-[10px] text-slate-400">扩展属性存储在 CI 的 attributes 中，不影响基础字段结构。</p>
                  </div>
                  <Button size="sm" icon={Plus} onClick={openCreateField}>添加字段</Button>
                </div>

                {selectedFieldIds.size > 0 ? (
                  <div className="animate-enter-fast mx-5 mb-3 flex flex-col gap-2 rounded-xl border border-brand-200 bg-brand-50/70 px-3 py-2.5 sm:flex-row sm:items-center">
                    <div className="flex items-center gap-2">
                      <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-brand-600 text-white"><ListChecks className="h-3.5 w-3.5" /></span>
                      <div>
                        <p className="text-[11px] font-semibold text-brand-900">已选择 {selectedFieldIds.size} 个扩展字段</p>
                        <p className="mt-0.5 text-[9.5px] text-brand-700/60">批量删除会同步移除已填写该字段的 CI 属性值</p>
                      </div>
                    </div>
                    <div className="ml-auto flex items-center gap-1.5">
                      <Button size="xs" variant="secondary" icon={Trash2} className="text-rose-600 hover:bg-rose-50" onClick={() => setFieldBulkDeleteOpen(true)}>批量删除</Button>
                      <button onClick={() => setSelectedFieldIds(new Set())} className="flex h-7 items-center gap-1 rounded-lg px-2 text-[10.5px] text-slate-500 hover:bg-white/70"><X className="h-3 w-3" />取消</button>
                    </div>
                  </div>
                ) : null}

                {detail.fields?.length ? (
                  <div className="table-wrap">
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th className="w-10 pl-4 pr-0">
                            <Checkbox
                              checked={allFieldsSelected}
                              indeterminate={someFieldsSelected && !allFieldsSelected}
                              onChange={(checked) => {
                                const next = new Set(selectedFieldIds);
                                for (const field of fields) {
                                  if (checked) next.add(field.id);
                                  else next.delete(field.id);
                                }
                                setSelectedFieldIds(next);
                              }}
                            />
                          </th>
                          <th className="w-8"></th>
                          <th>字段</th>
                          <th>类型</th>
                          <th>分组</th>
                          <th>选项</th>
                          <th>规则</th>
                          <th className="text-right">操作</th>
                        </tr>
                      </thead>
                      <tbody>
                        {detail.fields.map((field, index) => (
                          <tr key={field.id} onClick={() => openEditField(field)} className={cn('group cursor-pointer', selectedFieldIds.has(field.id) && 'bg-brand-50/40')}>
                            <td className="w-10 pl-4 pr-0">
                              <Checkbox
                                checked={selectedFieldIds.has(field.id)}
                                onChange={(checked) => {
                                  const next = new Set(selectedFieldIds);
                                  if (checked) next.add(field.id);
                                  else next.delete(field.id);
                                  setSelectedFieldIds(next);
                                }}
                              />
                            </td>
                            <td>
                              <div className="flex flex-col items-center text-slate-300">
                                <button disabled={index === 0} onClick={() => moveField(field, -1)} className="rounded p-0.5 hover:bg-slate-100 hover:text-slate-600 disabled:opacity-30"><ArrowUp className="h-3 w-3" /></button>
                                <button disabled={index === detail.fields!.length - 1} onClick={() => moveField(field, 1)} className="rounded p-0.5 hover:bg-slate-100 hover:text-slate-600 disabled:opacity-30"><ArrowDown className="h-3 w-3" /></button>
                              </div>
                            </td>
                            <td>
                              <p className="text-[12px] font-medium text-slate-700">{field.label}</p>
                              <p className="mt-0.5 font-mono text-[9px] text-slate-400">{field.field_key}</p>
                            </td>
                            <td>
                              <Badge className="bg-slate-100 text-slate-600 ring-slate-500/10">{FIELD_TYPES.find((item) => item.value === field.field_type)?.label || field.field_type}</Badge>
                            </td>
                            <td className="text-[11px] text-slate-500">{field.group_name}</td>
                            <td>
                              <div className="flex max-w-[210px] flex-wrap gap-1">
                                {field.options?.slice(0, 3).map((option) => <span key={option} className="rounded bg-slate-100 px-1.5 py-0.5 text-[9px] text-slate-500">{option}</span>)}
                                {field.options?.length > 3 ? <span className="text-[9px] text-slate-400">+{field.options.length - 3}</span> : null}
                                {!field.options?.length ? <span className="text-[10px] text-slate-300">—</span> : null}
                              </div>
                            </td>
                            <td>
                              <div className="flex flex-wrap items-center gap-1">
                                {field.required ? <span className="rounded bg-rose-50 px-1.5 py-0.5 text-[8.5px] font-medium text-rose-600">必填</span> : null}
                                {field.show_in_list ? <span className="rounded bg-brand-50 px-1.5 py-0.5 text-[8.5px] font-medium text-brand-600">列表展示</span> : null}
                                {!field.required && !field.show_in_list ? <span className="text-[10px] text-slate-300">—</span> : null}
                              </div>
                            </td>
                            <td>
                              <div className="flex items-center justify-end gap-0.5">
                                <IconButton icon={Pencil} label="编辑字段" onClick={(event) => { event.stopPropagation(); openEditField(field); }} />
                                <IconButton icon={Trash2} label="删除字段" variant="danger" onClick={(event) => { event.stopPropagation(); setDeleteFieldTarget(field); }} />
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <EmptyState
                    title="尚未定义扩展字段"
                    description="为当前类型添加业务特有的属性，如机架 U 位、授权到期日或端口数量。"
                    icon={Settings2}
                    action={<Button size="sm" icon={Plus} onClick={openCreateField}>添加第一个字段</Button>}
                  />
                )}
              </div>

              <div className="mt-3.5 grid grid-cols-1 gap-3.5 sm:grid-cols-3">
                <InfoCard icon={Layers3} title="基础字段" value={`${BASIC_FIELDS.length} 个`} desc={`当前类型隐藏 ${hiddenCount} 项，生效 ${BASIC_FIELDS.length - hiddenCount} 项`} onClick={() => setBasicOpen(true)} />
                <InfoCard icon={ListFilter} title="扩展字段" value={`${detail.fields?.length || 0} 个`} desc="点击查看当前类型的扩展字段" onClick={() => setFieldsInfoOpen(true)} />
                <InfoCard icon={Database} title="关联配置项" value={`${detail.ci_count} 个`} desc="当前类型下已纳管的 CI 数量" href={`/cmdb?type=${detail.code}`} />
              </div>
            </>
          )}
        </div>
      </div>

      <Modal
        open={typeModal}
        onClose={() => setTypeModal(false)}
        title={editingType ? '编辑 CI 类型' : '新增 CI 类型'}
        description="类型编码作为稳定标识，创建后不可修改。"
        icon={Layers3}
        size="md"
        footer={
          <>
            <Button variant="secondary" size="sm" onClick={() => setTypeModal(false)}>取消</Button>
            <Button size="sm" loading={savingType} onClick={saveType}>{editingType ? '保存' : '创建类型'}</Button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="类型名称" required>
              <Input value={typeForm.name} onChange={(event) => setTypeForm((current) => ({ ...current, name: event.target.value }))} placeholder="如 存储设备" />
            </Field>
            <Field label="类型编码" required hint="小写字母、数字与下划线">
              <Input value={typeForm.code} onChange={(event) => setTypeForm((current) => ({ ...current, code: event.target.value.toLowerCase() }))} placeholder="storage" disabled={Boolean(editingType)} className="font-mono" />
            </Field>
          </div>
          <Field label="类型描述">
            <textarea className="input-base min-h-[72px]" value={typeForm.description} onChange={(event) => setTypeForm((current) => ({ ...current, description: event.target.value }))} placeholder="说明该类型覆盖的资产范围…" />
          </Field>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="图标">
              <div className="grid grid-cols-6 gap-1.5">
                {ICON_OPTIONS.map((icon) => (
                  <button
                    key={icon}
                    type="button"
                    onClick={() => setTypeForm((current) => ({ ...current, icon }))}
                    className={cn('flex h-9 items-center justify-center rounded-lg border transition', typeForm.icon === icon ? 'border-brand-400 bg-brand-50 text-brand-600' : 'border-slate-200 text-slate-400 hover:bg-slate-50')}
                  >
                    <DynamicIcon name={icon} className="h-4 w-4" />
                  </button>
                ))}
              </div>
            </Field>
            <Field label="主题色">
              <div className="flex flex-wrap gap-2 pt-1">
                {COLOR_OPTIONS.map((color) => (
                  <button
                    key={color}
                    type="button"
                    onClick={() => setTypeForm((current) => ({ ...current, color }))}
                    className="flex h-8 w-8 items-center justify-center rounded-full ring-offset-2 transition"
                    style={{ background: color, boxShadow: typeForm.color === color ? `0 0 0 2px white, 0 0 0 4px ${color}` : undefined }}
                  >
                    {typeForm.color === color ? <Check className="h-3.5 w-3.5 text-white" /> : null}
                  </button>
                ))}
              </div>
            </Field>
          </div>
          <div className="flex items-center justify-between rounded-xl border border-slate-200 px-3 py-2.5">
            <div>
              <p className="text-[11.5px] font-medium text-slate-700">启用该类型</p>
              <p className="text-[9.5px] text-slate-400">停用后新建 CI 时不可选择，已有数据不受影响。</p>
            </div>
            <Toggle checked={Boolean(typeForm.enabled)} onChange={(checked) => setTypeForm((current) => ({ ...current, enabled: checked }))} />
          </div>
          <div className="flex items-center justify-between rounded-xl border border-slate-200 px-3 py-2.5">
            <div>
              <p className="text-[11.5px] font-medium text-slate-700">可上架硬件设备</p>
              <p className="text-[9.5px] text-slate-400">启用后，该类型的 CI 可以拖拽放置到机柜 U 位。</p>
            </div>
            <Toggle checked={Boolean(typeForm.rackable)} onChange={(checked) => setTypeForm((current) => ({ ...current, rackable: checked }))} />
          </div>
        </div>
      </Modal>

      <Modal
        open={fieldModal}
        onClose={() => setFieldModal(false)}
        title={editingField ? '编辑扩展字段' : '添加扩展字段'}
        description="字段会出现在 CI 新建、编辑、详情以及 Excel 导入模板中。"
        icon={Settings2}
        size="md"
        resizable={false}
        footer={
          <>
            <Button variant="secondary" size="sm" onClick={() => setFieldModal(false)}>取消</Button>
            <Button size="sm" loading={savingField} onClick={saveField}>{editingField ? '保存字段' : '添加字段'}</Button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="字段名称" required>
              <Input value={fieldForm.label} onChange={(event) => setFieldForm((current) => ({ ...current, label: event.target.value }))} placeholder="如 端口数量" />
            </Field>
            <Field label="字段标识" required hint="稳定标识，创建后不可修改">
              <Input value={fieldForm.field_key} onChange={(event) => setFieldForm((current) => ({ ...current, field_key: event.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_') }))} placeholder="port_count" className="font-mono" disabled={Boolean(editingField)} />
            </Field>
            <Field label="字段类型">
              <select className="input-base" value={fieldForm.field_type} onChange={(event) => setFieldForm((current) => ({ ...current, field_type: event.target.value }))}>
                {FIELD_TYPES.map((type) => <option key={type.value} value={type.value}>{type.label}</option>)}
              </select>
            </Field>
            <Field label="所属分组">
              <Input value={fieldForm.group_name} onChange={(event) => setFieldForm((current) => ({ ...current, group_name: event.target.value }))} placeholder="扩展属性" />
            </Field>
          </div>
          {['select', 'multiselect'].includes(fieldForm.field_type) ? (
            <Field label="选项" required hint="使用英文或中文逗号分隔，例如：主备, 双主, 单机">
              <Input value={fieldForm.optionsText} onChange={(event) => setFieldForm((current) => ({ ...current, optionsText: event.target.value }))} placeholder="选项 A, 选项 B, 选项 C" />
            </Field>
          ) : null}
          {fieldForm.field_type === 'ci_ref' ? (
            <Field label="关联 CI 类型" required hint="填写目标 CI 类型 code，逗号分隔；例如：virtualization, virtualization_host">
              <Input value={fieldForm.optionsText} onChange={(event) => setFieldForm((current) => ({ ...current, optionsText: event.target.value }))} placeholder="virtualization, virtualization_host" className="font-mono" />
            </Field>
          ) : null}
          <Field label="占位提示">
            <Input value={fieldForm.placeholder} onChange={(event) => setFieldForm((current) => ({ ...current, placeholder: event.target.value }))} placeholder="表单输入时的提示文案" />
          </Field>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <div className="flex items-center justify-between rounded-xl border border-slate-200 px-3 py-2.5">
              <div>
                <p className="text-[11px] font-medium text-slate-700">必填</p>
                <p className="text-[9px] text-slate-400">新建 CI 时强制填写</p>
              </div>
              <Toggle checked={Boolean(fieldForm.required)} onChange={(checked) => setFieldForm((current) => ({ ...current, required: checked }))} />
            </div>
            <div className="flex items-center justify-between rounded-xl border border-slate-200 px-3 py-2.5">
              <div>
                <p className="text-[11px] font-medium text-slate-700">列表展示</p>
                <p className="text-[9px] text-slate-400">在资产列表增加该列</p>
              </div>
              <Toggle checked={Boolean(fieldForm.show_in_list)} onChange={(checked) => setFieldForm((current) => ({ ...current, show_in_list: checked }))} />
            </div>
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        open={fieldBulkDeleteOpen}
        onClose={() => setFieldBulkDeleteOpen(false)}
        onConfirm={confirmBulkDeleteFields}
        loading={fieldBulkDeleting}
        title={`批量删除 ${selectedFieldIds.size} 个扩展字段`}
        confirmText="确认批量删除"
        description={
          <>
            删除后，这些字段会从所有 CI 表单、列表与 Excel 模板中移除，已有 CI 上对应的属性值也会被清理。
            <br />
            此操作不可恢复。
          </>
        }
      />
      <ConfirmDialog
        open={Boolean(deleteTypeTarget)}
        onClose={() => setDeleteTypeTarget(null)}
        onConfirm={confirmDeleteType}
        loading={deleting}
        title="删除 CI 类型"
        confirmText="确认删除"
        description={<>确定删除「{deleteTypeTarget?.name}」吗？仅当该类型下没有 CI 时才能删除。</>}
      />
      <ConfirmDialog
        open={Boolean(deleteFieldTarget)}
        onClose={() => setDeleteFieldTarget(null)}
        onConfirm={confirmDeleteField}
        loading={deleting}
        title="删除扩展字段"
        confirmText="删除字段"
        description={<>删除「{deleteFieldTarget?.label}」后，已有 CI 上该字段的值也会被移除，且不可恢复。</>}
      />
      <Modal open={fieldsInfoOpen} onClose={() => setFieldsInfoOpen(false)} title={`扩展字段 · ${detail?.name || ''}`} description="扩展字段是该类型资产独有的业务属性，会显示在资产表单、列表和 Excel 模板中；点击字段可编辑。" icon={ListFilter} size="md" resizable={false} footer={<Button variant="secondary" size="sm" onClick={() => setFieldsInfoOpen(false)}>关闭</Button>}>
        {detail?.fields?.length ? <div className="space-y-2">{detail.fields.map((field) => <button key={field.id} onClick={() => { setFieldsInfoOpen(false); openEditField(field); }} className="flex w-full items-start justify-between gap-3 rounded-lg border border-slate-200 p-3 text-left hover:border-brand-200 hover:bg-brand-50/30"><div><p className="text-[12px] font-medium text-slate-700">{field.label}{field.required ? <span className="ml-1 text-rose-500">*</span> : null}</p><p className="mt-0.5 font-mono text-[9px] text-slate-400">{field.field_key} · {FIELD_TYPES.find((item) => item.value === field.field_type)?.label || field.field_type} · {field.group_name}</p></div><span className="text-[9px] text-slate-400">{field.options?.length ? field.options.join(' / ') : '点击编辑'}</span></button>)}</div> : <p className="py-10 text-center text-[11px] text-slate-400">当前类型暂无扩展字段，可在扩展字段区域点击「添加字段」。</p>}
      </Modal>

      <Modal open={basicOpen} onClose={() => setBasicOpen(false)} title="基础字段配置" description={`当前类型已隐藏 ${hiddenCount} 项，生效 ${BASIC_FIELDS.length - hiddenCount} 项；隐藏字段在新建表单中不显示，也不再必填；仅影响当前资产类型。`} size="md" footer={<><Button variant="secondary" size="sm" onClick={() => setBasicOpen(false)}>取消</Button><Button size="sm" loading={basicSaving} onClick={saveBasicFields}>保存配置</Button></>}>
        <div className="grid grid-cols-2 gap-2">
          {BASIC_FIELDS.map(([key, defaultLabel]) => {
            const config = basicConfig[key];
            return <div key={key} className="flex items-center gap-2 rounded-lg border border-slate-200 p-2">
              <input className="input-base h-7 flex-1 text-[10.5px]" value={config.label} onChange={(event) => setBasicConfig((current) => ({ ...current, [key]: { ...current[key], label: event.target.value } }))} />
              <button onClick={() => setBasicConfig((current) => { const nextHidden = !current[key].hidden; return { ...current, [key]: { ...current[key], hidden: nextHidden, list: !nextHidden } }; })} className={cn('rounded px-1.5 py-1 text-[8.5px]', config.hidden ? 'bg-rose-50 text-rose-600' : 'bg-emerald-50 text-emerald-700')}>{config.hidden ? '已隐藏' : '显示中'}</button>
              <button disabled={config.hidden} onClick={() => { if (config.hidden) return; setBasicConfig((current) => ({ ...current, [key]: { ...current[key], list: current[key].list === false } })); }} className={cn('rounded px-1.5 py-1 text-[8.5px]', config.hidden ? 'cursor-not-allowed bg-slate-50 text-slate-300' : config.list === false ? 'bg-slate-100 text-slate-500' : 'bg-brand-50 text-brand-700')}>{config.list === false ? '列表隐藏' : '列表显示'}</button>
            </div>;
          })}
        </div>
        <p className="mt-2 text-[9px] text-slate-400">该配置保存到服务端，对所有用户生效。默认名称：{BASIC_FIELDS.map(([, label]) => label).join('、')}</p>
      </Modal>
    </div>
  );
}

function InfoCard({ icon: Icon, title, value, desc, href, onClick }: { icon: any; title: string; value: string; desc: string; href?: string; onClick?: () => void }) {
  const content = (
    <div className="card flex items-start gap-3 p-4 transition hover:border-brand-200 hover:shadow-sm">
      <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-50 text-slate-400"><Icon className="h-4 w-4" /></span>
      <div>
        <p className="text-[9.5px] text-slate-400">{title}</p>
        <p className="mt-0.5 text-[16px] font-semibold text-slate-800">{value}</p>
        <p className="mt-0.5 text-[9px] leading-relaxed text-slate-400">{desc}</p>
      </div>
    </div>
  );
  if (href) return <Link to={href}>{content}</Link>;
  return <button onClick={onClick} className="text-left">{content}</button>;
}
