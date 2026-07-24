import { useQuery } from '@tanstack/react-query';
import {
  CalendarCheck,
  Inbox,
  Radar,
  Search,
  XCircle,
  type LucideIcon,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { api, queryKeys } from '../api';
import { Badge } from '../components/Badge';
import { Button } from '../components/Button';
import { Card, CardBody, CardHeader } from '../components/Card';
import { FavoriteLocationsCard } from '../components/FavoriteLocationsCard';
import { PageHeader } from '../components/PageHeader';
import { Skeleton } from '../components/Skeleton';
import { formatCountdown, formatRelativeTime } from '../lib/format';
import { useNetStatus, useNow } from '../lib/hooks';
import { cn } from '../lib/utils';
import { useWatcherRuntime } from '../runtime';

interface StatCardProps {
  icon: LucideIcon;
  label: string;
  value: number | undefined;
  loading: boolean;
  tone: string;
  to: string;
}

function StatCard({ icon: Icon, label, value, loading, tone, to }: StatCardProps) {
  return (
    <Link to={to} aria-label={`${label}: open page`}>
      <Card className="transition-shadow hover:shadow-md">
        <CardBody className="flex items-center gap-4">
          <div className={`flex h-11 w-11 items-center justify-center rounded-lg ${tone}`}>
            <Icon className="h-5 w-5 text-white" aria-hidden="true" />
          </div>
          <div>
            {loading ? (
              <Skeleton className="mb-1 h-6 w-12" />
            ) : (
              <p className="text-2xl font-semibold text-slate-900">{value ?? 0}</p>
            )}
            <p className="text-xs text-slate-500">{label}</p>
          </div>
        </CardBody>
      </Card>
    </Link>
  );
}

function ConnectivityDot({ online, label }: { online: boolean; label: string }) {
  return (
    <span className="flex items-center gap-1.5 text-xs text-slate-500">
      <span
        role="status"
        aria-label={`${label}: ${online ? 'online' : 'offline'}`}
        className={cn('h-2 w-2 rounded-full', online ? 'bg-success' : 'bg-danger')}
      />
      {label}
    </span>
  );
}

function BarChart({
  rows,
}: {
  rows: { label: string; value: number; tone: string }[];
}) {
  const max = Math.max(1, ...rows.map((row) => row.value));
  return (
    <div className="space-y-3">
      {rows.map((row) => (
        <div key={row.label}>
          <div className="mb-1 flex items-center justify-between text-xs">
            <span className="text-slate-500">{row.label}</span>
            <span className="font-semibold text-slate-700">{row.value}</span>
          </div>
          <div
            className="h-2 overflow-hidden rounded-full bg-slate-100"
            role="meter"
            aria-label={`${row.label}: ${row.value}`}
            aria-valuemin={0}
            aria-valuemax={max}
            aria-valuenow={row.value}
          >
            <div
              className={`h-full rounded-full ${row.tone}`}
              style={{ width: `${(row.value / max) * 100}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

export function OverviewPage() {
  const now = useNow(1000);
  const backendOnline = useNetStatus();
  const { runtime } = useWatcherRuntime();

  const overviewQuery = useQuery({
    queryKey: queryKeys.overview,
    queryFn: () => api.overview.get(),
    refetchInterval: 30000,
    staleTime: 30000,
  });

  const overview = overviewQuery.data;
  const localQueueQuery = useQuery({
    queryKey: queryKeys.localQueue,
    queryFn: () => api.queue.get(),
  });
  const loading = overviewQuery.isPending;

  const healthyStates = new Set(['scheduled', 'checking', 'backoff', 'idle', 'paused']);
  const schedulerHealthy =
    runtime.size === 0 || [...runtime.values()].some((entry) => healthyStates.has(entry.state));
  const upcoming = [...runtime.values()]
    .filter((entry) => entry.nextRunAt !== undefined)
    .sort((a, b) => (a.nextRunAt ?? 0) - (b.nextRunAt ?? 0))
    .slice(0, 6);
  const watcherName = new Map(
    (overview?.upcoming_checks ?? []).map((watcher) => [watcher.watcher_id, watcher.provider_name]),
  );
  const queueItems = localQueueQuery.data?.items ?? [];
  const queueRows = [
    { label: 'Waiting', value: queueItems.filter((item) => item.status === 'queued').length, tone: 'bg-primary' },
    {
      label: 'In progress',
      value: queueItems.filter((item) => item.status === 'submitting' || item.status === 'booking').length,
      tone: 'bg-amber',
    },
    { label: 'Booked', value: queueItems.filter((item) => item.status === 'booked').length, tone: 'bg-success' },
    { label: 'Failed', value: queueItems.filter((item) => item.status === 'failed').length, tone: 'bg-danger' },
  ];

  return (
    <div>
      <PageHeader
        title="Overview"
        description="What your watchers did today"
        actions={
          <div className="flex items-center gap-4">
            <ConnectivityDot online={backendOnline} label="Backend" />
            <ConnectivityDot online={schedulerHealthy} label="Scheduler" />
          </div>
        }
      />
      {overviewQuery.isError && (
        <Card className="mb-6">
          <CardBody className="flex items-center justify-between gap-4">
            <p role="alert" className="text-sm text-danger">
              Could not load the overview. The server may be unreachable.
            </p>
            <Button variant="secondary" size="sm" onClick={() => void overviewQuery.refetch()}>
              Retry
            </Button>
          </CardBody>
        </Card>
      )}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <StatCard
          icon={Radar}
          label="Active watchers"
          value={overview?.active_watchers}
          loading={loading}
          tone="bg-primary"
          to="/watchers"
        />
        <StatCard
          icon={Inbox}
          label="Queued clients"
          value={localQueueQuery.data?.items.length}
          loading={localQueueQuery.isPending}
          tone="bg-navy"
          to="/queue"
        />
        <StatCard
          icon={Search}
          label="Slots found today"
          value={overview?.slots_found_today}
          loading={loading}
          tone="bg-amber"
          to="/activity"
        />
        <StatCard
          icon={CalendarCheck}
          label="Booked today"
          value={overview?.booked_today}
          loading={loading}
          tone="bg-success"
          to="/appointments"
        />
        <StatCard
          icon={XCircle}
          label="Failed today"
          value={overview?.failed_today}
          loading={loading}
          tone="bg-danger"
          to="/activity"
        />
      </div>
      <div className="mt-6 grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader
            title="Today's outcomes"
            action={
              <Link to="/activity" className="text-xs font-medium text-primary hover:underline">
                View activity
              </Link>
            }
          />
          <CardBody>
            {loading ? (
              <Skeleton className="h-28 w-full" />
            ) : (
              <BarChart
                rows={[
                  { label: 'Slots found', value: overview?.slots_found_today ?? 0, tone: 'bg-amber' },
                  { label: 'Booked', value: overview?.booked_today ?? 0, tone: 'bg-success' },
                  { label: 'Failed', value: overview?.failed_today ?? 0, tone: 'bg-danger' },
                ]}
              />
            )}
          </CardBody>
        </Card>
        <Card>
          <CardHeader
            title="Queue status"
            action={
              <Link to="/queue" className="text-xs font-medium text-primary hover:underline">
                Open queue
              </Link>
            }
          />
          <CardBody>
            {localQueueQuery.isPending ? (
              <Skeleton className="h-28 w-full" />
            ) : (
              <BarChart rows={queueRows} />
            )}
          </CardBody>
        </Card>
      </div>
      <div className="mt-6">
        <FavoriteLocationsCard />
      </div>
      <div className="mt-6 grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader
            title="Upcoming checks"
            action={
              <Link to="/watchers" className="text-xs font-medium text-primary hover:underline">
                All watchers
              </Link>
            }
          />
          <CardBody>
            {upcoming.length === 0 ? (
              <p className="text-sm text-slate-400">
                No checks scheduled — activate a watcher to start polling.
              </p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {upcoming.map((entry) => (
                  <li key={entry.watcherId} className="flex items-center justify-between py-2">
                    <span className="text-sm text-slate-700">
                      {watcherName.get(entry.watcherId) ?? `Watcher #${entry.watcherId}`}
                    </span>
                    <span className="text-xs text-slate-400">
                      in {formatCountdown((entry.nextRunAt ?? now) - now)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
        <Card>
          <CardHeader
            title="Recent activity"
            action={
              <Link to="/activity" className="text-xs font-medium text-primary hover:underline">
                All activity
              </Link>
            }
          />
          <CardBody>
            {overviewQuery.isPending ? (
              <div className="flex flex-col gap-2">
                <Skeleton className="h-5 w-full" />
                <Skeleton className="h-5 w-2/3" />
              </div>
            ) : (overview?.recent_activity.length ?? 0) === 0 ? (
              <p className="text-sm text-slate-400">No activity yet.</p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {overview?.recent_activity.slice(0, 8).map((item) => (
                  <li key={String(item.id)} className="flex items-center justify-between gap-4 py-2">
                    <span className="flex min-w-0 items-center gap-2">
                      <Badge tone={item.status === 'success' || item.status === 'booked' ? 'green' : 'gray'}>
                        {item.type}
                      </Badge>
                      <span className="truncate text-sm text-slate-700">{item.message}</span>
                    </span>
                    <span className="shrink-0 text-xs text-slate-400">
                      {formatRelativeTime(item.at, now)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
