import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WatcherScheduler } from '../../src/main/scheduler';
import type { CheckOutcome, SchedulerEvent } from '../../src/shared/types';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

interface Harness {
  scheduler: WatcherScheduler;
  events: SchedulerEvent[];
  checkNow: ReturnType<typeof vi.fn<(watcherId: number) => Promise<CheckOutcome>>>;
  scheduledDelays: number[];
}

function makeHarness(outcome: CheckOutcome = { status: 'ok' }): Harness {
  const events: SchedulerEvent[] = [];
  const scheduledDelays: number[] = [];
  const checkNow = vi.fn<(watcherId: number) => Promise<CheckOutcome>>().mockResolvedValue(outcome);
  const scheduler = new WatcherScheduler({
    checkNow,
    onEvent: (event) => events.push(event),
    now: () => Date.now(),
    setTimeout: (fn, ms) => {
      scheduledDelays.push(ms);
      return setTimeout(fn, ms);
    },
    clearTimeout: (handle) => clearTimeout(handle as NodeJS.Timeout),
    random: () => 0.5, // jitter factor exactly 1.0 → deterministic delays
  });
  return { scheduler, events, checkNow, scheduledDelays };
}

function stateOf(harness: Harness, watcherId: number) {
  return harness.scheduler.getRuntime().find((entry) => entry.watcherId === watcherId);
}

