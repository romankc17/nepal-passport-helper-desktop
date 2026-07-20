import { cn } from '../lib/utils';

interface CheckboxProps {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  ariaLabel: string;
  disabled?: boolean;
  indeterminate?: boolean;
}

export function Checkbox({
  checked,
  onCheckedChange,
  ariaLabel,
  disabled,
  indeterminate,
}: CheckboxProps) {
  return (
    <input
      type="checkbox"
      aria-label={ariaLabel}
      checked={checked}
      disabled={disabled}
      onChange={(event) => onCheckedChange(event.target.checked)}
      ref={(element) => {
        if (element) element.indeterminate = indeterminate === true && !checked;
      }}
      className={cn(
        'h-4 w-4 rounded border-slate-300 text-primary accent-primary',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1',
        'disabled:cursor-not-allowed disabled:opacity-50',
      )}
    />
  );
}
