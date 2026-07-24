import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, ArrowUpDown, CheckCircle2, Import, Send, Users, XCircle } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { ClientSummary } from '../../../shared/types';
import { api, queryKeys } from '../api';
import { Badge, type BadgeTone } from '../components/Badge';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { Checkbox } from '../components/Checkbox';
import { Drawer } from '../components/Drawer';
import { EmptyState } from '../components/EmptyState';
import { ImportOfficialDialog } from '../components/import-official/ImportOfficialDialog';
import { Input } from '../components/Input';
import { PageHeader } from '../components/PageHeader';
import { Pagination } from '../components/Pagination';
import { Select } from '../components/Select';
import { Skeleton } from '../components/Skeleton';
import { useToast } from '../components/Toast';
import { describeError } from '../lib/errors';
import { foreignCountry, formatDateTime, latinName } from '../lib/format';
import { useDebouncedValue } from '../lib/hooks';
import { resolveProviderLocation } from '../lib/resolve-location';
import { cn } from '../lib/utils';

const PAGE_SIZE = 25;

const statusTone: Record<string, BadgeTone> = {
  fresh: 'gray',
  ready: 'green',
  incomplete: 'amber',
  queued: 'blue',
  booked: 'green',
  not_permitted: 'red',
  cancelled: 'gray',
};

const typeOptions = ['First issuance (new)', 'Passport renewal', 'Replacement (lost/stolen)'];
const tabs = [
  { value: 'unbooked', label: 'Unbooked' },
  { value: 'fresh', label: 'Fresh' },
  { value: 'ready', label: 'Ready' },
  { value: 'booked', label: 'Booked' },
  { value: 'all', label: 'All' },
] as const;

type SortKey = 'name' | 'type' | 'office' | 'applicationId' | 'status' | 'added';
type SortState = { key: SortKey; direction: 'asc' | 'desc' };

const sortValue = (client: ClientSummary, key: SortKey): string | number => {
  switch (key) {
    case 'name':
      return client.full_name;
    case 'type':
      return client.application_type;
    case 'office':
      return client.provider_name;
    case 'applicationId':
      return client.official_application_id;
    case 'status':
      return client.desktop_status;
    case 'added':
      return client.created_at;
  }
};

const canMakeReady = (client: ClientSummary): boolean =>
  client.desktop_status === 'fresh';