describe('WatcherScheduler', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('schedules checks at the watcher interval and never overlaps runs', async () => {
    const harness = makeHarness();
    harness.scheduler.syncFromServer([{ id: 1, intervalSeconds: 60, active: true }]);

    await vi.advanceTimersByTimeAsync(0);
    expect(harness.checkNow).toHaveBeenCalledTimes(1);
    expect(stateOf(harness, 1)?.state).toBe('scheduled');

    await vi.advanceTimersByTimeAsync(60_000);
    expect(harness.checkNow).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(60_000);
    expect(harness.checkNow).toHaveBeenCalledTimes(3);
  });

  it('applies ±10% jitter to the success interval', async () => {
    const randomValues = [0, 1];
    const events: SchedulerEvent[] = [];
    const scheduledDelays: number[] = [];
    let call = 0;
    const scheduler = new WatcherScheduler({
      checkNow: () => Promise.resolve({ status: 'ok' }),
      onEvent: (event) => events.push(event),
      now: () => Date.now(),
      setTimeout: (fn, ms) => {
        scheduledDelays.push(ms);
        return setTimeout(fn, ms);
      },
      clearTimeout: (handle) => clearTimeout(handle as NodeJS.Timeout),
      random: () => randomValues[call++ % randomValues.length],
    });
    scheduler.syncFromServer([{ id: 1, intervalSeconds: 100, active: true }]);
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(100_000);

    const postRunDelays = scheduledDelays.filter((delay) => delay > 0);
    expect(postRunDelays[0]).toBe(90_000); // random 0 → 1 - 0.1
    expect(postRunDelays[1]).toBe(110_000); // random 1 → 1 + 0.1
  });

  it('checkNow runs immediately without creating a duplicate loop', async () => {
    const harness = makeHarness();
    harness.scheduler.syncFromServer([{ id: 1, intervalSeconds: 60, active: true }]);
    await vi.advanceTimersByTimeAsync(0);
    expect(harness.checkNow).toHaveBeenCalledTimes(1);

    harness.scheduler.checkNow(1);
    await vi.advanceTimersByTimeAsync(0);
    expect(harness.checkNow).toHaveBeenCalledTimes(2);

    // The regular loop continues from the manual run, exactly one timer.
    await vi.advanceTimersByTimeAsync(60_000);
    expect(harness.checkNow).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(harness.checkNow).toHaveBeenCalledTimes(4);
  });

  it('ignores checkNow while a check is in flight', async () => {
    const harness = makeHarness();
    const gate = deferred<CheckOutcome>();
    harness.checkNow.mockReturnValueOnce(gate.promise);
    harness.scheduler.syncFromServer([{ id: 1, intervalSeconds: 60, active: true }]);
    await vi.advanceTimersByTimeAsync(0);
    expect(harness.checkNow).toHaveBeenCalledTimes(1);

    harness.scheduler.checkNow(1);
    harness.scheduler.checkNow(1);
    await vi.advanceTimersByTimeAsync(0);
    expect(harness.checkNow).toHaveBeenCalledTimes(1);

    gate.resolve({ status: 'ok' });
    await vi.advanceTimersByTimeAsync(0);
    expect(stateOf(harness, 1)?.state).toBe('scheduled');
  });

  it('doubles backoff on retryable failures within jitter bounds', async () => {
    const harness = makeHarness({ status: 'retryable-error', message: 'server down' });
    harness.scheduler.syncFromServer([{ id: 1, intervalSeconds: 60, active: true }]);

    await vi.advanceTimersByTimeAsync(0); // first run fails
    expect(stateOf(harness, 1)?.state).toBe('backoff');

    await vi.advanceTimersByTimeAsync(120_000); // 60s * 2^1
    expect(harness.checkNow).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(240_000); // 60s * 2^2
    expect(harness.checkNow).toHaveBeenCalledTimes(3);

    const backoffDelays = harness.scheduledDelays.filter((delay) => delay > 0);
    expect(backoffDelays[0]).toBe(120_000);
    expect(backoffDelays[1]).toBe(240_000);
  });

  it('caps backoff at 30 minutes', async () => {
    const harness = makeHarness({ status: 'retryable-error' });
    harness.scheduler.syncFromServer([{ id: 1, intervalSeconds: 3600, active: true }]);

    for (let run = 0; run < 5; run++) {
      await vi.advanceTimersByTimeAsync(31 * 60_000);
    }

    const backoffDelays = harness.scheduledDelays.filter((delay) => delay > 0);
    const capped = backoffDelays[backoffDelays.length - 1];
    expect(capped).toBe(30 * 60_000);
    expect(Math.max(...backoffDelays)).toBeLessThanOrEqual(30 * 60_000);
  });

  it('stops the loop on permanent errors until manual action', async () => {
    const harness = makeHarness({ status: 'permanent-error', errorCode: 'PERMISSION_DENIED' });
    harness.scheduler.syncFromServer([{ id: 1, intervalSeconds: 60, active: true }]);

    await vi.advanceTimersByTimeAsync(0);
    expect(stateOf(harness, 1)?.state).toBe('error');

    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(harness.checkNow).toHaveBeenCalledTimes(1);
  });

  it('pauses and resumes a watcher locally', async () => {
    const harness = makeHarness();
    harness.scheduler.syncFromServer([{ id: 1, intervalSeconds: 60, active: true }]);
    await vi.advanceTimersByTimeAsync(0);
    expect(harness.checkNow).toHaveBeenCalledTimes(1);

    harness.scheduler.pause(1);
    expect(stateOf(harness, 1)?.state).toBe('paused');
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(harness.checkNow).toHaveBeenCalledTimes(1);

    harness.scheduler.resume(1);
    await vi.advanceTimersByTimeAsync(0);
    expect(harness.checkNow).toHaveBeenCalledTimes(2);
    expect(stateOf(harness, 1)?.state).toBe('scheduled');
  });

  it('stops the loop on CAPTCHA until manual resume', async () => {
    const harness = makeHarness({ status: 'captcha' });
    harness.scheduler.syncFromServer([{ id: 1, intervalSeconds: 60, active: true }]);

    await vi.advanceTimersByTimeAsync(0);
    expect(stateOf(harness, 1)?.state).toBe('captcha');

    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(harness.checkNow).toHaveBeenCalledTimes(1);

    harness.checkNow.mockResolvedValue({ status: 'ok' });
    harness.scheduler.resume(1);
    await vi.advanceTimersByTimeAsync(0);
    expect(harness.checkNow).toHaveBeenCalledTimes(2);
    expect(stateOf(harness, 1)?.state).toBe('scheduled');
  });

  it('auth-expired stops all loops and emits a global event', async () => {
    const harness = makeHarness();
    harness.checkNow.mockImplementation((watcherId: number) =>
      Promise.resolve(watcherId === 1 ? { status: 'auth-expired' } : { status: 'ok' }),
    );
    harness.scheduler.syncFromServer([
      { id: 1, intervalSeconds: 60, active: true },
      { id: 2, intervalSeconds: 60, active: true },
    ]);

    await vi.advanceTimersByTimeAsync(0);
    expect(stateOf(harness, 1)?.state).toBe('auth-expired');
    expect(stateOf(harness, 2)?.state).toBe('auth-expired');
    expect(harness.events.some((event) => event.type === 'auth-expired')).toBe(true);

    const callsAfterAuth = harness.checkNow.mock.calls.length;
    await vi.advanceTimersByTimeAsync(30 * 60_000);
    expect(harness.checkNow.mock.calls.length).toBe(callsAfterAuth);

    // A fresh sync (new login) restarts loops.
    harness.checkNow.mockResolvedValue({ status: 'ok' });
    harness.scheduler.syncFromServer([{ id: 1, intervalSeconds: 60, active: true }]);
    await vi.advanceTimersByTimeAsync(0);
    expect(stateOf(harness, 1)?.state).toBe('scheduled');
  });

  it('enforces the global concurrency cap of 3', async () => {
    const harness = makeHarness();
    const gates = Array.from({ length: 5 }, () => deferred<CheckOutcome>());
    harness.checkNow.mockImplementation(() => gates[harness.checkNow.mock.calls.length - 1].promise);

    harness.scheduler.syncFromServer(
      [1, 2, 3, 4, 5].map((id) => ({ id, intervalSeconds: 60, active: true })),
    );
    await vi.advanceTimersByTimeAsync(0);
    expect(harness.checkNow).toHaveBeenCalledTimes(3);

    gates[0].resolve({ status: 'ok' });
    await vi.advanceTimersByTimeAsync(0);
    expect(harness.checkNow).toHaveBeenCalledTimes(4);

    gates[1].resolve({ status: 'ok' });
    await vi.advanceTimersByTimeAsync(0);
    expect(harness.checkNow).toHaveBeenCalledTimes(5);

    gates[2].resolve({ status: 'ok' });
    gates[3].resolve({ status: 'ok' });
    gates[4].resolve({ status: 'ok' });
    await vi.advanceTimersByTimeAsync(0);
    expect(harness.checkNow).toHaveBeenCalledTimes(5);
  });

  it('onWake recalculates timers and runs due watchers immediately', async () => {
    const harness = makeHarness();
    harness.scheduler.syncFromServer([{ id: 1, intervalSeconds: 60, active: true }]);
    await vi.advanceTimersByTimeAsync(0);
    expect(harness.checkNow).toHaveBeenCalledTimes(1);

    harness.scheduler.onWake();
    await vi.advanceTimersByTimeAsync(0);
    expect(harness.checkNow).toHaveBeenCalledTimes(2);
  });

  it('syncFromServer starts new loops, pauses inactive ones and removes deleted ones', async () => {
    const harness = makeHarness();
    harness.scheduler.syncFromServer([
      { id: 1, intervalSeconds: 60, active: true },
      { id: 2, intervalSeconds: 60, active: true },
    ]);
    await vi.advanceTimersByTimeAsync(0);
    expect(harness.scheduler.getRuntime()).toHaveLength(2);

    harness.scheduler.syncFromServer([{ id: 1, intervalSeconds: 60, active: true }]);
    expect(harness.scheduler.getRuntime()).toHaveLength(1);

    harness.scheduler.syncFromServer([{ id: 1, intervalSeconds: 60, active: false }]);
    expect(stateOf(harness, 1)?.state).toBe('paused');

    const callsBefore = harness.checkNow.mock.calls.length;
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(harness.checkNow.mock.calls.length).toBe(callsBefore);
  });

  it('emits watcher-state events with state and nextRunAt', async () => {
    const harness = makeHarness();
    harness.scheduler.syncFromServer([{ id: 1, intervalSeconds: 60, active: true }]);
    await vi.advanceTimersByTimeAsync(0);

    const states = harness.events
      .filter((event) => event.type === 'watcher-state')
      .map((event) => (event.type === 'watcher-state' ? event.state : null));
    expect(states).toContain('scheduled');
    expect(states).toContain('checking');

    const scheduledEvent = harness.events.find(
      (event) => event.type === 'watcher-state' && event.state === 'scheduled',
    );
    expect(
      scheduledEvent?.type === 'watcher-state' ? scheduledEvent.nextRunAt : undefined,
    ).toBeTypeOf('number');
  });
});
