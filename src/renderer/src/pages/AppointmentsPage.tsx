import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarCheck, Download, RefreshCw } from 'lucide-react';
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { AppointmentStatus } from '../../../shared/types';
import { api, queryKeys } from '../api';
import { Badge } from '../components/Badge';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { EmptyState } from '../components/EmptyState';
import { PageHeader } from '../components/PageHeader';
import { Pagination } from '../components/Pagination';
import { Skeleton } from '../components/Skeleton';
import { useToast } from '../components/Toast';
import { describeError } from '../lib/errors';
import { foreignCountry, formatDateTime } from '../lib/format';
import { cn } from '../lib/utils';

const tabs: { value: AppointmentStatus; label: string }[] = [
  { value: 'booked', label: 'Booked' },
  { value: 'cancelled', label: 'Cancelled' },
];

export function AppointmentsPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();

  const tab = (searchParams.get('tab') as AppointmentStatus) || 'booked';
  const page = Number(searchParams.get('page') ?? '1') || 1;
  const [savingReceiptFor, setSavingReceiptFor] = useState<number | null>(null);

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

  const appointmentsQuery = useQuery({
    queryKey: queryKeys.appointments({ status: tab, page }),
    queryFn: () => api.appointments.list({ status: tab, page }),
    // Watchers book in the background — always refetch on mount.
    staleTime: 0,
  });

  const invalidate = async () => {
    await queryClient.invalidateQueries({ queryKey: ['appointments'] });
    await queryClient.invalidateQueries({ queryKey: ['clients'] });
    await queryClient.invalidateQueries({ queryKey: queryKeys.overview });
  };

  const reconcileMutation = useMutation({
    mutationFn: () => api.appointments.reconcile(),
    onSuccess: async (result) => {
      toast(
        result.healed.length > 0
          ? `Reconciled ${result.healed.length} appointment${result.healed.length === 1 ? '' : 's'} from official records`
          : 'Reconcile complete — nothing new found',
      );
      await invalidate();
    },
    onError: (error) => toast(describeError(error, 'Reconcile failed'), 'error'),
  });

  const saveReceipt = async (bookingId: number, clientName: string) => {
    setSavingReceiptFor(bookingId);
    try {
      const safeName = clientName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      const result = await window.desktop.appointments.saveReceipt(
        bookingId,
        `receipt-${bookingId}-${safeName || 'client'}.pdf`,
      );
      if (result.saved) {
        toast(`Receipt saved to ${result.path}`);
      }
    } catch (error) {
      toast(describeError(error, 'Could not save receipt'), 'error');
    } finally {
      setSavingReceiptFor(null);
    }
  };

  return (
    <div>
      <PageHeader
        title="Appointments"
        description="Booked and cancelled appointments"
        actions={
          <Button
            variant="secondary"
            onClick={() => reconcileMutation.mutate()}
            loading={reconcileMutation.isPending}
          >
            <RefreshCw className="h-4 w-4" aria-hidden="true" />
            Reconcile with official records
          </Button>
        }
      />

      <div role="tablist" aria-label="Appointment status" className="mb-4 flex gap-1">
        {tabs.map((entry) => (
          <button
            key={entry.value}
            role="tab"
            aria-selected={tab === entry.value}
            onClick={() => setParam('tab', entry.value)}
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

      <Card>
        {appointmentsQuery.isPending ? (
          <div className="flex flex-col gap-3 p-5">
            {[0, 1, 2].map((index) => (
              <Skeleton key={index} className="h-6 w-full" />
            ))}
          </div>
        ) : appointmentsQuery.isError ? (
          <EmptyState
            icon={CalendarCheck}
            title="Could not load appointments"
            description={describeError(appointmentsQuery.error)}
            action={
              <Button variant="secondary" onClick={() => void appointmentsQuery.refetch()}>
                Retry
              </Button>
            }
          />
        ) : appointmentsQuery.data.items.length === 0 ? (
          <EmptyState
            icon={CalendarCheck}
            title={tab === 'booked' ? 'No booked appointments' : 'No cancelled appointments'}
            description={
              tab === 'booked'
                ? 'Appointments appear here as watchers book them.'
                : 'Cancelled appointments appear here.'
            }
          />
        ) : (
          <>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-left text-xs text-slate-400">
                  <th className="px-5 py-3 font-medium">Client</th>
                  <th className="px-3 py-3 font-medium">Application ID</th>
                  <th className="px-3 py-3 font-medium">Code</th>
                  <th className="px-3 py-3 font-medium">Office</th>
                  <th className="px-3 py-3 font-medium">Date</th>
                  <th className="px-3 py-3 font-medium">Time</th>
                  <th className="px-3 py-3 font-medium">Booked at</th>
                  <th className="px-3 py-3 font-medium">Source</th>
                  <th className="px-3 py-3 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {appointmentsQuery.data.items.map((appointment) => (
                  <tr key={appointment.booking_id} className="border-b border-slate-50">
                    <td className="px-5 py-3 font-medium text-slate-800">
                      {appointment.client_name}
                    </td>
                    <td className="px-3 py-3 font-mono text-xs text-slate-500">
                      {appointment.official_application_id || '—'}
                    </td>
                    <td className="px-3 py-3 font-mono text-xs text-slate-500">
                      {appointment.appointment_code}
                    </td>
                    <td className="px-3 py-3 text-slate-600">
                      {appointment.provider_name}
                      {foreignCountry(appointment.country_name) && (
                        <span className="text-xs text-slate-400">
                          {' '}
                          · {foreignCountry(appointment.country_name)}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-3 text-slate-600">{appointment.date}</td>
                    <td className="px-3 py-3 text-slate-600">
                      {appointment.start_time.slice(0, 5)}
                    </td>
                    <td className="px-3 py-3 text-xs text-slate-500">
                      {formatDateTime(appointment.booked_at)}
                    </td>
                    <td className="px-3 py-3">
                      {appointment.booked_by_system ? (
                        <Badge tone="blue">auto</Badge>
                      ) : (
                        <Badge tone="gray">manual</Badge>
                      )}
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex items-center justify-end gap-1">
                        {tab === 'booked' && appointment.receipt_available && (
                          <Button
                            size="sm"
                            variant="ghost"
                            loading={savingReceiptFor === appointment.booking_id}
                            onClick={() =>
                              void saveReceipt(appointment.booking_id, appointment.client_name)
                            }
                            aria-label={`Download receipt for ${appointment.client_name}`}
                          >
                            <Download className="h-3.5 w-3.5" aria-hidden="true" />
                            Receipt
                          </Button>
                        )}
                        {tab === 'booked' && (
                          <a
                            href={appointment.edit_url}
                            target="_blank"
                            rel="noreferrer"
                            aria-label={`Delete booking and edit ${appointment.client_name}`}
                            className="inline-flex h-8 items-center rounded-md px-3 text-xs font-medium text-danger transition-colors hover:bg-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
                          >
                            Delete booking &amp; Edit
                          </a>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <Pagination
              page={appointmentsQuery.data.page}
              pageSize={appointmentsQuery.data.page_size}
              total={appointmentsQuery.data.total}
              onPageChange={(next) => setParam('page', String(next))}
            />
          </>
        )}
      </Card>
    </div>
  );
}
