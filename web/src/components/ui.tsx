import {
  forwardRef,
  useEffect,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import {
  AlertTriangle,
  Check,
  CheckCheck,
  ChevronLeft,
  ChevronRight,
  Copy,
  Inbox,
  Loader2,
  Search,
  X,
  type LucideIcon,
} from 'lucide-react';
import { cn, copyText, initials } from '@/lib/utils';

// ---------------------------------------------------------------- Button
type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'dark' | 'soft';
type ButtonSize = 'xs' | 'sm' | 'md' | 'lg';

const buttonVariants: Record<ButtonVariant, string> = {
  primary: 'border border-brand-600 bg-brand-600 text-white hover:border-brand-700 hover:bg-brand-700 active:bg-brand-800',
  secondary: 'border border-[#d9d9d9] bg-white text-[#1f2329] hover:border-brand-500 hover:text-brand-600',
  ghost: 'border border-transparent text-[#4e5969] hover:bg-[#f2f3f5] hover:text-[#1f2329]',
  danger: 'border border-[#f53f3f] bg-[#f53f3f] text-white hover:border-[#cb2634] hover:bg-[#cb2634]',
  dark: 'border border-[#1f2329] bg-[#1f2329] text-white hover:border-[#333a44] hover:bg-[#333a44]',
  soft: 'border border-brand-200 btn-soft-theme text-brand-700 hover:border-brand-300',
};

const buttonSizes: Record<ButtonSize, string> = {
  xs: 'h-6 gap-1 rounded px-2 text-[11px]',
  sm: 'h-7 gap-1.5 rounded-md px-2.5 text-[12px]',
  md: 'h-8 gap-1.5 rounded-md px-3 text-[13px]',
  lg: 'h-10 gap-2 rounded-md px-4 text-[14px]',
};

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: LucideIcon;
  loading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant = 'primary', size = 'md', icon: Icon, loading, children, disabled, ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      className={cn(
        'inline-flex shrink-0 items-center justify-center font-medium transition duration-150 disabled:pointer-events-none disabled:opacity-50',
        buttonVariants[variant],
        buttonSizes[size],
        className,
      )}
      disabled={disabled || loading}
      {...props}
    >
      {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : Icon ? <Icon className={cn(size === 'xs' ? 'h-3.5 w-3.5' : 'h-4 w-4')} /> : null}
      {children}
    </button>
  );
});

export function IconButton({
  icon: Icon,
  label,
  className,
  variant = 'ghost',
  size = 'sm',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  icon: LucideIcon;
  label: string;
  variant?: ButtonVariant;
  size?: 'sm' | 'md';
}) {
  return (
    <button
      title={label}
      aria-label={label}
      className={cn(
        'inline-flex items-center justify-center rounded-md transition disabled:opacity-40',
        variant === 'ghost' && 'text-slate-500 hover:bg-slate-100 hover:text-slate-900',
        variant === 'secondary' && 'border border-slate-200 bg-white text-slate-600 hover:bg-slate-50',
        variant === 'danger' && 'text-rose-500 hover:bg-rose-50',
        size === 'sm' ? 'h-8 w-8' : 'h-9 w-9',
        className,
      )}
      {...props}
    >
      <Icon className="h-4 w-4" />
    </button>
  );
}

// ---------------------------------------------------------------- Badges
export function Badge({
  children,
  className,
  dot,
  icon: Icon,
}: {
  children: ReactNode;
  className?: string;
  dot?: string;
  icon?: LucideIcon;
}) {
  return (
    <span
      className={cn(
        'inline-flex h-5 items-center gap-1 whitespace-nowrap rounded px-1.5 text-[11px] font-medium ring-1 ring-inset',
        className || 'bg-slate-100 text-slate-600 ring-slate-500/10',
      )}
    >
      {dot ? <span className={cn('h-1.5 w-1.5 rounded-full', dot)} /> : null}
      {Icon ? <Icon className="h-3 w-3" /> : null}
      {children}
    </span>
  );
}

