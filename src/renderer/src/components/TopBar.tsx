import { LogOut } from 'lucide-react';
import { useEffect, useState } from 'react';
import { cn } from '../lib/utils';
import { Button } from './Button';

type ConnectionStatus = 'online' | 'offline';

interface TopBarProps {
  userName: string;
  sessionOffline: boolean;
  onSignOut: () => void;
  signingOut: boolean;
}

export function TopBar({ userName, sessionOffline, onSignOut, signingOut }: TopBarProps) {
  const [status, setStatus] = useState<ConnectionStatus>(sessionOffline ? 'offline' : 'online');

  useEffect(() => {
    setStatus(sessionOffline ? 'offline' : 'online');
  }, [sessionOffline]);

  useEffect(() => {
    const unsubscribe = window.desktop.on('net-status', (payload) => {
      setStatus(payload.online ? 'online' : 'offline');
    });
    return unsubscribe;
  }, []);

  const online = status === 'online';

  return (
    <header className="flex h-14 shrink-0 items-center justify-between border-b border-slate-200 bg-white px-6">
      <div className="flex items-center gap-2">
        <span
          role="status"
          aria-label={online ? 'Connected to server' : 'Server unreachable'}
          title={online ? 'Connected to server' : 'Server unreachable'}
          className={cn(
            'h-2.5 w-2.5 rounded-full',
            online ? 'bg-success' : 'bg-danger',
          )}
        />
        <span className="text-xs text-slate-500">{online ? 'Connected' : 'Offline'}</span>
      </div>
      <div className="flex items-center gap-4">
        <span className="text-sm font-medium text-slate-700">{userName}</span>
        <Button
          variant="ghost"
          size="sm"
          onClick={onSignOut}
          loading={signingOut}
          aria-label="Sign out"
        >
          <LogOut className="h-4 w-4" aria-hidden="true" />
          Sign out
        </Button>
      </div>
    </header>
  );
}
