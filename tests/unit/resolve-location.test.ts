import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveProviderLocation } from '../../src/renderer/src/lib/resolve-location';

// resolve-location talks to window.desktop directly — stub it per test.
// The module caches per provider id, so each test uses unique ids.

const nepalCascade = new Map<string, { id: number | string; name: string }[]>([
  ['provinces:', [{ id: '226', name: 'Lumbini/लुम्बिनी' }]],
  ['districts:226', [{ id: '280', name: 'Rupandehi/रुपन्देही' }]],
  ['providers:280', [{ id: 501, name: 'Rupandehi' }]],
  ['providers:307', [{ id: 556, name: 'NE, Doha' }]],
]);

function installDesktop(watchers: Record<string, unknown>[] = []) {
  const locationsList = vi.fn((query: { kind: string; parent?: number | string }) => {
    const items = nepalCascade.get(`${query.kind}:${query.parent ?? ''}`);
    if (!items) return Promise.reject(new Error(`unexpected lookup ${query.kind}:${query.parent}`));
    return Promise.resolve(items);
  });
  (globalThis as Record<string, unknown>).window = {
    desktop: {
      watchers: { list: vi.fn().mockResolvedValue(watchers) },
      locations: { list: locationsList },
    },
  };
  return { locationsList };
}

describe('resolveProviderLocation', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('resolves a Nepal provider through the province/district cascade', async () => {
    installDesktop();
    const resolved = await resolveProviderLocation(501, 'Rupandehi');
    expect(resolved).toEqual({
      provider_id: 501,
      district_id: '280',
      province_id: '226',
      provider_name: 'Rupandehi',
    });
  });

  it('falls back to the foreign missions when the Nepal cascade misses', async () => {
    installDesktop();
    const resolved = await resolveProviderLocation(556, 'NE, Doha');
    expect(resolved).toEqual({
      provider_id: 556,
      district_id: '',
      province_id: '',
      provider_name: 'NE, Doha',
      country_id: '307',
      country_name: 'Other',
    });
  });

  it('prefers an existing watcher and carries its country fields', async () => {
    installDesktop([
      {
        provider_id: 557,
        district_id: '307',
        province_id: '',
        provider_name: 'NCG, Hong Kong',
        country_id: '307',
        country_name: 'Other',
      },
    ]);
    const resolved = await resolveProviderLocation(557, 'NCG, Hong Kong');
    expect(resolved).toMatchObject({ country_id: '307', country_name: 'Other' });
  });

  it('returns null when the provider is unknown everywhere', async () => {
    installDesktop();
    const resolved = await resolveProviderLocation(999, 'Nowhere');
    expect(resolved).toBeNull();
  });
});
