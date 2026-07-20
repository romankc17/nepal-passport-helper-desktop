import { useEffect } from 'react';
import { Outlet, useNavigate } from 'react-router-dom';
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

export function AppLayout() {
  const { session, signOut, signingOut } = useAuth();
  const navigate = useNavigate();

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

  return (
    <div className="flex h-full">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar
          userName={session?.user.username ?? ''}
          sessionOffline={session?.offline ?? false}
          onSignOut={() => void signOut()}
          signingOut={signingOut}
        />
        <main className="flex-1 overflow-y-auto p-6">
          <Outlet />
        </main>
      </div>
      <OperationPanel />
    </div>
  );
}
