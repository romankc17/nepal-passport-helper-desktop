import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Radar, Star, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { FavoriteLocation } from '../../../shared/types';
import { api, queryKeys } from '../api';
import { describeError } from '../lib/errors';
import { Button } from './Button';
import { Card, CardBody, CardHeader } from './Card';
import { Dialog } from './Dialog';
import {
  emptyLocationSelection,
  LocationCascade,
  type LocationSelection,
} from './LocationCascade';
import { Skeleton } from './Skeleton';
import { useToast } from './Toast';

export function FavoriteLocationsCard() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [addOpen, setAddOpen] = useState(false);

  const preferencesQuery = useQuery({
    queryKey: queryKeys.preferences,
    queryFn: () => api.preferences.get(),
    staleTime: 60000,
  });
  const favorites = preferencesQuery.data?.favorite_locations ?? [];

  const updateMutation = useMutation({
    mutationFn: (next: FavoriteLocation[]) =>
      api.preferences.update({ favorite_locations: next }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: queryKeys.preferences }),
    onError: (error) => toast(describeError(error, 'Could not update favorites'), 'error'),
  });

  const removeFavorite = (index: number) => {
    const removed = favorites[index];
    updateMutation.mutate(favorites.filter((_, i) => i !== index));
    if (removed) toast(`Favorite removed · ${removed.provider_name}`);
  };

  return (
    <Card>
      <CardHeader
        title="Favorite locations"
        action={
          <Button variant="ghost" size="sm" onClick={() => setAddOpen(true)}>
            <Plus className="h-4 w-4" aria-hidden="true" />
            Add favorite
          </Button>
        }
      />
      <CardBody>
        {preferencesQuery.isPending ? (
          <div className="flex flex-col gap-2">
            <Skeleton className="h-5 w-full" />
            <Skeleton className="h-5 w-2/3" />
          </div>
        ) : favorites.length === 0 ? (
          <p className="text-sm text-slate-400">
            No favorites yet — save the offices you check often and start a watcher for them in
            one click.
          </p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {favorites.map((favorite, index) => (
              <li
                key={`${favorite.provider_id}-${index}`}
                className="flex items-center justify-between gap-4 py-2"
              >
                <span className="flex min-w-0 items-center gap-2">
                  <Star
                    className="h-4 w-4 shrink-0 fill-amber text-amber"
                    aria-hidden="true"
                  />
                  <span className="truncate text-sm text-slate-700">
                    {favorite.provider_name}
                    {favorite.district_name && (
                      <span className="text-slate-400"> · {favorite.district_name}</span>
                    )}
                  </span>
                </span>
                <span className="flex shrink-0 items-center gap-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => navigate('/watchers', { state: { prefill: favorite } })}
                    aria-label={`Add watcher for ${favorite.provider_name}`}
                  >
                    <Radar className="h-4 w-4" aria-hidden="true" />
                    Add watcher
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => removeFavorite(index)}
                    aria-label={`Remove favorite ${favorite.provider_name}`}
                  >
                    <Trash2 className="h-4 w-4 text-danger" aria-hidden="true" />
                  </Button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardBody>
      <AddFavoriteDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        favorites={favorites}
        onSave={(next) => updateMutation.mutate(next)}
        saving={updateMutation.isPending}
      />
    </Card>
  );
}

interface AddFavoriteDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  favorites: FavoriteLocation[];
  onSave: (next: FavoriteLocation[]) => void;
  saving: boolean;
}

function AddFavoriteDialog({ open, onOpenChange, favorites, onSave, saving }: AddFavoriteDialogProps) {
  const [selection, setSelection] = useState<LocationSelection>(emptyLocationSelection);

  const ready =
    selection.provinceId !== '' && selection.districtId !== '' && selection.providerId !== '';

  const save = () => {
    onSave([
      ...favorites,
      {
        provider_id: selection.providerId,
        provider_name: selection.providerName,
        district_id: selection.districtId,
        province_id: selection.provinceId,
        ...(selection.districtName ? { district_name: selection.districtName } : {}),
      },
    ]);
    setSelection(emptyLocationSelection);
    onOpenChange(false);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Add favorite location"
      description="Favorites let you start a watcher for a saved office in one click."
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={save} loading={saving} disabled={!ready}>
            Save favorite
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <LocationCascade
          enabled={open}
          value={selection}
          onChange={setSelection}
          idPrefix="favorite"
        />
      </div>
    </Dialog>
  );
}
