import { describe, expect, it, vi } from 'vitest';
import { OfficialWorker } from '../../src/main/official-worker';

describe('OfficialWorker', () => {
  it('checks a device-local notify watcher without calling the web API', async () => {
    const watcher = {
      id: 1,
      mode: 'notify',
      provider_id: 525,
      days_ahead: 7,
      notify: true,
      available_slots: [],
    };
    const api = { localWatcherBookStart: vi.fn() };
    const official = {
      findSlots: vi.fn().mockResolvedValue([
        { date: '2026-07-25', start_time: '09:00', end_time: '09:30' },
      ]),
    };
    const localWatchers = {
      get: vi.fn().mockReturnValue(watcher),
      recordCheck: vi.fn().mockReturnValue({ ...watcher, available_slots: [] }),
    };
    const onSlotsFound = vi.fn();

    const result = await new OfficialWorker(
      api as never,
      official as never,
      undefined,
      undefined,
      localWatchers as never,
      onSlotsFound,
    ).checkWatcher(1, false);

    expect(result.slots_found).toBe(1);
    expect(api.localWatcherBookStart).not.toHaveBeenCalled();
    expect(localWatchers.recordCheck).toHaveBeenCalledWith(
      1,
      [{ date: '2026-07-25', start_time: '09:00', end_time: '09:30' }],
      '',
      0,
    );
    expect(onSlotsFound).toHaveBeenCalledOnce();
  });

  it('finds slots, books through the official API, and reports the result to Django', async () => {
    const api = {
      watcherLocalStart: vi.fn().mockResolvedValue({
        checked: true,
        run_id: 'run-1',
        service_id: 41,
        provider_id: 525,
        start_date: '2026-07-25',
        days_ahead: 7,
        jobs: [{
          client_id: 4,
          application_id: 'WPT-4',
          date: '2026-07-25',
          start_time: '00:00',
          end_time: '00:00',
          application_payload: {
            applicationMetaDataDTO: { applicationID: 'WPT-4' },
            genericFieldsDTO: { genericFieldDTOList: [
              { key: 'appointmentDate', value: '25/07/2026' },
              { key: 'appointmentTime', value: '00:00' },
            ] },
          },
          booking_payload: {
            providerID: 525,
            providerName: 'DAO Kathmandu',
            locationID: 27,
            serviceID: 41,
            serviceName: 'Passport_Enrollment',
            phone: '9800000000',
            email: 'client@example.com',
            applicantName: 'Test Client',
            date: '2026-07-25',
            startTime: '00:00',
          },
        }],
      }),
      watcherLocalPlan: vi.fn(),
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

    const result = await new OfficialWorker(api as never, official as never).checkWatcher(
      3, true, undefined, [4],
    );

    expect(result.slots_found).toBe(1);
    expect(api.watcherLocalStart).toHaveBeenCalledWith(3, true, [4]);
    expect(api.watcherLocalPlan).not.toHaveBeenCalled();
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
      [expect.objectContaining({ client_id: 4, booked: true, application_id: 'WPT-4' })],
    );
  });

  it('books queue clients in parallel with a maximum of 20 at a time', async () => {
    const jobs = Array.from({ length: 25 }, (_, index) => ({
      client_id: index + 1,
      application_id: `WPT-${index + 1}`,
      date: '2026-07-25',
      start_time: '00:00',
      end_time: '00:00',
      application_payload: {
        applicationMetaDataDTO: { applicationID: `WPT-${index + 1}` },
      },
      booking_payload: {
        providerID: 525,
        providerName: 'DAO Kathmandu',
        locationID: 27,
        serviceID: 41,
        serviceName: 'Passport_Enrollment',
        phone: '9800000000',
        email: `client-${index + 1}@example.com`,
        applicantName: `Client ${index + 1}`,
      },
    }));
    const slots = jobs.map((_, index) => ({
      date: '2026-07-25',
      start_time: `${String(9 + Math.floor(index / 2)).padStart(2, '0')}:${index % 2 ? '30' : '00'}`,
      end_time: '23:59',
    }));
    const api = {
      localWatcherBookStart: vi.fn().mockResolvedValue({
        watcher_id: 30,
        run_id: 'run-20',
        jobs,
      }),
      watcherLocalComplete: vi.fn().mockImplementation((_id, _run, _slots, results) =>
        Promise.resolve({ watcher: {}, checked: true, slots_found: slots.length, booked: results, errors: [] }),
      ),
    };
    let inFlight = 0;
    let maxInFlight = 0;
    const official = {
      findSlots: vi.fn().mockResolvedValue(slots),
      bookAppointment: vi.fn().mockImplementation(async () => {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 5));
        inFlight -= 1;
        return { id: 'APT' };
      }),
      refreshReceipt: vi.fn().mockResolvedValue('JVBERi0='),
      appointmentRecords: vi.fn(),
    };
    const watcher = {
      id: 3,
      mode: 'book',
      provider_id: 525,
      days_ahead: 7,
      notify: true,
      available_slots: [],
    };
    const localWatchers = {
      get: vi.fn().mockReturnValue(watcher),
      recordCheck: vi.fn().mockReturnValue(watcher),
    };

    await new OfficialWorker(
      api as never,
      official as never,
      undefined,
      undefined,
      localWatchers as never,
    ).checkWatcher(3, true, undefined, jobs.map((job) => job.client_id));

    expect(maxInFlight).toBe(20);
    expect(official.bookAppointment).toHaveBeenCalledTimes(25);
    expect(api.localWatcherBookStart.mock.invocationCallOrder[0]).toBeGreaterThan(
      official.findSlots.mock.invocationCallOrder[0],
    );
  });

  it('starts a lab booking and returns the batch id from prepare', async () => {
    const api = {
      labBookLocalPrepare: vi.fn().mockResolvedValue({
        batch_id: 'lab-1',
        watchers: [{ watcher_id: 12, record_id: 7, client_id: 17 }],
      }),
      // Background work settles cleanly; the return value comes from prepare.
      watcherLocalStart: vi.fn().mockResolvedValue({ checked: false, watcher: { available_slots: [] } }),
      labBookLocalComplete: vi.fn().mockResolvedValue({ batch_id: 'lab-1' }),
    };
    const worker = new OfficialWorker(api as never, {} as never);
    await expect(
      worker.bookLab({ client_ids: [7], idempotency_key: 'book-lab-1' }),
    ).resolves.toEqual({ batch_id: 'lab-1' });
    expect(api.labBookLocalPrepare).toHaveBeenCalledOnce();
  });

  it('runs lab bookings in bounded chunks, reporting each chunk and finishing on the last', async () => {
    const watchers = Array.from({ length: 6 }, (_, index) => ({
      watcher_id: index + 1, record_id: index + 100, client_id: index + 200,
    }));
    let inFlight = 0;
    let maxInFlight = 0;
    const api = {
      watcherLocalStart: vi.fn().mockImplementation(async () => {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 1));
        inFlight -= 1;
        return { checked: false, watcher: { available_slots: [] } };
      }),
      labBookLocalComplete: vi.fn().mockResolvedValue({ batch_id: 'lab-1' }),
    };
    const worker = new OfficialWorker(api as never, {} as never);

    await worker.runLabBooking('lab-1', watchers);

    expect(maxInFlight).toBeLessThanOrEqual(4);
    expect(api.watcherLocalStart).toHaveBeenCalledTimes(6);
    // Two chunks (4 + 2): first reports its record ids with final=false.
    expect(api.labBookLocalComplete).toHaveBeenCalledTimes(2);
    expect(api.labBookLocalComplete).toHaveBeenNthCalledWith(1, 'lab-1', [100, 101, 102, 103], false);
    expect(api.labBookLocalComplete).toHaveBeenNthCalledWith(2, 'lab-1', [104, 105], true);
  });

  it('starts a lab submission and returns the batch id from prepare', async () => {
    const api = {
      labSubmitLocalPrepare: vi.fn().mockResolvedValue({ batch_id: 'batch-1', jobs: [] }),
      labSubmitLocalComplete: vi.fn().mockResolvedValue({ batch_id: 'batch-1' }),
    };
    const worker = new OfficialWorker(api as never, {} as never);
    await expect(
      worker.submitLab({ clients: [], idempotency_key: 'sub-1' }),
    ).resolves.toEqual({ batch_id: 'batch-1' });
    expect(api.labSubmitLocalPrepare).toHaveBeenCalledOnce();
  });

  it('submits lab clients in bounded concurrent chunks, finishing the job only on the last chunk', async () => {
    const jobs = Array.from({ length: 50 }, (_, index) => ({
      client_id: index + 1, index, name: `Client ${index + 1}`,
      application_payload: { applicationMetaDataDTO: { applicationID: null } },
    }));
    const api = {
      labSubmitLocalComplete: vi.fn().mockResolvedValue({ batch_id: 'batch-1' }),
    };
    let inFlight = 0;
    let maxInFlight = 0;
    const official = {
      reserveApplicationId: vi.fn().mockImplementation(async () => {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 1));
        inFlight -= 1;
        return 'APP-X';
      }),
      submitApplication: vi.fn().mockResolvedValue('JVBERi0='),
    };
    const worker = new OfficialWorker(api as never, official as never);

    await worker.runLabSubmission('batch-1', jobs);

    // A full 50-client batch stays capped at four concurrent official submissions.
    expect(maxInFlight).toBeLessThanOrEqual(4);
    expect(official.reserveApplicationId).toHaveBeenCalledTimes(50);
    expect(api.labSubmitLocalComplete).toHaveBeenCalledTimes(13);
    expect(api.labSubmitLocalComplete).toHaveBeenNthCalledWith(
      1, 'batch-1', expect.arrayContaining([expect.objectContaining({ client_id: 1 })]), false,
    );
    expect(api.labSubmitLocalComplete).toHaveBeenNthCalledWith(
      13, 'batch-1', expect.arrayContaining([expect.objectContaining({ client_id: 49 })]), true,
    );
  });

  it('retries a transient completion failure without losing submitted clients', async () => {
    const jobs = [{ client_id: 1, index: 0, application_payload: { applicationMetaDataDTO: {} } }];
    const api = {
      labSubmitLocalComplete: vi.fn()
        .mockRejectedValueOnce(new Error('network down'))
        .mockResolvedValue({ batch_id: 'batch-1' }),
    };
    const official = {
      reserveApplicationId: vi.fn().mockResolvedValue('APP-1'),
      submitApplication: vi.fn().mockResolvedValue('JVBERi0='),
    };
    const worker = new OfficialWorker(api as never, official as never);

    await worker.runLabSubmission('batch-1', jobs);

    // The same idempotent results are retried instead of falsely finishing empty.
    expect(api.labSubmitLocalComplete).toHaveBeenCalledTimes(2);
    expect(api.labSubmitLocalComplete).toHaveBeenLastCalledWith(
      'batch-1',
      [expect.objectContaining({ client_id: 1, application_id: 'APP-1' })],
      true,
    );
  });

  it('makes fresh clients ready by reserving and submitting an application id per job', async () => {
    const api = {
      clientsSubmitPlan: vi.fn().mockResolvedValue({
        jobs: [{
          client_id: 1, name: 'Fresh Client',
          application_payload: { applicationMetaDataDTO: { applicationID: null } },
        }],
        already_ready: [{ client_id: 2, name: 'Already Ready', official_application_id: 'APP-2' }],
        errors: [{ client_id: 3, name: 'Missing Docs', error: 'Missing required documents: X.' }],
      }),
      clientsSubmitComplete: vi.fn().mockResolvedValue({
        submitted: [{ client_id: 1, name: 'Fresh Client', official_application_id: 'APP-1' }],
        failed: [],
      }),
    };
    const official = {
      reserveApplicationId: vi.fn().mockResolvedValue('APP-1'),
      submitApplication: vi.fn().mockResolvedValue('JVBERi0='),
    };
    const worker = new OfficialWorker(api as never, official as never);

    const result = await worker.submitClients({ client_ids: [1, 2, 3] });

    expect(official.reserveApplicationId).toHaveBeenCalledOnce();
    expect(official.submitApplication).toHaveBeenCalledWith({
      applicationMetaDataDTO: { applicationID: 'APP-1' },
    });
    expect(api.clientsSubmitComplete).toHaveBeenCalledWith([
      { client_id: 1, application_id: 'APP-1', receipt: 'JVBERi0=' },
    ]);
    expect(result).toEqual({
      submitted: [
        { client_id: 2, name: 'Already Ready', official_application_id: 'APP-2' },
        { client_id: 1, name: 'Fresh Client', official_application_id: 'APP-1' },
      ],
      failed: [{ client_id: 3, name: 'Missing Docs', error: 'Missing required documents: X.' }],
    });
  });

  it('reports a failed submission without aborting other jobs', async () => {
    const api = {
      clientsSubmitPlan: vi.fn().mockResolvedValue({
        jobs: [{ client_id: 1, name: 'Fails', application_payload: {} }],
        already_ready: [],
        errors: [],
      }),
      clientsSubmitComplete: vi.fn().mockResolvedValue({
        submitted: [],
        failed: [{ client_id: 1, name: 'Fails', error: 'Official submission failed' }],
      }),
    };
    const official = {
      reserveApplicationId: vi.fn().mockRejectedValue(new Error('Official submission failed')),
      submitApplication: vi.fn(),
    };
    const worker = new OfficialWorker(api as never, official as never);

    const result = await worker.submitClients({ client_ids: [1] });

    expect(official.submitApplication).not.toHaveBeenCalled();
    expect(api.clientsSubmitComplete).toHaveBeenCalledWith([
      { client_id: 1, application_id: '', error: 'Official submission failed' },
    ]);
    expect(result.failed).toEqual([{ client_id: 1, name: 'Fails', error: 'Official submission failed' }]);
  });
});
