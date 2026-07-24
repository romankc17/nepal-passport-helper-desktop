import type {
  LocalWatcherSnapshot,
  Paged,
  SlotInfo,
  Watcher,
  WatcherCreateInput,
  WatcherDetail,
  WatcherHistoryItem,
  WatcherSettingsPatch,
} from '../shared/types';
import { COUNTRY_NEPAL_ID } from '../shared/types';
import type { StoredConfig } from './settings';
import type { JsonStore } from './store';

const SERVICE_ID = 41;

export class LocalWatcherStore {
  constructor(private readonly store: JsonStore<StoredConfig>) {}

  list(): Watcher[] {
    const ownerId = this.store.get().sessionSnapshot?.user.id;
    return this.snapshot().watchers.filter((watcher) => watcher.owner_id === ownerId);
  }

  get(id: number): Watcher {
    const watcher = this.list().find((item) => item.id === id);
    if (!watcher) throw new Error('Watcher not found');
    return watcher;
  }

  detail(id: number): WatcherDetail {
    return {
      watcher: this.get(id),
      matching_clients: [],
      priority_bookings: [],
      recent_bookings: [],
    };
  }

  create(input: WatcherCreateInput, defaults: { interval: number; days: number }): Watcher {
    const snapshot = this.snapshot();
    const now = new Date().toISOString();
    const watcher: Watcher = {
      id: Math.max(0, ...snapshot.watchers.map((item) => item.id)) + 1,
      owner_id: this.store.get().sessionSnapshot?.user.id,
      name: input.provider_name,
      mode: input.mode,
      country_id: input.country_id ?? COUNTRY_NEPAL_ID,
      country_name: input.country_name ?? 'Nepal',
      province_id: input.province_id,
      district_id: input.district_id,
      provider_id: input.provider_id,
      provider_name: input.provider_name,
      district_name: input.district_name ?? '',
      interval_seconds: input.interval_seconds ?? defaults.interval,
      days_ahead: input.days_ahead ?? defaults.days,
      desired_bookings: input.desired_bookings ?? (input.mode === 'book' ? 1 : 0),
      notify: input.notify ?? true,
      notification_email: input.notification_email ?? '',
      active: true,
      last_checked_at: null,
      next_check_due_at: now,
      last_error: '',
      available_slots: [],
      queued_count: 0,
      booked_count: 0,
      created_at: now,
    };
    snapshot.watchers.push(watcher);
    this.persist(snapshot);
    return watcher;
  }

  update(id: number, patch: WatcherSettingsPatch): Watcher {
    return this.change(id, (watcher) => {
      const updated = { ...watcher, ...patch };
      return patch.desired_bookings === undefined
        ? updated
        : { ...updated, active: watcher.booked_count < patch.desired_bookings };
    });
  }

  pause(id: number): Watcher {
    return this.change(id, (watcher) => ({ ...watcher, active: false, next_check_due_at: null }));
  }

  resume(id: number): Watcher {
    return this.change(id, (watcher) => ({ ...watcher, active: true }));
  }

  delete(id: number): void {
    const snapshot = this.snapshot();
    snapshot.watchers = snapshot.watchers.filter((item) => item.id !== id);
    delete snapshot.history[String(id)];
    this.persist(snapshot);
  }

  history(id: number, page = 1, pageSize = 25): Paged<WatcherHistoryItem> {
    this.get(id);
    const items = this.snapshot().history[String(id)] ?? [];
    const start = (page - 1) * pageSize;
    return {
      items: items.slice(start, start + pageSize),
      page,
      page_size: pageSize,
      total: items.length,
    };
  }

  recordCheck(id: number, slots: SlotInfo[], error = '', booked = 0): Watcher {
    const snapshot = this.snapshot();
    const index = snapshot.watchers.findIndex((item) => item.id === id);
    if (index < 0) throw new Error('Watcher not found');
    const now = new Date().toISOString();
    const watcher = snapshot.watchers[index];
    const nextBooked = watcher.booked_count + booked;
    const active =
      watcher.mode === 'book' && watcher.desired_bookings > 0 && nextBooked >= watcher.desired_bookings
        ? false
        : watcher.active;
    snapshot.watchers[index] = {
      ...watcher,
      active,
      last_checked_at: now,
      next_check_due_at: active
        ? new Date(Date.now() + watcher.interval_seconds * 1000).toISOString()
        : null,
      last_error: error,
      available_slots: slots,
      booked_count: nextBooked,
    };
    if (slots.length) {
      const history = snapshot.history[String(id)] ?? [];
      history.unshift({
        id: Date.now(),
        started_at: now,
        finished_at: now,
        success: !error,
        error: error || null,
        slots_found: slots.length,
        request: { executor: 'desktop', service_id: SERVICE_ID },
        response: { slotCount: slots.length },
      });
      snapshot.history[String(id)] = history.slice(0, 200);
    }
    this.persist(snapshot);
    return snapshot.watchers[index];
  }

  private change(id: number, update: (watcher: Watcher) => Watcher): Watcher {
    const snapshot = this.snapshot();
    const index = snapshot.watchers.findIndex((item) => item.id === id);
    if (index < 0) throw new Error('Watcher not found');
    snapshot.watchers[index] = update(snapshot.watchers[index]);
    this.persist(snapshot);
    return snapshot.watchers[index];
  }

  private snapshot(): LocalWatcherSnapshot {
    const value = this.store.get().watcherSnapshot;
    if (
      !value ||
      !Array.isArray(value.watchers) ||
      !value.history ||
      typeof value.history !== 'object' ||
      Array.isArray(value.history)
    ) {
      return { watchers: [], history: {} };
    }
    return structuredClone(value);
  }

  private persist(snapshot: LocalWatcherSnapshot): void {
    this.store.update({ watcherSnapshot: snapshot });
  }
}
