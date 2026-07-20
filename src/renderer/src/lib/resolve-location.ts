// ready-by-location groups carry only provider_id + names, but queue/book-now
// need province/district ids too. Resolve them via existing watchers first,
// otherwise by cascading the locations API. Results are cached per session.

export interface ResolvedLocation {
  provider_id: number | string;
  district_id: number | string;
  province_id: number | string;
  provider_name: string;
}

const cache = new Map<string, ResolvedLocation | null>();

export async function resolveProviderLocation(
  providerId: number | string,
  providerName: string,
): Promise<ResolvedLocation | null> {
  const key = String(providerId);
  if (cache.has(key)) return cache.get(key) ?? null;

  const resolved = await doResolve(providerId, providerName);
  cache.set(key, resolved);
  return resolved;
}

async function doResolve(
  providerId: number | string,
  providerName: string,
): Promise<ResolvedLocation | null> {
  const watchers = await window.desktop.watchers.list();
  const watcher = watchers.find((entry) => String(entry.provider_id) === String(providerId));
  if (watcher) {
    return {
      provider_id: watcher.provider_id,
      district_id: watcher.district_id,
      province_id: watcher.province_id,
      provider_name: watcher.provider_name,
    };
  }

  const provinces = await window.desktop.locations.list({ kind: 'provinces' });
  for (const province of provinces) {
    const districts = await window.desktop.locations.list({
      kind: 'districts',
      parent: province.id,
    });
    for (const district of districts) {
      const providers = await window.desktop.locations.list({
        kind: 'providers',
        parent: district.id,
      });
      const provider = providers.find((entry) => String(entry.id) === String(providerId));
      if (provider) {
        return {
          provider_id: provider.id,
          district_id: district.id,
          province_id: province.id,
          provider_name: provider.name || providerName,
        };
      }
    }
  }
  return null;
}
