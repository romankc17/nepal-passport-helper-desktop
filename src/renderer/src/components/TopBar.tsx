import { Download, LogOut, RefreshCw } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api, onUpdateStatus } from '../api';
import type { UpdateStatus } from '../../../shared/types';
import { cn } from '../lib/utils';
import { Badge } from './Badge';
import { Button } from './Button';

type ConnectionStatus = 'online' | 'offline';

interface TopBarProps {
  userName: string;
  sessionOffline: boolean;
  onSignOut: () => void;
  signingOut: boolean;
  onRefresh?: () => void;
  isFetching?: boolean;
}

export function TopBar({ userName, sessionOffline, onSignOut, signingOut, onRefresh, isFetching }: TopBarProps) {
  const [status, setStatus] = useState<ConnectionStatus>(sessionOffline ? 'offline' : 'online');
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus>({ type: 'idle' });

  useEffect(() => {
    setStatus(sessionOffline ? 'offline' : 'online');
  }, [sessionOffline]);

  useEffect(() => {
    const unsubscribe = window.desktop.on('net-status', (payload) => {
      setStatus(payload.online ? 'online' : 'offline');
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    let active = true;
    void api.updater.status().then((nextStatus) => {
      if (active) setUpdateStatus(nextStatus);
    });
    const unsubscribe = onUpdateStatus(setUpdateStatus);
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  const online = status === 'online';

  const handleRefresh = () => {
    if (!onRefresh) return;
    onRefresh();
  };

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
      <div className="flex items-center gap-2">
        {updateStatus.type === 'available' && (
          <Badge tone="blue">Update available</Badge>
        )}
        {updateStatus.type === 'downloading' && (
          <Badge tone="blue">Downloading update… {Math.round(updateStatus.percent)}%</Badge>
        )}
        {updateStatus.type === 'downloaded' && (
          <Button
            variant="primary"
            size="sm"
            onClick={() => void api.updater.install()}
            aria-label={`Update app to version ${updateStatus.version}`}
          >
            <Download className="h-4 w-4" aria-hidden="true" />
            Update app
          </Button>
        )}
        <span className="text-sm font-medium text-slate-700">{userName}</span>
        <Button
          variant="ghost"
          size="sm"
          onClick={handleRefresh}
          aria-label="Refresh page"
          title="Refresh current page"
        >
          <RefreshCw className={cn('h-4 w-4', isFetching && 'animate-spin')} aria-hidden="true" />
          Refresh
        </Button>
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