export function Avatar({
  name,
  color = '#4f6ef7',
  src,
  size = 'md',
  className,
}: {
  name?: string | null;
  color?: string;
  src?: string | null;
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  className?: string;
}) {
  const sizes = {
    xs: 'h-6 w-6',
    sm: 'h-7 w-7',
    md: 'h-9 w-9',
    lg: 'h-10 w-10',
    xl: 'h-14 w-14',
  };
  const [imageFailed, setImageFailed] = useState(false);
  useEffect(() => setImageFailed(false), [src]);
  return (
    <span
      className={cn(
        'avatar inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full font-semibold text-white ring-1 ring-black/5',
        sizes[size],
        className,
      )}
      style={{ background: color || '#4f6ef7' }}
      title={name || ''}
    >
      {src && !imageFailed ? (
        <img
          src={src}
          alt={name || '头像'}
          className="h-full w-full object-cover"
          onError={() => setImageFailed(true)}
        />
      ) : (
        <span className={cn('avatar-text select-none', `avatar-${size}`)}>{initials(name)}</span>
      )}
    </span>
  );
}

// ---------------------------------------------------------------- Inputs
export function Field({
  label,
  required,
  hint,
  error,
  children,
  className,
}: {
  label?: ReactNode;
  required?: boolean;
  hint?: ReactNode;
  error?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      {label ? (
        <label className="label">
          {label}
          {required ? <span className="ml-0.5 text-rose-500">*</span> : null}
        </label>
      ) : null}
      {children}
      {error ? <p className="mt-1.5 text-xs text-rose-600">{error}</p> : hint ? <p className="mt-1.5 text-[11.5px] leading-relaxed text-slate-400">{hint}</p> : null}
    </div>
  );
}

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input(
  { className, spellCheck, ...props },
  ref,
) {
  return <input ref={ref} spellCheck={spellCheck ?? false} className={cn('input-base', className)} {...props} />;
});

export function SearchInput({
  value,
  onChange,
  placeholder = '搜索…',
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
}) {
  const [text, setText] = useState(value);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const typing = useRef(false);
  useEffect(() => {
    if (!typing.current) setText(value);
  }, [value]);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  const update = (next: string) => {
    setText(next);
    typing.current = true;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      typing.current = false;
      onChange(next);
    }, 180);
  };
  return (
    <div className={cn('relative', className)}>
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
      <input
        value={text}
        spellCheck={false}
        onChange={(event) => update(event.target.value)}
        placeholder={placeholder}
        className="input-base h-9 pl-9 pr-8"
      />
      {text ? (
        <button
          type="button"
          onClick={() => update('')}
          className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      ) : null}
    </div>
  );
}

export function Toggle({
  checked,
  onChange,
  disabled,
  label,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  label?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative inline-flex h-5.5 w-10 shrink-0 items-center rounded-full transition-colors disabled:opacity-50',
        checked ? 'bg-brand-600' : 'bg-slate-300',
      )}
    >
      <span
        className={cn(
          'inline-block h-4 w-4 rounded-full bg-white shadow transition-transform',
          checked ? 'translate-x-[21px]' : 'translate-x-[3px]',
        )}
      />
      {label ? <span className="sr-only">{label}</span> : null}
    </button>
  );
}

export function Checkbox({
  checked,
  indeterminate,
  onChange,
  disabled,
  label,
  className,
}: {
  checked: boolean;
  indeterminate?: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  label?: string;
  className?: string;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = Boolean(indeterminate);
  }, [indeterminate]);
  return (
    <label
      className={cn('inline-flex cursor-pointer items-center gap-2 select-none', disabled && 'cursor-not-allowed opacity-50', className)}
      onClick={(event) => event.stopPropagation()}
    >
      <input
        ref={ref}
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
        className="h-4 w-4 cursor-pointer rounded border-slate-300 accent-brand-600"
      />
      {label ? <span className="text-[11.5px] text-slate-600">{label}</span> : null}
    </label>
  );
}

