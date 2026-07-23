import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type ReactNode } from 'react';
import { api, onUpdateStatus, queryKeys } from '../api';
import type { UpdateStatus } from '../../../shared/types';
import { useAuth } from '../auth';
import { Badge } from '../components/Badge';
import { Button } from '../components/Button';
import { Card, CardBody, CardHeader } from '../components/Card';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { Input } from '../components/Input';
import { Label } from '../components/Label';
import { PageHeader } from '../components/PageHeader';
import { Select } from '../components/Select';
import { Skeleton } from '../components/Skeleton';
import { Switch } from '../components/Switch';
import { useToast } from '../components/Toast';
import { describeError } from '../lib/errors';
import { formatDateTime } from '../lib/format';

const isDev = import.meta.env.DEV;

function SettingRow({
  label,
  hint,
  control,
  htmlFor,
}: {
  label: string;
  hint?: string;
  control: ReactNode;
  htmlFor?: string;
}) {
  return (
    <div className="flex flex-col gap-3 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
      <div className="min-w-0">
        <Label htmlFor={htmlFor} className="mb-0">
          {label}
        </Label>
        {hint && <p className="mt-0.5 text-xs text-slate-400">{hint}</p>}
      </div>
      <div className="min-w-0 sm:shrink-0">{control}</div>
    </div>
  );
}

