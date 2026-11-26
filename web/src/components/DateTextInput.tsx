import { useEffect, useRef, useState } from 'react';
import { CalendarDays } from 'lucide-react';

function displayValue(value: string, withTime: boolean) {
  if (!value) return '';
  const normalized = String(value).replace('T', ' ').replace(/-/g, '/');
  return withTime ? normalized.slice(0, 16) : normalized.slice(0, 10);
}

function modelValue(value: string, withTime: boolean) {
  const normalized = value.trim().replace(/\//g, '-');
  const pattern = withTime ? /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})$/ : /^(\d{4})-(\d{2})-(\d{2})$/;
  if (!pattern.test(normalized)) return '';
  return withTime ? normalized.replace(' ', 'T') : normalized;
}

export function DateTextInput({ value, onChange, withTime = false, className = '', placeholder, ariaLabel, required }: { value?: string; onChange: (value: string) => void; withTime?: boolean; className?: string; placeholder?: string; ariaLabel?: string; required?: boolean }) {
  const [text, setText] = useState(displayValue(value || '', withTime));
  const pickerRef = useRef<HTMLInputElement>(null);
  const model = modelValue(text, withTime);
  useEffect(() => {
    setText((current) => modelValue(current, withTime) === (value || '') ? current : displayValue(value || '', withTime));
  }, [value, withTime]);
  const applyModel = (next: string) => {
    setText(displayValue(next, withTime));
    onChange(next);
  };
  return (
    <div className="relative w-full">
      <input
        value={text}
        required={required}
        aria-label={ariaLabel}
        inputMode="numeric"
        className={`input-base pr-8 ${className}`}
        placeholder={placeholder || (withTime ? 'yyyy/mm/dd HH:mm' : 'yyyy/mm/dd')}
        onChange={(event) => {
          setText(event.target.value);
          if (!event.target.value.trim()) { onChange(''); return; }
          const next = modelValue(event.target.value, withTime);
          if (next) onChange(next);
        }}
        onBlur={() => setText(displayValue(modelValue(text, withTime), withTime))}
      />
      <button type="button" onClick={() => { const picker = pickerRef.current; if (!picker) return; if (typeof picker.showPicker === 'function') picker.showPicker(); else picker.click(); }} className="absolute right-1.5 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded text-slate-400 hover:bg-slate-100 hover:text-slate-600" aria-label="打开日期选择器" title="打开日期选择器">
        <CalendarDays className="h-3.5 w-3.5" />
      </button>
      <input
        ref={pickerRef}
        type={withTime ? 'datetime-local' : 'date'}
        value={model}
        tabIndex={-1}
        aria-hidden="true"
        onChange={(event) => { if (event.target.value) applyModel(event.target.value); }}
        style={{ position: 'absolute', right: 0, bottom: 0, width: 1, height: 1, opacity: 0, pointerEvents: 'none' }}
      />
    </div>
  );
}
