import { vi } from 'vitest';
import type { DesktopApi } from '../../../src/preload/api.d.ts';

// Mirrors how errors actually arrive across the contextBridge: plain tagged
// objects, not Error instances.
export function bridgeError(code: string, message: string, retryable = false) {
  return { __desktopError: true, code, message, retryable };
}

type MockShape = Record<string, Record<string, unknown>>;

function createMock(): MockShape {
  return {
    auth: {
      login: vi.fn(),
      logout: vi.fn().mockResolvedValue({ signedOut: true }),
      getSession: vi.fn().mockResolvedValue(null),
    },
    overview: { get: vi.fn() },
    locations: { list: vi.fn().mockResolvedValue([]) },
    clients: {
      list: vi.fn(),
      get: vi.fn(),
      readyByLocation: vi.fn(),
      submit: vi.fn(),
      importPreview: vi.fn(),
      importConfirm: vi.fn(),
    },
    officialImport: {
      open: vi.fn().mockResolvedValue({ opened: true }),
      list: vi.fn().mockResolvedValue([]),
      get: vi.fn(),
      close: vi.fn().mockResolvedValue({ closed: true }),
    },
    queue: { add: vi.fn(), remove: vi.fn(), bookNow: vi.fn(), progress: vi.fn() },
    watchers: {
      list: vi.fn().mockResolvedValue([]),
      get: vi.fn(),
      create: vi.fn(),
      updateSettings: vi.fn(),
      pause: vi.fn(),
      resume: vi.fn(),
      check: vi.fn(),
      delete: vi.fn(),
      reorder: vi.fn(),
      history: vi.fn(),
    },
    appointments: {
      list: vi.fn(),
      receipt: vi.fn(),
      reconcile: vi.fn(),
      saveReceipt: vi.fn(),
    },
    account: { me: vi.fn() },
    devices: { revoke: vi.fn() },
    activity: { list: vi.fn() },
    preferences: { get: vi.fn(), update: vi.fn() },
    scheduler: {
      checkNow: vi.fn().mockResolvedValue({ requested: true, reason: null }),
      pause: vi.fn(),
      resume: vi.fn(),
      getRuntime: vi.fn().mockResolvedValue([]),
      sync: vi.fn().mockResolvedValue({ synced: true }),
    },
    settings: {
      get: vi.fn().mockResolvedValue({
        apiUrl: null,
        notificationsEnabled: true,
        soundEnabled: true,
        minimizeToTray: true,
        startOnLogin: false,
        defaultIntervalSeconds: 300,
        defaultDaysAhead: 14,
        theme: 'system',
      }),
      update: vi.fn(),
      refreshOfficialSession: vi.fn().mockResolvedValue({ refreshed: true }),
    },
    window: { minimizeToTray: vi.fn(), quit: vi.fn() },
    app: { version: vi.fn().mockResolvedValue('0.1.0') },
    updater: {
      check: vi.fn(),
      status: vi.fn().mockResolvedValue({ type: 'idle' }),
      install: vi.fn(),
    },
    lab: {
      summary: vi.fn().mockResolvedValue({
        generated: 0,
        submitted: 0,
        queued: 0,
        booked: 0,
        failed: 0,
        cancelled: 0,
        watchers: 0,
      }),
      clients: vi.fn().mockResolvedValue({ items: [], page: 1, page_size: 25, total: 0, is_staff: false }),
      detail: vi.fn(),
      generate: vi.fn(),
      submit: vi.fn(),
      book: vi.fn(),
      reconcile: vi.fn(),
      history: vi.fn().mockResolvedValue({ items: [], page: 1, page_size: 25, total: 0 }),
      cancel: vi.fn(),
      receipt: vi.fn(),
      delete: vi.fn(),
    },
    // `on` is a bare function, not a group — cast for the shared shape.
    on: vi.fn().mockReturnValue(() => undefined) as unknown as Record<string, unknown>,
  };
}

// The renderer's api.ts captures window.desktop sub-objects at module load,
// so the mock must be a singleton whose methods are reset IN PLACE.
let singleton: MockShape | null = null;

export function installDesktopMock(): DesktopApi {
  const fresh = createMock();
  if (!singleton) {
    singleton = fresh;
    (window as unknown as Record<string, unknown>).desktop = singleton;
  } else {
    for (const key of Object.keys(fresh)) {
      if (key === 'on') {
        // Bare function: replace (callers access it dynamically).
        singleton[key] = fresh[key];
        continue;
      }
      Object.assign(singleton[key], fresh[key]);
    }
  }
  return window.desktop;
}
