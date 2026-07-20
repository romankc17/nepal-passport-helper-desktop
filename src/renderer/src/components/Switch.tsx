import * as RadixSwitch from '@radix-ui/react-switch';
import { cn } from '../lib/utils';

interface SwitchProps {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
  ariaLabel: string;
  id?: string;
}

export function Switch({ checked, onCheckedChange, disabled, ariaLabel, id }: SwitchProps) {
  return (
    <RadixSwitch.Root
      id={id}
      aria-label={ariaLabel}
      checked={checked}
      onCheckedChange={onCheckedChange}
      disabled={disabled}
      className={cn(
        'relative h-6 w-11 rounded-full transition-colors',
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2',
        'disabled:cursor-not-allowed disabled:opacity-50',
        checked ? 'bg-primary' : 'bg-slate-300',
      )}
    >
      <RadixSwitch.Thumb
        className={cn(
          'block h-5 w-5 translate-x-0.5 rounded-full bg-white shadow transition-transform',
          'data-[state=checked]:translate-x-[22px]',
        )}
      />
    </RadixSwitch.Root>
  );
}
