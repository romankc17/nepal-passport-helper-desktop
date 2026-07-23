import { describe, expect, it } from 'vitest';
import { LocalQueueStore } from '../../src/main/local-queue';

describe('LocalQueueStore', () => {
  it('keeps client selections only in memory and removes them by client id', () => {
    const store = new LocalQueueStore();
    const location = {
      country_id: '222', province_id: '225', district_id: '264',
      provider_id: 544, provider_name: 'Department of Passports',
    };

    expect(store.add({
      client_id: 7, client_name: 'Ram Sharma', official_application_id: 'WPT-7',
      phone: '9800000000', email: 'ram@example.com', location,
    }, 1)).toBeNull();
    expect(store.forProvider(544).map((item) => item.client_id)).toEqual([7]);
    expect(store.remove([7])).toEqual([7]);
    expect(store.all()).toEqual([]);
  });
});
