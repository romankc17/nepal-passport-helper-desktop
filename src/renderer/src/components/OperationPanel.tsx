import { CheckCircle2, ChevronDown, ChevronUp, Loader2, X, XCircle } from 'lucide-react';
import { useState } from 'react';
import { useOperations, type Operation, type OperationItem } from '../operations';
import { cn } from '../lib/utils';
import { Badge, type BadgeTone } from './Badge';

const stagePresentation: Record<OperationItem['stage'], { label: string; tone: BadgeTone }> = {
  submitting: { label: 'Submitting', tone: 'blue' },
  booking: { label: 'Booking', tone: 'blue' },
  booked: { label: 'Booked', tone: 'green' },
  queued: { label: 'Queued', tone: 'amber' },
  failed: { label: 'Failed', tone: 'red' },
  skipped: { label: 'Skipped', tone: 'gray' },
};

function OperationRow({ operation }: { operation: Operation }) {
  const [expanded, setExpanded] = useState(operation.status === 'running');
  const running = operation.status === 'running';

  return (
    <div className="border-b border-slate-100 last:border-b-0">
      <button
        type="button"
        onClick={() => setExpanded((current) => !current)}
        aria-expanded={expanded}
        className="flex w-full items-center justify-between gap-2 px-4 py-2.5 text-left hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
      >
        <span className="flex min-w-0 items-center gap-2">
          {running ? (
            <Loader2 className="h-4 w-4 shrink-0 animate-spin text-primary" aria-hidden="true" />
          ) : operation.status === 'done' ? (
            <CheckCircle2 className="h-4 w-4 shrink-0 text-success" aria-hidden="true" />
          ) : (
            <XCircle className="h-4 w-4 shrink-0 text-danger" aria-hidden="true" />
          )}
          <span className="truncate text-sm font-medium text-slate-800">{operation.title}</span>
        </span>
        {expanded ? (
          <ChevronDown className="h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
        ) : (
          <ChevronUp className="h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
        )}
      </button>
      {expanded && (
        <ul className="px-4 pb-3">
          {operation.items.map((item) => (
            <li key={item.clientId} className="flex items-start justify-between gap-2 py-1">
              <div className="min-w-0">
                <p className="truncate text-sm text-slate-700">{item.clientName}</p>
                {item.message && (
                  <p className="text-xs text-slate-400">
                    {item.message}
                    {item.code ? ` (${item.code})` : ''}
                  </p>
                )}
              </div>
              <Badge tone={stagePresentation[item.stage].tone}>
                {stagePresentation[item.stage].label}
              </Badge>
            </li>
          ))}
          {operation.message && <li className="pt-1 text-xs text-danger">{operation.message}</li>}
        </ul>
      )}
    </div>
  );
}

// Fixed bottom-right collapsible panel for long-running operations.
export function OperationPanel() {
  const { operations, dismissOperation } = useOperations();
  const [collapsed, setCollapsed] = useState(false);

  if (operations.length === 0) return null;

  const runningCount = operations.filter((operation) => operation.status === 'running').length;

  return (
    <aside
      aria-label="Background operations"
      className="fixed bottom-4 right-4 z-40 w-96 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-lg"
    >
      <div className="flex items-center justify-between bg-navy px-4 py-2">
        <button
          type="button"
          onClick={() => setCollapsed((current) => !current)}
          aria-expanded={!collapsed}
          className="flex items-center gap-2 text-sm font-medium text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-300"
        >
          {runningCount > 0 && (
            <Loader2 className="h-4 w-4 animate-spin text-blue-300" aria-hidden="true" />
          )}
          Operations{runningCount > 0 ? ` (${runningCount} running)` : ''}
          {collapsed ? (
            <ChevronUp className="h-4 w-4 text-slate-300" aria-hidden="true" />
          ) : (
            <ChevronDown className="h-4 w-4 text-slate-300" aria-hidden="true" />
          )}
        </button>
        {operations.every((operation) => operation.status !== 'running') && (
          <button
            type="button"
            aria-label="Clear finished operations"
            onClick={() => operations.forEach((operation) => dismissOperation(operation.id))}
            className="rounded p-0.5 text-slate-300 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-300"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        )}
      </div>
      {!collapsed && (
        <div className={cn('max-h-80 overflow-y-auto')}>
          {[...operations].reverse().map((operation) => (
            <OperationRow key={operation.id} operation={operation} />
          ))}
        </div>
      )}
    </aside>
  );
}
