import { useEffect, useState } from 'react';
import { ExternalLink, Map, Plug, Radar, Save } from 'lucide-react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { usePageTitle } from '@/lib/hooks';
import { Button, Field, Input, PageHeader, Skeleton } from '@/components/ui';

export default function ThirdPartyPage() {
  usePageTitle('第三方对接');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [config, setConfig] = useState<any>({ amap_web_key: '', amap_js_key: '', amap_security_code: '', zabbix: [] });
  useEffect(() => {
    api.get<{ data: any }>('/api/system/third-party').then((response) => setConfig(response.data)).catch((error) => toast.error(error.message)).finally(() => setLoading(false));
  }, []);
  const save = async () => {
    setSaving(true);
    try {
      const response = await api.put<{ data: any }>('/api/system/third-party', { amap_web_key: config.amap_web_key, amap_js_key: config.amap_js_key, amap_security_code: config.amap_security_code });
      setConfig((current: any) => ({ ...current, ...response.data }));
      toast.success('第三方 API 配置已保存');
    } catch (error: any) { toast.error(error.message); } finally { setSaving(false); }
  };
  const testAmap = async () => {
    if (!config.amap_web_key?.trim()) {
      if (!config.amap_js_key?.trim()) return toast.error('请至少填写 JS API Key 或 Web 服务 Key');
      toast.success('JS API Key 已填写；Web 服务 Key 未配置，跳过 Web 服务接口测试');
      return;
    }
    setTesting(true);
    try {
      await api.put('/api/system/third-party', { amap_web_key: config.amap_web_key, amap_js_key: config.amap_js_key, amap_security_code: config.amap_security_code });
      const result = await api.post<{ province?: string; city?: string }>('/api/system/third-party/test-amap', {});
      toast.success(`高德 API 连接成功${result.city ? ` · ${result.city}` : ''}`);
    } catch (error: any) { toast.error(error.message); } finally { setTesting(false); }
  };
  return (
    <div className="animate-enter">
      <PageHeader eyebrow="Integrations" title="第三方对接" description="集中维护 Zabbix、高德地图及后续第三方系统的 API 与对接配置。" actions={<Button size="sm" icon={Save} loading={saving} onClick={save}>保存配置</Button>} />
      <div className="grid gap-3 xl:grid-cols-2">
        <div className="card overflow-hidden">
          <div className="flex items-center gap-2 border-b border-[#eef1f6] px-5 py-3.5"><span className="flex h-8 w-8 items-center justify-center rounded-lg bg-sky-50 text-sky-600"><Map className="h-4 w-4" /></span><div><h2 className="text-[13px] font-semibold text-slate-800">高德地图 API</h2><p className="text-[10px] text-slate-400">在线地图瓦片与 Web 服务接口配置</p></div></div>
          {loading ? <div className="space-y-2 p-5"><Skeleton className="h-10" /><Skeleton className="h-10" /></div> : (
            <div className="space-y-3 p-5">
              <div className="rounded-lg border border-brand-200 bg-white p-3 text-[9.5px] leading-relaxed text-slate-600">
                <p className="font-medium text-brand-700">高德开放平台字段对应关系</p>
                <p className="mt-1"><strong>Key 名称</strong>：仅用于区分应用，不是密钥，不需要填写。</p>
                <p><strong>Key</strong>：复制应用详情中的 Key；需按应用「服务平台」分别填写到 Web 服务 Key 或 JS API Key。</p>
                <p><strong>安全密钥</strong>：仅 JS API 2.0 使用，与 JS API Key 配对。</p>
              </div>
              <Field label="Web 服务 Key（可选）" hint="对应高德「Web服务」类型应用的 Key，用于地址解析/逆地理编码；不填写不影响 JS 地图"><Input value={config.amap_web_key} onChange={(event) => setConfig((current: any) => ({ ...current, amap_web_key: event.target.value }))} className="font-mono text-[11px]" placeholder="可选" /></Field>
              <Field label="JS API Key" hint="对应高德「Web端(JS API)」类型应用的 Key 字段"><Input value={config.amap_js_key} onChange={(event) => setConfig((current: any) => ({ ...current, amap_js_key: event.target.value }))} className="font-mono text-[11px]" placeholder="JS API 应用详情中的 Key" /></Field>
              <Field label="安全密钥" hint="对应 JS API 应用详情中的「安全密钥 / securityJsCode」"><Input value={config.amap_security_code} onChange={(event) => setConfig((current: any) => ({ ...current, amap_security_code: event.target.value }))} className="font-mono text-[11px]" placeholder="securityJsCode" /></Field>
              <div className="flex items-center justify-between rounded-xl bg-slate-50 px-3 py-2.5"><span className="text-[10px] text-slate-500">数据中心地图当前使用高德在线瓦片图源</span><Link to="/system/map-settings" className="flex items-center gap-1 text-[10px] font-medium text-brand-600">地理位置配置 <ExternalLink className="h-3 w-3" /></Link></div>
              <div className="flex items-center justify-between gap-3 border-t border-slate-100 pt-3">
                <p className="text-[9px] leading-relaxed text-slate-400">Web 服务 Key 为可选；未填写时仅校验 JS API Key 配置。</p>
                <Button variant="secondary" size="sm" loading={testing} onClick={testAmap}>测试高德 API</Button>
              </div>
            </div>
          )}
        </div>
        <div className="card overflow-hidden">
          <div className="flex items-center gap-2 border-b border-[#eef1f6] px-5 py-3.5"><span className="flex h-8 w-8 items-center justify-center rounded-lg bg-orange-50 text-orange-600"><Radar className="h-4 w-4" /></span><div><h2 className="text-[13px] font-semibold text-slate-800">监控与第三方集成</h2><p className="text-[10px] text-slate-400">Zabbix 等系统对接入口</p></div></div>
          <div className="space-y-2 p-5">
            {config.zabbix?.length ? config.zabbix.map((integration: any) => (
              <div key={integration.id} className="flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2.5">
                <Plug className="h-3.5 w-3.5 text-slate-400" />
                <div className="min-w-0 flex-1"><p className="truncate text-[11px] font-medium text-slate-700">{integration.name}</p><p className="truncate text-[9px] text-slate-400">{integration.base_url} · {integration.enabled ? '已启用' : '未启用'}</p></div>
                <Link to="/integrations/zabbix" className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"><ExternalLink className="h-3.5 w-3.5" /></Link>
              </div>
            )) : <p className="rounded-xl border border-dashed border-slate-200 px-3 py-6 text-center text-[10.5px] text-slate-400">尚未配置 Zabbix 集成。</p>}
            <Link to="/integrations/zabbix" className="flex items-center justify-center gap-1.5 rounded-xl border border-slate-200 px-3 py-2.5 text-[10.5px] font-medium text-slate-600 hover:bg-slate-50"><Radar className="h-3.5 w-3.5" /> 打开 Zabbix 集成</Link>
          </div>
        </div>
      </div>
    </div>
  );
}
