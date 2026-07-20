import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Bell,
  BellOff,
  ChevronDown,
  ChevronUp,
  History,
  Pencil,
  Play,
  Pause,
  RotateCw,
  ShieldAlert,
  Trash2,
} from 'lucide-react';
import { useState } from 'react';
import type { Watcher, WatcherLoopState } from '../../../shared/types';
import { api, queryKeys } from '../api';
import { useAuth } from '../auth';
import { describeError } from '../lib/errors';
import { formatCountdown, formatInterval, formatRelativeTime, latinName } from '../lib/format';
import { useNow } from '../lib/hooks';
import { cn } from '../lib/utils';
import { useWatcherRuntime } from '../runtime';
import { Badge, type BadgeTone } from './Badge';
import { Button } from './Button';
import { Card } from './Card';
import { ConfirmDialog } from './ConfirmDialog';
import { Dialog } from './Dialog';
import { Input } from './Input';
import { Label } from './Label';
import { Skeleton } from './Skeleton';
import { Switch } from './Switch';
import { useToast } from './Toast';

const statePresentation: Record<WatcherLoopState, { label: string; tone: BadgeTone }> = {
  idle: { label: 'Idle', tone: 'gray' },
  scheduled: { label: 'Active', tone: 'green' },
  checking: { label: 'Checking', tone: 'blue' },
  backoff: { label: 'Retrying', tone: 'amber' },
  paused: { label: 'Paused', tone: 'gray' },
  offline: { label: 'Offline', tone: 'gray' },
  captcha: { label: 'CAPTCHA required', tone: 'amber' },
  'auth-expired': { label: 'Auth expired', tone: 'red' },
  error: { label: 'Error', tone: 'red' },
};

interface WatcherCardProps {
  watcher: Watcher;
}

