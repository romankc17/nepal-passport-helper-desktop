import { BrowserWindow, Notification } from 'electron';

export interface NotificationRequest {
  title: string;
  body: string;
  route?: string;
}

export interface NotificationsDeps {
  getWindow: () => BrowserWindow | null;
  isSoundEnabled: () => boolean;
  isNotificationsEnabled: () => boolean;
}

// Native notifications. Sound strategy: when our sound setting is on we keep
// the native notification silent and ask the renderer to play a short
// WebAudio beep, so behaviour is identical on Windows and macOS; otherwise
// fully silent.
export class Notifications {
  constructor(private readonly deps: NotificationsDeps) {}

  show(request: NotificationRequest): void {
    if (!this.deps.isNotificationsEnabled()) return;
    if (!Notification.isSupported()) return;

    const notification = new Notification({
      title: request.title,
      body: request.body,
      silent: true,
    });

    notification.on('click', () => {
      const win = this.deps.getWindow();
      if (win) {
        if (win.isMinimized()) win.restore();
        win.show();
        win.focus();
        if (request.route) win.webContents.send('notification-click', { route: request.route });
      }
    });

    notification.show();

    if (this.deps.isSoundEnabled()) {
      this.deps.getWindow()?.webContents.send('play-sound');
    }
  }
}
