import { useIsFetching, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { OperationPanel } from './OperationPanel';
import { TopBar } from './TopBar';
import { useAuth } from '../auth';

function playBeep(): void {
  try {
    const AudioContextClass = window.AudioContext;
    const audioContext = new AudioContextClass();
    const oscillator = audioContext.createOscillator();
    const gain = audioContext.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.value = 880;
    gain.gain.setValueAtTime(0.08, audioContext.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, audioContext.currentTime + 0.4);
    oscillator.connect(gain);
    gain.connect(audioContext.destination);
    oscillator.start();
    oscillator.stop(audioContext.currentTime + 0.4);
    oscillator.onended = () => void audioContext.close();
  } catch {
    // Audio is best-effort; the native notification itself is already shown.
  }
}

const PAGE_QUERIES: Record<string, string[]> = {
  '/': ['overview', 'activity', 'watchers'],
  '/watchers': ['watchers', 'preferences'],
  '/queue': ['clients', 'watchers'],
  '/clients': ['clients', 'watchers'],
  '/booking-lab': ['lab-summary', 'lab-clients', 'lab-history', 'watchers'],
  '/appointments': ['appointments', 'clients', 'overview'],
  '/activity': ['activity'],
  '/settings': ['settings', 'preferences'],
};

export function AppLayout() {
  const { session, signOut, signingOut } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();

  const pageQueryKeys = useMemo(() => PAGE_QUERIES[location.pathname] ?? [], [location.pathname]);

  const isFetching = useIsFetching({
    predicate: (query) => pageQueryKeys.includes(String(query.queryKey[0])),
  }) > 0;

  useEffect(() => {
    const unsubscribeSound = window.desktop.on('play-sound', () => playBeep());
    const unsubscribeClick = window.desktop.on('notification-click', (payload) => {
      navigate(payload.route);
    });
    const unsubscribeAuth = window.desktop.on('auth-expired', () => {
      void signOut({ localOnly: true });
    });
    return () => {
      unsubscribeSound();
      unsubscribeClick();
      unsubscribeAuth();
    };
  }, [navigate, signOut]);

  const handleRefresh = () => {
    for (const key of pageQueryKeys) {
      void queryClient.invalidateQueries({ queryKey: [key] });
    }
  };

  return (
    <div className="flex h-full">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar
          userName={session?.user.username ?? ''}
          sessionOffline={session?.offline ?? false}
          onSignOut={() => void signOut()}
          signingOut={signingOut}
          onRefresh={handleRefresh}
          isFetching={isFetching}
        />
        <main className="flex-1 overflow-y-auto p-6">
          <Outlet />
        </main>
      </div>
      <OperationPanel />
    </div>
  );
}
