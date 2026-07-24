import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronDown, Inbox, ListOrdered, Zap } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import type {
  ClientSummary,
  LocalQueueItem,
  ReadyByLocationGroup,
  Watcher,
  WatcherRuntime,
} from '../../../shared/types';
import { api, queryKeys } from '../api';
import { Badge, type BadgeTone } from '../components/Badge';
import { Button } from '../components/Button';
import { Card, CardBody, CardHeader } from '../components/Card';
import { Checkbox } from '../components/Checkbox';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { EmptyState } from '../components/EmptyState';
import { Input } from '../components/Input';
import { PageHeader } from '../components/PageHeader';
import { Select } from '../components/Select';
import { Skeleton } from '../components/Skeleton';
import { useToast } from '../components/Toast';
import { describeError } from '../lib/errors';
import { foreignCountry, formatCountdown, latinName } from '../lib/format';
import { useDebouncedValue, useNow } from '../lib/hooks';
import { resolveProviderLocation } from '../lib/resolve-location';
import { useOperations } from '../operations';
import { useWatcherRuntime } from '../runtime';

const desktopStatusTone: Record<string, BadgeTone> = {
  fresh: 'gray',
  ready: 'green',
  incomplete: 'amber',
  queued: 'blue',
  booked: 'green',
  not_permitted: 'red',
  cancelled: 'gray',
};

function clientMatches(
  client: ClientSummary,
  search: string,
  typeFilter: string,
  statusFilter: string,
): boolean {
  if (search && !client.full_name.toLowerCase().includes(search)) return false;
  if (typeFilter && client.application_type !== typeFilter) return false;
  if (statusFilter && client.desktop_status !== statusFilter) return false;
  return true;
}

function lastCheckText(watcher: Watcher | undefined, now: number): string {
  if (!watcher?.last_checked_at) return 'Not checked yet';
  const checkedAt = new Date(watcher.last_checked_at).getTime();
  return Number.isNaN(checkedAt) ? 'Not checked yet' : `${formatCountdown(now - checkedAt)} ago`;
}

function nextCheckText(
  watcher: Watcher | undefined,
  live: WatcherRuntime | undefined,
  now: number,
): string {
  if (live?.state === 'checking') return 'Checking now';
  if (live?.state === 'paused' || watcher?.active === false) return 'Paused';
  if (live?.state === 'offline') return 'Waiting for connection';
  if (live?.state === 'captcha') return 'CAPTCHA required';
  if (live?.state === 'auth-expired') return 'Sign in required';
  const serverDueAt = watcher?.next_check_due_at
    ? new Date(watcher.next_check_due_at).getTime()
    : undefined;
  const nextRunAt = live?.nextRunAt ?? serverDueAt;
  return nextRunAt && !Number.isNaN(nextRunAt)
    ? `in ${formatCountdown(nextRunAt - now)}`
    : 'Not scheduled';
}

function queueItemNote(item: LocalQueueItem): string {
  if (item.status === 'failed') return item.error ?? 'Booking failed';
  if (item.status === 'submitting') return 'Submitting application';
  if (item.status === 'booking') return 'Booking appointment';
  if (item.status === 'booked' && item.appointment) {
    return `${item.appointment.date} · ${item.appointment.start_time}`;
  }
  return 'Waiting for the next slot check';
}

