import { describe, expect, it, vi } from 'vitest';
import { OfficialWorker } from '../../src/main/official-worker';

describe('OfficialWorker', () => {
  it('finds slots, books through the official API, and reports the result to Django', async () => {
    const api = {
      watcherLocalStart: vi.fn().mockResolvedValue({
        checked: true,
        run_id: 'run-1',
        service_id: 41,
        provider_id: 525,
        start_date: '2026-07-25',
        days_ahead: 7,
      }),
      watcherLocalPlan: vi.fn().mockResolvedValue({
        run_id: 'run-1',
        jobs: [{
          booking_id: 9,
          client_id: 4,
          application_id: 'WPT-4',
          date: '2026-07-25',
          start_time: '09:00',
          end_time: '09:30',
          application_payload: { applicationMetaDataDTO: { applicationID: 'WPT-4' } },
          booking_payload: {
            providerID: 525,
            providerName: 'DAO Kathmandu',
            locationID: 27,
            serviceID: 41,
            serviceName: 'Passport_Enrollment',
            phone: '9800000000',
            email: 'client@example.com',
            applicantName: 'Test Client',
          },
        }],
      }),
      watcherLocalComplete: vi.fn().mockImplementation((_id, _run, _slots, results) =>
        Promise.resolve({ watcher: {}, checked: true, slots_found: 1, booked: results, errors: [] }),
      ),
    };
    const official = {
      findSlots: vi.fn().mockResolvedValue([
        { date: '2026-07-25', start_time: '09:00', end_time: '09:30' },
      ]),
      bookAppointment: vi.fn().mockResolvedValue({ id: 'APT-1' }),
      refreshReceipt: vi.fn().mockResolvedValue('JVBERi0='),
      appointmentRecords: vi.fn(),
    };

    const result = await new OfficialWorker(api as never, official as never).checkWatcher(3, true);

    expect(result.slots_found).toBe(1);
    expect(official.bookAppointment).toHaveBeenCalledWith({
      applicationId: 'WPT-4',
      providerId: 525,
      providerName: 'DAO Kathmandu',
      locationId: 27,
      date: '2026-07-25',
      startTime: '09:00',
      phone: '9800000000',
      email: 'client@example.com',
      applicantName: 'Test Client',
      serviceId: 41,
      serviceName: 'Passport_Enrollment',
    });
    expect(api.watcherLocalComplete).toHaveBeenCalledWith(
      3,
      'run-1',
      [{ date: '2026-07-25', start_time: '09:00', end_time: '09:30' }],
      [expect.objectContaining({ booking_id: 9, booked: true, application_id: 'WPT-4' })],
    );
  });

  it('books demo clients through the same local watcher worker', async () => {
    const api = {
      labBookLocalPrepare: vi.fn().mockResolvedValue({
        batch_id: 'lab-1',
        watchers: [{ watcher_id: 12, record_id: 7 }],
      }),
      watcherLocalStart: vi.fn().mockResolvedValue({
        checked: false,
        watcher: { available_slots: [] },
      }),
      labBookLocalComplete: vi.fn().mockResolvedValue({ batch_id: 'lab-1' }),
    };
    const worker = new OfficialWorker(api as never, {} as never);

    await expect(
      worker.bookLab({ client_ids: [7], idempotency_key: 'book-lab-1' }),
    ).resolves.toEqual({ batch_id: 'lab-1' });

    expect(api.watcherLocalStart).toHaveBeenCalledWith(12, true);
    expect(api.labBookLocalComplete).toHaveBeenCalledWith('lab-1');
  });
});