// ---------------------------------------------------------------- Tabs & pagination
export function Tabs<T extends string>({
  items,
  value,
  onChange,
  className,
}: {
  items: Array<{ value: T; label: ReactNode; count?: number }>;
  value: T;
  onChange: (value: T) => void;
  className?: string;
}) {
  return (
    <div className={cn('flex items-center gap-1 overflow-x-auto border-b border-[#e9edf4]', className)}>
      {items.map((item) => (
        <button
          key={item.value}
          onClick={() => onChange(item.value)}
          className={cn(
            'relative flex h-10 shrink-0 items-center gap-1.5 px-3 text-[13px] font-medium transition',
            value === item.value ? 'text-brand-700' : 'text-slate-500 hover:text-slate-800',
          )}
        >
          {item.label}
          {item.count !== undefined ? (
            <span
              className={cn(
                'rounded-md px-1.5 py-0.5 text-[10px] font-semibold',
                value === item.value ? 'bg-brand-50 text-brand-700' : 'bg-slate-100 text-slate-500',
              )}
            >
              {item.count}
            </span>
          ) : null}
          {value === item.value ? <span className="absolute inset-x-2 bottom-0 h-0.5 rounded-full bg-brand-600" /> : null}
        </button>
      ))}
    </div>
  );
}

export function PageSizeSelect({ value, onChange, className }: { value: number; onChange: (size: number) => void; className?: string }) {
  return (
    <label className={cn('inline-flex items-center gap-1.5 text-[10px] text-slate-500', className)}>
      每页
      <select className="h-7 rounded-md border border-slate-200 bg-white px-1.5 text-[10px] text-slate-600 outline-none" value={value} onChange={(event) => onChange(Number(event.target.value))}>
        {[10, 20, 30, 50, 100, 150, 200].map((size) => <option key={size} value={size}>{size} 条</option>)}
      </select>
    </label>
  );
}

export function Pagination({
  page,
  pageSize,
  total,
  onChange,
}: {
  page: number;
  pageSize: number;
  total: number;
  onChange: (page: number) => void;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const [jump, setJump] = useState('');
  if (total === 0) return null;
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  const goToPage = () => {
    const target = Number(jump);
    if (!Number.isFinite(target)) return;
    onChange(Math.min(pages, Math.max(1, Math.floor(target))));
    setJump('');
  };
  return (
    <div className="flex flex-col items-center justify-between gap-3 px-4 py-3 sm:flex-row">
      <p className="text-xs text-slate-500">
        显示 <span className="font-medium text-slate-700">{from}</span>–<span className="font-medium text-slate-700">{to}</span> 条，共{' '}
        <span className="font-medium text-slate-700">{total}</span> 条
      </p>
      <div className="flex items-center gap-1">
        <IconButton icon={ChevronLeft} label="上一页" disabled={page <= 1} onClick={() => onChange(page - 1)} />
        <span className="mx-1 text-xs text-slate-500">
          {page} / {pages}
        </span>
        <IconButton icon={ChevronRight} label="下一页" disabled={page >= pages} onClick={() => onChange(page + 1)} />
        <span className="ml-2 flex items-center gap-1 text-[10px] text-slate-400">跳至<input className="h-7 w-12 rounded-md border border-slate-200 bg-white px-1.5 text-center text-[10px] text-slate-600 outline-none focus:border-brand-400" value={jump} onChange={(event) => setJump(event.target.value.replace(/[^\d]/g, ''))} onKeyDown={(event) => { if (event.key === 'Enter') goToPage(); }} onBlur={goToPage} inputMode="numeric" aria-label="跳转页码" />页</span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- Modal
const modalSizes = {
  sm: 'max-w-md',
  md: 'max-w-xl',
  lg: 'max-w-3xl',
  xl: 'max-w-5xl',
  full: 'max-w-[1100px]',
};

const modalWidths: Record<string, string> = {
  sm: 'min(28rem, calc(100vw - 2rem))',
  md: 'min(36rem, calc(100vw - 2rem))',
  lg: 'min(48rem, calc(100vw - 2rem))',
  xl: 'min(64rem, calc(100vw - 2rem))',
  full: 'min(1100px, calc(100vw - 3rem))',
};

export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = 'md',
  icon: Icon,
  bodyClassName,
  resizable,
  closeOnBackdrop = true,
}: {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  size?: keyof typeof modalSizes;
  icon?: LucideIcon;
  bodyClassName?: string;
  resizable?: boolean;
  closeOnBackdrop?: boolean;
}) {
  useEffect(() => {
    if (!open) return;
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handler);
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', handler);
      document.body.style.overflow = previous;
    };
  }, [open, onClose]);

  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-6">
      <div className="absolute inset-0 bg-black/45" onClick={closeOnBackdrop ? onClose : undefined} />
      <div
        role="dialog"
        aria-modal="true"
        className={cn(
          'animate-scale-in relative flex max-h-[92vh] w-full flex-col overflow-hidden rounded-t-lg border border-[#e5e6eb] bg-white shadow-[var(--shadow-float)] sm:rounded-lg',
          modalSizes[size],
        )}
        style={(resizable ?? (size === 'full' || size === 'lg')) ? {
          width: modalWidths[size] || modalWidths.md,
          maxWidth: 'none',
          resize: 'both',
          overflow: 'auto',
          minWidth: 'min(420px, calc(100vw - 2rem))',
        } : undefined}
      >
        {title ? (
          <div className="flex items-start gap-3 border-b border-[#e5e6eb] px-5 py-4 sm:px-6">
            {Icon ? (
              <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-brand-50 text-brand-600">
                <Icon className="h-4.5 w-4.5" />
              </span>
            ) : null}
            <div className="min-w-0 flex-1">
              <h2 className="text-[16px] font-semibold text-[#1f2329]">{title}</h2>
              {description ? <p className="mt-0.5 text-xs leading-relaxed text-slate-500">{description}</p> : null}
            </div>
            <IconButton icon={X} label="关闭" onClick={onClose} className="-mr-1 -mt-0.5" />
          </div>
        ) : null}
        <div className={cn('custom-scroll flex-1 overflow-y-auto px-5 py-5 sm:px-6', bodyClassName)}>{children}</div>
        {footer ? (
          <div className="flex items-center justify-end gap-2 border-t border-[#e5e6eb] bg-[#fafafa] px-5 py-3 sm:px-6">
            {footer}
          </div>
        ) : null}
      </div>
    </div>,
    document.body,
  );
}

