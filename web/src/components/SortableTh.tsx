import { ArrowDown, ArrowUp, ChevronsUpDown } from 'lucide-react';
import { cn } from '@/lib/utils';

export function SortableTh({ label, field, sortBy, sortDir, onSort, className }: {
  label: string;
  field: string;
  sortBy: string;
  sortDir: 'asc' | 'desc';
  onSort: (field: string) => void;
  className?: string;
}) {
  const active = sortBy === field;
  const Icon = active ? (sortDir === 'asc' ? ArrowUp : ArrowDown) : ChevronsUpDown;
  return (
    <th className={className}>
      <button
        type="button"
        onClick={() => onSort(field)}
        className={cn('inline-flex items-center gap-1 whitespace-nowrap hover:text-slate-800', active && 'text-brand-600')}
      >
        {label}
        <Icon className="h-3 w-3" />
      </button>
    </th>
  );
}
