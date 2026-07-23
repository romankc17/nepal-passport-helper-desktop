// In-memory session queue for local booking. Deliberately has no persistence:
// nothing here is written to disk or the backend DB, so the queue vanishes
// when the app closes and never syncs with the web app.

import type {
  LocalQueueItem,
  LocalQueueItemStatus,
  LocalQueueLocation,
} from '../shared/types';
import { COUNTRY_NEPAL_ID } from '../shared/types';

export function localQueueLocationKey(location: LocalQueueLocation): string {
  return `${location.country_id ?? COUNTRY_NEPAL_ID}:${location.provider_id}`;
}

export interface QueueSkip {
  client_id: number;
  reason: string;
}

// Pure data store; the engine drives status transitions and emits events.
export class LocalQueueStore {
  private readonly items = new Map<number, LocalQueueItem>();

  /** Add an item; clients already queued (any location) are skipped. */
  add(item: Omit<LocalQueueItem, 'added_at' | 'status'>, now: number): QueueSkip | null {
    if (this.items.has(item.client_id)) {
      return { client_id: item.client_id, reason: 'already_queued' };
    }
    this.items.set(item.client_id, { ...item, added_at: now, status: 'queued' });
    return null;
  }

  remove(clientIds: number[]): number[] {
    const removed: number[] = [];
    for (const id of clientIds) {
      if (this.items.delete(id)) removed.push(id);
    }
    return removed;
  }

  clear(): void {
    this.items.clear();
  }

  get(clientId: number): LocalQueueItem | undefined {
    return this.items.get(clientId);
  }

  update(
    clientId: number,
    patch: Partial<Pick<LocalQueueItem, 'status' | 'error' | 'appointment' | 'official_application_id' | 'permanent'>>,
  ): LocalQueueItem | undefined {
    const item = this.items.get(clientId);
    if (!item) return undefined;
    Object.assign(item, patch);
    return item;
  }

  setStatus(clientId: number, status: LocalQueueItemStatus, error?: string): void {
    this.update(clientId, { status, error });
  }

  all(): LocalQueueItem[] {
    return [...this.items.values()].sort((a, b) => a.added_at - b.added_at);
  }

  /** Items of one location, FIFO order. */
  forLocation(location: LocalQueueLocation): LocalQueueItem[] {
    const key = localQueueLocationKey(location);
    return this.all().filter((item) => localQueueLocationKey(item.location) === key);
  }

  forProvider(providerId: number | string): LocalQueueItem[] {
    return this.all().filter((item) => String(item.location.provider_id) === String(providerId));
  }

  /** Location keys that currently hold at least one item. */
  locations(): { key: string; location: LocalQueueLocation }[] {
    const seen = new Map<string, LocalQueueLocation>();
    for (const item of this.items.values()) {
      const key = localQueueLocationKey(item.location);
      if (!seen.has(key)) seen.set(key, item.location);
    }
    return [...seen.entries()].map(([key, location]) => ({ key, location }));
  }

  get size(): number {
    return this.items.size;
  }
}
