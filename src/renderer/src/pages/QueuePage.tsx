import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { Inbox, ListOrdered, Zap } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { ClientSummary, ReadyByLocationGroup } from '../../../shared/types';
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
import { latinName } from '../lib/format';
import { useDebouncedValue } from '../lib/hooks';
import { resolveProviderLocation } from '../lib/resolve-location';
import { useOperations } from '../operations';

const desktopStatusTone: Record<string, BadgeTone> = {
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

export function QueuePage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { startQueue, startBookNow } = useOperations();
  const [searchParams, setSearchParams] = useSearchParams();

  const search = searchParams.get('q') ?? '';
  const locationFilter = searchParams.get('location') ?? '';
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
  });

  const watchersQuery = useQuery({
    queryKey: queryKeys.watchers,
    queryFn: () => api.watchers.list(),
    refetchInterval: 60000,
  });

  const queuedWatchers = (watchersQuery.data ?? []).filter((watcher) => watcher.queued_count > 0);

  const watcherDetails = useQueries({
    queries: queuedWatchers.map((watcher) => ({
      queryKey: queryKeys.watcher(watcher.id),
      queryFn: () => api.watchers.get(watcher.id),
      refetchInterval: 30000,
    })),
  });

  const groups = readyQuery.data ?? [];

  const applicationTypes = useMemo(
    () =>
      [...new Set(groups.flatMap((group) => group.clients.map((client) => client.application_type)))].sort(),
    [groups],
  );

  const visibleGroups = groups
    .filter((group) => !locationFilter || String(group.provider_id) === locationFilter)
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
    group.clients.filter((client) => selected.has(client.id)).map((client) => client.id);

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
          `Queued ${result.queued.length} client${result.queued.length === 1 ? '' : 's'} · ${group.provider_name}`,
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
      await queryClient.invalidateQueries({ queryKey: queryKeys.watchers });
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
      toast(`Removed ${removeBooking.name} from the queue`);
      setRemoveBooking(null);
      await queryClient.invalidateQueries({ queryKey: queryKeys.watchers });
      await queryClient.invalidateQueries({ queryKey: ['watchers'] });
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
        description="Queue ready clients and let watchers book them as slots open"
      />

      <Card className="mb-6">
        <CardBody className="grid grid-cols-1 gap-3 md:grid-cols-4">
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
              ...['ready', 'incomplete', 'queued', 'booked', 'not_permitted', 'cancelled'].map(
                (status) => ({ value: status, label: status.replace('_', ' ') }),
              ),
            ]}
          />
        </CardBody>
      </Card>

      <h2 className="mb-3 text-sm font-semibold text-slate-700">Ready to book</h2>
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
            title="No ready clients match"
            description="Clients appear here once their documents are complete and your account can book at their office."
          />
        </Card>
      ) : (
        <div className="mb-8 flex flex-col gap-4">
          {visibleGroups.map((group) => {
            const selectedIds = groupSelectedIds(group);
            const allSelected = group.clients.length > 0 && selectedIds.length === group.clients.length;
            const groupBusy = busyGroup === group.provider_id;
            return (
              <Card key={group.provider_id}>
                <CardHeader
                  title={`${group.provider_name} · ${latinName(group.district_name)}`}
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
                        Queue selected ({selectedIds.length})
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
                        group.clients.forEach((client) => toggleClient(client.id, checked))
                      }
                    />
                    Select all ({group.clients.length})
                  </label>
                </div>
                <ul className="divide-y divide-slate-100 border-t border-slate-100">
                  {group.clients.map((client) => (
                    <li key={client.id} className="flex items-center gap-3 px-5 py-2.5">
                      <Checkbox
                        ariaLabel={`Select ${client.full_name}`}
                        checked={selected.has(client.id)}
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
                      <Badge tone={desktopStatusTone[client.desktop_status] ?? 'gray'}>
                        {client.desktop_status.replace('_', ' ')}
                      </Badge>
                    </li>
                  ))}
                </ul>
              </Card>
            );
          })}
        </div>
      )}

      <h2 className="mb-3 text-sm font-semibold text-slate-700">Currently queued</h2>
      {queuedWatchers.length === 0 ? (
        <Card>
          <EmptyState
            icon={ListOrdered}
            title="Nothing queued"
            description="Queued clients appear here. If no slot is available, clients stay queued and watchers keep trying automatically."
          />
        </Card>
      ) : (
        <div className="flex flex-col gap-4">
          {queuedWatchers.map((watcher, index) => {
            const detail = watcherDetails[index];
            return (
              <Card key={watcher.id}>
                <CardHeader
                  title={`${watcher.provider_name} · ${watcher.queued_count} queued`}
                />
                {detail?.isPending ? (
                  <CardBody>
                    <Skeleton className="h-4 w-full" />
                  </CardBody>
                ) : (
                  <ul className="divide-y divide-slate-100">
                    {(detail?.data?.priority_bookings ?? []).map((booking) => (
                      <li key={booking.id} className="flex items-center gap-3 px-5 py-2.5">
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium text-slate-800">
                            {booking.client_name}
                          </p>
                          <p className="text-xs text-slate-400">Booking #{booking.id}</p>
                        </div>
                        <Badge
                          tone={
                            booking.status === 'failed'
                              ? 'red'
                              : booking.status === 'pending'
                                ? 'amber'
                                : 'blue'
                          }
                        >
                          {booking.status}
                        </Badge>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setRemoveBooking({ id: booking.id, name: booking.client_name })}
                          aria-label={`Remove ${booking.client_name} from queue`}
                        >
                          Remove
                        </Button>
                      </li>
                    ))}
                  </ul>
                )}
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
        title="Remove from queue"
        description={`Remove ${removeBooking?.name ?? 'this client'} from the booking queue? Only pending or failed bookings can be removed.`}
        confirmLabel="Remove"
        danger
        loading={removing}
        onConfirm={() => void confirmRemove()}
      />
    </div>
  );
}
