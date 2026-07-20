import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { BookNowInput, BookNowResult, QueueAddInput, QueueAddResult } from '../../shared/types';
import { describeError } from './lib/errors';

export type OperationItemStage =
  | 'submitting'
  | 'booking'
  | 'booked'
  | 'queued'
  | 'failed'
  | 'skipped';

export interface OperationItem {
  clientId: number;
  clientName: string;
  bookingId?: number;
  stage: OperationItemStage;
  message?: string;
  code?: string;
}

export interface Operation {
  id: string;
  kind: 'book-now' | 'queue';
  title: string;
  status: 'running' | 'done' | 'failed';
  items: OperationItem[];
  startedAt: number;
  finishedAt?: number;
  message?: string;
}

interface OperationsContextValue {
  operations: Operation[];
  startBookNow: (input: BookNowInput, clientNames: Map<number, string>) => Promise<BookNowResult>;
  startQueue: (input: QueueAddInput, clientNames: Map<number, string>) => Promise<QueueAddResult>;
  dismissOperation: (id: string) => void;
}

const OperationsContext = createContext<OperationsContextValue | null>(null);

const PROGRESS_POLL_MS = 2000;
let nextOperationId = 1;

// Persistent long-running operations (book-now runs, bulk queue). Lives above
// the router so the panel survives page navigation.
export function OperationsProvider({ children }: { children: ReactNode }) {
  const [operations, setOperations] = useState<Operation[]>([]);
  const operationsRef = useRef(operations);
  operationsRef.current = operations;

  const patchOperation = useCallback((id: string, patch: Partial<Operation>) => {
    setOperations((current) =>
      current.map((operation) => (operation.id === id ? { ...operation, ...patch } : operation)),
    );
  }, []);

  const patchItem = useCallback(
    (id: string, bookingId: number, patch: Partial<OperationItem>) => {
      const operation = operationsRef.current.find((entry) => entry.id === id);
      if (!operation) return;
      patchOperation(id, {
        items: operation.items.map((item) =>
          item.bookingId === bookingId ? { ...item, ...patch } : item,
        ),
      });
    },
    [patchOperation],
  );

  const pollProgress = useCallback(
    (operationId: string, bookingIds: number[], done: () => boolean) => {
      const timer = window.setInterval(() => {
        if (done()) {
          window.clearInterval(timer);
          return;
        }
        window.desktop.queue
          .progress(bookingIds)
          .then((items) => {
            for (const item of items) {
              if (!item.stage) continue;
              patchItem(operationId, item.booking_id, {
                stage: item.stage === 'failed' ? 'failed' : item.stage,
              });
            }
          })
          .catch(() => {
            // Progress polling is best-effort; the request itself decides.
          });
      }, PROGRESS_POLL_MS);
      return () => window.clearInterval(timer);
    },
    [patchItem],
  );

  const startBookNow = useCallback(
    async (input: BookNowInput, clientNames: Map<number, string>): Promise<BookNowResult> => {
      const id = `op-${nextOperationId++}`;
      const operation: Operation = {
        id,
        kind: 'book-now',
        title: `Check & book · ${input.provider_name}`,
        status: 'running',
        startedAt: Date.now(),
        items: input.client_ids.map((clientId) => ({
          clientId,
          clientName: clientNames.get(clientId) ?? `Client #${clientId}`,
          stage: 'submitting',
        })),
      };
      setOperations((current) => [...current, operation]);

      // Queue first so we know the booking ids and can poll live per-client
      // stages while the forced check runs. The queue call gets a derived key —
      // reusing the exact book-now key would let the server return the queue
      // response for the book-now call (idempotency is per key).
      let bookingIds: number[] = [];
      try {
        const queued = await window.desktop.queue.add({
          ...input,
          idempotency_key: `${input.idempotency_key}:queue`,
        });
        bookingIds = queued.queued.map((entry) => entry.booking_id);
        const byClient = new Map(queued.queued.map((entry) => [entry.client_id, entry.booking_id]));
        patchOperation(id, {
          items: operation.items.map((item) => ({ ...item, bookingId: byClient.get(item.clientId) })),
        });
      } catch {
        // If queueing itself fails, bookNow will surface the real error.
      }

      let finished = false;
      const stopPolling =
        bookingIds.length > 0 ? pollProgress(id, bookingIds, () => finished) : () => undefined;

      try {
        const result = await window.desktop.queue.bookNow(input);
        finished = true;
        stopPolling();

        const finalItems = result.results.map((entry) => ({
          clientId: entry.client_id,
          clientName: clientNames.get(entry.client_id) ?? `Client #${entry.client_id}`,
          bookingId: entry.booking_id,
          stage: entry.outcome as OperationItemStage,
          message:
            entry.outcome === 'queued'
              ? 'No slot available — client stays queued and the watcher keeps trying.'
              : entry.error,
        }));
        const anyFailed = result.results.some((entry) => entry.outcome === 'failed');
        patchOperation(id, {
          status: anyFailed ? 'failed' : 'done',
          items: finalItems,
          finishedAt: Date.now(),
        });
        return result;
      } catch (error) {
        finished = true;
        stopPolling();
        patchOperation(id, {
          status: 'failed',
          finishedAt: Date.now(),
          message: describeError(error, 'Book-now failed'),
        });
        throw error;
      }
    },
    [patchOperation, pollProgress],
  );

  const startQueue = useCallback(
    async (input: QueueAddInput, clientNames: Map<number, string>): Promise<QueueAddResult> => {
      const id = `op-${nextOperationId++}`;
      const operation: Operation = {
        id,
        kind: 'queue',
        title: `Queue clients · ${input.provider_name}`,
        status: 'running',
        startedAt: Date.now(),
        items: input.client_ids.map((clientId) => ({
          clientId,
          clientName: clientNames.get(clientId) ?? `Client #${clientId}`,
          stage: 'submitting',
        })),
      };
      setOperations((current) => [...current, operation]);

      try {
        const result = await window.desktop.queue.add(input);
        const skippedByClient = new Map(result.skipped.map((entry) => [entry.client_id, entry]));
        const queuedByClient = new Map(result.queued.map((entry) => [entry.client_id, entry]));
        patchOperation(id, {
          status: 'done',
          finishedAt: Date.now(),
          items: operation.items.map((item) => {
            const skipped = skippedByClient.get(item.clientId);
            if (skipped) return { ...item, stage: 'skipped', message: skipped.reason };
            const queued = queuedByClient.get(item.clientId);
            return { ...item, stage: 'queued', bookingId: queued?.booking_id };
          }),
        });
        return result;
      } catch (error) {
        patchOperation(id, {
          status: 'failed',
          finishedAt: Date.now(),
          message: describeError(error, 'Queueing failed'),
        });
        throw error;
      }
    },
    [patchOperation],
  );

  const dismissOperation = useCallback((id: string) => {
    setOperations((current) => current.filter((operation) => operation.id !== id));
  }, []);

  const value = useMemo(
    () => ({ operations, startBookNow, startQueue, dismissOperation }),
    [operations, startBookNow, startQueue, dismissOperation],
  );

  return <OperationsContext.Provider value={value}>{children}</OperationsContext.Provider>;
}

export function useOperations(): OperationsContextValue {
  const context = useContext(OperationsContext);
  if (!context) {
    throw new Error('useOperations must be used within an OperationsProvider');
  }
  return context;
}
