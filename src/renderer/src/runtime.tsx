import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { WatcherRuntime } from '../../shared/types';
import { useAuth } from './auth';

interface WatcherRuntimeContextValue {
  runtime: Map<number, WatcherRuntime>;
  refresh: () => Promise<void>;
}

const WatcherRuntimeContext = createContext<WatcherRuntimeContextValue | null>(null);

// Live scheduler runtime shared by every page: seeded from
// scheduler.getRuntime() and kept current via watcher-state events.
export function WatcherRuntimeProvider({ children }: { children: ReactNode }) {
  const { session } = useAuth();
  const [runtime, setRuntime] = useState<Map<number, WatcherRuntime>>(new Map());

  const refresh = useCallback(async () => {
    try {
      const entries = await window.desktop.scheduler.getRuntime();
      setRuntime(new Map(entries.map((entry) => [entry.watcherId, entry])));
    } catch {
      // Runtime is best-effort; watcher cards fall back to server state.
    }
  }, []);

  useEffect(() => {
    if (!session) {
      setRuntime(new Map());
      return;
    }
    void refresh();
    const unsubscribe = window.desktop.on('watcher-state', (event) => {
      setRuntime((current) => {
        const next = new Map(current);
        next.set(event.watcherId, {
          watcherId: event.watcherId,
          state: event.state,
          nextRunAt: event.nextRunAt,
          lastResult: event.lastResult,
        });
        return next;
      });
    });
    return unsubscribe;
  }, [session, refresh]);

  const value = useMemo(() => ({ runtime, refresh }), [runtime, refresh]);
  return (
    <WatcherRuntimeContext.Provider value={value}>{children}</WatcherRuntimeContext.Provider>
  );
}

export function useWatcherRuntime(): WatcherRuntimeContextValue {
  const context = useContext(WatcherRuntimeContext);
  if (!context) {
    throw new Error('useWatcherRuntime must be used within a WatcherRuntimeProvider');
  }
  return context;
}
