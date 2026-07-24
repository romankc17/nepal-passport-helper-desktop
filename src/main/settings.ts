import type { App } from 'electron';
import type { AppSettings, AppSettingsPatch, LocalWatcherSnapshot } from '../shared/types';
import type { JsonStore } from './store';
import { isE2E } from './e2e';

// Production builds lock the API URL to this value; the dev-only override
// (settings.apiUrl / EPP_DEV_API_URL) is ignored when app.isPackaged is true,
// except under the EPP_E2E=1 test hook.
const PRODUCTION_API_URL = 'https://nepal-passport-helper.onrender.com';
const DEV_FALLBACK_API_URL = 'http://localhost:8000';

export interface StoredConfig {
  settings: AppSettings;
  deviceId: string | null;
  sessionSnapshot: {
    user: { id: number; username: string; is_staff: boolean };
    access: { mode: string; providers: { id: number; name: string }[]; booking_lab: boolean };
    defaults: { interval_seconds: number };
  } | null;
  watcherSnapshot: LocalWatcherSnapshot | null;
}

export const defaultSettings: AppSettings = {
  apiUrl: null,
  notificationsEnabled: true,
  soundEnabled: true,
  minimizeToTray: true,
  startOnLogin: false,
  defaultIntervalSeconds: 300,
  defaultDaysAhead: 14,
  theme: 'system',
};

export const defaultStoredConfig: StoredConfig = {
  settings: defaultSettings,
  deviceId: null,
  sessionSnapshot: null,
  watcherSnapshot: null,
};

export class SettingsManager {
  constructor(
    private readonly store: JsonStore<StoredConfig>,
    private readonly app: App,
    private readonly isDev: boolean,
  ) {}

  get(): AppSettings {
    return this.store.get().settings;
  }

  update(patch: AppSettingsPatch): AppSettings {
    const current = this.get();
    const next: AppSettings = {
      ...current,
      ...patch,
      apiUrl: this.isDev ? (patch.apiUrl !== undefined ? patch.apiUrl : current.apiUrl) : null,
    };
    this.store.update({ settings: next });
    if (patch.startOnLogin !== undefined) this.applyLoginItem(next.startOnLogin);
    return next;
  }

  applyLoginItem(openAtLogin: boolean): void {
    try {
      this.app.setLoginItemSettings({ openAtLogin });
    } catch {
      // Unsupported on some Linux sessions; setting still persists locally.
    }
  }

  resolveApiUrl(): string {
    // E2E harness may point even packaged builds at the local mock server.
    if (isE2E && process.env.EPP_DEV_API_URL) return process.env.EPP_DEV_API_URL;
    if (!this.isDev) return PRODUCTION_API_URL;
    const override = this.get().apiUrl;
    if (override) return override;
    return process.env.EPP_DEV_API_URL || DEV_FALLBACK_API_URL;
  }

  getDeviceId(): string {
    const existing = this.store.get().deviceId;
    if (existing) return existing;
    const deviceId = crypto.randomUUID();
    this.store.update({ deviceId });
    return deviceId;
  }
}
