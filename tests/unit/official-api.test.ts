import { describe, expect, it, vi } from 'vitest';
import { OfficialApi } from '../../src/main/official-api';

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('OfficialApi', () => {
  it('finds slots directly with one cached anonymous token', async () => {
    const fetchFn = vi.fn(async (url: string) => {
      if (url.endsWith('/interface-adapter/get-free-access-token')) return json({ token: 'free-token' });
      if (url.includes('/findNonWorkingDays?')) {
        return json({ data: { localDates: ['2026-07-26'], maxEndDate: '2026-07-27' } });
      }
      if (url.includes('startDate=2026-07-25')) {
        return json({ data: [{ startTime: '09:00', endTime: '09:30' }] });
      }
      return json({ data: [] });
    });
    const api = new OfficialApi({ fetchFn });

    await expect(api.findSlots(41, 525, '2026-07-25', 3)).resolves.toEqual([
      { date: '2026-07-25', start_time: '09:00', end_time: '09:30' },
    ]);

    expect(fetchFn).toHaveBeenCalledTimes(4);
    expect(fetchFn.mock.calls.filter(([url]) => url.endsWith('/get-free-access-token'))).toHaveLength(1);
    expect(fetchFn.mock.calls[1][0]).toContain('serviceID=41&providerID=525');
  });

  it('submits, searches, and cancels without a portal window', async () => {
    const fetchFn = vi.fn(async (url: string) => {
      if (url.endsWith('/interface-adapter/get-free-access-token')) return json({ token: 'free-token' });
      if (url.endsWith('/interface-adapter/reports/summary')) return json('JVBERi0=');
      if (url.endsWith('/process-state-controller/public/applications')) return json({ ok: true });
      if (url.includes('/v1/external/public/search?')) return json({ data: [{ status: 'SCHEDULED' }] });
      if (url.endsWith('/v1/external/public/cancelAppointment')) return json({ status: 'CANCELED' });
      throw new Error(`Unexpected URL: ${url}`);
    });
    const api = new OfficialApi({ fetchFn });

    await expect(api.submitApplication({ application: 'WPT-1' })).resolves.toBe('JVBERi0=');
    await expect(api.appointmentRecords('WPT-1')).resolves.toEqual([{ status: 'SCHEDULED' }]);
    await expect(api.cancelAppointment('WPT-1')).resolves.toEqual({ status: 'CANCELED' });

    expect(fetchFn.mock.calls.filter(([url]) => url.endsWith('/get-free-access-token'))).toHaveLength(1);
  });

  it('replaces the cached anonymous token on refresh', async () => {
    let token = 0;
    const fetchFn = vi.fn(async () => json({ token: `token-${++token}` }));
    const api = new OfficialApi({ fetchFn });

    await expect(api.getFreeToken()).resolves.toBe('token-1');
    await api.refreshToken();
    await expect(api.getFreeToken()).resolves.toBe('token-2');
  });
});
