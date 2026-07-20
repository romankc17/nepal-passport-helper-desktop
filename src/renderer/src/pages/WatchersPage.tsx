import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Radar } from 'lucide-react';
import { useState } from 'react';
import type { WatcherMode } from '../../../shared/types';
import { api, queryKeys } from '../api';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { Dialog } from '../components/Dialog';
import { EmptyState } from '../components/EmptyState';
import { Input } from '../components/Input';
import { Label } from '../components/Label';
import { PageHeader } from '../components/PageHeader';
import { Select } from '../components/Select';
import { Skeleton } from '../components/Skeleton';
import { useToast } from '../components/Toast';
import { WatcherCard } from '../components/WatcherCard';
import { describeError } from '../lib/errors';
import { latinName } from '../lib/format';
import { useWatcherRuntime } from '../runtime';

export function WatchersPage() {
  const [addOpen, setAddOpen] = useState(false);
  const { refresh } = useWatcherRuntime();

  const watchersQuery = useQuery({
    queryKey: queryKeys.watchers,
    queryFn: () => api.watchers.list(),
    refetchInterval: 60000,
  });

  return (
    <div>
      <PageHeader
        title="Slot Watchers"
        description="Watchers poll government offices for open appointment slots"
        actions={
          <Button onClick={() => setAddOpen(true)}>
            <Plus className="h-4 w-4" aria-hidden="true" />
            Add watcher
          </Button>
        }
      />
      {watchersQuery.isPending ? (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 2xl:grid-cols-3">
          {[0, 1, 2].map((index) => (
            <Card key={index} className="p-5">
              <Skeleton className="mb-3 h-5 w-1/2" />
              <Skeleton className="mb-2 h-4 w-full" />
              <Skeleton className="h-4 w-2/3" />
            </Card>
          ))}
        </div>
      ) : watchersQuery.isError ? (
        <Card>
          <EmptyState
            icon={Radar}
            title="Could not load watchers"
            description={describeError(watchersQuery.error)}
            action={
              <Button variant="secondary" onClick={() => void watchersQuery.refetch()}>
                Retry
              </Button>
            }
          />
        </Card>
      ) : watchersQuery.data.length === 0 ? (
        <Card>
          <EmptyState
            icon={Radar}
            title="No watchers yet"
            description="Create a watcher for an office and it will poll for open slots — and book them automatically in auto-book mode."
            action={
              <Button onClick={() => setAddOpen(true)}>
                <Plus className="h-4 w-4" aria-hidden="true" />
                Add your first watcher
              </Button>
            }
          />
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 2xl:grid-cols-3">
          {watchersQuery.data.map((watcher) => (
            <WatcherCard key={watcher.id} watcher={watcher} />
          ))}
        </div>
      )}
      <AddWatcherDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        onCreated={async () => {
          await watchersQuery.refetch();
          await window.desktop.scheduler.sync();
          await refresh();
        }}
      />
    </div>
  );
}

interface AddWatcherDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => Promise<void>;
}

