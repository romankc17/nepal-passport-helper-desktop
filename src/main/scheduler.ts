import type {
  CheckNowResult,
  CheckOutcome,
  SchedulerEvent,
  WatcherLoopState,
  WatcherRuntime,
  WatcherSyncItem,
} from '../shared/types';

export interface SchedulerDeps {
  checkNow: (watcherId: number, force: boolean) => Promise<CheckOutcome>;
  onEvent: (event: SchedulerEvent) => void;
  now: () => number;
  setTimeout: (fn: () => void, ms: number) => unknown;
  clearTimeout: (handle: unknown) => void;
  random: () => number;
  maxConcurrent?: number;
}

interface LoopRecord {
  watcherId: number;
  intervalSeconds: number;
  state: WatcherLoopState;
  timer: unknown | null;
  backoffAttempt: number;
  inFlight: boolean;
  queuedForRun: boolean;
  lastResult?: CheckOutcome;
  nextRunAt?: number;
  forceNextRun: boolean;
  /** One-off manual run without a persistent loop — settle to a resting state. */
  manualOnce?: boolean;
  /** Paused/captcha state to restore after a one-off manual run. */
  restoreStateAfterManual?: WatcherLoopState;
}

const MAX_BACKOFF_MS = 30 * 60 * 1000;
const JITTER_RATIO = 0.1;

// Pure, dependency-injected per-watcher polling scheduler. No Electron or
// node imports — main wires the real API client and timers into it, tests
// drive it with fake timers and a scripted checkNow.
export class WatcherScheduler {
  private readonly loops = new Map<number, LoopRecord>();
  private readonly runQueue: number[] = [];
  private runningCount = 0;
  private authExpired = false;
  private readonly maxConcurrent: number;

  constructor(private readonly deps: SchedulerDeps) {
    this.maxConcurrent = deps.maxConcurrent ?? 3;
  }

  // Reconcile local loops with the server watcher list. Creates loops for new
  // active watchers, pauses loops for inactive ones, removes loops for
  // deleted watchers. Also clears a previous auth-expired stop (fresh login).
  syncFromServer(watchers: WatcherSyncItem[]): void {
    this.authExpired = false;
    const seen = new Set<number>();

    for (const watcher of watchers) {
      seen.add(watcher.id);
      const existing = this.loops.get(watcher.id);

      if (!watcher.active) {
        if (existing && existing.state !== 'paused') this.pauseLoop(existing);
        continue;
      }

      if (!existing) {
        const loop = this.createLoop(watcher.id, watcher.intervalSeconds);
        this.loops.set(watcher.id, loop);
        this.scheduleRun(loop, 0, 'scheduled');
        continue;
      }

      const intervalChanged = existing.intervalSeconds !== watcher.intervalSeconds;
      existing.intervalSeconds = watcher.intervalSeconds;
      if (intervalChanged && existing.state === 'scheduled' && !existing.inFlight) {
        this.scheduleRun(existing, this.jitter(watcher.intervalSeconds * 1000), 'scheduled');
      }
      if (
        existing.state === 'idle' ||
        existing.state === 'paused' ||
        existing.state === 'auth-expired'
      ) {
        existing.backoffAttempt = 0;
        this.scheduleRun(existing, 0, 'scheduled');
      }
    }

    for (const [id, loop] of this.loops) {
      if (!seen.has(id)) {
        this.clearTimer(loop);
        this.loops.delete(id);
      }
    }
  }

  // Manual immediate run. A click is explicit user intent, so it works even
  // without a loop (inactive watcher) and on paused/captcha loops — as a
  // one-off that never resumes a schedule. Returns whether the run was
  // accepted; the IPC layer surfaces rejections so the UI can explain why
  // nothing happened instead of silently ignoring the click.
  checkNow(watcherId: number): CheckNowResult {
    if (this.authExpired) return { accepted: false, reason: 'auth-expired' };
    let loop = this.loops.get(watcherId);
    if (!loop) {
      loop = { ...this.createLoop(watcherId, 0), manualOnce: true };
      this.loops.set(watcherId, loop);
      this.startRun(loop, true);
      return { accepted: true };
    }
    if (loop.inFlight || loop.queuedForRun) {
      return { accepted: false, reason: 'already-running' };
    }
    if (loop.state === 'paused' || loop.state === 'captcha') {
      loop.restoreStateAfterManual = loop.state;
    }
    this.clearTimer(loop);
    this.startRun(loop, true);
    return { accepted: true };
  }

