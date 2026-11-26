import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Eye, EyeOff, Network, Pencil, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { usePageTitle } from '@/lib/hooks';
import { cn } from '@/lib/utils';
import { Button, EmptyState, Field, Input, Modal, PageHeader, PageSizeSelect, Pagination, SearchInput, Skeleton } from '@/components/ui';

interface IPGroup { subnet: string; count: number; label?: string; vlan?: string; notes?: string; items: any[] }
const STATUS_LABELS: Record<string, string> = { in_use: '使用中', idle: '闲置', reserved: '保留', offline: '已下线' };

export default function IPInventoryPage() {
  usePageTitle('网络IP资产');
  const [groups, setGroups] = useState<IPGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [subnetFilter, setSubnetFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [sourceFilter, setSourceFilter] = useState('');
  const [hiddenSubnets, setHiddenSubnets] = useState<Set<string>>(new Set());
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [manualOpen, setManualOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ ip_address: '', status: 'in_use', owner: '', notes: '', ci_id: '' });
  const [assets, setAssets] = useState<any[]>([]);
  const [assetTypeFilter, setAssetTypeFilter] = useState('');
  const [assetSearch, setAssetSearch] = useState('');
  const [subnetEdit, setSubnetEdit] = useState<IPGroup | null>(null);
  const [subnetForm, setSubnetForm] = useState({ label: '', vlan: '', notes: '' });
  const [subnetSaving, setSubnetSaving] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState('');
  const [importing, setImporting] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [history, setHistory] = useState<any[]>([]);

  const load = async () => {
    setLoading(true);
    try {
      const response = await api.get<{ data: IPGroup[] }>('/api/ip-inventory');
      setGroups(response.data);
    } catch (error: any) { toast.error(error.message); } finally { setLoading(false); }
  };
  useEffect(() => { load(); api.get<{ data: any[] }>('/api/cis?pageSize=500').then((response) => setAssets(response.data || [])).catch(() => {}); }, []);

  const allItems = useMemo(() => groups.flatMap((group) => group.items.map((item) => ({ ...item, subnet: group.subnet }))), [groups]);
  const filteredItems = useMemo(() => allItems.filter((item) => {
    if (hiddenSubnets.has(item.subnet)) return false;
    if (subnetFilter && item.subnet !== subnetFilter) return false;
    if (statusFilter && item.status !== statusFilter) return false;
    if (sourceFilter && item.source !== sourceFilter) return false;
    if (search && !`${item.ip_address} ${item.asset_no} ${item.name} ${item.manager_name || ''}`.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  }), [allItems, hiddenSubnets, subnetFilter, statusFilter, sourceFilter, search]);
  const totalPages = Math.max(1, Math.ceil(filteredItems.length / pageSize));
  const pageGroups = useMemo(() => {
    const map = new Map<string, any[]>();
    for (const item of filteredItems.slice((page - 1) * pageSize, page * pageSize)) {
      if (!map.has(item.subnet)) map.set(item.subnet, []);
      map.get(item.subnet)!.push(item);
    }
    const meta = new Map(groups.map((group) => [group.subnet, group]));
    return [...map.entries()].map(([subnet, items]) => ({ ...meta.get(subnet), subnet, count: items.length, items }));
  }, [filteredItems, page, pageSize, groups]);
  useEffect(() => { setPage(1); }, [search, subnetFilter, statusFilter, sourceFilter, pageSize, hiddenSubnets]);

  const total = groups.reduce((sum, group) => sum + group.count, 0);
  const allowedAssetTypes = new Set(['服务器', '网络设备', '信息安全设备', '虚拟化平台', '虚拟机', '业务系统']);
  const assetsWithNetwork = assets.filter((asset) => allowedAssetTypes.has(asset.type_name));
  const assetTypes = [...new Set(assetsWithNetwork.map((asset) => asset.type_name).filter(Boolean))];
  const filteredAssets = assetsWithNetwork.filter((asset) => (!assetTypeFilter || asset.type_name === assetTypeFilter) && (!assetSearch || `${asset.asset_no} ${asset.name} ${asset.type_name}`.toLowerCase().includes(assetSearch.toLowerCase())));
  const openCreate = () => { setEditing(null); setAssetTypeFilter(''); setAssetSearch(''); setForm({ ip_address: '', status: 'in_use', owner: '', notes: '', ci_id: '' }); setManualOpen(true); };
  const openEdit = (item: any) => { setEditing(item); setForm({ ip_address: item.ip_address, status: item.status, owner: item.manager_name || '', notes: item.name === '手工登记 IP' ? '' : item.interface_name || '', ci_id: item.linked_ci_id ? String(item.linked_ci_id) : '' }); setManualOpen(true); };
  const saveManual = async () => {
    setSaving(true);
    try {
      if (editing) await api.put(`/api/ip-assets/${editing.manual_id}`, form);
      else await api.post('/api/ip-assets', form);      toast.success(editing ? 'IP 已更新' : 'IP 已新增');
      setManualOpen(false);
      await load();
    } catch (error: any) { toast.error(error.message); } finally { setSaving(false); }
  };
  const removeManual = async (item: any) => {
    if (!window.confirm(`确定删除手工 IP ${item.ip_address} 吗？`)) return;
    try { await api.delete(`/api/ip-assets/${item.manual_id}`); toast.success('IP 已删除'); await load(); } catch (error: any) { toast.error(error.message); }
  };
  const importIps = async () => {
    const items = importText.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line) => {
      const [ip_address, status = 'in_use', owner = '', notes = ''] = line.split(/[,，\t]/).map((part) => part.trim());
      return { ip_address, status: ['in_use', 'idle', 'reserved', 'offline'].includes(status) ? status : 'in_use', owner, notes };
    });
    if (!items.length) return toast.error('请粘贴至少一行 IP');
    setImporting(true);
    try {
      const response = await api.post<{ data: { imported: number; skipped: Array<{ ip: string; reason: string }> } }>('/api/ip-assets/import', { items });
      toast.success(`成功导入 ${response.data.imported} 条${response.data.skipped.length ? `，跳过 ${response.data.skipped.length} 条` : ''}`);
      if (response.data.skipped.length) toast.info(response.data.skipped.slice(0, 3).map((item) => `${item.ip}：${item.reason}`).join('；'));
      setImportOpen(false);
      setImportText('');
      await load();
    } catch (error: any) { toast.error(error.message); } finally { setImporting(false); }
  };
  const openSubnet = (group: IPGroup) => { setSubnetEdit(group); setSubnetForm({ label: group.label || '', vlan: group.vlan || '', notes: group.notes || '' }); };
  const saveSubnet = async () => {
    if (!subnetEdit) return;
    setSubnetSaving(true);
    try {
      await api.put('/api/ip-subnets', { subnet: subnetEdit.subnet, ...subnetForm });
      toast.success('网段标签已保存');
      setSubnetEdit(null);
      await load();
    } catch (error: any) { toast.error(error.message); } finally { setSubnetSaving(false); }
  };

  return (
    <div className="animate-enter">
      <PageHeader eyebrow="Network inventory" title="网络IP资产" description="自动汇总 CMDB 与手工登记的 IP 地址，按 /24 网段分组并按地址排序。" actions={<div className="flex items-center gap-2"><Button variant="secondary" size="sm" icon={Eye} onClick={async () => { const response = await api.get<{ data: any[] }>('/api/ip-assets/history'); setHistory(response.data || []); setHistoryOpen(true); }}>历史记录</Button><Button variant="secondary" size="sm" icon={Plus} onClick={() => setImportOpen(true)}>批量导入</Button><Button size="sm" icon={Plus} onClick={openCreate}>新增IP</Button></div>} />
      <div className="mb-3 grid grid-cols-2 gap-2.5 lg:grid-cols-4">
        {[{ label: 'IP 地址总数', value: total }, { label: '网段数量', value: groups.length }, { label: '当前筛选', value: filteredItems.length }, { label: '手工登记', value: allItems.filter((item) => item.source === 'manual').length }].map((item) => (
          <div key={item.label} className="card flex items-center gap-3 p-3.5"><span className="flex h-9 w-9 items-center justify-center rounded-xl bg-sky-50 text-sky-600"><Network className="h-4 w-4" /></span><div><p className="text-[20px] font-semibold leading-none text-slate-900">{item.value}</p><p className="mt-1 text-[9.5px] text-slate-400">{item.label}</p></div></div>
        ))}
      </div>
      <div className="card overflow-hidden">
        <div className="space-y-2 border-b border-[#eef1f6] p-4">
          <div className="flex flex-wrap items-center justify-between gap-2"><div><h2 className="text-[13px] font-semibold text-slate-800">IP 台账</h2><p className="mt-0.5 text-[10px] text-slate-400">支持按网段、状态、来源筛选，手工 IP 可编辑或删除</p></div><SearchInput value={search} onChange={setSearch} placeholder="搜索 IP、资产编号…" className="w-full sm:w-[260px]" /></div>
          <div className="flex flex-wrap items-center gap-1.5">
            <select className="input-base h-7 w-auto text-[10px]" value={subnetFilter} onChange={(event) => setSubnetFilter(event.target.value)}><option value="">全部网段</option>{groups.map((group) => <option key={group.subnet} value={group.subnet}>{group.subnet}</option>)}</select>
            <select className="input-base h-7 w-auto text-[10px]" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option value="">全部状态</option>{Object.entries(STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
            <select className="input-base h-7 w-auto text-[10px]" value={sourceFilter} onChange={(event) => setSourceFilter(event.target.value)}><option value="">全部来源</option><option value="ci">CMDB 主 IP</option><option value="bmc">BMC/带外</option><option value="attribute">扩展字段</option><option value="ci_ip">附加 IP</option><option value="manual">手工登记</option></select>
            {hiddenSubnets.size ? <button onClick={() => setHiddenSubnets(new Set())} className="text-[9.5px] text-brand-600">恢复已隐藏的 {hiddenSubnets.size} 个网段</button> : null}
          </div>
        </div>
        {loading ? <div className="space-y-2 p-4">{[1, 2, 3].map((item) => <Skeleton key={item} className="h-16" />)}</div> : filteredItems.length ? (
          <>
            <div className="space-y-4 p-4">
              {pageGroups.map((group) => (
                <div key={group.subnet} className="overflow-hidden rounded-xl border border-slate-200">
                  <div className="flex items-center justify-between bg-slate-50 px-4 py-2.5"><div className="min-w-0"><span className="font-mono text-[11px] font-semibold text-slate-700">{group.subnet}</span>{group.label ? <span className="ml-2 rounded bg-sky-100 px-1.5 py-0.5 text-[9px] text-sky-700">{group.label}</span> : null}{group.vlan ? <span className="ml-1.5 rounded bg-violet-100 px-1.5 py-0.5 text-[9px] text-violet-700">VLAN {group.vlan}</span> : null}{group.notes ? <span className="ml-2 text-[9px] text-slate-400">{group.notes}</span> : null}</div><div className="flex items-center gap-2"><span className="text-[9.5px] text-slate-400">{group.count} 个地址</span><button onClick={() => openSubnet(group)} className="rounded p-1 text-slate-400 hover:bg-white hover:text-slate-600" title="编辑网段标签"><Pencil className="h-3.5 w-3.5" /></button><button onClick={() => setHiddenSubnets((current) => new Set(current).add(group.subnet))} className="rounded p-1 text-slate-400 hover:bg-white hover:text-slate-600" title="隐藏该网段"><EyeOff className="h-3.5 w-3.5" /></button></div></div>
                  <table className="data-table"><thead><tr><th>IP 地址</th><th>资产</th><th>类型</th><th>负责人</th><th>位置</th><th>状态</th><th>操作</th></tr></thead><tbody>
                    {group.items.map((item) => (
                      <tr key={`${item.id}-${item.ip_address}`}>
                        <td><span className="font-mono text-[11px] font-medium text-slate-700">{item.ip_address}</span>{item.interface_name ? <p className="mt-0.5 text-[8.5px] text-slate-400">{item.interface_name}</p> : null}</td>
                        <td>{item.source === 'manual' ? (item.linked_ci_id ? <><Link to={`/cmdb/${item.linked_ci_id}`} className="text-[11.5px] font-medium text-brand-600 hover:text-brand-700">{item.linked_ci_name}</Link><p className="mt-0.5 font-mono text-[9px] text-slate-400">{item.linked_asset_no}</p></> : <span className="text-[11.5px] font-medium text-slate-700">{item.name}</span>) : <><Link to={`/cmdb/${item.id}`} className="text-[11.5px] font-medium text-brand-600 hover:text-brand-700">{item.name}</Link><p className="mt-0.5 font-mono text-[9px] text-slate-400">{item.asset_no}</p></>}</td>
                        <td className="text-[10.5px] text-slate-500">{item.type_name}</td>
                        <td className="text-[10.5px] text-slate-500">{item.manager_name || '—'}</td>
                        <td className="text-[10.5px] text-slate-500">{item.location || '—'}</td>
                        <td><span className={cn('inline-flex items-center gap-1 text-[9.5px]', item.status === 'in_use' ? 'text-emerald-600' : item.status === 'offline' ? 'text-slate-400' : 'text-amber-600')}><span className={cn('h-1.5 w-1.5 rounded-full', item.status === 'in_use' ? 'bg-emerald-500' : item.status === 'offline' ? 'bg-slate-300' : 'bg-amber-500')} />{STATUS_LABELS[item.status] || item.status}</span></td>
                        <td>{item.source === 'manual' ? <div className="flex items-center gap-1"><button onClick={() => openEdit(item)} className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600" aria-label="编辑IP"><Pencil className="h-3.5 w-3.5" /></button><button onClick={() => removeManual(item)} className="rounded p-1 text-slate-400 hover:bg-rose-50 hover:text-rose-600" aria-label="删除IP"><Trash2 className="h-3.5 w-3.5" /></button></div> : <span className="text-[9px] text-slate-300">—</span>}</td>
                      </tr>
                    ))}
                  </tbody></table>
                </div>
              ))}
            </div>
            <div className="flex flex-col items-center justify-between gap-2 border-t border-[#eef1f6] px-4 py-2 sm:flex-row"><PageSizeSelect value={pageSize} onChange={(size) => { setPageSize(size); setPage(1); }} /><Pagination page={page} pageSize={pageSize} total={filteredItems.length} onChange={setPage} /></div>
          </>
        ) : <EmptyState title="没有匹配的 IP" description={hiddenSubnets.size ? '当前网段已被隐藏，可恢复隐藏后查看。' : '调整筛选条件，或新增手工 IP。'} icon={Network} className="py-16" />}
      </div>

      <Modal open={manualOpen} onClose={() => setManualOpen(false)} title={editing ? '编辑手工 IP' : '新增手工 IP'} description="用于登记不在 CMDB 资产主数据中的地址，例如临时地址、保留地址或第三方设备地址。" icon={Network} size="lg" footer={<><Button variant="secondary" size="sm" onClick={() => setManualOpen(false)}>取消</Button><Button size="sm" loading={saving} onClick={saveManual}>{editing ? '保存修改' : '新增 IP'}</Button></>}>
        <div className="space-y-3">
          <Field label="IP 地址" required><Input value={form.ip_address} onChange={(event) => setForm((current) => ({ ...current, ip_address: event.target.value }))} placeholder="例如 10.20.30.40" className="font-mono text-[11px]" /></Field>
          <div className="grid grid-cols-2 gap-3"><Field label="状态"><select className="input-base" value={form.status} onChange={(event) => setForm((current) => ({ ...current, status: event.target.value }))}>{Object.entries(STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></Field><Field label="负责人"><Input value={form.owner} onChange={(event) => setForm((current) => ({ ...current, owner: event.target.value }))} /></Field></div>
          <Field label="关联资产（可选）" hint="按设备类型筛选后，将手工 IP 归属到某个 CMDB 资产">
            <div className="mb-2 grid grid-cols-2 gap-2"><select className="input-base h-8 text-[10.5px]" value={assetTypeFilter} onChange={(event) => setAssetTypeFilter(event.target.value)}><option value="">全部设备类型</option>{assetTypes.map((type) => <option key={type} value={type}>{type}</option>)}</select><Input className="h-8 text-[10.5px]" value={assetSearch} onChange={(event) => setAssetSearch(event.target.value)} placeholder="搜索资产编号、名称" /></div>
            <select className="input-base" value={form.ci_id} onChange={(event) => setForm((current) => ({ ...current, ci_id: event.target.value }))}><option value="">不关联资产</option>{filteredAssets.map((asset) => <option key={asset.id} value={asset.id}>{asset.asset_no} · {asset.name}</option>)}</select>
          </Field>
          <Field label="说明"><Input value={form.notes} onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))} placeholder="用途、设备或备注信息" /></Field>
        </div>
      </Modal>
      <Modal open={historyOpen} onClose={() => setHistoryOpen(false)} title="IP 关联历史" description="记录人工 IP 被 CMDB 资产接管的时间、前后归属与操作者。" icon={Eye} size="lg" footer={<Button variant="secondary" size="sm" onClick={() => setHistoryOpen(false)}>关闭</Button>}>
        {history.length ? <div className="max-h-[480px] space-y-2 overflow-auto">{history.map((item) => <div key={item.id} className="rounded-lg border border-slate-200 p-3 text-[10.5px]"><p className="font-mono font-medium text-slate-700">{item.ip_address}</p><p className="mt-1 text-slate-500">{item.previous_asset_no || item.previous_notes || '手工 IP'} → {item.new_asset_no || '未关联资产'}</p><p className="mt-1 text-[9px] text-slate-400">{item.actor_name || '系统'} · {new Date(item.created_at).toLocaleString()}</p></div>)}</div> : <p className="py-10 text-center text-[11px] text-slate-400">暂无关联变更记录。</p>}
      </Modal>

      <Modal open={importOpen} onClose={() => setImportOpen(false)} title="批量导入手工 IP" description="每行一条，格式：IP,状态,负责人,备注。状态可填 in_use / idle / reserved / offline，缺省为 in_use。" icon={Network} size="md" footer={<><Button variant="secondary" size="sm" onClick={() => setImportOpen(false)}>取消</Button><Button size="sm" loading={importing} onClick={importIps}>开始导入</Button></>}>
        <textarea className="input-base min-h-[260px] font-mono text-[10.5px]" value={importText} onChange={(event) => setImportText(event.target.value)} placeholder={'10.20.30.40,in_use,张三,办公终端\n10.20.30.41,reserved,,保留地址'} />
        <p className="mt-2 text-[9.5px] text-slate-400">与已登记手工 IP 或 CMDB 资产 IP 冲突的记录会自动跳过，并提示冲突原因。</p>
      </Modal>

      <Modal open={Boolean(subnetEdit)} onClose={() => setSubnetEdit(null)} title={`网段标签 · ${subnetEdit?.subnet || ''}`} description="标识该网段用途、VLAN 或备注信息，便于地址规划与运维。" icon={Network} size="sm" footer={<><Button variant="secondary" size="sm" onClick={() => setSubnetEdit(null)}>取消</Button><Button size="sm" loading={subnetSaving} onClick={saveSubnet}>保存标签</Button></>}>
        <div className="space-y-3">
          <Field label="用途/名称"><Input value={subnetForm.label} onChange={(event) => setSubnetForm((current) => ({ ...current, label: event.target.value }))} placeholder="例如：生产服务器区 / DMZ" /></Field>
          <Field label="VLAN"><Input value={subnetForm.vlan} onChange={(event) => setSubnetForm((current) => ({ ...current, vlan: event.target.value }))} placeholder="例如：120" className="font-mono text-[11px]" /></Field>
          <Field label="备注"><Input value={subnetForm.notes} onChange={(event) => setSubnetForm((current) => ({ ...current, notes: event.target.value }))} placeholder="网关、用途或维护说明" /></Field>
        </div>
      </Modal>
    </div>
  );
}