export function QueuePage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { startQueue, startBookNow } = useOperations();
  const { runtime } = useWatcherRuntime();
  const [searchParams, setSearchParams] = useSearchParams();
  const now = useNow();

  const search = searchParams.get('q') ?? '';
  const locationFilter = searchParams.get('location') ?? '';
  const countryFilter = searchParams.get('country') ?? '';
  const typeFilter = searchParams.get('type') ?? '';
  const statusFilter = searchParams.get('status') ?? '';
  const debouncedSearch = useDebouncedValue(search).toLowerCase();

  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [busyGroup, setBusyGroup] = useState<number | null>(null);
  const [removeBooking, setRemoveBooking] = useState<{ id: number; name: string } | null>(null);
  const [removing, setRemoving] = useState(false);

  const setParam = (key: string, value: string) => {
    setSearchParams(
      (current) => {
        const next = new URLSearchParams(current);
        if (value) next.set(key, value);
        else next.delete(key);
        return next;
      },
      { replace: true },
    );
  };

  const readyQuery = useQuery({
    queryKey: queryKeys.readyByLocation,
    queryFn: () => api.clients.readyByLocation(),
    refetchInterval: 60000,
    staleTime: 60000,
  });

  const localQueueQuery = useQuery({
    queryKey: queryKeys.localQueue,
    queryFn: () => api.queue.get(),
  });

  const watchersQuery = useQuery({
    queryKey: queryKeys.watchers,
    queryFn: () => api.watchers.list(),
    refetchInterval: 60000,
    staleTime: 60000,
  });

  useEffect(() => window.desktop.on('local-queue-state', (payload) => {
    queryClient.setQueryData(queryKeys.localQueue, payload as { items: LocalQueueItem[] });
  }), [queryClient]);

  useEffect(() => window.desktop.on('watcher-state', (event) => {
    if (event.state !== 'checking') {
      void queryClient.invalidateQueries({ queryKey: queryKeys.watchers });
    }
  }), [queryClient]);

  const sessionGroups = [...(localQueueQuery.data?.items ?? []).reduce((groups, item) => {
    const key = String(item.location.provider_id);
    const group = groups.get(key) ?? { name: item.location.provider_name, items: [] as LocalQueueItem[] };
    group.items.push(item);
    groups.set(key, group);
    return groups;
  }, new Map<string, { name: string; items: LocalQueueItem[] }>()).entries()];

  const queuedClientIds = new Set(
    (localQueueQuery.data?.items ?? [])
      .filter((item) => item.status !== 'booked')
      .map((item) => item.client_id),
  );

  const watchersByProvider = useMemo(() => {
    const byProvider = new Map<string, Watcher>();
    for (const watcher of watchersQuery.data ?? []) {
      const key = String(watcher.provider_id);
      const current = byProvider.get(key);
      if (!current || (watcher.mode === 'book' && current.mode !== 'book')) {
        byProvider.set(key, watcher);
      }
    }
    return byProvider;
  }, [watchersQuery.data]);

  const groups = readyQuery.data ?? [];

  const applicationTypes = useMemo(
    () =>
      [...new Set(groups.flatMap((group) => group.clients.map((client) => client.application_type)))].sort(),
    [groups],
  );

  const visibleGroups = groups
    .filter((group) => !locationFilter || String(group.provider_id) === locationFilter)
    .filter(
      (group) =>
        !countryFilter ||
        String(group.country_id ?? group.clients[0]?.appointment_country_id ?? '222') ===
          countryFilter,
    )
    .map((group) => ({
      ...group,
      clients: group.clients.filter((client) =>
        clientMatches(client, debouncedSearch, typeFilter, statusFilter),
      ),
    }))
    .filter((group) => group.clients.length > 0);

  const toggleClient = (clientId: number, checked: boolean) => {
    setSelected((current) => {
      const next = new Set(current);
      if (checked) next.add(clientId);
      else next.delete(clientId);
      return next;
    });
  };

  const groupSelectedIds = (group: ReadyByLocationGroup) =>
    group.clients
      .filter((client) => client.can_book && selected.has(client.id))
      .map((client) => client.id);

  const runForGroup = async (
    group: ReadyByLocationGroup,
    action: 'queue' | 'book',
  ): Promise<void> => {
    const clientIds = groupSelectedIds(group);
    if (clientIds.length === 0) {
      toast('Select at least one client first', 'error');
      return;
    }
    setBusyGroup(group.provider_id);
    const clientNames = new Map(group.clients.map((client) => [client.id, client.full_name]));
    try {
      const location = await resolveProviderLocation(group.provider_id, group.provider_name);
      if (!location) {
        toast(
          'Could not resolve province/district for this office. Create a watcher for it first.',
          'error',
        );
        return;
      }
      const input = {
        ...location,
        client_ids: clientIds,
        idempotency_key: window.crypto.randomUUID(),
      };
      if (action === 'queue') {
        const result = await startQueue(input, clientNames);
        toast(
          `Watching ${result.queued.length} client${result.queued.length === 1 ? '' : 's'} this session · ${group.provider_name}`,
        );
      } else {
        const result = await startBookNow(input, clientNames);
        const booked = result.results.filter((entry) => entry.outcome === 'booked').length;
        const queued = result.results.filter((entry) => entry.outcome === 'queued').length;
        const failed = result.results.filter((entry) => entry.outcome === 'failed').length;
        toast(
          booked > 0
            ? `Booked ${booked} · queued ${queued} · failed ${failed}`
            : 'No slot available — clients stay queued and watchers keep trying.',
          booked > 0 ? 'success' : 'error',
        );
      }
      setSelected(new Set());
      await queryClient.invalidateQueries({ queryKey: queryKeys.readyByLocation });
      await queryClient.invalidateQueries({ queryKey: queryKeys.localQueue });
    } catch (error) {
      toast(describeError(error, 'Operation failed'), 'error');
    } finally {
      setBusyGroup(null);
    }
  };

  const confirmRemove = async () => {
    if (!removeBooking) return;
    setRemoving(true);
    try {
      await api.queue.remove([removeBooking.id]);
      toast(`Stopped watching ${removeBooking.name}`);
      setRemoveBooking(null);
      await queryClient.invalidateQueries({ queryKey: queryKeys.localQueue });
    } catch (error) {
      toast(describeError(error, 'Could not remove booking'), 'error');
    } finally {
      setRemoving(false);
    }
  };

  return (
    <div>
      <PageHeader
        title="Booking Queue"
        description="See who is waiting and book up to 20 clients in parallel when a watcher finds slots"
      />

      <h2 className="mb-3 text-sm font-semibold text-slate-700">Queued clients</h2>
      {sessionGroups.length === 0 ? (
        <Card className="mb-8">
          <EmptyState
            icon={ListOrdered}
            title="No clients selected"
            description="Add a bookable client below. This queue lasts only for the current desktop session."
          />
        </Card>
      ) : (
        <div className="mb-8 grid grid-cols-1 gap-4 lg:grid-cols-2">
          {sessionGroups.map(([providerId, group]) => {
            const watcher = watchersByProvider.get(providerId);
            const live = watcher ? runtime.get(watcher.id) : undefined;
            return (
              <details
                key={providerId}
                className="group self-start rounded-lg border border-slate-200 bg-white shadow-sm"
              >
                <summary className="cursor-pointer list-none p-4 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h3 className="truncate text-sm font-semibold text-slate-900">{group.name}</h3>
                      <p className="mt-0.5 text-xs text-slate-500">
                        {group.items.length} client{group.items.length === 1 ? '' : 's'} queued
                      </p>
                    </div>
                    <ChevronDown
                      className="h-4 w-4 shrink-0 text-slate-400 transition-transform group-open:rotate-180"
                      aria-hidden="true"
                    />
                  </div>
                  <dl className="mt-3 grid grid-cols-2 gap-3 border-t border-slate-100 pt-3 text-xs">
                    <div>
                      <dt className="text-slate-400">Last check</dt>
                      <dd className="mt-0.5 font-medium text-slate-700">
                        {lastCheckText(watcher, now)}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-slate-400">Next check</dt>
                      <dd className="mt-0.5 font-medium text-slate-700">
                        {nextCheckText(watcher, live, now)}
                      </dd>
                    </div>
                  </dl>
                  <p className="mt-3 text-xs font-medium text-primary group-open:hidden">
                    Expand client list
                  </p>
                </summary>
                <div className="grid grid-cols-1 gap-2 border-t border-slate-100 p-3 sm:grid-cols-2">
                  {group.items.map((item) => (
                    <div
                      key={item.client_id}
                      className="flex min-w-0 flex-col rounded-md border border-slate-200 p-3"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <p className="truncate text-sm font-medium text-slate-800">
                          {item.client_name}
                        </p>
                        <Badge
                          tone={
                            item.status === 'failed'
                              ? 'red'
                              : item.status === 'queued'
                                ? 'amber'
                                : 'green'
                          }
                        >
                          {item.status}
                        </Badge>
                      </div>
                      <p className="mt-1 min-h-8 text-xs text-slate-400">{queueItemNote(item)}</p>
                      <Button
                        className="mt-2 self-start"
                        size="sm"
                        variant="ghost"
                        onClick={() =>
                          setRemoveBooking({ id: item.client_id, name: item.client_name })
                        }
                        aria-label={`Remove ${item.client_name} from this session`}
                      >
                        Remove
                      </Button>
                    </div>
                  ))}
                </div>
              </details>
            );
          })}
        </div>
      )}

      <h2 className="mb-3 text-sm font-semibold text-slate-700">Add clients to queue</h2>
      <Card className="mb-6">
        <CardBody className="grid grid-cols-1 gap-3 md:grid-cols-5">
          <Input
            aria-label="Search clients"
            placeholder="Search name…"
            value={search}
            onChange={(event) => setParam('q', event.target.value)}
          />
          <Select
            ariaLabel="Filter by office"
            value={locationFilter || 'all'}
            onValueChange={(value) => setParam('location', value === 'all' ? '' : value)}
            options={[
              { value: 'all', label: 'All offices' },
              ...groups.map((group) => ({
                value: String(group.provider_id),
                label: group.provider_name,
              })),
            ]}
          />
          <Select
            ariaLabel="Filter by country"
            value={countryFilter || 'all'}
            onValueChange={(value) => setParam('country', value === 'all' ? '' : value)}
            options={[
              { value: 'all', label: 'All countries' },
              { value: '222', label: 'Nepal' },
              { value: '307', label: 'Other (missions)' },
            ]}
          />
          <Select
            ariaLabel="Filter by application type"
            value={typeFilter || 'all'}
            onValueChange={(value) => setParam('type', value === 'all' ? '' : value)}
            options={[
              { value: 'all', label: 'All types' },
              ...applicationTypes.map((type) => ({ value: type, label: type })),
            ]}
          />
          <Select
            ariaLabel="Filter by status"
            value={statusFilter || 'all'}
            onValueChange={(value) => setParam('status', value === 'all' ? '' : value)}
            options={[
              { value: 'all', label: 'All statuses' },
              ...['fresh', 'ready', 'incomplete', 'booked', 'not_permitted', 'cancelled'].map(
                (status) => ({ value: status, label: status.replace('_', ' ') }),
              ),
            ]}
          />
        </CardBody>
      </Card>

      <h3 className="mb-3 text-sm font-semibold text-slate-700">Clients by office</h3>
      {readyQuery.isPending ? (
        <div className="mb-8 flex flex-col gap-4">
          {[0, 1].map((index) => (
            <Card key={index} className="p-5">
              <Skeleton className="mb-3 h-5 w-1/3" />
              <Skeleton className="h-4 w-full" />
            </Card>
          ))}
        </div>
      ) : visibleGroups.length === 0 ? (
        <Card className="mb-8">
          <EmptyState
            icon={Inbox}
            title="No clients match"
            description="Clients assigned to an available office appear here; incomplete rows cannot be selected."
          />
        </Card>
      ) : (
        <div className="mb-8 flex flex-col gap-4">
          {visibleGroups.map((group) => {
            const selectedIds = groupSelectedIds(group);
            const selectableClients = group.clients.filter((client) => client.can_book);
            const allSelected =
              selectableClients.length > 0 && selectedIds.length === selectableClients.length;
            const groupBusy = busyGroup === group.provider_id;
            return (
              <Card key={group.provider_id}>
                <CardHeader
                  title={[
                    group.provider_name,
                    group.district_name
                      ? latinName(group.district_name)
                      : foreignCountry(group.country_name),
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                  action={
                    <div className="flex items-center gap-2">
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={selectedIds.length === 0 || groupBusy}
                        loading={groupBusy}
                        onClick={() => void runForGroup(group, 'queue')}
                      >
                        <ListOrdered className="h-3.5 w-3.5" aria-hidden="true" />
                        Watch this session ({selectedIds.length})
                      </Button>
                      <Button
                        size="sm"
                        disabled={selectedIds.length === 0 || groupBusy}
                        loading={groupBusy}
                        onClick={() => void runForGroup(group, 'book')}
                      >
                        <Zap className="h-3.5 w-3.5" aria-hidden="true" />
                        Check & book now
                      </Button>
                    </div>
                  }
                />
                <div className="px-5 py-2">
                  <label className="flex items-center gap-2 py-1.5 text-xs text-slate-500">
                    <Checkbox
                      ariaLabel={`Select all clients at ${group.provider_name}`}
                      checked={allSelected}
                      indeterminate={selectedIds.length > 0 && !allSelected}
                      onCheckedChange={(checked) =>
                        selectableClients.forEach((client) => toggleClient(client.id, checked))
                      }
                    />
                    Select bookable ({selectableClients.length})
                  </label>
                </div>
                <ul className="divide-y divide-slate-100 border-t border-slate-100">
                  {group.clients.map((client) => (
                    <li key={client.id} className="flex items-center gap-3 px-5 py-2.5">
                      <Checkbox
                        ariaLabel={`Select ${client.full_name}`}
                        checked={selected.has(client.id)}
                        disabled={!client.can_book}
                        onCheckedChange={(checked) => toggleClient(client.id, checked)}
                      />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-slate-800">
                          {client.full_name}
                        </p>
                        <p className="text-xs text-slate-400">
                          {client.application_type}
                          {client.missing_document_count > 0
                            ? ` · ${client.missing_document_count} doc${client.missing_document_count === 1 ? '' : 's'} missing`
                            : ''}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge tone={desktopStatusTone[client.desktop_status] ?? 'gray'}>
                          {client.desktop_status.replace('_', ' ')}
                        </Badge>
                        {queuedClientIds.has(client.id) && (
                          <span
                            aria-label={`${client.full_name} is queued`}
                            title="Queued in this session"
                            className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-blue-100 text-blue-700"
                          >
                            <ListOrdered className="h-3.5 w-3.5" aria-hidden="true" />
                          </span>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              </Card>
            );
          })}
        </div>
      )}

      <ConfirmDialog
        open={removeBooking !== null}
        onOpenChange={(open) => {
          if (!open) setRemoveBooking(null);
        }}
        title="Remove from this session"
        description={`Stop watching for an appointment for ${removeBooking?.name ?? 'this client'}?`}
        confirmLabel="Remove"
        danger
        loading={removing}
        onConfirm={() => void confirmRemove()}
      />
    </div>
  );
}