  // Local pause only — the server-side queue is untouched.
  pause(watcherId: number): void {
    const loop = this.loops.get(watcherId);
    if (!loop || loop.state === 'paused') return;
    this.pauseLoop(loop);
  }

  resume(watcherId: number): void {
    const loop = this.loops.get(watcherId);
    if (!loop || this.authExpired) return;
    if (loop.state !== 'paused' && loop.state !== 'captcha' && loop.state !== 'error') return;
    loop.backoffAttempt = 0;
    this.scheduleRun(loop, 0, 'scheduled');
  }

  // System woke from sleep: timers may have drifted, so recalculate them all.
  onWake(): void {
    if (this.authExpired) return;
    for (const loop of this.loops.values()) {
      if (loop.state === 'scheduled' || loop.state === 'backoff') {
        this.clearTimer(loop);
        this.scheduleRun(loop, 0, loop.state);
      }
    }
  }

  setOffline(offline: boolean): void {
    for (const loop of this.loops.values()) {
      if (offline) {
        if (loop.state === 'scheduled' || loop.state === 'backoff') {
          this.clearTimer(loop);
          loop.state = 'offline';
          loop.nextRunAt = undefined;
          this.emit(loop);
        }
      } else if (loop.state === 'offline' && !this.authExpired) {
        this.scheduleRun(loop, 0, 'scheduled');
      }
    }
  }

  getRuntime(): WatcherRuntime[] {
    return [...this.loops.values()].map((loop) => ({
      watcherId: loop.watcherId,
      state: loop.state,
      nextRunAt: loop.nextRunAt,
      lastResult: loop.lastResult,
    }));
  }

  private createLoop(watcherId: number, intervalSeconds: number): LoopRecord {
    return {
      watcherId,
      intervalSeconds,
      state: 'idle',
      timer: null,
      backoffAttempt: 0,
      inFlight: false,
      queuedForRun: false,
      forceNextRun: false,
    };
  }

  private pauseLoop(loop: LoopRecord): void {
    this.clearTimer(loop);
    this.dequeue(loop.watcherId);
    loop.state = 'paused';
    loop.nextRunAt = undefined;
    this.emit(loop);
  }

  private scheduleRun(loop: LoopRecord, delayMs: number, state: 'scheduled' | 'backoff'): void {
    this.clearTimer(loop);
    loop.state = state;
    loop.nextRunAt = this.deps.now() + delayMs;
    loop.timer = this.deps.setTimeout(() => {
      loop.timer = null;
      this.startRun(loop);
    }, delayMs);
    this.emit(loop);
  }

  private startRun(loop: LoopRecord, force = false): void {
    if (this.authExpired || loop.inFlight) return;
    if (this.runningCount >= this.maxConcurrent) {
      loop.forceNextRun ||= force;
      if (!loop.queuedForRun) {
        loop.queuedForRun = true;
        this.runQueue.push(loop.watcherId);
      }
      return;
    }
    loop.queuedForRun = false;
    force ||= loop.forceNextRun;
    loop.forceNextRun = false;
    loop.inFlight = true;
    this.runningCount += 1;
    loop.state = 'checking';
    loop.nextRunAt = undefined;
    this.emit(loop);

    this.deps.checkNow(loop.watcherId, force).then(
      (outcome) => this.finishRun(loop, outcome),
      (error: unknown) =>
        this.finishRun(loop, {
          status: 'retryable-error',
          message: error instanceof Error ? error.message : 'Unknown check failure',
        }),
    );
  }

