import type {
  LocalBookingJob,
  LocalBookingResult,
  ReconcileResult,
  LabSubmitInput,
  LabBookInput,
  WatcherCheckResult,
} from '../shared/types';
import type { ApiClient } from './api-client';
import type { FoundOfficialSlot, OfficialApi } from './official-api';

export class OfficialWorker {
  constructor(
    private readonly api: ApiClient,
    private readonly official: OfficialApi,
  ) {}

  async checkWatcher(
    watcherId: number,
    force: boolean,
    selectedSlots?: string[],
  ): Promise<WatcherCheckResult> {
    const start = await this.api.watcherLocalStart(watcherId, force);
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
      const plan = await this.api.watcherLocalPlan(watcherId, runId, slots);
      const results: LocalBookingResult[] = [];
      for (let offset = 0; offset < plan.jobs.length; offset += 4) {
        results.push(
          ...(await Promise.all(plan.jobs.slice(offset, offset + 4).map((job) => this.runJob(job)))),
        );
      }
      return await this.api.watcherLocalComplete(watcherId, runId, slots, results);
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

  async submitLab(input: LabSubmitInput): Promise<{ batch_id: string }> {
    const plan = await this.api.labSubmitLocalPrepare(input);
    const results = await Promise.all(plan.jobs.map(async (job) => {
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
    await this.api.labSubmitLocalComplete(plan.batch_id, results);
    return { batch_id: plan.batch_id };
  }

  async bookLab(input: LabBookInput): Promise<{ batch_id: string }> {
    const plan = await this.api.labBookLocalPrepare(input);
    await Promise.allSettled(
      plan.watchers.map(({ watcher_id }) => this.checkWatcher(watcher_id, true)),
    );
    await this.api.labBookLocalComplete(plan.batch_id);
    return { batch_id: plan.batch_id };
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
        booking_id: job.booking_id,
        application_id: applicationId,
        booked: true,
        date,
        start_time: startTime,
        receipt,
        response,
      };
    } catch (error) {
      return {
        booking_id: job.booking_id,
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