export function ClientsPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const [selectedClientId, setSelectedClientId] = useState<number | null>(null);
  const [queueing, setQueueing] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [sort, setSort] = useState<SortState | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [makingReady, setMakingReady] = useState<Set<number>>(new Set());

  const search = searchParams.get('q') ?? '';
  const tab = tabs.some(({ value }) => value === searchParams.get('tab'))
    ? (searchParams.get('tab') as (typeof tabs)[number]['value'])
    : 'unbooked';
  const typeFilter = searchParams.get('type') ?? '';
  const providerFilter = searchParams.get('provider') ?? '';
  const docsFilter = searchParams.get('docs') ?? '';
  const page = Number(searchParams.get('page') ?? '1') || 1;
  const debouncedSearch = useDebouncedValue(search);

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

  const clientsQuery = useQuery({
    queryKey: queryKeys.clients({
      page,
      page_size: PAGE_SIZE,
      q: debouncedSearch || undefined,
      status: tab === 'fresh' || tab === 'ready' ? tab : undefined,
      application_type: typeFilter || undefined,
      provider_id: providerFilter ? Number(providerFilter) : undefined,
      booked: tab === 'all' ? undefined : tab === 'booked',
    }),
    queryFn: () =>
      api.clients.list({
        page,
        page_size: PAGE_SIZE,
        q: debouncedSearch || undefined,
        status: tab === 'fresh' || tab === 'ready' ? tab : undefined,
        application_type: typeFilter || undefined,
        provider_id: providerFilter ? Number(providerFilter) : undefined,
        booked: tab === 'all' ? undefined : tab === 'booked',
      }),
    staleTime: 30000,
  });

  const detailQuery = useQuery({
    queryKey: queryKeys.client(selectedClientId ?? 0),
    queryFn: () => api.clients.get(selectedClientId ?? 0),
    enabled: selectedClientId !== null,
  });

  const visibleClients = (clientsQuery.data?.items ?? []).filter((client) => {
    if (docsFilter === 'complete') return client.missing_document_count === 0;
    if (docsFilter === 'missing') return client.missing_document_count > 0;
    return true;
  });

  const sortedClients = useMemo(() => {
    if (!sort) return visibleClients;
    const direction = sort.direction === 'asc' ? 1 : -1;
    return [...visibleClients].sort((a, b) => {
      const left = sortValue(a, sort.key);
      const right = sortValue(b, sort.key);
      if (typeof left === 'number' && typeof right === 'number') {
        return (left - right) * direction;
      }
      return String(left).localeCompare(String(right)) * direction;
    });
  }, [visibleClients, sort]);

  const eligibleIds = sortedClients.filter(canMakeReady).map((client) => client.id);
  const selectedEligibleIds = eligibleIds.filter((id) => selected.has(id));

  const toggleSelect = (clientId: number, checked: boolean) => {
    setSelected((current) => {
      const next = new Set(current);
      if (checked) next.add(clientId);
      else next.delete(clientId);
      return next;
    });
  };

  const toggleSelectAll = (checked: boolean) => {
    setSelected(checked ? new Set(sortedClients.map((client) => client.id)) : new Set());
  };

  const toggleSort = (key: SortKey) => {
    setSort((current) => {
      if (!current || current.key !== key) return { key, direction: 'asc' };
      if (current.direction === 'asc') return { key, direction: 'desc' };
      return null;
    });
  };

  const renderHeader = (key: SortKey, label: string) => (
    <button
      type="button"
      onClick={() => toggleSort(key)}
      aria-label={`Sort by ${label}`}
      className="flex items-center gap-1 font-medium hover:text-slate-600"
    >
      {label}
      {sort?.key === key ? (
        sort.direction === 'asc' ? (
          <ArrowUp className="h-3 w-3" aria-hidden="true" />
        ) : (
          <ArrowDown className="h-3 w-3" aria-hidden="true" />
        )
      ) : (
        <ArrowUpDown className="h-3 w-3 opacity-50" aria-hidden="true" />
      )}
    </button>
  );

  const queueForBooking = async (client: ClientSummary) => {
    setQueueing(true);
    try {
      const location = await resolveProviderLocation(client.provider_id, client.provider_name);
      if (!location) {
        toast('Could not resolve province/district for this office.', 'error');
        return;
      }
      const result = await api.queue.add({
        ...location,
        client_ids: [client.id],
        idempotency_key: window.crypto.randomUUID(),
      });
      if (result.queued.length > 0) {
        toast(`${client.full_name} added to this booking session`);
      } else {
        toast(result.skipped[0]?.reason ?? 'Client could not be added', 'error');
      }
      await queryClient.invalidateQueries({ queryKey: ['clients'] });
      await queryClient.invalidateQueries({ queryKey: queryKeys.watchers });
    } catch (error) {
      toast(describeError(error, 'Could not add client to this session'), 'error');
    } finally {
      setQueueing(false);
    }
  };

  const submitMutation = useMutation({
    mutationFn: (clientIds: number[]) => api.clients.submit({ client_ids: clientIds }),
  });

  const makeReady = async (clientIds: number[]) => {
    const ids = clientIds.filter((id) => !makingReady.has(id));
    if (ids.length === 0) return;
    setMakingReady((current) => new Set([...current, ...ids]));
    try {
      const result = await submitMutation.mutateAsync(ids);
      if (result.submitted.length > 0) {
        toast(
          `Made ready: ${result.submitted.length} client${result.submitted.length === 1 ? '' : 's'}`,
        );
      }
      if (result.failed.length > 0) {
        toast(
          result.failed.length === 1
            ? result.failed[0].error
            : `${result.failed.length} clients could not be made ready`,
          'error',
        );
      }
      setSelected((current) => {
        const next = new Set(current);
        ids.forEach((id) => next.delete(id));
        return next;
      });
      await queryClient.invalidateQueries({ queryKey: ['clients'] });
      if (selectedClientId !== null && ids.includes(selectedClientId)) {
        await queryClient.invalidateQueries({ queryKey: queryKeys.client(selectedClientId) });
      }
    } catch (error) {
      toast(describeError(error, 'Could not make clients ready'), 'error');
    } finally {
      setMakingReady((current) => {
        const next = new Set(current);
        ids.forEach((id) => next.delete(id));
        return next;
      });
    }
  };

  const detail = detailQuery.data;

  const onImported = (client: ClientSummary) => {
    void queryClient.invalidateQueries({ queryKey: ['clients'] });
    setSelectedClientId(client.id);
    toast(`Imported ${client.full_name} as a new Fresh client`);
  };
  const missingRequiredDocs =
    detail?.document_requirements.filter((doc) => doc.required && !doc.present) ?? [];

  return (
    <div>
      <PageHeader
        title="Clients"
        description="Applicants synced from your workspace"
        actions={
          <Button
            variant="secondary"
            data-testid="open-import-official"
            onClick={() => setImportOpen(true)}
          >
            <Import className="h-4 w-4" aria-hidden="true" />
            Import from official application
          </Button>
        }
      />

      <div role="tablist" aria-label="Client booking status" className="mb-4 flex gap-1">
        {tabs.map((entry) => (
          <button
            key={entry.value}
            role="tab"
            aria-selected={tab === entry.value}
            onClick={() => setParam('tab', entry.value === 'unbooked' ? '' : entry.value)}
            className={cn(
              'rounded-md px-4 py-2 text-sm font-medium transition-colors',
              'focus:outline-none focus-visible:ring-2 focus-visible:ring-primary',
              tab === entry.value
                ? 'bg-navy text-white'
                : 'text-slate-600 hover:bg-slate-200/60',
            )}
          >
            {entry.label}
          </button>
        ))}
      </div>

      <Card className="mb-4">
        <div className="grid grid-cols-1 gap-3 px-4 py-3 md:grid-cols-4">
          <Input
            aria-label="Search clients"
            placeholder="Search name…"
            value={search}
            onChange={(event) => setParam('q', event.target.value)}
          />
          <Select
            ariaLabel="Filter by application type"
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
              ...(clientsQuery.data?.providers ?? []).map((provider) => ({
                value: String(provider.id),
                label: provider.name,
              })),
            ]}
          />
          <Select
            ariaLabel="Filter by document readiness"
            value={docsFilter || 'all'}
            onValueChange={(value) => setParam('docs', value === 'all' ? '' : value)}
            options={[
              { value: 'all', label: 'Docs: all' },
              { value: 'complete', label: 'Docs: complete' },
              { value: 'missing', label: 'Docs: missing' },
            ]}
          />
        </div>
      </Card>

      <Card>
        {clientsQuery.isPending ? (
          <div className="flex flex-col gap-3 p-5">
            {[0, 1, 2, 3].map((index) => (
              <Skeleton key={index} className="h-6 w-full" />
            ))}
          </div>
        ) : clientsQuery.isError ? (
          <EmptyState
            icon={Users}
            title="Could not load clients"
            description={describeError(clientsQuery.error)}
            action={
              <Button variant="secondary" onClick={() => void clientsQuery.refetch()}>
                Retry
              </Button>
            }
          />
        ) : visibleClients.length === 0 ? (
          <EmptyState
            icon={Users}
            title="No clients match"
            description="Adjust the filters, or sync new clients from the web workspace."
          />
        ) : (
          <>
            <div className="flex items-center gap-3 px-5 py-3">
              <Checkbox
                ariaLabel="Select all clients on this page"
                checked={selected.size > 0 && sortedClients.every((client) => selected.has(client.id))}
                indeterminate={selected.size > 0 && !sortedClients.every((client) => selected.has(client.id))}
                onCheckedChange={toggleSelectAll}
              />
              <span className="text-xs text-slate-500">{selected.size} selected</span>
              <Button
                size="sm"
                disabled={selectedEligibleIds.length === 0 || makingReady.size > 0}
                loading={makingReady.size > 0}
                onClick={() => void makeReady(selectedEligibleIds)}
              >
                <Send className="h-3.5 w-3.5" aria-hidden="true" />
                Make ready ({selectedEligibleIds.length})
              </Button>
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-left text-xs text-slate-400">
                  <th className="w-10 px-5 py-3" />
                  <th className="px-3 py-3">{renderHeader('name', 'Name')}</th>
                  <th className="px-3 py-3">{renderHeader('type', 'Type')}</th>
                  <th className="px-3 py-3">{renderHeader('office', 'Office')}</th>
                  <th className="px-3 py-3">{renderHeader('applicationId', 'Application ID')}</th>
                  <th className="px-3 py-3">{renderHeader('status', 'Status')}</th>
                  <th className="px-3 py-3">{renderHeader('added', 'Added')}</th>
                  <th className="px-3 py-3" />
                </tr>
              </thead>
              <tbody>
                {sortedClients.map((client) => (
                  <tr
                    key={client.id}
                    onClick={() => setSelectedClientId(client.id)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') setSelectedClientId(client.id);
                    }}
                    tabIndex={0}
                    aria-label={`Open details for ${client.full_name}`}
                    className="cursor-pointer border-b border-slate-50 transition-colors hover:bg-blue-50/40 focus:outline-none focus-visible:bg-blue-50"
                  >
                    <td className="px-5 py-3" onClick={(event) => event.stopPropagation()}>
                      <Checkbox
                        ariaLabel={`Select ${client.full_name}`}
                        checked={selected.has(client.id)}
                        onCheckedChange={(checked) => toggleSelect(client.id, checked)}
                      />
                    </td>
                    <td className="px-3 py-3 font-medium text-slate-800">{client.full_name}</td>
                    <td className="px-3 py-3 text-slate-600">{client.application_type}</td>
                    <td className="px-3 py-3 text-slate-600">
                      {client.provider_name}
                      {foreignCountry(client.appointment_country_name ?? client.country_name) && (
                        <span className="text-xs text-slate-400">
                          {' '}
                          · {foreignCountry(client.appointment_country_name ?? client.country_name)}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-3 font-mono text-xs text-slate-500">
                      {client.official_application_id || '—'}
                    </td>
                    <td className="px-3 py-3">
                      <Badge tone={statusTone[client.desktop_status] ?? 'gray'}>
                        {client.desktop_status.replace('_', ' ')}
                      </Badge>
                    </td>
                    <td className="px-3 py-3 text-xs text-slate-500">
                      {formatDateTime(client.created_at)}
                    </td>
                    <td className="px-3 py-3" onClick={(event) => event.stopPropagation()}>
                      {canMakeReady(client) && (
                        <Button
                          size="sm"
                          variant="secondary"
                          disabled={makingReady.has(client.id)}
                          loading={makingReady.has(client.id)}
                          onClick={() => void makeReady([client.id])}
                        >
                          Make ready
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <Pagination
              page={clientsQuery.data.page}
              pageSize={clientsQuery.data.page_size}
              total={clientsQuery.data.total}
              onPageChange={(next) => setParam('page', String(next))}
            />
          </>
        )}
      </Card>

      <ImportOfficialDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        onCreated={onImported}
      />

      <Drawer
        open={selectedClientId !== null}
        onOpenChange={(open) => {
          if (!open) setSelectedClientId(null);
        }}
        title={detail?.full_name ?? 'Client details'}
      >
        {detailQuery.isPending ? (
          <div className="flex flex-col gap-3">
            <Skeleton className="h-5 w-1/2" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-2/3" />
          </div>
        ) : !detail ? (
          <p className="text-sm text-danger">Could not load client details.</p>
        ) : (
          <div className="flex flex-col gap-6">
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
              <div>
                <dt className="text-xs text-slate-400">Application type</dt>
                <dd className="text-slate-800">{detail.application_type}</dd>
              </div>
              <div>
                <dt className="text-xs text-slate-400">Status</dt>
                <dd>
                  <Badge tone={statusTone[detail.desktop_status] ?? 'gray'}>
                    {detail.desktop_status.replace('_', ' ')}
                  </Badge>
                </dd>
              </div>
              <div>
                <dt className="text-xs text-slate-400">Office</dt>
                <dd className="text-slate-800">
                  {[
                    detail.provider_name,
                    detail.district_name ? latinName(detail.district_name) : '',
                    foreignCountry(detail.appointment_country_name ?? detail.country_name),
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-slate-400">Official application ID</dt>
                <dd className="font-mono text-xs text-slate-800">
                  {detail.official_application_id || '—'}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-slate-400">Phone</dt>
                <dd className="text-slate-800">{detail.phone || '—'}</dd>
              </div>
              <div>
                <dt className="text-xs text-slate-400">Email</dt>
                <dd className="text-slate-800">{detail.email || '—'}</dd>
              </div>
              <div>
                <dt className="text-xs text-slate-400">Created by</dt>
                <dd className="text-slate-800">{detail.created_by}</dd>
              </div>
              {detail.appointment && (
                <div>
                  <dt className="text-xs text-slate-400">Appointment</dt>
                  <dd className="text-slate-800">
                    {detail.appointment.date} · {detail.appointment.start_time.slice(0, 5)}
                  </dd>
                </div>
              )}
            </dl>

            <section>
              <h3 className="mb-2 text-sm font-semibold text-slate-800">Documents</h3>
              <ul className="flex flex-col gap-1.5">
                {detail.document_requirements.map((doc) => (
                  <li key={doc.type} className="flex items-center gap-2 text-sm">
                    {doc.present ? (
                      <CheckCircle2 className="h-4 w-4 text-success" aria-hidden="true" />
                    ) : (
                      <XCircle className="h-4 w-4 text-danger" aria-hidden="true" />
                    )}
                    <span className="text-slate-700">{doc.label}</span>
                    {doc.required && (
                      <Badge tone={doc.present ? 'green' : 'red'}>required</Badge>
                    )}
                  </li>
                ))}
              </ul>
            </section>

            {detail.active_booking !== null && (
              <section>
                <h3 className="mb-2 text-sm font-semibold text-slate-800">Active booking</h3>
                <pre className="overflow-x-auto rounded-md bg-slate-50 p-3 text-xs text-slate-600">
                  {JSON.stringify(detail.active_booking, null, 2)}
                </pre>
              </section>
            )}

            <section className="flex flex-col gap-2">
              {canMakeReady(detail) && (
                <Button
                  variant="secondary"
                  disabled={makingReady.has(detail.id)}
                  loading={makingReady.has(detail.id)}
                  onClick={() => void makeReady([detail.id])}
                  className="w-full"
                >
                  <Send className="h-4 w-4" aria-hidden="true" />
                  Make ready
                </Button>
              )}
              {detail.can_book ? (
                <Button
                  onClick={() => void queueForBooking(detail)}
                  loading={queueing}
                  className="w-full"
                >
                  Watch in this session
                </Button>
              ) : detail.desktop_status === 'not_permitted' ? (
                <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">
                  Your account cannot book at this office.
                </p>
              ) : missingRequiredDocs.length > 0 ? (
                <div className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">
                  <p className="font-medium">Cannot book yet — missing required documents:</p>
                  <ul className="mt-1 list-inside list-disc">
                    {missingRequiredDocs.map((doc) => (
                      <li key={doc.type}>{doc.label}</li>
                    ))}
                  </ul>
                </div>
              ) : (
                <p className="rounded-md bg-slate-50 px-3 py-2 text-sm text-slate-600">
                  This client cannot be booked right now (status: {detail.desktop_status}).
                </p>
              )}
            </section>
          </div>
        )}
      </Drawer>
    </div>
  );
}