  private finishRun(loop: LoopRecord, outcome: CheckOutcome): void {
    loop.inFlight = false;
    this.runningCount -= 1;
    loop.lastResult = outcome;

    if (outcome.status === 'auth-expired') {
      this.handleAuthExpired(loop);
      return;
    }

    if (this.authExpired) {
      this.drainQueue();
      return;
    }

    // The loop may have been deleted, paused or taken offline mid-flight.
    if (this.loops.get(loop.watcherId) !== loop) {
      this.drainQueue();
      return;
    }
    if (loop.state === 'paused' || loop.state === 'offline') {
      this.emit(loop);
      this.drainQueue();
      return;
    }

    if (loop.manualOnce) {
      // One-off check without a persistent loop: settle to a resting state
      // with no timer so nothing is scheduled for an inactive watcher.
      loop.manualOnce = undefined;
      loop.state =
        outcome.status === 'ok' ? 'idle' : outcome.status === 'captcha' ? 'captcha' : 'error';
      loop.nextRunAt = undefined;
      this.emit(loop);
      this.drainQueue();
      return;
    }

    if (loop.restoreStateAfterManual !== undefined) {
      // One-off check on a paused/captcha loop: restore the resting state
      // instead of resuming the schedule. A fresh CAPTCHA outcome wins.
      const restore = loop.restoreStateAfterManual;
      loop.restoreStateAfterManual = undefined;
      loop.state = outcome.status === 'captcha' ? 'captcha' : restore;
      loop.nextRunAt = undefined;
      this.emit(loop);
      this.drainQueue();
      return;
    }

    switch (outcome.status) {
      case 'ok':
        loop.backoffAttempt = 0;
        this.scheduleRun(loop, this.jitter(loop.intervalSeconds * 1000), 'scheduled');
        break;
      case 'retryable-error': {
        loop.backoffAttempt += 1;
        const base = Math.min(
          loop.intervalSeconds * 1000 * 2 ** loop.backoffAttempt,
          MAX_BACKOFF_MS,
        );
        this.scheduleRun(loop, this.jitter(base), 'backoff');
        break;
      }
      case 'permanent-error':
        loop.state = 'error';
        loop.nextRunAt = undefined;
        this.emit(loop);
        break;
      case 'captcha':
        loop.state = 'captcha';
        loop.nextRunAt = undefined;
        this.emit(loop);
        break;
    }
    this.drainQueue();
  }

  private handleAuthExpired(failedLoop: LoopRecord): void {
    this.authExpired = true;
    this.runQueue.length = 0;
    for (const loop of this.loops.values()) {
      this.clearTimer(loop);
      loop.queuedForRun = false;
      loop.state = 'auth-expired';
      loop.nextRunAt = undefined;
      if (loop.watcherId === failedLoop.watcherId) {
        loop.lastResult = failedLoop.lastResult;
      }
      this.emit(loop);
    }
    this.deps.onEvent({ type: 'auth-expired' });
  }

  private drainQueue(): void {
    while (this.runningCount < this.maxConcurrent && this.runQueue.length > 0) {
      const watcherId = this.runQueue.shift();
      if (watcherId === undefined) return;
      const loop = this.loops.get(watcherId);
      if (!loop || !loop.queuedForRun || loop.inFlight) continue;
      if (loop.state === 'paused' || loop.state === 'offline') {
        loop.queuedForRun = false;
        continue;
      }
      this.startRun(loop);
    }
  }

  private dequeue(watcherId: number): void {
    const index = this.runQueue.indexOf(watcherId);
    if (index >= 0) this.runQueue.splice(index, 1);
    const loop = this.loops.get(watcherId);
    if (loop) {
      loop.queuedForRun = false;
      loop.forceNextRun = false;
    }
  }

  private jitter(baseMs: number): number {
    const factor = 1 - JITTER_RATIO + this.deps.random() * JITTER_RATIO * 2;
    return Math.round(baseMs * factor);
  }

  private clearTimer(loop: LoopRecord): void {
    if (loop.timer !== null) {
      this.deps.clearTimeout(loop.timer);
      loop.timer = null;
    }
  }

  private emit(loop: LoopRecord): void {
    this.deps.onEvent({
      type: 'watcher-state',
      watcherId: loop.watcherId,
      state: loop.state,
      lastResult: loop.lastResult,
      nextRunAt: loop.nextRunAt,
    });
  }
}
