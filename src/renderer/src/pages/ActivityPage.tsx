import { useQuery } from '@tanstack/react-query';
import { Activity } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { api, queryKeys } from '../api';
import { Badge, type BadgeTone } from '../components/Badge';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { EmptyState } from '../components/EmptyState';
import { Input } from '../components/Input';
import { PageHeader } from '../components/PageHeader';
import { Pagination } from '../components/Pagination';
import { Select } from '../components/Select';
import { Skeleton } from '../components/Skeleton';
import { describeError } from '../lib/errors';
import { formatDateTime, truncateMiddle } from '../lib/format';

const typeOptions = ['check', 'queue', 'book', 'booking', 'cancel', 'reconcile'];
const statusOptions = ['success', 'booked', 'failed', 'error', 'cancelled'];

const statusTone: Record<string, BadgeTone> = {
  success: 'green',
  booked: 'green',
  failed: 'red',
  error: 'red',
  cancelled: 'gray',
};

const typeTone: Record<string, BadgeTone> = {
  check: 'blue',
  queue: 'amber',
  book: 'green',
  booking: 'green',
  cancel: 'red',
  reconcile: 'blue',
};

export function ActivityPage() {
  const [searchParams, setSearchParams] = useSearchParams();

  const typeFilter = searchParams.get('type') ?? '';
  const providerFilter = searchParams.get('provider') ?? '';
  const statusFilter = searchParams.get('status') ?? '';
  const from = searchParams.get('from') ?? '';
  const to = searchParams.get('to') ?? '';
  const page = Number(searchParams.get('page') ?? '1') || 1;

  const setParam = (key: string, value: string) => {
    setSearchParams(
      (current) => {
        const next = new URLSearchParams(current);
        if (value) next.set(key, value);
        else next.delete(key);
        if (key !== 'page') next.delete('page');
        return next;
      },
      { replace: true },
    );
  };

  const query = {
    type: typeFilter || undefined,
    provider_id: providerFilter ? Number(providerFilter) : undefined,
    status: statusFilter || undefined,
    from: from || undefined,
    to: to || undefined,
    page,
  };

  const activityQuery = useQuery({
    queryKey: queryKeys.activity(query),
    queryFn: () => api.activity.list(query),
    // The feed changes as a side effect of bookings/cancels — always refetch
    // on mount instead of serving the Overview's prefetched cache.
    staleTime: 0,
  });

  const providersQuery = useQuery({
    queryKey: queryKeys.clients({ page_size: 1 }),
    queryFn: () => api.clients.list({ page_size: 1 }),
    staleTime: 60000,
  });

  return (
    <div>
      <PageHeader title="Activity" description="Slot finds, queue actions and bookings" />

      <Card className="mb-4">
        <div className="grid grid-cols-1 gap-3 px-4 py-3 md:grid-cols-6">
          <Select
            ariaLabel="Filter by type"
            value={typeFilter || 'all'}
            onValueChange={(value) => setParam('type', value === 'all' ? '' : value)}
            options={[
              { value: 'all', label: 'All types' },
              ...typeOptions.map((type) => ({ value: type, label: type })),
            ]}
          />
          <Select
            ariaLabel="Filter by office"
            value={providerFilter || 'all'}
            onValueChange={(value) => setParam('provider', value === 'all' ? '' : value)}
            options={[
              { value: 'all', label: 'All offices' },
              ...(providersQuery.data?.providers ?? []).map((provider) => ({
                value: String(provider.id),
                label: provider.name,
              })),
            ]}
          />
          <Select
            ariaLabel="Filter by status"
            value={statusFilter || 'all'}
            onValueChange={(value) => setParam('status', value === 'all' ? '' : value)}
            options={[
              { value: 'all', label: 'All statuses' },
              ...statusOptions.map((status) => ({ value: status, label: status })),
            ]}
          />
          <Input
            aria-label="From date"
            type="date"
            value={from}
            onChange={(event) => setParam('from', event.target.value)}
          />
          <Input
            aria-label="To date"
            type="date"
            value={to}
            onChange={(event) => setParam('to', event.target.value)}
          />
          <Button variant="secondary" onClick={() => setSearchParams({}, { replace: true })}>
            Clear filters
          </Button>
        </div>
      </Card>

      <Card>
        {activityQuery.isPending ? (
          <div className="flex flex-col gap-3 p-5">
            {[0, 1, 2, 3].map((index) => (
              <Skeleton key={index} className="h-6 w-full" />
            ))}
          </div>
        ) : activityQuery.isError ? (
          <EmptyState
            icon={Activity}
            title="Could not load activity"
            description={describeError(activityQuery.error)}
            action={
              <Button variant="secondary" onClick={() => void activityQuery.refetch()}>
                Retry
              </Button>
            }
          />
        ) : activityQuery.data.items.length === 0 ? (
          <EmptyState
            icon={Activity}
            title="No activity matches"
            description="Found slots and booking actions show up here."
          />
        ) : (
          <>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-left text-xs text-slate-400">
                  <th className="px-5 py-3 font-medium">Time</th>
                  <th className="px-3 py-3 font-medium">Type</th>
                  <th className="px-3 py-3 font-medium">Actor / device</th>
                  <th className="px-3 py-3 font-medium">Office</th>
                  <th className="px-3 py-3 font-medium">Client</th>
                  <th className="px-3 py-3 font-medium">Status</th>
                  <th className="px-3 py-3 font-medium">Duration</th>
                  <th className="px-3 py-3 font-medium">Message</th>
                  <th className="px-3 py-3 font-medium">Request</th>
                </tr>
              </thead>
              <tbody>
                {activityQuery.data.items.map((item) => (
                  <tr key={String(item.id)} className="border-b border-slate-50">
                    <td className="whitespace-nowrap px-5 py-2.5 text-xs text-slate-500">
                      {formatDateTime(item.at)}
                    </td>
                    <td className="px-3 py-2.5">
                      <Badge tone={typeTone[item.type] ?? 'gray'}>{item.type}</Badge>
                    </td>
                    <td className="px-3 py-2.5 text-xs text-slate-600">
                      {item.actor}
                      {item.device ? ` · ${item.device}` : ''}
                    </td>
                    <td className="px-3 py-2.5 text-xs text-slate-600">
                      {item.provider_name ?? '—'}
                    </td>
                    <td className="px-3 py-2.5 text-xs text-slate-600">
                      {item.client_name ?? '—'}
                    </td>
                    <td className="px-3 py-2.5">
                      <Badge tone={statusTone[item.status] ?? 'gray'}>{item.status}</Badge>
                    </td>
                    <td className="px-3 py-2.5 text-xs text-slate-500">
                      {item.duration_ms !== null ? `${(item.duration_ms / 1000).toFixed(1)}s` : '—'}
                    </td>
                    <td className="max-w-56 truncate px-3 py-2.5 text-xs text-slate-600">
                      {item.message ?? '—'}
                    </td>
                    <td
                      className="px-3 py-2.5 font-mono text-xs text-slate-400"
                      title={item.request_id ?? undefined}
                    >
                      {truncateMiddle(item.request_id, 4)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <Pagination
              page={activityQuery.data.page}
              pageSize={activityQuery.data.page_size}
              total={activityQuery.data.total}
              onPageChange={(next) => setParam('page', String(next))}
            />
          </>
        )}
      </Card>
    </div>
  );
}