function updateHint(status: UpdateStatus | null): string | undefined {
  if (!status) return undefined;
  switch (status.type) {
    case 'idle':
      return undefined;
    case 'checking':
      return 'Checking for updates…';
    case 'available':
      return `Version ${status.version} is available`;
    case 'downloading':
      return 'Downloading update…';
    case 'downloaded':
      return `Version ${status.version} downloaded`;
    case 'up-to-date':
      return 'You are on the latest version';
    case 'error':
      return status.message;
  }
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${Number((bytes / k ** i).toFixed(1))} ${sizes[i]}`;
}

export function SettingsPage() {
  const { toast } = useToast();
  const { session, signOut } = useAuth();
  const queryClient = useQueryClient();
  const [signOutOpen, setSignOutOpen] = useState(false);
  const [apiUrlDraft, setApiUrlDraft] = useState<string | null>(null);
  const [appVersion, setAppVersion] = useState<string | null>(null);
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus | null>(null);
  const [checkingUpdate, setCheckingUpdate] = useState(false);

  const settingsQuery = useQuery({
    queryKey: queryKeys.settings,
    queryFn: () => api.settings.get(),
    staleTime: 60000,
  });
  const preferencesQuery = useQuery({
    queryKey: queryKeys.preferences,
    queryFn: () => api.preferences.get(),
    staleTime: 60000,
  });
  const meQuery = useQuery({
    queryKey: ['me'],
    queryFn: () => api.account.me(),
    staleTime: 60000,
  });

  useEffect(() => {
    if (settingsQuery.data && apiUrlDraft === null) {
      setApiUrlDraft(settingsQuery.data.apiUrl ?? '');
    }
  }, [settingsQuery.data, apiUrlDraft]);

  useEffect(() => {
    let active = true;
    void api.app.version().then((version) => {
      if (active) setAppVersion(version);
    });
    void api.updater.status().then((status) => {
      if (active) setUpdateStatus(status);
    });
    const unsubscribe = onUpdateStatus((status) => {
      setUpdateStatus(status);
      if (status.type !== 'checking') {
        setCheckingUpdate(false);
      }
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  const settingsMutation = useMutation({
    mutationFn: (patch: Parameters<typeof api.settings.update>[0]) => api.settings.update(patch),
    onSuccess: async () => {
      toast('Settings saved');
      await queryClient.invalidateQueries({ queryKey: queryKeys.settings });
    },
    onError: (error) => toast(describeError(error, 'Could not save settings'), 'error'),
  });

  const preferencesMutation = useMutation({
    mutationFn: (patch: Parameters<typeof api.preferences.update>[0]) =>
      api.preferences.update(patch),
    onSuccess: async () => {
      toast('Preferences saved');
      await queryClient.invalidateQueries({ queryKey: queryKeys.preferences });
    },
    onError: (error) => toast(describeError(error, 'Could not save preferences'), 'error'),
  });

  const revokeMutation = useMutation({
    mutationFn: (deviceId: number) => api.devices.revoke(deviceId),
    onSuccess: async () => {
      toast('Device signed out');
      await queryClient.invalidateQueries({ queryKey: ['me'] });
    },
    onError: (error) => toast(describeError(error, 'Could not revoke device'), 'error'),
  });

  const officialSessionMutation = useMutation({
    mutationFn: () => api.settings.refreshOfficialSession(),
    onSuccess: () => toast('Official session refreshed'),
    onError: (error) => toast(describeError(error, 'Could not refresh official session'), 'error'),
  });

  const settings = settingsQuery.data;
  const preferences = preferencesQuery.data;
  const me = meQuery.data;

  const currentApiUrl = isDev
    ? (apiUrlDraft ?? '') || 'http://localhost:8000 (default)'
    : 'Managed automatically';

  return (
    <div className="max-w-6xl">
      <PageHeader
        title="Settings"
        description="Manage how the app checks, notifies, and stays connected"
      />

      <div className="grid grid-cols-1 items-start gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="flex min-w-0 flex-col gap-6">
          <Card>
            <CardHeader title="Notifications" />
            <CardBody className="divide-y divide-slate-100">
              {preferencesQuery.isPending ? (
                <Skeleton className="h-10 w-full" />
              ) : (
                <>
                  <SettingRow
                    label="Account notifications"
                    hint="Apply to every signed-in device"
                    htmlFor="pref-notifications"
                    control={
                      <Switch
                        id="pref-notifications"
                        ariaLabel="Account notifications"
                        checked={preferences?.notifications_enabled ?? false}
                        disabled={preferencesMutation.isPending}
                        onCheckedChange={(checked) =>
                          preferencesMutation.mutate({
                            notifications_enabled: checked,
                          })
                        }
                      />
                    }
                  />
                  <SettingRow
                    label="Booking sound"
                    hint="Play when the server reports a booking"
                    htmlFor="pref-sound"
                    control={
                      <Switch
                        id="pref-sound"
                        ariaLabel="Booking sound"
                        checked={preferences?.sound_enabled ?? false}
                        disabled={preferencesMutation.isPending}
                        onCheckedChange={(checked) =>
                          preferencesMutation.mutate({ sound_enabled: checked })
                        }
                      />
                    }
                  />
                  <SettingRow
                    label="Email on booking"
                    htmlFor="pref-email-toggle"
                    control={
                      <Switch
                        id="pref-email-toggle"
                        ariaLabel="Email on booking"
                        checked={preferences?.email_on_booking ?? false}
                        disabled={preferencesMutation.isPending}
                        onCheckedChange={(checked) =>
                          preferencesMutation.mutate({
                            email_on_booking: checked,
                          })
                        }
                      />
                    }
                  />
                  <SettingRow
                    label="Email address"
                    htmlFor="pref-email-address"
                    control={
                      <Input
                        id="pref-email-address"
                        type="email"
                        className="w-full sm:w-64"
                        defaultValue={preferences?.email_address ?? ''}
                        placeholder="you@example.com"
                        onBlur={(event) => {
                          if (event.target.value !== (preferences?.email_address ?? '')) {
                            preferencesMutation.mutate({
                              email_address: event.target.value,
                            });
                          }
                        }}
                      />
                    }
                  />
                </>
              )}
              {settingsQuery.isPending ? (
                <Skeleton className="h-10 w-full" />
              ) : (
                <SettingRow
                  label="This device sound"
                  hint="Beep on this device for native notifications"
                  htmlFor="local-sound"
                  control={
                    <Switch
                      id="local-sound"
                      ariaLabel="This device sound"
                      checked={settings?.soundEnabled ?? false}
                      disabled={settingsMutation.isPending}
                      onCheckedChange={(checked) =>
                        settingsMutation.mutate({ soundEnabled: checked })
                      }
                    />
                  }
                />
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Application" />
            <CardBody className="divide-y divide-slate-100">
              {settingsQuery.isPending ? (
                <Skeleton className="h-24 w-full" />
              ) : (
                <>
                  <SettingRow
                    label="Minimize to tray"
                    hint="Closing the window keeps watchers running in the tray"
                    htmlFor="min-tray"
                    control={
                      <Switch
                        id="min-tray"
                        ariaLabel="Minimize to tray"
                        checked={settings?.minimizeToTray ?? true}
                        disabled={settingsMutation.isPending}
                        onCheckedChange={(checked) =>
                          settingsMutation.mutate({ minimizeToTray: checked })
                        }
                      />
                    }
                  />
                  <SettingRow
                    label="Start on login"
                    htmlFor="start-login"
                    control={
                      <Switch
                        id="start-login"
                        ariaLabel="Start on login"
                        checked={settings?.startOnLogin ?? false}
                        disabled={settingsMutation.isPending}
                        onCheckedChange={(checked) =>
                          settingsMutation.mutate({ startOnLogin: checked })
                        }
                      />
                    }
                  />
                  <SettingRow
                    label="Default check interval"
                    hint="In seconds; used for new slot watchers"
                    htmlFor="default-interval"
                    control={
                      <Input
                        id="default-interval"
                        type="number"
                        min={30}
                        className="w-32"
                        defaultValue={settings?.defaultIntervalSeconds ?? 300}
                        onBlur={(event) => {
                          const value = Number(event.target.value);
                          if (value >= 30 && value !== settings?.defaultIntervalSeconds) {
                            settingsMutation.mutate({
                              defaultIntervalSeconds: value,
                            });
                          }
                        }}
                      />
                    }
                  />
                  <SettingRow
                    label="Default days ahead"
                    htmlFor="default-days"
                    control={
                      <Input
                        id="default-days"
                        type="number"
                        min={1}
                        max={90}
                        className="w-32"
                        defaultValue={settings?.defaultDaysAhead ?? 14}
                        onBlur={(event) => {
                          const value = Number(event.target.value);
                          if (value >= 1 && value <= 90 && value !== settings?.defaultDaysAhead) {
                            settingsMutation.mutate({
                              defaultDaysAhead: value,
                            });
                          }
                        }}
                      />
                    }
                  />
                  <SettingRow
                    label="Theme"
                    htmlFor="theme"
                    control={
                      <Select
                        ariaLabel="Theme"
                        className="w-40"
                        value={settings?.theme ?? 'system'}
                        onValueChange={(value) =>
                          settingsMutation.mutate({
                            theme: value as 'light' | 'system',
                          })
                        }
                        options={[
                          { value: 'system', label: 'System' },
                          { value: 'light', label: 'Light' },
                        ]}
                      />
                    }
                  />
                </>
              )}
            </CardBody>
          </Card>
        </div>

        <div className="flex min-w-0 flex-col gap-6">
          <Card>
            <CardHeader title="Connection" />
            <CardBody className="divide-y divide-slate-100">
              <SettingRow
                label="API URL"
                hint={isDev ? 'Dev builds can point at a local server' : undefined}
                htmlFor="api-url"
                control={
                  isDev ? (
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                      <Input
                        id="api-url"
                        className="w-full sm:w-64"
                        placeholder="http://localhost:8000"
                        value={apiUrlDraft ?? ''}
                        onChange={(event) => setApiUrlDraft(event.target.value)}
                      />
                      <Button
                        size="sm"
                        variant="secondary"
                        loading={settingsMutation.isPending}
                        onClick={() =>
                          settingsMutation.mutate({
                            apiUrl: apiUrlDraft?.trim() ? apiUrlDraft.trim() : null,
                          })
                        }
                      >
                        Save
                      </Button>
                    </div>
                  ) : (
                    <span className="text-sm text-slate-600">{currentApiUrl}</span>
                  )
                }
              />
              <SettingRow
                label="Official portal session"
                hint="Reset the portal login and anonymous token"
                control={
                  <Button
                    size="sm"
                    variant="secondary"
                    loading={officialSessionMutation.isPending}
                    onClick={() => officialSessionMutation.mutate()}
                  >
                    Refresh
                  </Button>
                }
              />
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Devices" />
            <CardBody>
              {meQuery.isPending ? (
                <Skeleton className="h-16 w-full" />
              ) : meQuery.isError ? (
                <p className="text-sm text-danger">Could not load devices.</p>
              ) : (
                <ul className="divide-y divide-slate-100">
                  {(me?.devices ?? []).map((device) => (
                    <li key={device.id} className="flex items-center justify-between gap-4 py-3">
                      <div>
                        <p className="text-sm font-medium text-slate-800">
                          {device.name} {device.current && <Badge tone="blue">this device</Badge>}
                        </p>
                        <p className="text-xs text-slate-400">
                          Last seen {formatDateTime(device.last_seen_at)}
                        </p>
                      </div>
                      {!device.current && (
                        <Button
                          size="sm"
                          variant="secondary"
                          loading={revokeMutation.isPending}
                          onClick={() => revokeMutation.mutate(device.id)}
                        >
                          Revoke
                        </Button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Update" />
            <CardBody>
              <SettingRow
                label={appVersion ? `Version ${appVersion}` : 'Checking version…'}
                hint={updateHint(updateStatus)}
                control={
                  <div className="flex items-center gap-2">
                    {updateStatus?.type === 'downloaded' ? (
                      <Button
                        size="sm"
                        variant="primary"
                        onClick={() => void api.updater.install()}
                      >
                        Install and restart
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        variant="secondary"
                        loading={checkingUpdate}
                        onClick={() => {
                          setCheckingUpdate(true);
                          void api.updater.check().catch((error: unknown) => {
                            setCheckingUpdate(false);
                            toast(describeError(error, 'Update check failed'), 'error');
                          });
                        }}
                      >
                        Check for updates
                      </Button>
                    )}
                  </div>
                }
              />
              {updateStatus?.type === 'downloading' && (
                <div className="mt-2">
                  <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
                    <div
                      className="h-full bg-primary transition-all"
                      style={{ width: `${Math.round(updateStatus.percent)}%` }}
                    />
                  </div>
                  <p className="mt-1 text-xs text-slate-500">
                    {Math.round(updateStatus.percent)}% — {formatBytes(updateStatus.transferred)} /{' '}
                    {formatBytes(updateStatus.total)}
                  </p>
                </div>
              )}
              {updateStatus?.type === 'error' && (
                <p className="mt-2 text-sm text-danger">{updateStatus.message}</p>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Account" />
            <CardBody>
              <SettingRow
                label={session?.user.username ?? 'Signed in'}
                hint={
                  session?.access.providers.map((provider) => provider.name).join(', ') || undefined
                }
                control={
                  <Button variant="danger" size="sm" onClick={() => setSignOutOpen(true)}>
                    Sign out
                  </Button>
                }
              />
            </CardBody>
          </Card>
        </div>
      </div>

      <ConfirmDialog
        open={signOutOpen}
        onOpenChange={setSignOutOpen}
        title="Sign out"
        description="Sign out on this device? Watchers will stop until you sign in again."
        confirmLabel="Sign out"
        danger
        onConfirm={() => void signOut()}
      />
    </div>
  );
}
