import { DateTextInput } from './DateTextInput';

export function DateInput({ value, onChange, className, placeholder = 'yyyy/mm/dd' }: {
  value?: string | null;
  onChange: (value: string) => void;
  className?: string;
  placeholder?: string;
}) {
  return (
    <DateTextInput
      value={value || ''}
      onChange={onChange}
      className={className}
      placeholder={placeholder}
      ariaLabel={placeholder}
    />
  );
}