export function WatcherCard({ watcher }: WatcherCardProps) {
  const { runtime, refresh } = useWatcherRuntime();
  const { toast } = useToast();
  const { signOut } = useAuth();
  const queryClient = useQueryClient();
  const now = useNow(1000);

  const [slotsExpanded, setSlotsExpanded] = useState(false);
  const [historyExpanded, setHistoryExpanded] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const live = runtime.get(watcher.id);
  const loopState: WatcherLoopState = live?.state ?? (watcher.active ? 'scheduled' : 'paused');
  const presentation = statePresentation[loopState];
  const checking = loopState === 'checking';

  const invalidateWatchers = async () => {
    await queryClient.invalidateQueries({ queryKey: queryKeys.watchers });
    await window.desktop.scheduler.sync();
    await refresh();
  };

  const pauseMutation = useMutation({
    mutationFn: () => api.watchers.pause(watcher.id),
    onSuccess: () => {
      toast(`Watcher paused · ${watcher.provider_name}`);
      void invalidateWatchers();
    },
    onError: (error) => toast(describeError(error, 'Could not pause watcher'), 'error'),
  });

  const resumeMutation = useMutation({
    mutationFn: async () => {
      await window.desktop.scheduler.resume(watcher.id);
      if (watcher.active || loopState === 'paused') {
        await api.watchers.resume(watcher.id);
      }
    },
    onSuccess: () => {
      toast(`Watcher resumed · ${watcher.provider_name}`);
      void invalidateWatchers();
    },
    onError: (error) => toast(describeError(error, 'Could not resume watcher'), 'error'),
  });

  const deleteMutation = useMutation({
    mutationFn: () => api.watchers.delete(watcher.id),
    onSuccess: () => {
      toast(`Watcher deleted · ${watcher.provider_name}`);
      setDeleteOpen(false);
      void invalidateWatchers();
    },
    onError: (error) => toast(describeError(error, 'Could not delete watcher'), 'error'),
  });

  const checkNow = () => {
    window.desktop.scheduler
      .checkNow(watcher.id)
      .then(() => refresh())
      .catch((error) => toast(describeError(error, 'Could not start a check'), 'error'));
  };

  const historyQuery = useQuery({
    queryKey: queryKeys.watcherHistory(watcher.id),
    queryFn: () => api.watchers.history(watcher.id),
    enabled: historyExpanded,
  });

  const busy = pauseMutation.isPending || resumeMutation.isPending;
  const nextRunAt = live?.nextRunAt;

  return (
    <Card className="flex flex-col">
      <div className="flex items-start justify-between gap-3 px-5 pt-4">
        <div className="flex min-w-0 items-center gap-2.5">
          <span
            aria-hidden="true"
            className={cn(
              'h-2.5 w-2.5 shrink-0 rounded-full',
              checking ? 'animate-pulse bg-primary' : watcher.active ? 'bg-success' : 'bg-slate-300',
            )}
          />
          <div className="min-w-0">
            <h3 className="truncate text-sm font-semibold text-slate-900">
              {watcher.provider_name}
            </h3>
            <p className="truncate text-xs text-slate-500">
              {watcher.district_name ? `${latinName(watcher.district_name)} · ` : ''}
              {watcher.mode === 'book' ? 'Watch & auto-book' : 'Watch & notify'}
            </p>
          </div>
        </div>
        <Badge tone={presentation.tone}>{presentation.label}</Badge>
      </div>

      {loopState === 'captcha' && (
        <div className="mx-5 mt-3 flex items-start gap-2 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800">
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>
            The government site asked for a CAPTCHA. This watcher is paused — resume it once the
            CAPTCHA session is cleared.
          </span>
        </div>
      )}
      {loopState === 'auth-expired' && (
        <div className="mx-5 mt-3 flex items-start justify-between gap-2 rounded-md bg-red-50 px-3 py-2 text-xs text-red-800">
          <span className="mt-0.5">Your session expired. Sign in again to restart all watchers.</span>
          <Button size="sm" variant="secondary" onClick={() => void signOut({ localOnly: true })}>
            Sign in
          </Button>
        </div>
      )}
      {loopState === 'error' && live?.lastResult?.message && (
        <div className="mx-5 mt-3 rounded-md bg-red-50 px-3 py-2 text-xs text-red-800">
          {live.lastResult.message}
          {live.lastResult.errorCode ? ` (${live.lastResult.errorCode})` : ''}
        </div>
      )}
      {!live && watcher.last_error && (
        <div className="mx-5 mt-3 rounded-md bg-red-50 px-3 py-2 text-xs text-red-800">
          {watcher.last_error}
        </div>
      )}

      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 px-5 py-4 text-xs">
        <div>
          <dt className="text-slate-400">Interval</dt>
          <dd className="font-medium text-slate-700">{formatInterval(watcher.interval_seconds)}</dd>
        </div>
        <div>
          <dt className="text-slate-400">Notify</dt>
          <dd className="flex items-center gap-1 font-medium text-slate-700">
            {watcher.notify ? (
              <>
                <Bell className="h-3.5 w-3.5 text-primary" aria-hidden="true" /> On
              </>
            ) : (
              <>
                <BellOff className="h-3.5 w-3.5 text-slate-400" aria-hidden="true" /> Off
              </>
            )}
          </dd>
        </div>
        <div>
          <dt className="text-slate-400">Last checked</dt>
          <dd className="font-medium text-slate-700">
            {formatRelativeTime(watcher.last_checked_at, now)}
            {live?.lastResult?.slotsFound !== undefined &&
              ` · ${live.lastResult.slotsFound} slot${live.lastResult.slotsFound === 1 ? '' : 's'}`}
            {(live?.lastResult?.bookedCount ?? 0) > 0 &&
              ` · ${live?.lastResult?.bookedCount} booked`}
          </dd>
        </div>
        <div>
          <dt className="text-slate-400">Next check</dt>
          <dd className="font-medium text-slate-700">
            {nextRunAt && loopState !== 'paused' ? `in ${formatCountdown(nextRunAt - now)}` : '—'}
          </dd>
        </div>
        <div>
          <dt className="text-slate-400">Queued</dt>
          <dd className="font-medium text-slate-700">
            {watcher.queued_count} client{watcher.queued_count === 1 ? '' : 's'}
          </dd>
        </div>
        <div>
          <dt className="text-slate-400">Booked</dt>
          <dd className="font-medium text-slate-700">{watcher.booked_count}</dd>
        </div>
      </dl>

      <div className="px-5 pb-3">
        <button
          type="button"
          onClick={() => setSlotsExpanded((current) => !current)}
          aria-expanded={slotsExpanded}
          className="flex items-center gap-1.5 text-xs font-medium text-primary hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          {watcher.available_slots.length} slot
          {watcher.available_slots.length === 1 ? '' : 's'} available
          {slotsExpanded ? (
            <ChevronUp className="h-3.5 w-3.5" aria-hidden="true" />
          ) : (
            <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
          )}
        </button>
        {slotsExpanded && (
          <ul className="mt-2 max-h-28 overflow-y-auto rounded-md bg-slate-50 px-3 py-2 text-xs text-slate-600">
            {watcher.available_slots.length === 0 && <li>No open slots right now.</li>}
            {watcher.available_slots.map((slot) => (
              <li key={`${slot.date}-${slot.start_time}`} className="py-0.5">
                {slot.date} · {slot.start_time.slice(0, 5)}–{slot.end_time.slice(0, 5)}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="mt-auto flex items-center gap-1.5 border-t border-slate-100 px-4 py-3">
        <Button
          size="sm"
          variant="secondary"
          onClick={checkNow}
          loading={checking}
          disabled={busy || loopState === 'auth-expired'}
          aria-label={`Check ${watcher.provider_name} now`}
        >
          <RotateCw className="h-3.5 w-3.5" aria-hidden="true" />
          Check now
        </Button>
        {watcher.active && loopState !== 'captcha' ? (
          <Button
            size="sm"
            variant="secondary"
            onClick={() => pauseMutation.mutate()}
            loading={pauseMutation.isPending}
            disabled={resumeMutation.isPending}
            aria-label={`Pause ${watcher.provider_name}`}
          >
            <Pause className="h-3.5 w-3.5" aria-hidden="true" />
            Pause
          </Button>
        ) : (
          <Button
            size="sm"
            variant="secondary"
            onClick={() => resumeMutation.mutate()}
            loading={resumeMutation.isPending}
            disabled={pauseMutation.isPending}
            aria-label={`Resume ${watcher.provider_name}`}
          >
            <Play className="h-3.5 w-3.5" aria-hidden="true" />
            Resume
          </Button>
        )}
        <Button
          size="sm"
          variant="ghost"
          onClick={() => setEditOpen(true)}
          aria-label={`Edit ${watcher.provider_name}`}
        >
          <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => setDeleteOpen(true)}
          aria-label={`Delete ${watcher.provider_name}`}
        >
          <Trash2 className="h-3.5 w-3.5 text-danger" aria-hidden="true" />
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => setHistoryExpanded((current) => !current)}
          aria-expanded={historyExpanded}
          aria-label={`History for ${watcher.provider_name}`}
        >
          <History className="h-3.5 w-3.5" aria-hidden="true" />
        </Button>
      </div>

      {historyExpanded && (
        <div className="border-t border-slate-100 px-5 py-3">
          {historyQuery.isPending ? (
            <div className="flex flex-col gap-2">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-2/3" />
            </div>
          ) : historyQuery.isError ? (
            <p className="text-xs text-danger">Could not load history.</p>
          ) : historyQuery.data.items.length === 0 ? (
            <p className="text-xs text-slate-400">No checks recorded yet.</p>
          ) : (
            <ul className="max-h-36 overflow-y-auto text-xs">
              {historyQuery.data.items.map((entry) => (
                <li key={entry.id} className="flex items-center justify-between gap-2 py-1">
                  <span className="text-slate-600">{formatRelativeTime(entry.finished_at, now)}</span>
                  <span className="text-slate-400">{entry.slots_found} slots</span>
                  <Badge tone={entry.success ? 'green' : 'red'}>
                    {entry.success ? 'OK' : 'Failed'}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <EditWatcherDialog
        watcher={watcher}
        open={editOpen}
        onOpenChange={setEditOpen}
        onSaved={invalidateWatchers}
      />
      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="Delete watcher"
        description={`Delete the watcher for ${watcher.provider_name}? Queued clients stay on the server but will no longer be checked.`}
        confirmLabel="Delete"
        danger
        loading={deleteMutation.isPending}
        onConfirm={() => deleteMutation.mutate()}
      />
    </Card>
  );
}

interface EditWatcherDialogProps {
  watcher: Watcher;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => Promise<void>;
}

function EditWatcherDialog({ watcher, open, onOpenChange, onSaved }: EditWatcherDialogProps) {
  const { toast } = useToast();
  const [intervalSeconds, setIntervalSeconds] = useState(String(watcher.interval_seconds));
  const [daysAhead, setDaysAhead] = useState(String(watcher.days_ahead));
  const [desiredBookings, setDesiredBookings] = useState(String(watcher.desired_bookings));
  const [notify, setNotify] = useState(watcher.notify);

  const updateMutation = useMutation({
    mutationFn: () =>
      api.watchers.updateSettings(watcher.id, {
        interval_seconds: Number(intervalSeconds),
        days_ahead: Number(daysAhead),
        desired_bookings: Number(desiredBookings),
        notify,
      }),
    onSuccess: async () => {
      toast('Watcher settings saved');
      onOpenChange(false);
      await onSaved();
    },
    onError: (error) => toast(describeError(error, 'Could not save settings'), 'error'),
  });

  const valid =
    Number(intervalSeconds) >= 30 && Number(daysAhead) >= 1 && Number(desiredBookings) >= 1;

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={`Edit · ${watcher.provider_name}`}
      description="Changes apply to the server watcher and the local schedule."
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={() => updateMutation.mutate()}
            loading={updateMutation.isPending}
            disabled={!valid}
          >
            Save
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div>
          <Label htmlFor={`interval-${watcher.id}`}>Check interval (seconds, min 30)</Label>
          <Input
            id={`interval-${watcher.id}`}
            type="number"
            min={30}
            value={intervalSeconds}
            onChange={(event) => setIntervalSeconds(event.target.value)}
          />
        </div>
        <div>
          <Label htmlFor={`days-${watcher.id}`}>Days ahead</Label>
          <Input
            id={`days-${watcher.id}`}
            type="number"
            min={1}
            max={90}
            value={daysAhead}
            onChange={(event) => setDaysAhead(event.target.value)}
          />
        </div>
        <div>
          <Label htmlFor={`desired-${watcher.id}`}>Desired bookings</Label>
          <Input
            id={`desired-${watcher.id}`}
            type="number"
            min={1}
            value={desiredBookings}
            onChange={(event) => setDesiredBookings(event.target.value)}
          />
        </div>
        <div className="flex items-center justify-between">
          <Label htmlFor={`notify-${watcher.id}`} className="mb-0">
            Native notifications
          </Label>
          <Switch
            id={`notify-${watcher.id}`}
            ariaLabel="Toggle notifications"
            checked={notify}
            onCheckedChange={setNotify}
          />
        </div>
      </div>
    </Dialog>
  );
}