export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title = '确认操作',
  description,
  confirmText = '确认',
  danger = true,
  loading,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title?: string;
  description?: ReactNode;
  confirmText?: string;
  danger?: boolean;
  loading?: boolean;
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      size="sm"
      icon={AlertTriangle}
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={onClose}>
            取消
          </Button>
          <Button variant={danger ? 'danger' : 'primary'} size="sm" onClick={onConfirm} loading={loading}>
            {confirmText}
          </Button>
        </>
      }
    >
      <div className="text-sm leading-relaxed text-slate-600">{description}</div>
    </Modal>
  );
}

// ---------------------------------------------------------------- Empty / loading
export function EmptyState({
  title = '暂无数据',
  description,
  icon: Icon = Inbox,
  action,
  className,
}: {
  title?: string;
  description?: ReactNode;
  icon?: LucideIcon;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col items-center justify-center px-6 py-14 text-center', className)}>
      <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-lg border border-[#e5e6eb] bg-[#f7f8fa] text-[#86909c]">
        <Icon className="h-5 w-5" />
      </div>
      <p className="text-sm font-medium text-slate-700">{title}</p>
      {description ? <p className="mt-1 max-w-sm text-xs leading-relaxed text-slate-400">{description}</p> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('shimmer rounded-lg', className)} />;
}

export function TableSkeleton({ rows = 6, cols = 5 }: { rows?: number; cols?: number }) {
  return (
    <div className="p-4">
      {Array.from({ length: rows }).map((_, row) => (
        <div key={row} className="flex items-center gap-4 border-b border-slate-100 py-4 last:border-0">
          {Array.from({ length: cols }).map((_, col) => (
            <Skeleton key={col} className={cn('h-4', col === 0 ? 'w-10' : col === 1 ? 'flex-1' : 'w-24')} />
          ))}
        </div>
      ))}
    </div>
  );
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cn('h-4 w-4 animate-spin text-brand-600', className)} />;
}

// ---------------------------------------------------------------- misc
export function CopyButton({ value, className }: { value: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      variant="secondary"
      size="xs"
      icon={copied ? CheckCheck : Copy}
      className={className}
      onClick={async () => {
        if (await copyText(value)) {
          setCopied(true);
          setTimeout(() => setCopied(false), 1600);
        }
      }}
    >
      {copied ? '已复制' : '复制'}
    </Button>
  );
}

export function CheckItem({ children, tone = 'default' }: { children: ReactNode; tone?: 'default' | 'warning' }) {
  return (
    <div className={cn('flex items-start gap-2 text-xs leading-relaxed', tone === 'warning' ? 'text-amber-700' : 'text-slate-500')}>
      {tone === 'warning' ? <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> : <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-500" />}
      <span>{children}</span>
    </div>
  );
}

export function ProgressBar({ value, className, color = 'bg-brand-500' }: { value: number; className?: string; color?: string }) {
  return (
    <div className={cn('h-1.5 w-full overflow-hidden rounded-full bg-slate-100', className)}>
      <div className={cn('h-full rounded-full transition-all duration-500', color)} style={{ width: `${Math.min(100, Math.max(0, value))}%` }} />
    </div>
  );
}

export function Dropdown({
  trigger,
  children,
  align = 'right',
  className,
}: {
  trigger: ReactNode;
  children: ReactNode;
  align?: 'left' | 'right';
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onClick = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);
  return (
    <div ref={ref} className={cn('relative', className)}>
      <div onClick={() => setOpen((value) => !value)}>{trigger}</div>
      {open ? (
        <div
          className={cn(
            'animate-scale-in absolute top-[calc(100%+8px)] z-40 min-w-[190px] rounded-xl border border-slate-200 bg-white p-1.5 shadow-[var(--shadow-float)]',
            align === 'right' ? 'right-0' : 'left-0',
          )}
          onClick={() => setOpen(false)}
        >
          {children}
        </div>
      ) : null}
    </div>
  );
}

export function MenuItem({
  children,
  icon: Icon,
  onClick,
  danger,
  active,
}: {
  children: ReactNode;
  icon?: LucideIcon;
  onClick?: () => void;
  danger?: boolean;
  active?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] transition',
        danger ? 'text-rose-600 hover:bg-rose-50' : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900',
        active && 'bg-brand-50 text-brand-700',
      )}
    >
      {Icon ? <Icon className="h-4 w-4" /> : null}
      {children}
    </button>
  );
}

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
  children,
  className = '',
}: {
  eyebrow?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div className={`mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between ${className}`}>
      <div className="min-w-0 flex-1">
        {eyebrow ? <div className="mb-1 text-[12px] font-normal text-[#86909c]">{eyebrow}</div> : null}
        <h1 className="text-[22px] font-semibold tracking-[-0.01em] text-[#1f2329] sm:text-[24px]">{title}</h1>
        {description ? <p className="mt-1 max-w-none text-[13px] leading-relaxed text-[#4e5969]">{description}</p> : null}
        {children}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2 sm:ml-6">{actions}</div> : null}
    </div>
  );
}

export function SectionHeading({
  title,
  description,
  action,
}: {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-[#f0f0f0] px-5 py-3.5">
      <div>
        <h3 className="text-[14px] font-semibold text-[#1f2329]">{title}</h3>
        {description ? <p className="mt-0.5 text-[12px] text-[#86909c]">{description}</p> : null}
      </div>
      {action}
    </div>
  );
}

export function InfoGrid({ items, columns = 3 }: { items: Array<{ label: string; value: ReactNode; wide?: boolean }>; columns?: 2 | 3 | 4 }) {
  return (
    <div className={cn('grid gap-x-6 gap-y-4', columns === 2 ? 'grid-cols-1 sm:grid-cols-2' : columns === 4 ? 'grid-cols-2 lg:grid-cols-4' : 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3')}>
      {items.map((item) => (
        <div key={item.label} className={item.wide ? 'sm:col-span-2 lg:col-span-3' : ''}>
          <dt className="text-[11px] font-medium tracking-wide text-slate-400">{item.label}</dt>
          <dd className="mt-1 text-[13px] leading-relaxed text-slate-700">{item.value || '—'}</dd>
        </div>
      ))}
    </div>
  );
}
