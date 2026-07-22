import { cn } from '../lib/utils';

interface ProgressBarProps {
  /** 0-100 for a determinate bar; omit for an indeterminate sliding bar. */
  value?: number;
  className?: string;
}

export function ProgressBar({ value, className }: ProgressBarProps) {
  if (value === undefined) {
    return (
      <div
        className={cn('h-1.5 w-full overflow-hidden rounded-full bg-slate-200', className)}
        role="status"
        aria-label="Processing"
      >
        <div
          className="h-full rounded-full bg-primary"
          style={{
            width: '35%',
            animation: 'progress-indeterminate 1.1s ease-in-out infinite alternate',
          }}
        />
        <style>{`
          @keyframes progress-indeterminate {
            0% { transform: translateX(-100%); }
            100% { transform: translateX(285%); }
          }
        `}</style>
      </div>
    );
  }

  return (
    <div className={cn('h-1.5 w-full rounded-full bg-slate-200', className)}>
      <div
        className="h-full rounded-full bg-primary transition-all"
        style={{ width: `${Math.max(0, Math.min(100, value))}%` }}
      />
    </div>
  );
}
