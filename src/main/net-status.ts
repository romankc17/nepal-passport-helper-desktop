import { EventEmitter } from 'node:events';
import { net } from 'electron';

const POLL_INTERVAL_MS = 15000;
const PROBE_TIMEOUT_MS = 5000;

// Polls reachability of the API origin and emits 'online' / 'offline' only on
// transitions. A resolved HTTP response of any status counts as online.
export class NetStatus extends EventEmitter {
  private timer: NodeJS.Timeout | null = null;
  private online = true;
  private probing = false;

  constructor(
    private readonly getProbeUrl: () => string,
    private readonly intervalMs: number = POLL_INTERVAL_MS,
  ) {
    super();
  }

  isOnline(): boolean {
    return this.online;
  }

  start(): void {
    if (this.timer) return;
    void this.probe();
    this.timer = setInterval(() => void this.probe(), this.intervalMs);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private async probe(): Promise<void> {
    if (this.probing) return;
    this.probing = true;
    try {
      await net.fetch(this.getProbeUrl(), {
        method: 'HEAD',
        signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      });
      this.setOnline(true);
    } catch {
      this.setOnline(false);
    } finally {
      this.probing = false;
    }
  }

  private setOnline(online: boolean): void {
    if (online === this.online) return;
    this.online = online;
    this.emit(online ? 'online' : 'offline');
  }
}
