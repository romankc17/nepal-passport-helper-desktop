import type { ActivityQuery, AppointmentListQuery, ClientListQuery, LabListQuery, UpdateStatus } from '../../shared/types';

// Typed wrappers over window.desktop + the TanStack Query key factory.
// The renderer never talks to the Django API directly — all traffic goes
// through the main process.

export const queryKeys = {
  session: ['session'] as const,
  overview: ['overview'] as const,
  watchers: ['watchers'] as const,
  watcher: (id: number) => ['watchers', id] as const,
  watcherHistory: (id: number, page?: number) => ['watchers', id, 'history', page] as const,
  watcherRuntime: ['watcher-runtime'] as const,
  clients: (query?: ClientListQuery) => ['clients', query] as const,
  client: (id: number) => ['clients', id] as const,
  readyByLocation: ['clients', 'ready-by-location'] as const,
  localQueue: ['local-queue'] as const,
  appointments: (query?: AppointmentListQuery) => ['appointments', query] as const,
  activity: (query?: ActivityQuery) => ['activity', query] as const,
  preferences: ['preferences'] as const,
  settings: ['settings'] as const,
  labSummary: ['lab-summary'] as const,
  labClients: (query?: LabListQuery) => ['lab-clients', query] as const,
  labClient: (id: number) => ['lab-clients', id] as const,
  labHistory: (query?: LabListQuery) => ['lab-history', query] as const,
};

export const api = {
  auth: window.desktop.auth,
  overview: window.desktop.overview,
  locations: window.desktop.locations,
  clients: window.desktop.clients,
  queue: window.desktop.queue,
  watchers: window.desktop.watchers,
  appointments: window.desktop.appointments,
  account: window.desktop.account,
  devices: window.desktop.devices,
  activity: window.desktop.activity,
  preferences: window.desktop.preferences,
  scheduler: window.desktop.scheduler,
  settings: window.desktop.settings,
  updater: window.desktop.updater,
  app: window.desktop.app,
  lab: window.desktop.lab,
};

export function onUpdateStatus(callback: (status: UpdateStatus) => void): () => void {
  return window.desktop.on('update-status', callback as (payload: unknown) => void);
}
