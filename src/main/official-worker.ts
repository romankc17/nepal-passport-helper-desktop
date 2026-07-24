import type {
  ClientSubmitInput,
  ClientSubmitResult,
  LocalBookingJob,
  LocalBookingResult,
  ReconcileResult,
  LabSubmitInput,
  LabBookInput,
  Watcher,
  WatcherCheckResult,
} from '../shared/types';
import { ApiError, type ApiClient } from './api-client';
import type { FoundOfficialSlot, OfficialApi } from './official-api';
import type { LocalQueueStore } from './local-queue';
import type { LocalWatcherStore } from './local-watchers';

// The government gateway starts dropping connections / demanding CAPTCHA
// under too much concurrent traffic from one process (see official-api.ts);
// application submissions run in small batches rather than all at once.
const SUBMIT_CHUNK_SIZE = 4;
const BOOKING_CHUNK_SIZE = 20;

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let offset = 0; offset < items.length; offset += size) {
    chunks.push(items.slice(offset, offset + size));
  }
  return chunks;
}

async function retryCompletion<T>(operation: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await operation();
    } catch (error) {
      if (attempt === 2 || (error instanceof ApiError && !error.retryable)) throw error;
      await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)));
    }
  }
}

function applySlot(template: LocalBookingJob, slot: FoundOfficialSlot): LocalBookingJob {
  const job = structuredClone(template);
  job.date = slot.date;
  job.start_time = slot.start_time;
  job.end_time = slot.end_time;
  job.booking_payload.date = slot.date;
  job.booking_payload.startTime = slot.start_time;
  const fields = (
    job.application_payload.genericFieldsDTO as
      | { genericFieldDTOList?: unknown }
      | undefined
  )?.genericFieldDTOList;
  if (Array.isArray(fields)) {
    const [year, month, day] = slot.date.split('-');
    for (const field of fields) {
      if (!field || typeof field !== 'object') continue;
      const item = field as { key?: string; value?: unknown };
      if (item.key === 'appointmentDate') item.value = `${day}/${month}/${year}`;
      if (item.key === 'appointmentTime') item.value = slot.start_time;
    }
  }
  return job;
}

export class OfficialWorker {
  constructor(
    private readonly api: ApiClient,
    private readonly official: OfficialApi,
    private readonly localQueue?: LocalQueueStore,
    private readonly onQueueChange: () => void = () => undefined,
    private readonly localWatchers?: LocalWatcherStore,
    private readonly onSlotsFound: (
      watcher: Watcher,
      slots: FoundOfficialSlot[],
    ) => void = () => undefined,
  ) {}

  async refreshToken(): Promise<void> {
    await this.official.refreshToken();
  }

  async checkWatcher(
    watcherId: number,
    force: boolean,
    selectedSlots?: string[],
    requestedClientIds?: number[],
  ): Promise<WatcherCheckResult> {
    if (this.localWatchers) {
      return this.checkLocalWatcher(watcherId, selectedSlots, requestedClientIds);
    }
    const clientIds = requestedClientIds ?? this.localQueue
      ?.all()
      .filter((item) => item.status === 'queued' || (item.status === 'failed' && !item.permanent))
      .map((item) => item.client_id) ?? [];
    const start = await this.api.watcherLocalStart(watcherId, force, clientIds);
    if (!start.checked) {
      return {
        watcher: start.watcher!,
        checked: false,
        slots_found: start.watcher?.available_slots.length ?? 0,
        booked: [],
        errors: [],
      };
    }
    const runId = start.run_id!;
    let slots: FoundOfficialSlot[] = [];
    try {
      slots = await this.official.findSlots(
        start.service_id!,
        start.provider_id!,
        start.start_date!,
        start.days_ahead!,
      );
      if (selectedSlots?.length) {
        const selected = new Set(selectedSlots);
        slots = slots.filter((slot) => selected.has(`${slot.date}|${slot.start_time}`));
      }
      const jobs = start.jobs
        ? start.jobs.slice(0, slots.length).map((job, index) => applySlot(job, slots[index]))
        : (await this.api.watcherLocalPlan(watcherId, runId, slots, clientIds)).jobs;
      for (const job of jobs) this.localQueue?.setStatus(job.client_id, 'booking');
      if (jobs.length) this.onQueueChange();
      const results: LocalBookingResult[] = [];
      for (let offset = 0; offset < jobs.length; offset += BOOKING_CHUNK_SIZE) {
        results.push(
          ...(await Promise.all(
            jobs.slice(offset, offset + BOOKING_CHUNK_SIZE).map((job) => this.runJob(job)),
          )),
        );
      }
      const completed = await this.api.watcherLocalComplete(watcherId, runId, slots, results);
      for (const result of results) {
        this.localQueue?.update(result.client_id, result.booked ? {
          status: 'booked',
          official_application_id: result.application_id,
          appointment: { date: result.date, start_time: result.start_time },
          error: undefined,
        } : {
          status: 'failed',
          official_application_id: result.application_id,
          error: result.error,
        });
      }
      if (results.length) this.onQueueChange();
      return completed;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Official portal request failed';
      try {
        await this.api.watcherLocalComplete(watcherId, runId, slots, [], message);
      } catch {
        // Preserve the official error; the server lease expires automatically.
      }
      throw error;
    }
  }

