import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  BookOpen,
  CheckCircle2,
  Clock,
  Download,
  FlaskConical,
  History,
  Inbox,
  ListOrdered,
  RefreshCw,
  Search,
  Trash2,
  Users,
  XCircle,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { LabClient, LabListQuery } from '../../../shared/types';
import { api, queryKeys } from '../api';
import { Badge, type BadgeTone } from '../components/Badge';
import { Button } from '../components/Button';
import { Card, CardBody, CardHeader } from '../components/Card';
import { Checkbox } from '../components/Checkbox';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { Dialog } from '../components/Dialog';
import { EmptyState } from '../components/EmptyState';
import { Input } from '../components/Input';
import { Label } from '../components/Label';
import { PageHeader } from '../components/PageHeader';
import { Pagination } from '../components/Pagination';
import { ProgressBar } from '../components/ProgressBar';
import { Select } from '../components/Select';
import { Skeleton } from '../components/Skeleton';
import { useToast } from '../components/Toast';
import { describeError } from '../lib/errors';
import { formatDateTime } from '../lib/format';
import { useDebouncedValue } from '../lib/hooks';

type LabTab = 'generated' | 'submitted' | 'booked' | 'watchers' | 'history';

function stageProgress(stage?: string): number | undefined {
  if (stage === 'done' || stage === 'failed') return 100;
  if (stage === 'submitting' || stage === 'booking') return 60;
  if (stage === 'pending') return 10;
  return undefined;
}

const statusTone: Record<string, BadgeTone> = {
  draft: 'gray',
  submitted: 'blue',
  queued: 'amber',
  pending: 'amber',
  booked: 'green',
  failed: 'red',
  cancelled: 'gray',
};

const statusLabel: Record<string, string> = {
  draft: 'Not submitted',
  submitted: 'Submitted',
  queued: 'Queued',
  pending: 'Pending',
  booked: 'Booked',
  failed: 'Failed',
  cancelled: 'Cancelled',
};

const applicationTypeLabel: Record<string, string> = {
  NEW: 'New',
  RENEW: 'Renew',
  REPLACE_LOST: 'Lost',
  REPLACE_DAMAGED: 'Damaged',
  MODIFICATION: 'Modification',
  MIXED: 'Mixed',
};

