import {
  createContext,
  useCallback,
  useContext,
  useMemo,
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

let nextOperationId = 1;

// Persistent long-running operations (book-now runs, bulk queue). Lives above
// the router so the panel survives page navigation.
export function OperationsProvider({ children }: { children: ReactNode }) {
  const [operations, setOperations] = useState<Operation[]>([]);

  const patchOperation = useCallback((id: string, patch: Partial<Operation>) => {
    setOperations((current) =>
      current.map((operation) => (operation.id === id ? { ...operation, ...patch } : operation)),
    );
  }, []);

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

      try {
        const result = await window.desktop.queue.bookNow(input);

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
        patchOperation(id, {
          status: 'failed',
          finishedAt: Date.now(),
          message: describeError(error, 'Book-now failed'),
        });
        throw error;
      }
    },
    [patchOperation],
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
            return { ...item, stage: queued ? 'queued' : 'skipped' };
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
