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
    locations: { list: vi.fn() },
    clients: { list: vi.fn(), get: vi.fn(), readyByLocation: vi.fn() },
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
      cancel: vi.fn(),
      receipt: vi.fn(),
      reconcile: vi.fn(),
      saveReceipt: vi.fn(),
    },
    account: { me: vi.fn() },
    devices: { revoke: vi.fn() },
    activity: { list: vi.fn() },
    preferences: { get: vi.fn(), update: vi.fn() },
    scheduler: {
      checkNow: vi.fn().mockResolvedValue({ requested: true }),
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
    },
    window: { minimizeToTray: vi.fn(), quit: vi.fn() },
    app: { version: vi.fn().mockResolvedValue('0.1.0') },
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