function AddWatcherDialog({ open, onOpenChange, onCreated }: AddWatcherDialogProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [provinceId, setProvinceId] = useState('');
  const [districtId, setDistrictId] = useState('');
  const [providerId, setProviderId] = useState('');
  const [mode, setMode] = useState<WatcherMode>('book');
  const [intervalSeconds, setIntervalSeconds] = useState('');
  const [daysAhead, setDaysAhead] = useState('');

  const settingsQuery = useQuery({
    queryKey: queryKeys.settings,
    queryFn: () => api.settings.get(),
    enabled: open,
  });

  const provincesQuery = useQuery({
    queryKey: ['locations', 'provinces'],
    queryFn: () => api.locations.list({ kind: 'provinces' }),
    enabled: open,
  });

  const districtsQuery = useQuery({
    queryKey: ['locations', 'districts', provinceId],
    queryFn: () => api.locations.list({ kind: 'districts', parent: provinceId }),
    enabled: open && provinceId !== '',
  });

  const providersQuery = useQuery({
    queryKey: ['locations', 'providers', districtId],
    queryFn: () => api.locations.list({ kind: 'providers', parent: districtId }),
    enabled: open && districtId !== '',
  });

  const effectiveInterval = intervalSeconds || String(settingsQuery.data?.defaultIntervalSeconds ?? 300);
  const effectiveDays = daysAhead || String(settingsQuery.data?.defaultDaysAhead ?? 14);

  const selectedProvider = providersQuery.data?.find(
    (provider) => String(provider.id) === providerId,
  );

  const createMutation = useMutation({
    mutationFn: () =>
      api.watchers.create({
        provider_id: providerId,
        district_id: districtId,
        province_id: provinceId,
        provider_name: selectedProvider?.name ?? '',
        mode,
        interval_seconds: Number(effectiveInterval),
        days_ahead: Number(effectiveDays),
      }),
    onSuccess: async () => {
      toast(`Watcher created · ${selectedProvider?.name ?? ''}`);
      onOpenChange(false);
      setProvinceId('');
      setDistrictId('');
      setProviderId('');
      await queryClient.invalidateQueries({ queryKey: queryKeys.watchers });
      await onCreated();
    },
    onError: (error) => toast(describeError(error, 'Could not create watcher'), 'error'),
  });

  const ready = provinceId !== '' && districtId !== '' && providerId !== '';

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Add watcher"
      description="Pick an office; the watcher starts polling immediately."
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={() => createMutation.mutate()}
            loading={createMutation.isPending}
            disabled={!ready}
          >
            Create watcher
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div>
          <Label htmlFor="add-province">Province</Label>
          <Select
            ariaLabel="Province"
            value={provinceId}
            onValueChange={(value) => {
              setProvinceId(value);
              setDistrictId('');
              setProviderId('');
            }}
            options={(provincesQuery.data ?? []).map((item) => ({
              value: String(item.id),
              label: latinName(item.name),
            }))}
            placeholder={provincesQuery.isPending ? 'Loading provinces…' : 'Select province'}
            disabled={provincesQuery.isPending}
          />
        </div>
        <div>
          <Label htmlFor="add-district">District</Label>
          <Select
            ariaLabel="District"
            value={districtId}
            onValueChange={(value) => {
              setDistrictId(value);
              setProviderId('');
            }}
            options={(districtsQuery.data ?? []).map((item) => ({
              value: String(item.id),
              label: latinName(item.name),
            }))}
            placeholder={
              provinceId === ''
                ? 'Select a province first'
                : districtsQuery.isPending
                  ? 'Loading districts…'
                  : 'Select district'
            }
            disabled={provinceId === '' || districtsQuery.isPending}
          />
        </div>
        <div>
          <Label htmlFor="add-provider">Office</Label>
          <Select
            ariaLabel="Office"
            value={providerId}
            onValueChange={setProviderId}
            options={(providersQuery.data ?? []).map((item) => ({
              value: String(item.id),
              label: item.name,
            }))}
            placeholder={
              districtId === ''
                ? 'Select a district first'
                : providersQuery.isPending
                  ? 'Loading offices…'
                  : 'Select office'
            }
            disabled={districtId === '' || providersQuery.isPending}
          />
        </div>
        <div>
          <Label htmlFor="add-mode">Mode</Label>
          <Select
            ariaLabel="Mode"
            value={mode}
            onValueChange={(value) => setMode(value as WatcherMode)}
            options={[
              { value: 'book', label: 'Watch & auto-book' },
              { value: 'notify', label: 'Watch & notify' },
            ]}
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label htmlFor="add-interval">Interval (seconds)</Label>
            <Input
              id="add-interval"
              type="number"
              min={30}
              placeholder={effectiveInterval}
              value={intervalSeconds}
              onChange={(event) => setIntervalSeconds(event.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="add-days">Days ahead</Label>
            <Input
              id="add-days"
              type="number"
              min={1}
              max={90}
              placeholder={effectiveDays}
              value={daysAhead}
              onChange={(event) => setDaysAhead(event.target.value)}
            />
          </div>
        </div>
      </div>
    </Dialog>
  );
}
