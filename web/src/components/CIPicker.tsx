import { useEffect, useRef, useState } from 'react';
import { Boxes, Plus, Search, X } from 'lucide-react';
import { api } from '@/lib/api';
import { useDebounce } from '@/lib/hooks';
import { cn } from '@/lib/utils';
import type { CI } from '@/lib/types';
import { Spinner } from '@/components/ui';

export function CIPicker({
  value,
  onChange,
  placeholder = '搜索资产名称或编号，添加到工单…',
}: {
  value: CI[];
  onChange: (value: CI[]) => void;
  placeholder?: string;
}) {
  const [query, setQuery] = useState('');
  const debounced = useDebounce(query, 220);
  const [options, setOptions] = useState<CI[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    let active = true;
    setLoading(true);
    api
      .get<{ data: CI[] }>(`/api/cis/options?q=${encodeURIComponent(debounced)}`)
      .then((response) => {
        if (active) setOptions(response.data.filter((item) => !value.some((selected) => selected.id === item.id)));
      })
      .catch(() => {})
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [debounced, open, value]);

  useEffect(() => {
    const handler = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  return (
    <div ref={containerRef} className="relative">
      {value.length ? (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {value.map((ci) => (
            <span key={ci.id} className="inline-flex items-center gap-1.5 rounded-lg border border-brand-100 bg-brand-50 py-1 pl-2 pr-1 text-[10.5px] text-brand-800">
              <span className="h-1.5 w-1.5 rounded-full" style={{ background: ci.type_color || '#4f6ef7' }} />
              <span className="max-w-[220px] truncate">{ci.name}</span>
              <span className="font-mono text-[9px] text-brand-500">{ci.asset_no}</span>
              <button
                type="button"
                onClick={() => onChange(value.filter((item) => item.id !== ci.id))}
                className="rounded p-0.5 text-brand-400 hover:bg-brand-100 hover:text-brand-700"
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      ) : null}
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
        <input
          className="input-base h-10 pl-9"
          value={query}
          onFocus={() => setOpen(true)}
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
          }}
          placeholder={placeholder}
        />
        {loading ? <Spinner className="absolute right-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2" /> : null}
      </div>
      {open ? (
        <div className="absolute left-0 right-0 top-[calc(100%+6px)] z-30 max-h-56 overflow-y-auto rounded-xl border border-slate-200 bg-white p-1 shadow-[var(--shadow-float)]">
          {options.map((option) => (
            <button
              key={option.id}
              type="button"
              onClick={() => {
                onChange([...value, option]);
                setQuery('');
                setOpen(false);
              }}
              className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition hover:bg-slate-50"
            >
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-white" style={{ background: option.type_color || '#4f6ef7' }}>
                <Boxes className="h-3.5 w-3.5" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[11.5px] font-medium text-slate-700">{option.name}</span>
                <span className="block font-mono text-[9px] text-slate-400">{option.asset_no} · {option.type_name}</span>
              </span>
              <Plus className="h-3.5 w-3.5 text-slate-300" />
            </button>
          ))}
          {!options.length && !loading ? <p className="px-3 py-5 text-center text-[10.5px] text-slate-400">未找到可关联的 CI</p> : null}
          {!options.length && loading ? <p className="px-3 py-5 text-center text-[10.5px] text-slate-400">检索中…</p> : null}
        </div>
      ) : null}
    </div>
  );
}