function useLabDrafts() {
  const [drafts, setDrafts] = useState<Record<string, unknown>[]>(() => {
    try {
      const raw = localStorage.getItem('booking-lab-drafts');
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  });

  const save = (next: Record<string, unknown>[]) => {
    setDrafts(next);
    localStorage.setItem('booking-lab-drafts', JSON.stringify(next));
  };

  const add = (clients: Record<string, unknown>[]) => {
    save([...drafts, ...clients.map((client, index) => ({ ...client, _draftId: Date.now() + index }))]);
  };

  const remove = (ids: Set<number>) => {
    save(drafts.filter((_, index) => !ids.has(index)));
  };

  const clear = () => save([]);

  return { drafts, add, remove, clear };
}

function SummaryCard({
  label,
  value,
  icon: Icon,
  tone,
}: {
  label: string;
  value: number;
  icon: typeof Inbox;
  tone?: string;
}) {
  return (
    <Card>
      <CardBody className="flex items-center gap-3 py-4">
        <div className={`rounded-lg p-2 ${tone ?? 'bg-slate-100'}`}>
          <Icon className="h-5 w-5 text-slate-600" />
        </div>
        <div>
          <p className="text-sm text-slate-500">{label}</p>
          <p className="text-2xl font-semibold text-slate-900">{value}</p>
        </div>
      </CardBody>
    </Card>
  );
}

export function BookingLabPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [generateOpen, setGenerateOpen] = useState(false);
  const [cancelTarget, setCancelTarget] = useState<LabClient | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<LabClient | null>(null);
  const [receiptTarget, setReceiptTarget] = useState<LabClient | null>(null);
  const [pendingSubmitIds, setPendingSubmitIds] = useState<Set<number>>(new Set());
  const [pendingBookIds, setPendingBookIds] = useState<Set<number>>(new Set());
  const [activeJob, setActiveJob] = useState<{ batchId: string; kind: 'submit' | 'book' } | null>(null);

  const tab = (searchParams.get('tab') ?? 'generated') as LabTab;
  const search = searchParams.get('q') ?? '';
  const statusFilter = searchParams.get('status') ?? '';
  const ownerFilter = searchParams.get('owner') ?? '';
  const page = parseInt(searchParams.get('page') ?? '1', 10);
  const debouncedSearch = useDebouncedValue(search).toLowerCase();

  const { drafts, add: addDrafts, remove: removeDrafts, clear: clearDrafts } = useLabDrafts();

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

  // The tab decides the base status set server-side so pagination totals
  // match what is shown; the user's status select narrows it further.
  const listQuery: LabListQuery = useMemo(() => ({
    q: debouncedSearch || undefined,
    status:
      statusFilter ||
      (tab === 'submitted' ? 'submitted,queued,failed' : tab === 'booked' ? 'booked' : undefined),
    owner: ownerFilter || undefined,
    page,
    page_size: 25,
  }), [debouncedSearch, statusFilter, ownerFilter, page, tab]);

  // Drafts are keyed by index, server clients by id — never carry a
  // selection across tabs.
  useEffect(() => {
    setSelected(new Set());
  }, [tab]);

  const summaryQuery = useQuery({
    queryKey: queryKeys.labSummary,
    queryFn: () => api.lab.summary(),
    refetchInterval: 30000,
    staleTime: 30000,
  });

  const clientsQuery = useQuery({
    queryKey: queryKeys.labClients(listQuery),
    queryFn: () => api.lab.clients(listQuery),
    enabled: tab === 'submitted' || tab === 'booked',
    refetchInterval: tab === 'submitted' || tab === 'booked' ? 30000 : false,
    staleTime: 30000,
  });

  const historyQuery = useQuery({
    queryKey: queryKeys.labHistory(listQuery),
    queryFn: () => api.lab.history(listQuery),
    enabled: tab === 'history',
    refetchInterval: 30000,
    staleTime: 30000,
  });

  const watchersQuery = useQuery({
    queryKey: queryKeys.watchers,
    queryFn: () => api.watchers.list(),
    enabled: tab === 'watchers',
    refetchInterval: 30000,
    staleTime: 30000,
  });

  const labWatchers = useMemo(
    () => (watchersQuery.data ?? []).filter((w) => w.name.startsWith('Lab booking ')),
    [watchersQuery.data],
  );

  const generateMutation = useMutation({
    mutationFn: (input: Parameters<typeof api.lab.generate>[0]) => api.lab.generate(input),
    onSuccess: (result) => {
      addDrafts(result.clients);
      toast(`Generated ${result.count} demo clients`);
      setGenerateOpen(false);
    },
    onError: (error) => toast(describeError(error, 'Could not generate demo clients'), 'error'),
  });

  const startSubmitMutation = useMutation({
    mutationFn: () =>
      api.lab.submit({
        clients: selectedDrafts,
        idempotency_key: crypto.randomUUID(),
      }),
    onSuccess: ({ batch_id }) => setActiveJob({ batchId: batch_id, kind: 'submit' }),
    onError: (error) => {
      toast(describeError(error, 'Could not start submission'), 'error');
      setPendingSubmitIds(new Set());
    },
  });

  const startBookMutation = useMutation({
    mutationFn: (input: Parameters<typeof api.lab.book>[0]) => api.lab.book(input),
    onSuccess: ({ batch_id }) => setActiveJob({ batchId: batch_id, kind: 'book' }),
    onError: (error) => {
      toast(describeError(error, 'Could not start booking'), 'error');
      setPendingBookIds(new Set());
    },
  });

  const jobQuery = useQuery({
    queryKey: ['lab-job', activeJob?.batchId],
    queryFn: () => api.lab.job(activeJob!.batchId),
    enabled: activeJob !== null,
    refetchInterval: 1500,
  });

  useEffect(() => {
    if (!activeJob || !jobQuery.data?.finished) return;
    const job = jobQuery.data;
    if (job.error) {
      toast(job.error, 'error');
    } else if (job.kind === 'submit') {
      const result = job.result as { submitted: { name: string }[]; failed: { name: string; error: string }[] } | null;
      const submitted = result?.submitted ?? [];
      const failed = result?.failed ?? [];
      toast(`Submitted ${submitted.length} clients`);
      if (failed.length > 0) {
        toast(`${failed.length} clients failed to submit`, 'error');
      }
      clearDrafts();
      setParam('tab', 'submitted');
    } else {
      const result = job.result as { results: { booked: number; queued: number }[] } | null;
      const results = result?.results ?? [];
      const totalBooked = results.reduce((sum, r) => sum + r.booked, 0);
      const totalQueued = results.reduce((sum, r) => sum + r.queued, 0);
      toast(`Booked ${totalBooked} clients, queued ${totalQueued}`);
    }
    setSelected(new Set());
    setPendingSubmitIds(new Set());
    setPendingBookIds(new Set());
    setActiveJob(null);
    void queryClient.invalidateQueries({ queryKey: ['lab-clients'] });
    void queryClient.invalidateQueries({ queryKey: queryKeys.labSummary });
  }, [activeJob, jobQuery.data]);

  const cancelMutation = useMutation({
    mutationFn: (bookingId: number) => api.lab.cancel(bookingId),
    onSuccess: () => {
      toast('Appointment cancelled');
      setCancelTarget(null);
      void queryClient.invalidateQueries({ queryKey: ['lab-clients'] });
      void queryClient.invalidateQueries({ queryKey: queryKeys.labSummary });
    },
    onError: (error) => toast(describeError(error, 'Could not cancel appointment'), 'error'),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => api.lab.delete(id),
    onSuccess: () => {
      toast('Client deleted');
      setDeleteTarget(null);
      void queryClient.invalidateQueries({ queryKey: ['lab-clients'] });
      void queryClient.invalidateQueries({ queryKey: queryKeys.labSummary });
    },
    onError: (error) => toast(describeError(error, 'Could not delete client'), 'error'),
  });

  const receiptMutation = useMutation({
    mutationFn: (bookingId: number) => api.lab.receipt(bookingId),
    onSuccess: (receipt) => {
      const link = document.createElement('a');
      link.href = `data:application/pdf;base64,${receipt.data}`;
      link.download = receipt.filename;
      link.click();
      toast('Receipt downloaded');
      setReceiptTarget(null);
    },
    onError: (error) => toast(describeError(error, 'Could not download receipt'), 'error'),
  });

  const summary = summaryQuery.data;
  const clients = clientsQuery.data?.items ?? [];
  const isStaff = clientsQuery.data?.is_staff ?? false;
  const history = historyQuery.data?.items ?? [];

  // Server-side status filtering (see listQuery) means the returned page is
  // already scoped to the active tab.
  const filteredClients = clients;

  // Drafts live client-side; the search box filters them here while keeping
  // the original draft index so selection/removal stays aligned.
  const visibleDrafts = useMemo(() => {
    const indexed = drafts.map((draft, index) => ({ draft, index }));
    if (!debouncedSearch) return indexed;
    return indexed.filter(({ draft }) => {
      const name = `${draft.given_name ?? ''} ${draft.surname ?? ''}`.toLowerCase();
      const office = String(draft.appointment_provider_name ?? '').toLowerCase();
      return name.includes(debouncedSearch) || office.includes(debouncedSearch);
    });
  }, [drafts, debouncedSearch]);

  const selectedClients = filteredClients.filter((c) => selected.has(c.id));
  const selectedDrafts = drafts.filter((_, index) => selected.has(index));

  const toggleSelect = (id: number) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    if (selected.size === filteredClients.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(filteredClients.map((c) => c.id)));
    }
  };

  const toggleAllDrafts = () => {
    if (selected.size === drafts.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(drafts.map((_, index) => index)));
    }
  };

  const handleSubmit = async () => {
    if (selectedDrafts.length === 0) return;
    setPendingSubmitIds(new Set(selected));
    await startSubmitMutation.mutateAsync();
  };

  const handleBook = async () => {
    const bookable = selectedClients.filter((c) => c.can_book);
    if (bookable.length === 0) return;
    setPendingBookIds(new Set(bookable.map((c) => c.id)));
    await startBookMutation.mutateAsync({
      client_ids: bookable.map((c) => c.id),
      idempotency_key: crypto.randomUUID(),
    });
  };

  const tabs = [
    { key: 'generated' as LabTab, label: 'Generated', icon: FlaskConical },
    { key: 'submitted' as LabTab, label: 'Submitted', icon: ListOrdered },
    { key: 'booked' as LabTab, label: 'Booked', icon: BookOpen },
    { key: 'watchers' as LabTab, label: 'Watchers', icon: Clock },
    { key: 'history' as LabTab, label: 'History', icon: History },
  ];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Booking Lab"
        description="Generate demo clients, submit them, and book appointments in a safe test environment."
        actions={
          <Button onClick={() => setGenerateOpen(true)}>
            <FlaskConical className="mr-2 h-4 w-4" />
            Generate demo clients
          </Button>
        }
      />

      {summary && (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
          <SummaryCard label="Generated drafts" value={drafts.length} icon={Inbox} />
          <SummaryCard label="Submitted" value={summary.submitted} icon={CheckCircle2} tone="bg-blue-50" />
          <SummaryCard label="Booked" value={summary.booked} icon={BookOpen} tone="bg-green-50" />
          <SummaryCard label="Failed" value={summary.failed} icon={XCircle} tone="bg-red-50" />
          <SummaryCard label="Watchers" value={summary.watchers} icon={Users} tone="bg-purple-50" />
        </div>
      )}

      <div className="flex items-center gap-2 border-b border-slate-200">
        {tabs.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            role="tab"
            aria-selected={tab === key}
            className={`flex items-center gap-2 border-b-2 px-4 py-2 text-sm font-medium transition-colors ${
              tab === key
                ? 'border-primary text-primary'
                : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
            onClick={() => setParam('tab', key)}
          >
            <Icon className="h-4 w-4" />
            {label}
          </button>
        ))}
      </div>

      <div className="flex flex-col gap-3 rounded-lg border border-slate-200 bg-white p-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <Input
            className="pl-9"
            placeholder="Search clients..."
            value={search}
            onChange={(e) => setParam('q', e.target.value)}
          />
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          {(tab === 'submitted' || tab === 'booked') && (
            <Select
              className="w-40"
              ariaLabel="Status"
              value={statusFilter || 'all'}
              onValueChange={(value) => setParam('status', value === 'all' ? '' : value)}
              options={[
                { value: 'all', label: 'All statuses' },
                { value: 'submitted', label: 'Submitted' },
                { value: 'booked', label: 'Booked' },
                { value: 'failed', label: 'Failed' },
                { value: 'cancelled', label: 'Cancelled' },
              ]}
            />
          )}
          {isStaff && (tab === 'submitted' || tab === 'booked' || tab === 'history') && (
            <Select
              className="w-40"
              ariaLabel="Owner"
              value={ownerFilter || 'all'}
              onValueChange={(value) => setParam('owner', value === 'all' ? '' : value)}
              options={[
                { value: 'all', label: 'All users' },
                { value: 'me', label: 'My records' },
              ]}
            />
          )}
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              void queryClient.invalidateQueries({ queryKey: ['lab-clients'] });
              void queryClient.invalidateQueries({ queryKey: queryKeys.labSummary });
              void queryClient.invalidateQueries({ queryKey: ['lab-history'] });
              void queryClient.invalidateQueries({ queryKey: queryKeys.watchers });
            }}
          >
            <RefreshCw className="mr-2 h-4 w-4" />
            Refresh
          </Button>
        </div>
      </div>

      {tab === 'generated' && (
        <Card>
          <CardHeader title="Generated demo clients" />
          <CardBody>
            {drafts.length === 0 ? (
              <EmptyState
                icon={Inbox}
                title="No generated clients"
                description="Generate demo clients to get started."
                action={
                  <Button onClick={() => setGenerateOpen(true)}>
                    Generate demo clients
                  </Button>
                }
              />
            ) : (
              <>
                <div className="mb-4 flex items-center gap-3">
                  <Checkbox
                    checked={selected.size === drafts.length && drafts.length > 0}
                    indeterminate={selected.size > 0 && selected.size < drafts.length}
                    onCheckedChange={toggleAllDrafts}
                    ariaLabel="Select all"
                  />
                  <span className="text-sm text-slate-600">
                    {selected.size} of {drafts.length} selected
                  </span>
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={selected.size === 0}
                    onClick={() => removeDrafts(selected)}
                  >
                    <Trash2 className="mr-2 h-4 w-4" />
                    Remove selected
                  </Button>
                  <Button
                    size="sm"
                    disabled={selected.size === 0 || pendingSubmitIds.size > 0}
                    loading={pendingSubmitIds.size > 0}
                    onClick={() => void handleSubmit()}
                  >
                    Submit for appointment
                  </Button>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-slate-200 text-left text-slate-500">
                        <th className="pb-2 pr-4" />
                        <th className="pb-2 pr-4">Name</th>
                        <th className="pb-2 pr-4">Type</th>
                        <th className="pb-2 pr-4">Office</th>
                        <th className="pb-2 pr-4">Status</th>
                        <th className="pb-2 pr-4 w-40">Progress</th>
                        <th className="pb-2" />
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {visibleDrafts.length === 0 ? (
                        <tr>
                          <td colSpan={7} className="py-6 text-center text-sm text-slate-500">
                            No generated clients match your search.
                          </td>
                        </tr>
                      ) : (
                        visibleDrafts.map(({ draft, index }) => (
                        <tr key={index} className="hover:bg-slate-50">
                          <td className="py-3 pr-4">
                            <Checkbox
                              checked={selected.has(index)}
                              onCheckedChange={() => toggleSelect(index)}
                              ariaLabel={`Select ${draft.given_name as string}`}
                            />
                          </td>
                          <td className="py-3 pr-4 font-medium text-slate-900">
                            {draft.given_name as string} {draft.surname as string}
                          </td>
                          <td className="py-3 pr-4 text-slate-600">
                            {applicationTypeLabel[draft.application_type as string] ?? (draft.application_type as string)}
                          </td>
                          <td className="py-3 pr-4 text-slate-600">{draft.appointment_provider_name as string}</td>
                          <td className="py-3 pr-4">
                            <Badge tone="gray">Not submitted</Badge>
                          </td>
                          <td className="py-3 pr-4 align-middle">
                            {pendingSubmitIds.has(index) ? (
                              <ProgressBar
                                value={stageProgress(
                                  activeJob?.kind === 'submit' ? jobQuery.data?.stages[index] : undefined,
                                )}
                              />
                            ) : null}
                          </td>
                          <td className="py-3">
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => removeDrafts(new Set([index]))}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </td>
                        </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </CardBody>
        </Card>
      )}

      {(tab === 'submitted' || tab === 'booked') && (
        <Card>
          <CardHeader
            title={tab === 'submitted' ? 'Submitted clients' : 'Booked appointments'}
          />
          <CardBody>
            {clientsQuery.isPending ? (
              <div className="space-y-3">
                {[1, 2, 3].map((i) => (
                  <Skeleton key={i} className="h-16 w-full" />
                ))}
              </div>
            ) : clientsQuery.isError ? (
              <EmptyState
                icon={XCircle}
                title="Could not load clients"
                description={describeError(
                  clientsQuery.error,
                  'There was an error loading the booking lab clients.',
                )}
                action={
                  <Button onClick={() => void clientsQuery.refetch()}>Retry</Button>
                }
              />
            ) : filteredClients.length === 0 ? (
              <EmptyState
                icon={Inbox}
                title={tab === 'submitted' ? 'No submitted clients' : 'No booked appointments'}
                description={
                  tab === 'submitted'
                    ? 'Generate and submit demo clients to see them here.'
                    : 'Book submitted clients to see appointments here.'
                }
              />
            ) : (
              <>
                <div className="mb-4 flex items-center gap-3">
                  <Checkbox
                    checked={selected.size === filteredClients.length && filteredClients.length > 0}
                    indeterminate={selected.size > 0 && selected.size < filteredClients.length}
                    onCheckedChange={toggleAll}
                    ariaLabel="Select all"
                  />
                  <span className="text-sm text-slate-600">
                    {selected.size} of {filteredClients.length} selected
                  </span>
                  {tab === 'submitted' && (
                    <Button
                      size="sm"
                      disabled={selected.size === 0 || pendingBookIds.size > 0}
                      loading={pendingBookIds.size > 0 || startBookMutation.isPending}
                      onClick={() => void handleBook()}
                    >
                      Book now
                    </Button>
                  )}
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-slate-200 text-left text-slate-500">
                        <th className="pb-2 pr-4" />
                        <th className="pb-2 pr-4">Name</th>
                        {isStaff && <th className="pb-2 pr-4">Owner</th>}
                        <th className="pb-2 pr-4">WPT ID</th>
                        <th className="pb-2 pr-4">Office</th>
                        <th className="pb-2 pr-4">Status</th>
                        <th className="pb-2 pr-4 w-40">Progress</th>
                        {tab === 'booked' && <th className="pb-2 pr-4">Appointment</th>}
                        <th className="pb-2" />
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {filteredClients.map((client) => (
                        <tr key={client.id} className="hover:bg-slate-50">
                          <td className="py-3 pr-4">
                            <Checkbox
                              checked={selected.has(client.id)}
                              onCheckedChange={() => toggleSelect(client.id)}
                              ariaLabel={`Select ${client.name}`}
                            />
                          </td>
                          <td className="py-3 pr-4 font-medium text-slate-900">{client.name}</td>
                          {isStaff && (
                            <td className="py-3 pr-4">
                              <Badge tone="blue">{client.owner}</Badge>
                            </td>
                          )}
                          <td className="py-3 pr-4 font-mono text-xs text-slate-600">
                            {client.official_application_id || '—'}
                          </td>
                          <td className="py-3 pr-4 text-slate-600">{client.provider_name}</td>
                          <td className="py-3 pr-4">
                            <Badge tone={statusTone[client.status] ?? 'gray'}>
                              {statusLabel[client.status] ?? client.status}
                            </Badge>
                          </td>
                          <td className="py-3 pr-4 align-middle">
                            {pendingBookIds.has(client.id) ? (
                              <ProgressBar
                                value={stageProgress(
                                  activeJob?.kind === 'book' ? jobQuery.data?.stages[client.id] : undefined,
                                )}
                              />
                            ) : null}
                          </td>
                          {tab === 'booked' && (
                            <td className="py-3 pr-4 text-slate-600">
                              {client.appointment_date && client.start_time
                                ? `${client.appointment_date} ${client.start_time}`
                                : '—'}
                            </td>
                          )}
                          <td className="py-3">
                            <div className="flex items-center gap-1">
                              {client.receipt_available && client.booking_id && (
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  title="Download receipt"
                                  onClick={() => setReceiptTarget(client)}
                                >
                                  <Download className="h-4 w-4" />
                                </Button>
                              )}
                              {client.can_cancel && client.booking_id && (
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  title="Cancel appointment"
                                  onClick={() => setCancelTarget(client)}
                                >
                                  <XCircle className="h-4 w-4 text-danger" />
                                </Button>
                              )}
                              {client.can_delete && (
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  title="Delete client"
                                  onClick={() => setDeleteTarget(client)}
                                >
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {clientsQuery.data && (
                  <Pagination
                    page={clientsQuery.data.page}
                    pageSize={clientsQuery.data.page_size}
                    total={clientsQuery.data.total}
                    onPageChange={(next) => setParam('page', String(next))}
                  />
                )}
              </>
            )}
          </CardBody>
        </Card>
      )}

      {tab === 'watchers' && (
        <Card>
          <CardHeader title="Lab watchers" />
          <CardBody>
            {watchersQuery.isPending ? (
              <div className="space-y-3">
                {[1, 2, 3].map((i) => (
                  <Skeleton key={i} className="h-12 w-full" />
                ))}
              </div>
            ) : watchersQuery.isError ? (
              <EmptyState
                icon={XCircle}
                title="Could not load watchers"
                description={describeError(
                  watchersQuery.error,
                  'There was an error loading the lab watchers.',
                )}
                action={
                  <Button onClick={() => void watchersQuery.refetch()}>Retry</Button>
                }
              />
            ) : labWatchers.length === 0 ? (
              <EmptyState
                icon={Clock}
                title="No lab watchers"
                description="Lab watchers are created when you book clients with watch mode. Use the regular Watchers page to manage them."
              />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 text-left text-slate-500">
                      <th className="pb-2 pr-4">Name</th>
                      <th className="pb-2 pr-4">Office</th>
                      <th className="pb-2 pr-4">Mode</th>
                      <th className="pb-2 pr-4">Status</th>
                      <th className="pb-2 pr-4">Slots found</th>
                      <th className="pb-2 pr-4">Last check</th>
                      <th className="pb-2">Error</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {labWatchers.map((watcher) => (
                      <tr key={watcher.id} className="hover:bg-slate-50">
                        <td className="py-3 pr-4 font-medium text-slate-900">{watcher.name}</td>
                        <td className="py-3 pr-4 text-slate-600">
                          {watcher.provider_name}
                          {watcher.district_name ? `, ${watcher.district_name}` : ''}
                        </td>
                        <td className="py-3 pr-4">
                          <Badge tone={watcher.mode === 'book' ? 'blue' : 'gray'}>
                            {watcher.mode === 'book' ? 'Auto-book' : 'Notify'}
                          </Badge>
                        </td>
                        <td className="py-3 pr-4">
                          <Badge tone={watcher.active ? 'green' : 'gray'}>
                            {watcher.active ? 'Active' : 'Paused'}
                          </Badge>
                        </td>
                        <td className="py-3 pr-4 text-slate-600">{watcher.available_slots.length}</td>
                        <td className="py-3 pr-4 text-slate-500">
                          {watcher.last_checked_at ? formatDateTime(watcher.last_checked_at) : '—'}
                        </td>
                        <td className="py-3 text-danger">{watcher.last_error || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardBody>
        </Card>
      )}

      {tab === 'history' && (
        <Card>
          <CardHeader title="Booking lab history" />
          <CardBody>
            {historyQuery.isPending ? (
              <div className="space-y-3">
                {[1, 2, 3].map((i) => (
                  <Skeleton key={i} className="h-12 w-full" />
                ))}
              </div>
            ) : historyQuery.isError ? (
              <EmptyState
                icon={XCircle}
                title="Could not load history"
                description={describeError(
                  historyQuery.error,
                  'There was an error loading the booking lab history.',
                )}
                action={
                  <Button onClick={() => void historyQuery.refetch()}>Retry</Button>
                }
              />
            ) : history.length === 0 ? (
              <EmptyState
                icon={History}
                title="No history"
                description="Booking lab activity will appear here."
              />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 text-left text-slate-500">
                      <th className="pb-2 pr-4">Client</th>
                      <th className="pb-2 pr-4">Owner</th>
                      <th className="pb-2 pr-4">Status</th>
                      <th className="pb-2 pr-4">Monitor</th>
                      <th className="pb-2 pr-4">Appointment</th>
                      <th className="pb-2 pr-4">Error</th>
                      <th className="pb-2">Time</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {history.map((item) => (
                      <tr key={item.id} className="hover:bg-slate-50">
                        <td className="py-3 pr-4 font-medium text-slate-900">{item.client_name}</td>
                        <td className="py-3 pr-4 text-slate-600">{item.owner}</td>
                        <td className="py-3 pr-4">
                          <Badge tone={statusTone[item.status] ?? 'gray'}>
                            {statusLabel[item.status] ?? item.status}
                          </Badge>
                        </td>
                        <td className="py-3 pr-4 text-slate-600">{item.monitor_name}</td>
                        <td className="py-3 pr-4 text-slate-600">
                          {item.appointment_date && item.start_time
                            ? `${item.appointment_date} ${item.start_time}`
                            : '—'}
                        </td>
                        <td className="py-3 pr-4 text-danger">{item.error || '—'}</td>
                        <td className="py-3 text-slate-500">{formatDateTime(item.created_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {historyQuery.data && (
                  <Pagination
                    page={historyQuery.data.page}
                    pageSize={historyQuery.data.page_size}
                    total={historyQuery.data.total}
                    onPageChange={(next) => setParam('page', String(next))}
                  />
                )}
              </div>
            )}
          </CardBody>
        </Card>
      )}

      <GenerateDialog
        open={generateOpen}
        onOpenChange={setGenerateOpen}
        onGenerate={(input) => generateMutation.mutate(input)}
        loading={generateMutation.isPending}
      />

      <ConfirmDialog
        open={!!cancelTarget}
        onOpenChange={(open) => !open && setCancelTarget(null)}
        title="Cancel appointment"
        description={`Cancel the appointment for ${cancelTarget?.name}? This will cancel the official booking and remove the receipt.`}
        confirmLabel="Cancel appointment"
        danger
        loading={cancelMutation.isPending}
        onConfirm={() => cancelTarget?.booking_id && cancelMutation.mutate(cancelTarget.booking_id)}
      />

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title="Delete client"
        description={`Delete ${deleteTarget?.name}? This will remove the local record.`}
        confirmLabel="Delete"
        danger
        loading={deleteMutation.isPending}
        onConfirm={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
      />

      <Dialog
        open={!!receiptTarget}
        onOpenChange={(open) => !open && setReceiptTarget(null)}
        title="Download receipt"
      >
        <div className="space-y-4">
          <p className="text-sm text-slate-600">
            Download the latest receipt for {receiptTarget?.name}?
          </p>
          <div className="flex justify-end gap-3">
            <Button variant="secondary" onClick={() => setReceiptTarget(null)}>
              Cancel
            </Button>
            <Button
              loading={receiptMutation.isPending}
              onClick={() => receiptTarget?.booking_id && receiptMutation.mutate(receiptTarget.booking_id)}
            >
              <Download className="mr-2 h-4 w-4" />
              Download
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}

function GenerateDialog({
  open,
  onOpenChange,
  onGenerate,
  loading,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onGenerate: (input: Parameters<typeof api.lab.generate>[0]) => void;
  loading: boolean;
}) {
  const [provinceId, setProvinceId] = useState('');
  const [districtId, setDistrictId] = useState('');
  const [providerId, setProviderId] = useState('');
  const [applicationType, setApplicationType] = useState('MIXED');
  const [count, setCount] = useState('5');

  const provincesQuery = useQuery({
    queryKey: ['locations', 'provinces'],
    queryFn: () => api.locations.list({ kind: 'provinces' }),
    enabled: open,
    staleTime: 300000,
  });

  const districtsQuery = useQuery({
    queryKey: ['locations', 'districts', provinceId],
    queryFn: () => api.locations.list({ kind: 'districts', parent: provinceId }),
    enabled: open && !!provinceId,
    staleTime: 300000,
  });

  const providersQuery = useQuery({
    queryKey: ['locations', 'providers', districtId],
    queryFn: () => api.locations.list({ kind: 'providers', parent: districtId }),
    enabled: open && !!districtId,
    staleTime: 300000,
  });

  const handleSubmit = () => {
    const provider = providersQuery.data?.find((p) => String(p.id) === providerId);
    if (!provider || !provinceId || !districtId || !providerId) return;
    onGenerate({
      province_id: provinceId,
      district_id: districtId,
      provider_id: Number(providerId),
      application_type: applicationType,
      count: parseInt(count, 10) || 1,
      idempotency_key: crypto.randomUUID(),
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Generate demo clients">
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="lab-province">Province</Label>
            <Select
              ariaLabel="Province"
              value={provinceId}
              onValueChange={(value) => {
                setProvinceId(value);
                setDistrictId('');
                setProviderId('');
              }}
              options={provincesQuery.data?.map((p) => ({ value: String(p.id), label: p.name })) ?? []}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="lab-district">District</Label>
            <Select
              ariaLabel="District"
              value={districtId}
              onValueChange={(value) => {
                setDistrictId(value);
                setProviderId('');
              }}
              options={districtsQuery.data?.map((d) => ({ value: String(d.id), label: d.name })) ?? []}
            />
          </div>
        </div>
        <div className="space-y-2">
          <Label htmlFor="lab-provider">Appointment office</Label>
          <Select
            ariaLabel="Appointment office"
            value={providerId}
            onValueChange={setProviderId}
            options={providersQuery.data?.map((p) => ({ value: String(p.id), label: p.name })) ?? []}
          />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="lab-type">Application type</Label>
            <Select
              ariaLabel="Application type"
              value={applicationType}
              onValueChange={setApplicationType}
              options={[
                { value: 'MIXED', label: 'Mixed — all types' },
                { value: 'NEW', label: 'First issuance (new)' },
                { value: 'RENEW', label: 'Passport renewal' },
                { value: 'REPLACE_LOST', label: 'Replacement (lost/stolen)' },
                { value: 'REPLACE_DAMAGED', label: 'Replacement (damaged)' },
                { value: 'MODIFICATION', label: 'Modification (data correction)' },
              ]}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="lab-count">Number of clients</Label>
            <Input
              id="lab-count"
              type="number"
              min={1}
              max={50}
              value={count}
              onChange={(e) => setCount(e.target.value)}
            />
          </div>
        </div>
        <div className="flex justify-end gap-3 pt-4">
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            loading={loading}
            disabled={!provinceId || !districtId || !providerId}
            onClick={handleSubmit}
          >
            Generate
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
