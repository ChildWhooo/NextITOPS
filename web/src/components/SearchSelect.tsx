import { useMemo, useRef, useState } from 'react';
import { ChevronDown, Search } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface SearchSelectOption {
  value: string;
  label: string;
  description?: string;
}

export function SearchSelect({ value, options, onChange, placeholder = '请选择', className = '', onQueryChange }: {
  value: string;
  options: SearchSelectOption[];
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  onQueryChange?: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [openUp, setOpenUp] = useState(false);
  const [query, setQuery] = useState('');
  const buttonRef = useRef<HTMLButtonElement>(null);
  const selected = options.find((option) => String(option.value) === String(value));
  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return options.slice(0, 200);
    return options.filter((option) => `${option.label} ${option.description || ''}`.toLowerCase().includes(term)).slice(0, 200);
  }, [options, query]);

  return (
    <div className={cn('relative', className)}>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => {
          const nextOpen = !open;
          if (nextOpen) {
            const rect = buttonRef.current?.getBoundingClientRect();
            setOpenUp(Boolean(rect && window.innerHeight - rect.bottom < 360 && rect.top > 360));
          }
          setOpen(nextOpen);
        }}
        className="input-base flex h-10 w-full items-center justify-between gap-2 text-left text-sm"
      >
        <span className={cn('truncate', selected ? 'text-slate-800' : 'text-slate-400')}>{selected?.label || placeholder}</span>
        <ChevronDown className="h-4 w-4 shrink-0 text-slate-400" />
      </button>
      {open ? (
        <>
          <div className="fixed inset-0 z-40" onClick={() => { setOpen(false); setQuery(''); }} />
          <div className={cn('absolute left-0 right-0 z-50 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl', openUp ? 'bottom-full mb-1' : 'mt-1')}>
            <div className="flex items-center gap-2 border-b border-slate-100 px-3 py-2.5">
              <Search className="h-4 w-4 text-slate-400" />
              <input autoFocus value={query} onChange={(event) => { setQuery(event.target.value); onQueryChange?.(event.target.value); }} placeholder="输入关键字搜索…" className="w-full bg-transparent text-sm outline-none" />
            </div>
            <div className="custom-scroll max-h-80 overflow-y-auto p-1">
              {filtered.length ? filtered.map((option) => (
                <button key={option.value} type="button" onClick={() => { onChange(String(option.value)); setOpen(false); setQuery(''); }} className={cn('flex w-full flex-col rounded-lg px-2.5 py-2 text-left hover:bg-slate-50', String(option.value) === String(value) && 'bg-brand-50')}>
                  <span className="truncate text-sm text-slate-700">{option.label}</span>
                  {option.description ? <span className="truncate text-xs text-slate-400">{option.description}</span> : null}
                </button>
              )) : <p className="px-3 py-5 text-center text-sm text-slate-400">没有匹配项</p>}
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}