  private async checkLocalWatcher(
    watcherId: number,
    selectedSlots?: string[],
    requestedClientIds?: number[],
  ): Promise<WatcherCheckResult> {
    const watcher = this.localWatchers!.get(watcherId);
    let slots: FoundOfficialSlot[] = [];
    try {
      const localToday = new Date(Date.now() - new Date().getTimezoneOffset() * 60_000)
        .toISOString()
        .slice(0, 10);
      slots = await this.official.findSlots(
        41,
        watcher.provider_id,
        localToday,
        watcher.days_ahead,
      );
      if (selectedSlots?.length) {
        const selected = new Set(selectedSlots);
        slots = slots.filter((slot) => selected.has(`${slot.date}|${slot.start_time}`));
      }

      const clientIds = requestedClientIds ?? this.localQueue
        ?.forProvider(watcher.provider_id)
        .filter((item) => item.status === 'queued' || (item.status === 'failed' && !item.permanent))
        .map((item) => item.client_id) ?? [];
      const results: LocalBookingResult[] = [];
      if (watcher.mode === 'book' && slots.length && clientIds.length) {
        const plan = await this.api.localWatcherBookStart({
          watcher,
          client_ids: clientIds,
          slots,
        });
        for (const job of plan.jobs) this.localQueue?.setStatus(job.client_id, 'booking');
        if (plan.jobs.length) this.onQueueChange();
        for (let offset = 0; offset < plan.jobs.length; offset += BOOKING_CHUNK_SIZE) {
          results.push(
            ...(await Promise.all(
              plan.jobs
                .slice(offset, offset + BOOKING_CHUNK_SIZE)
                .map((job) => this.runJob(job)),
            )),
          );
        }
        await this.api.watcherLocalComplete(
          plan.watcher_id,
          plan.run_id,
          slots,
          results,
        );
        for (const result of results) {
          this.localQueue?.update(result.client_id, result.booked ? {
            status: 'booked',
            official_application_id: result.application_id,
            appointment: { date: result.date, start_time: result.start_time },
            error: undefined,
          } : {
            status: 'failed',
            official_application_id: result.application_id,
            error: result.error,
          });
        }
        if (results.length) this.onQueueChange();
      }

      const booked = results.filter((result) => result.booked);
      const updated = this.localWatchers!.recordCheck(watcherId, slots, '', booked.length);
      const previousSlots = new Set(
        watcher.available_slots.map((slot) => `${slot.date}|${slot.start_time}|${slot.end_time}`),
      );
      const newSlots = slots.filter(
        (slot) => !previousSlots.has(`${slot.date}|${slot.start_time}|${slot.end_time}`),
      );
      if (watcher.mode === 'notify' && watcher.notify && newSlots.length) {
        this.onSlotsFound(updated, newSlots);
      }
      return {
        watcher: updated,
        checked: true,
        slots_found: slots.length,
        booked,
        errors: results
          .filter((result) => !result.booked)
          .map((result) => ({ client_id: result.client_id, message: result.error })),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Official portal request failed';
      this.localWatchers!.recordCheck(watcherId, slots, message);
      throw error;
    }
  }

  async cancelBooking(
    bookingId: number,
  ): Promise<{ cancelled: true; booking_id: number; application_id: string }> {
    const plan = await this.api.appointmentLocalCancelPlan(bookingId);
    const records = await this.official.appointmentRecords(plan.application_id);
    const scheduled = records.filter((item) => String(item.status).toUpperCase() === 'SCHEDULED');
    if (scheduled.length > 1) {
      throw new Error('The official portal returned multiple active appointments; cancellation was stopped');
    }
    if (records.length > 0 && scheduled.length === 0) {
      throw new Error('This application has no active official appointment to cancel');
    }
    let response: Record<string, unknown>;
    try {
      response = await this.official.cancelAppointment(plan.application_id);
    } catch (error) {
      const stillScheduled = (await this.official.appointmentRecords(plan.application_id)).some(
        (item) => String(item.status).toUpperCase() === 'SCHEDULED',
      );
      if (stillScheduled) throw error;
      response = { status: 'CANCELED', verified: true };
    }
    return this.api.appointmentLocalCancelComplete(bookingId, response);
  }

  async reconcile(clientIds?: number[], lab = false): Promise<ReconcileResult> {
    const plan = await this.api.appointmentsLocalReconcilePlan(clientIds, lab);
    const items = await Promise.all(
      plan.items.map(async (item) => ({
        client_id: item.client_id,
        record:
          (await this.official.appointmentRecords(item.application_id)).find(
            (record) => String(record.status).toUpperCase() === 'SCHEDULED',
          ) ?? null,
      })),
    );
    return this.api.appointmentsLocalReconcileComplete(items);
  }

  /**
   * Kicks off a lab submission and returns the batch id immediately — the
   * official portal calls run in the background so the renderer's job polling
   * shows live progress instead of the IPC call blocking until all (up to 50)
   * clients finish. Failures are reported per client; the job is always
   * marked finished so the poller never hangs.
   */
  async submitLab(input: LabSubmitInput): Promise<{ batch_id: string }> {
    const plan = await this.api.labSubmitLocalPrepare(input);
    void this.runLabSubmission(plan.batch_id, plan.jobs);
    return { batch_id: plan.batch_id };
  }

  // Public for tests; awaits the whole background submission.
  async runLabSubmission(
    batchId: string,
    jobs: { client_id: number; index: number; application_payload: Record<string, unknown> }[],
  ): Promise<void> {
    const chunks = chunk(jobs, SUBMIT_CHUNK_SIZE);
    if (chunks.length === 0) chunks.push([]);
    let finalSent = false;
    try {
      for (const [chunkIndex, group] of chunks.entries()) {
        const results = await Promise.all(group.map(async (job) => {
          let applicationId = '';
          try {
            applicationId = await this.official.reserveApplicationId();
            const payload = structuredClone(job.application_payload);
            setApplicationId(payload, applicationId);
            const receipt = await this.official.submitApplication(payload);
            return { client_id: job.client_id, index: job.index, application_id: applicationId, receipt };
          } catch (error) {
            return {
              client_id: job.client_id, index: job.index, application_id: applicationId,
              error: error instanceof Error ? error.message : 'Official submission failed',
            };
          }
        }));
        const isLast = chunkIndex === chunks.length - 1;
        await retryCompletion(() =>
          this.api.labSubmitLocalComplete(batchId, results, isLast),
        );
        if (isLast) finalSent = true;
      }
    } catch {
      // A completion call itself failed (e.g. network). Never leave the job
      // unfinished — the renderer polls until finished.
      // ponytail: best-effort; a chunk whose results never landed is lost, and
      // reconcile heals any application submitted-but-not-recorded.
      if (!finalSent) {
        await this.api.labSubmitLocalComplete(batchId, [], true).catch(() => undefined);
      }
    }
  }

  /** "Make Ready": submit fresh/cancelled real clients to the official
   * pre-enrollment form, independent of booking. Clients that already have
   * an official_application_id are reported back as submitted immediately
   * (see clients_submit_plan's already_ready). */
  async submitClients(input: ClientSubmitInput): Promise<ClientSubmitResult> {
    const plan = await this.api.clientsSubmitPlan(input);
    const jobResults: { client_id: number; application_id: string; receipt?: string; error?: string }[] = [];
    for (const jobs of chunk(plan.jobs, SUBMIT_CHUNK_SIZE)) {
      jobResults.push(...(await Promise.all(jobs.map(async (job) => {
        try {
          const applicationId = await this.official.reserveApplicationId();
          const payload = structuredClone(job.application_payload);
          setApplicationId(payload, applicationId);
          const receipt = await this.official.submitApplication(payload);
          return { client_id: job.client_id, application_id: applicationId, receipt };
        } catch (error) {
          return {
            client_id: job.client_id, application_id: '',
            error: error instanceof Error ? error.message : 'Official submission failed',
          };
        }
      }))));
    }
    const completed = jobResults.length
      ? await this.api.clientsSubmitComplete(jobResults)
      : { submitted: [], failed: [] };
    return {
      submitted: [...plan.already_ready, ...completed.submitted],
      failed: [...plan.errors, ...completed.failed],
    };
  }

  /**
   * Kicks off lab bookings and returns the batch id immediately. Watcher
   * checks run in the background in chunks (never all 50 at once against the
   * government gateway); each chunk reports its records to the server so the
   * per-client progress advances live. The job is always finished.
   */
  async bookLab(input: LabBookInput): Promise<{ batch_id: string }> {
    const plan = await this.api.labBookLocalPrepare(input);
    void this.runLabBooking(plan.batch_id, plan.watchers);
    return { batch_id: plan.batch_id };
  }

  // Public for tests; awaits the whole background booking.
  async runLabBooking(
    batchId: string,
    watchers: { watcher_id: number; record_id: number; client_id: number }[],
  ): Promise<void> {
    const chunks = chunk(watchers, SUBMIT_CHUNK_SIZE);
    if (chunks.length === 0) chunks.push([]);
    let finalSent = false;
    try {
      for (const [chunkIndex, group] of chunks.entries()) {
        await Promise.allSettled(
          group.map(({ watcher_id, client_id }) =>
            this.checkWatcher(watcher_id, true, undefined, [client_id]),
          ),
        );
        const isLast = chunkIndex === chunks.length - 1;
        await retryCompletion(() =>
          this.api.labBookLocalComplete(
            batchId, group.map(({ record_id }) => record_id), isLast,
          ),
        );
        if (isLast) finalSent = true;
      }
    } catch {
      if (!finalSent) {
        await this.api.labBookLocalComplete(batchId, [], true).catch(() => undefined);
      }
    }
  }

  private async runJob(job: LocalBookingJob): Promise<LocalBookingResult> {
    let applicationId = job.application_id;
    let receipt: string | undefined;
    let response: Record<string, unknown> = {};
    let date = job.date;
    let startTime = job.start_time;
    try {
      const applicationPayload = structuredClone(job.application_payload);
      if (!applicationId) applicationId = await this.official.reserveApplicationId();
      setApplicationId(applicationPayload, applicationId);
      if (!job.application_id) {
        receipt = await this.official.submitApplication(applicationPayload);
      }
      try {
        response = await this.official.bookAppointment({
          applicationId,
          providerId: requiredField(job.booking_payload, 'providerID'),
          providerName: requiredString(job.booking_payload, 'providerName'),
          locationId: requiredField(job.booking_payload, 'locationID'),
          date,
          startTime,
          phone: requiredString(job.booking_payload, 'phone'),
          email: requiredString(job.booking_payload, 'email'),
          applicantName: requiredString(job.booking_payload, 'applicantName'),
          serviceId: requiredField(job.booking_payload, 'serviceID'),
          serviceName: requiredString(job.booking_payload, 'serviceName'),
        });
        if (!response.id) throw new Error('The official portal did not confirm the appointment');
      } catch (bookingError) {
        const scheduled = (await this.official.appointmentRecords(applicationId)).find(
          (item) => String(item.status).toUpperCase() === 'SCHEDULED',
        );
        if (!scheduled) throw bookingError;
        response = { id: applicationId, alreadyScheduled: true, appointment: scheduled };
        if (typeof scheduled.date === 'string') date = scheduled.date;
        if (typeof scheduled.startTime === 'string') startTime = scheduled.startTime;
      }
      if (job.application_id) receipt = await this.official.refreshReceipt(applicationPayload);
      return {
        client_id: job.client_id,
        application_id: applicationId,
        booked: true,
        date,
        start_time: startTime,
        receipt,
        response,
      };
    } catch (error) {
      return {
        client_id: job.client_id,
        application_id: applicationId,
        booked: false,
        date,
        start_time: startTime,
        response,
        error: error instanceof Error ? error.message : 'Official booking failed',
      };
    }
  }
}

function requiredField(payload: Record<string, unknown>, name: string): string | number {
  const value = payload[name];
  if (typeof value !== 'string' && typeof value !== 'number') {
    throw new Error(`Booking payload is missing ${name}`);
  }
  return value;
}

function requiredString(payload: Record<string, unknown>, name: string): string {
  const value = requiredField(payload, name);
  return String(value);
}

function setApplicationId(payload: Record<string, unknown>, applicationId: string): void {
  const metadata = payload.applicationMetaDataDTO;
  if (typeof metadata !== 'object' || metadata === null || Array.isArray(metadata)) {
    throw new Error('Application payload is missing metadata');
  }
  (metadata as Record<string, unknown>).applicationID = applicationId;
}
