import { Check } from 'lucide-react';
import { cn } from '../../lib/utils';

interface StepperProps {
  /** Step labels in order. */
  steps: string[];
  /** 1-based index of the current step. */
  current: number;
}

export function Stepper({ steps, current }: StepperProps) {
  return (
    <ol className="flex flex-wrap items-center gap-x-2 gap-y-1" aria-label="Import progress">
      {steps.map((label, index) => {
        const number = index + 1;
        const completed = number < current;
        const isCurrent = number === current;
        return (
          <li
            key={label}
            aria-current={isCurrent ? 'step' : undefined}
            className="flex items-center gap-2"
          >
            <span
              aria-hidden="true"
              className={cn(
                'flex h-6 w-6 items-center justify-center rounded-full text-xs font-medium',
                completed && 'bg-primary text-white',
                isCurrent && 'border-2 border-primary text-primary',
                !completed && !isCurrent && 'border border-slate-300 text-slate-400',
              )}
            >
              {completed ? <Check className="h-3.5 w-3.5" /> : number}
            </span>
            <span
              className={cn(
                'text-xs',
                isCurrent ? 'font-medium text-slate-800' : 'text-slate-400',
                completed && 'text-slate-600',
              )}
            >
              {label}
            </span>
            {number < steps.length && <span className="h-px w-4 bg-slate-200" aria-hidden="true" />}
          </li>
        );
      })}
    </ol>
  );
}
