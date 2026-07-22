import { useQuery } from '@tanstack/react-query';
import { api } from '../api';
import { latinName } from '../lib/format';
import { Label } from './Label';
import { Select } from './Select';

export interface LocationSelection {
  provinceId: string;
  districtId: string;
  providerId: string;
  providerName: string;
  districtName: string;
}

export const emptyLocationSelection: LocationSelection = {
  provinceId: '',
  districtId: '',
  providerId: '',
  providerName: '',
  districtName: '',
};

interface LocationCascadeProps {
  /** Fetch only while the parent dialog is open. */
  enabled: boolean;
  value: LocationSelection;
  onChange: (next: LocationSelection) => void;
  /** Prefix for label htmlFor ids, so two cascades can coexist on one page. */
  idPrefix: string;
}

export function LocationCascade({ enabled, value, onChange, idPrefix }: LocationCascadeProps) {
  const provincesQuery = useQuery({
    queryKey: ['locations', 'provinces'],
    queryFn: () => api.locations.list({ kind: 'provinces' }),
    enabled,
    staleTime: 300000,
  });

  const districtsQuery = useQuery({
    queryKey: ['locations', 'districts', value.provinceId],
    queryFn: () => api.locations.list({ kind: 'districts', parent: value.provinceId }),
    enabled: enabled && value.provinceId !== '',
    staleTime: 300000,
  });

  const providersQuery = useQuery({
    queryKey: ['locations', 'providers', value.districtId],
    queryFn: () => api.locations.list({ kind: 'providers', parent: value.districtId }),
    enabled: enabled && value.districtId !== '',
    staleTime: 300000,
  });

  return (
    <>
      <div>
        <Label htmlFor={`${idPrefix}-province`}>Province</Label>
        <Select
          ariaLabel="Province"
          value={value.provinceId}
          onValueChange={(provinceId) =>
            onChange({ ...emptyLocationSelection, provinceId })
          }
          options={(provincesQuery.data ?? []).map((item) => ({
            value: String(item.id),
            label: latinName(item.name),
          }))}
          placeholder={provincesQuery.isPending ? 'Loading provinces…' : 'Select province'}
          disabled={provincesQuery.isPending}
        />
      </div>
      <div>
        <Label htmlFor={`${idPrefix}-district`}>District</Label>
        <Select
          ariaLabel="District"
          value={value.districtId}
          onValueChange={(districtId) => {
            const district = districtsQuery.data?.find((item) => String(item.id) === districtId);
            onChange({
              ...value,
              districtId,
              districtName: district ? latinName(district.name) : '',
              providerId: '',
              providerName: '',
            });
          }}
          options={(districtsQuery.data ?? []).map((item) => ({
            value: String(item.id),
            label: latinName(item.name),
          }))}
          placeholder={
            value.provinceId === ''
              ? 'Select a province first'
              : districtsQuery.isPending
                ? 'Loading districts…'
                : 'Select district'
          }
          disabled={value.provinceId === '' || districtsQuery.isPending}
        />
      </div>
      <div>
        <Label htmlFor={`${idPrefix}-provider`}>Office</Label>
        <Select
          ariaLabel="Office"
          value={value.providerId}
          onValueChange={(providerId) => {
            const provider = providersQuery.data?.find((item) => String(item.id) === providerId);
            onChange({ ...value, providerId, providerName: provider?.name ?? '' });
          }}
          options={(providersQuery.data ?? []).map((item) => ({
            value: String(item.id),
            label: item.name,
          }))}
          placeholder={
            value.districtId === ''
              ? 'Select a district first'
              : providersQuery.isPending
                ? 'Loading offices…'
                : 'Select office'
          }
          disabled={value.districtId === '' || providersQuery.isPending}
        />
      </div>
    </>
  );
}
