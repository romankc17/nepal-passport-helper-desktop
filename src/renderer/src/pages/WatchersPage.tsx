import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Radar, Star } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import type { FavoriteLocation, WatcherMode } from '../../../shared/types';
import { COUNTRY_NEPAL_ID } from '../../../shared/types';
import { api, queryKeys } from '../api';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { Dialog } from '../components/Dialog';
import { EmptyState } from '../components/EmptyState';
import { Input } from '../components/Input';
import { Label } from '../components/Label';
import {
  emptyLocationSelection,
  LocationCascade,
  type LocationSelection,
} from '../components/LocationCascade';
import { PageHeader } from '../components/PageHeader';
import { Select } from '../components/Select';
import { Skeleton } from '../components/Skeleton';
import { useToast } from '../components/Toast';
import { WatcherCard } from '../components/WatcherCard';
import { describeError } from '../lib/errors';
import { useWatcherRuntime } from '../runtime';

export function WatchersPage() {
  const [addOpen, setAddOpen] = useState(false);
  const [prefill, setPrefill] = useState<FavoriteLocation | null>(null);
  const { refresh } = useWatcherRuntime();
  const location = useLocation();
  const navigate = useNavigate();

  // The overview favorites card navigates here with a favorite to prefill.
  useEffect(() => {
    const state = location.state as { prefill?: FavoriteLocation } | null;
    if (state?.prefill) {
      setPrefill(state.prefill);
      setAddOpen(true);
      navigate(location.pathname, { replace: true, state: null });
    }
  }, [location, navigate]);

  const watchersQuery = useQuery({
    queryKey: queryKeys.watchers,
    queryFn: () => api.watchers.list(),
    refetchInterval: 60000,
    staleTime: 60000,
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
        prefill={prefill}
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
  prefill?: FavoriteLocation | null;
}

function selectionFromFavorite(favorite: FavoriteLocation): LocationSelection {
  return {
    provinceId: String(favorite.province_id),
    districtId: String(favorite.district_id),
    providerId: String(favorite.provider_id),
    providerName: favorite.provider_name,
    districtName: favorite.district_name ?? '',
  };
}

function AddWatcherDialog({ open, onOpenChange, onCreated, prefill }: AddWatcherDialogProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [selection, setSelection] = useState<LocationSelection>(emptyLocationSelection);
  const [countryId, setCountryId] = useState<string>(COUNTRY_NEPAL_ID);
  const [favoriteKey, setFavoriteKey] = useState('');
  const [mode, setMode] = useState<WatcherMode>('book');
  const [intervalSeconds, setIntervalSeconds] = useState('');
  const [daysAhead, setDaysAhead] = useState('');
  const [notificationEmail, setNotificationEmail] = useState('');

  const settingsQuery = useQuery({
    queryKey: queryKeys.settings,
    queryFn: () => api.settings.get(),
    enabled: open,
    staleTime: 60000,
  });

  const preferencesQuery = useQuery({
    queryKey: queryKeys.preferences,
    queryFn: () => api.preferences.get(),
    enabled: open,
    staleTime: 60000,
  });
  const favorites = preferencesQuery.data?.favorite_locations ?? [];

  const countriesQuery = useQuery({
    queryKey: ['locations', 'countries'],
    queryFn: () => api.locations.list({ kind: 'countries' }),
    enabled: open,
    staleTime: 300000,
  });

  const isForeign = countryId !== COUNTRY_NEPAL_ID;

  // Foreign missions are providers whose parent is the "Other" country —
  // keyed by countryId so switching countries never shows a stale list.
  const missionsQuery = useQuery({
    queryKey: ['locations', 'providers', `country-${countryId}`],
    queryFn: () => api.locations.list({ kind: 'providers', parent: countryId }),
    enabled: open && isForeign,
    staleTime: 300000,
  });

  const countryName =
    countriesQuery.data?.find((item) => String(item.id) === countryId)?.name ??
    (isForeign ? 'Other' : 'Nepal');

  const handleCountryChange = (nextCountryId: string) => {
    setCountryId(nextCountryId);
    setSelection(emptyLocationSelection);
    setFavoriteKey('');
  };

  // Apply a prefill (from the overview favorites card) when the dialog opens.
  useEffect(() => {
    if (open && prefill) {
      setCountryId(COUNTRY_NEPAL_ID);
      setSelection(selectionFromFavorite(prefill));
      setFavoriteKey('');
    }
  }, [open, prefill]);

  const applyFavorite = (key: string) => {
    setFavoriteKey(key);
    const favorite = favorites[Number(key)];
    if (favorite) {
      setCountryId(COUNTRY_NEPAL_ID);
      setSelection(selectionFromFavorite(favorite));
    }
  };

  const handleSelectionChange = (next: LocationSelection) => {
    setFavoriteKey('');
    setSelection(next);
  };

  const effectiveInterval = intervalSeconds || String(settingsQuery.data?.defaultIntervalSeconds ?? 300);
  const effectiveDays = daysAhead || String(settingsQuery.data?.defaultDaysAhead ?? 14);

  const ready = isForeign
    ? selection.providerId !== ''
    : selection.provinceId !== '' && selection.districtId !== '' && selection.providerId !== '';
  const alreadyFavorite = favorites.some(
    (favorite) => String(favorite.provider_id) === selection.providerId,
  );

  const saveFavoriteMutation = useMutation({
    mutationFn: () =>
      api.preferences.update({
        favorite_locations: [
          ...favorites,
          {
            provider_id: selection.providerId,
            provider_name: selection.providerName,
            district_id: selection.districtId,
            province_id: selection.provinceId,
            ...(selection.districtName ? { district_name: selection.districtName } : {}),
          },
        ],
      }),
    onSuccess: () => {
      toast(`Favorite saved · ${selection.providerName}`);
      void queryClient.invalidateQueries({ queryKey: queryKeys.preferences });
    },
    onError: (error) => toast(describeError(error, 'Could not save favorite'), 'error'),
  });

  const createMutation = useMutation({
    mutationFn: () =>
      api.watchers.create({
        provider_id: selection.providerId,
        district_id: isForeign ? '' : selection.districtId,
        province_id: isForeign ? '' : selection.provinceId,
        provider_name: selection.providerName,
        country_id: countryId,
        country_name: countryName,
        mode,
        interval_seconds: Number(effectiveInterval),
        days_ahead: Number(effectiveDays),
        notification_email: notificationEmail.trim(),
      }),
    onSuccess: async () => {
      toast(`Watcher created · ${selection.providerName}`);
      onOpenChange(false);
      setSelection(emptyLocationSelection);
      setCountryId(COUNTRY_NEPAL_ID);
      setFavoriteKey('');
      setNotificationEmail('');
      await queryClient.invalidateQueries({ queryKey: queryKeys.watchers });
      await onCreated();
    },
    onError: (error) => toast(describeError(error, 'Could not create watcher'), 'error'),
  });

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
          <Label htmlFor="add-country">Country</Label>
          {countriesQuery.isError ? (
            <div className="flex items-center gap-2">
              <p className="text-xs text-danger">Could not load countries.</p>
              <Button variant="ghost" size="sm" onClick={() => void countriesQuery.refetch()}>
                Retry
              </Button>
            </div>
          ) : (
            <Select
              ariaLabel="Country"
              value={countryId}
              onValueChange={handleCountryChange}
              options={(countriesQuery.data ?? []).map((item) => ({
                value: String(item.id),
                label: item.name,
              }))}
              placeholder={countriesQuery.isPending ? 'Loading countries…' : 'Select country'}
              disabled={countriesQuery.isPending}
            />
          )}
        </div>
        {favorites.length > 0 && !isForeign && (
          <div>
            <Label htmlFor="add-favorite">Favorite</Label>
            <Select
              ariaLabel="Favorite location"
              value={favoriteKey}
              onValueChange={applyFavorite}
              options={favorites.map((favorite, index) => ({
                value: String(index),
                label: favorite.district_name
                  ? `${favorite.provider_name} · ${favorite.district_name}`
                  : favorite.provider_name,
              }))}
              placeholder="Custom location…"
            />
          </div>
        )}
        {isForeign ? (
          <div>
            <Label htmlFor="add-mission">Mission</Label>
            {missionsQuery.isError ? (
              <div className="flex items-center gap-2">
                <p className="text-xs text-danger">Could not load missions.</p>
                <Button variant="ghost" size="sm" onClick={() => void missionsQuery.refetch()}>
                  Retry
                </Button>
              </div>
            ) : (
              <Select
                ariaLabel="Mission"
                value={selection.providerId}
                onValueChange={(providerId) => {
                  const mission = missionsQuery.data?.find(
                    (item) => String(item.id) === providerId,
                  );
                  setFavoriteKey('');
                  setSelection({
                    ...emptyLocationSelection,
                    providerId,
                    providerName: mission?.name ?? '',
                  });
                }}
                options={(missionsQuery.data ?? []).map((item) => ({
                  value: String(item.id),
                  label: item.name,
                }))}
                placeholder={missionsQuery.isPending ? 'Loading missions…' : 'Select mission'}
                disabled={missionsQuery.isPending}
              />
            )}
          </div>
        ) : (
          <LocationCascade
            enabled={open}
            value={selection}
            onChange={handleSelectionChange}
            idPrefix="add"
          />
        )}
        {ready && !alreadyFavorite && !isForeign && (
          <div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => saveFavoriteMutation.mutate()}
              loading={saveFavoriteMutation.isPending}
            >
              <Star className="h-4 w-4" aria-hidden="true" />
              Save office as favorite
            </Button>
          </div>
        )}
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
        <div>
          <Label htmlFor="add-email">Alert email</Label>
          <Input
            id="add-email"
            type="email"
            placeholder="email@example.com"
            value={notificationEmail}
            onChange={(event) => setNotificationEmail(event.target.value)}
          />
          <p className="mt-1 text-xs text-slate-500">
            Leave blank to disable email alerts for this watcher.
          </p>
        </div>
      </div>
    </Dialog>
  );
}
