import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { LocalWatcherStore } from '../../src/main/local-watchers';
import { defaultStoredConfig, type StoredConfig } from '../../src/main/settings';
import { JsonStore } from '../../src/main/store';

const dirs: string[] = [];

function makeStore() {
  const dir = mkdtempSync(join(tmpdir(), 'local-watchers-'));
  dirs.push(dir);
  return new JsonStore<StoredConfig>(join(dir, 'config.json'), defaultStoredConfig);
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('LocalWatcherStore', () => {
  it('persists watcher state and history only in the device config', () => {
    const config = makeStore();
    const local = new LocalWatcherStore(config);
    const watcher = local.create({
      provider_id: 501,
      provider_name: 'Rupandehi',
      district_id: '280',
      district_name: 'Rupandehi',
      province_id: '226',
      mode: 'notify',
    }, { interval: 300, days: 14 });

    local.recordCheck(watcher.id, []);
    expect(local.history(watcher.id).items).toHaveLength(0);

    local.recordCheck(watcher.id, [
      { date: '2026-07-25', start_time: '10:00', end_time: '11:00' },
    ]);

    const reloaded = new LocalWatcherStore(config);
    expect(reloaded.list()).toHaveLength(1);
    expect(reloaded.list()[0].available_slots).toHaveLength(1);
    expect(reloaded.history(watcher.id).items[0].slots_found).toBe(1);
  });
});
