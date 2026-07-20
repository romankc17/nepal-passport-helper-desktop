import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Users, XCircle } from 'lucide-react';
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { ClientSummary } from '../../../shared/types';
import { api, queryKeys } from '../api';
import { Badge, type BadgeTone } from '../components/Badge';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { Drawer } from '../components/Drawer';
import { EmptyState } from '../components/EmptyState';
import { Input } from '../components/Input';
import { PageHeader } from '../components/PageHeader';
import { Pagination } from '../components/Pagination';
import { Select } from '../components/Select';
import { Skeleton } from '../components/Skeleton';
import { useToast } from '../components/Toast';
import { describeError } from '../lib/errors';
import { latinName } from '../lib/format';
import { useDebouncedValue } from '../lib/hooks';
import { resolveProviderLocation } from '../lib/resolve-location';

const PAGE_SIZE = 25;

const statusTone: Record<string, BadgeTone> = {
  ready: 'green',
  incomplete: 'amber',
  queued: 'blue',
  booked: 'green',
  not_permitted: 'red',
  cancelled: 'gray',
};

const statusOptions = ['ready', 'incomplete', 'queued', 'booked', 'not_permitted', 'cancelled'];
const typeOptions = ['First issuance (new)', 'Passport renewal', 'Replacement (lost/stolen)'];

export function ClientsPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const [selectedClientId, setSelectedClientId] = useState<number | null>(null);
  const [queueing, setQueueing] = useState(false);

  const search = searchParams.get('q') ?? '';
  const statusFilter = searchParams.get('status') ?? '';
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
      status: statusFilter || undefined,
      application_type: typeFilter || undefined,
      provider_id: providerFilter ? Number(providerFilter) : undefined,
    }),
    queryFn: () =>
      api.clients.list({
        page,
        page_size: PAGE_SIZE,
        q: debouncedSearch || undefined,
        status: statusFilter || undefined,
        application_type: typeFilter || undefined,
        provider_id: providerFilter ? Number(providerFilter) : undefined,
      }),
  });

  const providersQuery = useQuery({
    queryKey: ['providers-for-filter'],
    queryFn: async () => {
      const groups = await api.clients.readyByLocation();
      return groups.map((group) => ({ id: group.provider_id, name: group.provider_name }));
    },
    staleTime: 60000,
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
        toast(`${client.full_name} queued for booking`);
      } else {
        toast(result.skipped[0]?.reason ?? 'Client could not be queued', 'error');
      }
      await queryClient.invalidateQueries({ queryKey: ['clients'] });
      await queryClient.invalidateQueries({ queryKey: queryKeys.watchers });
    } catch (error) {
      toast(describeError(error, 'Could not queue client'), 'error');
    } finally {
      setQueueing(false);
    }
  };

  const detail = detailQuery.data;
  const missingRequiredDocs =
    detail?.document_requirements.filter((doc) => doc.required && !doc.present) ?? [];

  return (
    <div>
      <PageHeader title="Clients" description="Applicants synced from your workspace" />

      <Card className="mb-4">
        <div className="grid grid-cols-1 gap-3 px-4 py-3 md:grid-cols-5">
          <Input
            aria-label="Search clients"
            placeholder="Search name…"
            value={search}
            onChange={(event) => setParam('q', event.target.value)}
          />
          <Select
            ariaLabel="Filter by status"
            value={statusFilter || 'all'}
            onValueChange={(value) => setParam('status', value === 'all' ? '' : value)}
            options={[
              { value: 'all', label: 'All statuses' },
              ...statusOptions.map((status) => ({
                value: status,
                label: status.replace('_', ' '),
              })),
            ]}
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
              ...(providersQuery.data ?? []).map((provider) => ({
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
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-left text-xs text-slate-400">
                  <th className="px-5 py-3 font-medium">Name</th>
                  <th className="px-3 py-3 font-medium">Type</th>
                  <th className="px-3 py-3 font-medium">Office</th>
                  <th className="px-3 py-3 font-medium">Application ID</th>
                  <th className="px-3 py-3 font-medium">Documents</th>
                  <th className="px-3 py-3 font-medium">Status</th>
                  <th className="px-3 py-3 font-medium">Contact</th>
                </tr>
              </thead>
              <tbody>
                {visibleClients.map((client) => (
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
                    <td className="px-5 py-3 font-medium text-slate-800">{client.full_name}</td>
                    <td className="px-3 py-3 text-slate-600">{client.application_type}</td>
                    <td className="px-3 py-3 text-slate-600">{client.provider_name}</td>
                    <td className="px-3 py-3 font-mono text-xs text-slate-500">
                      {client.official_application_id || '—'}
                    </td>
                    <td className="px-3 py-3">
                      {client.missing_document_count === 0 ? (
                        <span className="text-xs text-success">Complete</span>
                      ) : (
                        <span className="text-xs text-amber">
                          {client.missing_document_count} missing
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-3">
                      <Badge tone={statusTone[client.desktop_status] ?? 'gray'}>
                        {client.desktop_status.replace('_', ' ')}
                      </Badge>
                    </td>
                    <td className="px-3 py-3 text-xs text-slate-500">
                      {client.phone || client.email || '—'}
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
                  {detail.provider_name} · {latinName(detail.district_name)}
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

            <section>
              {detail.can_book ? (
                <Button
                  onClick={() => void queueForBooking(detail)}
                  loading={queueing}
                  className="w-full"
                >
                  Queue for booking
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
