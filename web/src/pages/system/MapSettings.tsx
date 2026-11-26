import { useEffect, useState } from 'react';
import { ArrowLeftRight, ImageUp, Link2, Map, Pencil, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { usePageTitle } from '@/lib/hooks';
import { cn } from '@/lib/utils';
import type { CI } from '@/lib/types';
import { Badge, Button, ConfirmDialog, EmptyState, Field, IconButton, Input, Modal, PageHeader, Skeleton } from '@/components/ui';
import { SearchSelect } from '@/components/SearchSelect';

const EMPTY_LINK = { source_dc_id: '', target_dc_id: '', name: '', carrier: '', bandwidth_mbps: 1000, status: 'up', source: 'manual', zabbix_ci_id: '', zabbix_metric: '', notes: '' };

export default function MapSettingsPage() {
  usePageTitle('地理位置配置');
  const [datacenters, setDatacenters] = useState<any[]>([]);
  const [links, setLinks] = useState<any[]>([]);
  const [networkCis, setNetworkCis] = useState<CI[]>([]);
  const [loading, setLoading] = useState(true);
  const [mapInfo, setMapInfo] = useState<any>(null);
  const [linkOpen, setLinkOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [form, setForm] = useState<Record<string, any>>(EMPTY_LINK);
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<any>(null);
  const [deleting, setDeleting] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const [dcResponse, linkResponse, mapResponse, cisResponse] = await Promise.all([
        api.get<{ data: any[] }>('/api/datacenters'),
        api.get<{ data: any[] }>('/api/datacenter-links'),
        api.get<{ data: any }>('/api/system/map'),
        api.get<{ data: CI[] }>('/api/cis?pageSize=500'),
      ]);
      setDatacenters(dcResponse.data);
      setLinks(linkResponse.data);
      setMapInfo(mapResponse.data);
      setNetworkCis(cisResponse.data);
    } catch (error: any) { toast.error(error.message); } finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  const openCreate = () => {
    setEditing(null);
    setForm({ ...EMPTY_LINK, source_dc_id: datacenters[0]?.id || '', target_dc_id: datacenters[1]?.id || '' });
    setLinkOpen(true);
  };

  const openEdit = (link: any) => {
    setEditing(link);
    setForm({ source_dc_id: link.source_dc_id, target_dc_id: link.target_dc_id, name: link.name, carrier: link.carrier, bandwidth_mbps: link.bandwidth_mbps, status: link.status, source: link.source, zabbix_ci_id: link.zabbix_ci_id || '', zabbix_metric: link.zabbix_metric || '', notes: link.notes || '' });
    setLinkOpen(true);
  };

  const saveLink = async () => {
    if (!form.name?.trim()) return toast.error('请填写线路名称');
    setSaving(true);
    try {
      const payload = { ...form, source_dc_id: Number(form.source_dc_id), target_dc_id: Number(form.target_dc_id), bandwidth_mbps: Number(form.bandwidth_mbps || 0), zabbix_ci_id: form.zabbix_ci_id ? Number(form.zabbix_ci_id) : null };
      if (editing) await api.put(`/api/datacenter-links/${editing.id}`, payload);
      else await api.post('/api/datacenter-links', payload);
      toast.success(editing ? '线路已更新' : '线路已创建');
      setLinkOpen(false);
      await load();
    } catch (error: any) { toast.error(error.message); } finally { setSaving(false); }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await api.delete(`/api/datacenter-links/${deleteTarget.id}`);
      toast.success('线路已删除');
      setDeleteTarget(null);
      await load();
    } catch (error: any) { toast.error(error.message); } finally { setDeleting(false); }
  };

  const uploadMap = (file?: File) => {
    if (!file) return;
    if (file.size > 2.5 * 1024 * 1024) return toast.error('地图 SVG 不能超过 2.5MB');
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const response = await api.put<{ data: any }>('/api/system/map', { svg: String(reader.result || '') });
        setMapInfo(response.data);
        toast.success('地图图源已更新');
      } catch (error: any) { toast.error(error.message); }
    };
    reader.readAsText(file);
  };

  const resetMap = async () => {
    try {
      const response = await api.delete<{ data: any }>('/api/system/map');
      setMapInfo(response.data);
      toast.success('已恢复默认地图');
    } catch (error: any) { toast.error(error.message); }
  };

  return (
    <div className="animate-enter">
      <PageHeader eyebrow="Location settings" title="地理位置配置" description="维护数据中心地理位置、网络线路、运营商、速率与监控来源，并更新系统标准地图图源。" actions={<Button size="sm" icon={Plus} onClick={openCreate}>新增网络线路</Button>} />
      <div className="mb-3.5 grid gap-3.5 xl:grid-cols-12">
        <div className="card overflow-hidden xl:col-span-4">
          <div className="border-b border-[#eef1f6] px-5 py-3.5"><h2 className="flex items-center gap-1.5 text-[13px] font-semibold text-slate-800"><Map className="h-3.5 w-3.5 text-brand-500" /> 标准地图图源</h2><p className="mt-0.5 text-[10px] text-slate-400">上传符合中国标准地图规范的 SVG。</p></div>
          <div className="space-y-3 p-5">
            <div className="flex items-center gap-3 rounded-xl border border-slate-200 p-3">
              <span className="flex h-14 w-14 items-center justify-center rounded-xl bg-slate-50"><Map className="h-6 w-6 text-slate-400" /></span>
              <div className="min-w-0 flex-1"><p className="text-[11px] font-medium text-slate-700">{mapInfo?.custom ? '自定义地图图源' : '系统标准地图'}</p><p className="mt-0.5 truncate text-[9px] text-slate-400">{mapInfo?.custom ? '已上传自定义 SVG' : (mapInfo?.default_url || '/china-provinces.svg')}</p></div>
            </div>
            <div className="flex gap-2">
              <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[10.5px] font-medium text-slate-600 hover:bg-slate-50"><ImageUp className="h-3.5 w-3.5" /> 上传 SVG<input type="file" accept="image/svg+xml" className="hidden" onChange={(event) => uploadMap(event.target.files?.[0])} /></label>
              {mapInfo?.custom ? <Button variant="secondary" size="xs" icon={RefreshCw} onClick={resetMap}>恢复默认</Button> : null}
            </div>
          </div>
        </div>
        <div className="card overflow-hidden xl:col-span-8">
          <div className="flex items-center justify-between border-b border-[#eef1f6] px-5 py-3.5"><div><h2 className="text-[13px] font-semibold text-slate-800">数据中心网络线路</h2><p className="mt-0.5 text-[10px] text-slate-400">线路会以连线绘制在标准地图上；可绑定 Zabbix 资产与监控项。</p></div><Badge className="bg-slate-100 text-slate-500 ring-slate-500/10">{links.length} 条</Badge></div>
          {loading ? <div className="space-y-2 p-4">{[1, 2].map((item) => <Skeleton key={item} className="h-14" />)}</div> : links.length ? (
            <div className="divide-y divide-[#f0f2f7]">
              {links.map((link) => {
                const meta = link.effective_status === 'up' ? 'bg-emerald-50 text-emerald-700 ring-emerald-600/15' : link.effective_status === 'down' ? 'bg-rose-50 text-rose-700 ring-rose-600/15' : 'bg-amber-50 text-amber-700 ring-amber-600/15';
                return (
                  <div key={link.id} className="flex flex-col gap-2 px-5 py-3.5 sm:flex-row sm:items-center">
                    <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-50 text-brand-600"><Link2 className="h-3.5 w-3.5" /></span>
                    <div className="min-w-0 flex-1"><p className="text-[11.5px] font-medium text-slate-700">{link.name}</p><p className="mt-0.5 text-[9.5px] text-slate-400"><ArrowLeftRight className="mr-1 inline h-3 w-3" />{link.source_name} → {link.target_name} · {link.carrier} · {link.bandwidth_mbps ? `${link.bandwidth_mbps}M` : '—'} · {link.status_source === 'zabbix' ? `Zabbix ${link.monitored_asset_no || ''}${link.zabbix_metric ? ` / ${link.zabbix_metric}` : ''}` : '手工状态'}</p></div>
                    <Badge className={meta}>{link.effective_status === 'up' ? '正常' : link.effective_status === 'down' ? '中断' : '异常'}</Badge>
                    <IconButton icon={Pencil} label="编辑线路" onClick={() => openEdit(link)} />
                    <IconButton icon={Trash2} label="删除线路" variant="danger" onClick={() => setDeleteTarget(link)} />
                  </div>
                );
              })}
            </div>
          ) : <EmptyState title="暂无网络线路" description="新增数据中心之间的线路，地图将显示连接关系与状态。" icon={Link2} className="py-12" />}
        </div>
      </div>

      <Modal open={linkOpen} onClose={() => setLinkOpen(false)} title={editing ? '编辑网络线路' : '新增网络线路'} description="定义两端数据中心、运营商、带宽与状态来源。" icon={Link2} size="md" footer={<><Button variant="secondary" size="sm" onClick={() => setLinkOpen(false)}>取消</Button><Button size="sm" loading={saving} onClick={saveLink}>{editing ? '保存' : '创建'}</Button></>}>
        <div className="space-y-3">
          <Field label="线路名称" required><Input value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} placeholder="例如 上海—北京灾备专线" /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="源数据中心"><select className="input-base" value={form.source_dc_id} onChange={(event) => setForm((current) => ({ ...current, source_dc_id: event.target.value }))}>{datacenters.map((dc) => <option key={dc.id} value={dc.id}>{dc.name}</option>)}</select></Field>
            <Field label="目标数据中心"><select className="input-base" value={form.target_dc_id} onChange={(event) => setForm((current) => ({ ...current, target_dc_id: event.target.value }))}>{datacenters.map((dc) => <option key={dc.id} value={dc.id}>{dc.name}</option>)}</select></Field>
            <Field label="运营商"><Input value={form.carrier} onChange={(event) => setForm((current) => ({ ...current, carrier: event.target.value }))} placeholder="中国电信 / 中国移动 / 中国联通" /></Field>
            <Field label="连接速率 (Mbps)"><Input type="number" min="0" value={form.bandwidth_mbps} onChange={(event) => setForm((current) => ({ ...current, bandwidth_mbps: event.target.value }))} /></Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="状态来源"><select className="input-base" value={form.source} onChange={(event) => setForm((current) => ({ ...current, source: event.target.value }))}><option value="manual">手工维护</option><option value="zabbix">Zabbix 监控</option></select></Field>
            <Field label="手工状态"><select className="input-base" value={form.status} onChange={(event) => setForm((current) => ({ ...current, status: event.target.value }))}><option value="up">正常</option><option value="degraded">异常</option><option value="down">中断</option></select></Field>
          </div>
          {form.source === 'zabbix' ? <div className="grid grid-cols-2 gap-3 rounded-xl border border-brand-100 bg-brand-50/40 p-3">
            <Field label="监控资产"><SearchSelect value={String(form.zabbix_ci_id || '')} onChange={(value) => setForm((current) => ({ ...current, zabbix_ci_id: value }))} placeholder="选择服务器、网络或安全设备" options={[{ value: '', label: '选择资产' }, ...networkCis.map((ci) => ({ value: String(ci.id), label: `${ci.asset_no} · ${ci.name}`, description: ci.type_name || '' }))]} /></Field>
            <Field label="监控项 Key"><Input value={form.zabbix_metric} onChange={(event) => setForm((current) => ({ ...current, zabbix_metric: event.target.value }))} placeholder="net.if.status[ifOperStatus]" className="font-mono" /></Field>
          </div> : null}
          <Field label="备注"><Input value={form.notes} onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))} placeholder="线路用途、维护窗口等" /></Field>
        </div>
      </Modal>
      <ConfirmDialog open={Boolean(deleteTarget)} onClose={() => setDeleteTarget(null)} onConfirm={confirmDelete} loading={deleting} title="删除网络线路" description={<>确定删除「{deleteTarget?.name}」吗？</>} />
    </div>
  );
}
