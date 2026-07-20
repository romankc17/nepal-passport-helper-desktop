import { describe, expect, it } from 'vitest';
import {
  ValidationError,
  asEnum,
  asId,
  asIdArray,
  asString,
  validateAppSettingsPatch,
  validateBookNowInput,
  validateLoginInput,
  validateWatcherCreateInput,
  validateWatcherSettingsPatch,
} from '../../src/shared/ipc-contract';

const validLocationIds = {
  provider_id: 1,
  district_id: 2,
  province_id: 3,
  provider_name: 'Kathmandu CDO',
};

describe('asId', () => {
  it('accepts positive integers', () => {
    expect(asId(5)).toBe(5);
  });

  it.each([0, -3, 1.5, '5', NaN, null, undefined])('rejects %s', (value) => {
    expect(() => asId(value)).toThrow(ValidationError);
  });
});

describe('asString', () => {
  it('rejects oversized strings', () => {
    expect(() => asString('x'.repeat(2001), 'field')).toThrow(ValidationError);
    expect(asString('x'.repeat(2000), 'field')).toHaveLength(2000);
  });

  it('rejects empty and non-string values', () => {
    expect(() => asString('', 'field')).toThrow(ValidationError);
    expect(() => asString(42, 'field')).toThrow(ValidationError);
  });
});

describe('asEnum', () => {
  it('accepts allowed values and rejects others', () => {
    expect(asEnum('book', 'mode', ['notify', 'book'] as const)).toBe('book');
    expect(() => asEnum('steal', 'mode', ['notify', 'book'] as const)).toThrow(ValidationError);
    expect(() => asEnum(1, 'mode', ['notify', 'book'] as const)).toThrow(ValidationError);
  });
});

describe('asIdArray', () => {
  it('accepts arrays of positive integers', () => {
    expect(asIdArray([1, 2, 3], 'ids')).toEqual([1, 2, 3]);
  });

  it('rejects empty arrays, wrong types and bad entries', () => {
    expect(() => asIdArray([], 'ids')).toThrow(ValidationError);
    expect(() => asIdArray('1,2', 'ids')).toThrow(ValidationError);
    expect(() => asIdArray([1, -2], 'ids')).toThrow(ValidationError);
    expect(() => asIdArray([1, '2'], 'ids')).toThrow(ValidationError);
  });
});

describe('validateLoginInput', () => {
  it('accepts a valid login payload', () => {
    const input = validateLoginInput({
      username: 'agent',
      password: 's3cret',
      serverUrl: 'http://localhost:8000',
    });
    expect(input.username).toBe('agent');
    expect(input.serverUrl).toBe('http://localhost:8000');
  });

  it('rejects garbage', () => {
    expect(() => validateLoginInput(null)).toThrow(ValidationError);
    expect(() => validateLoginInput({ username: 'agent' })).toThrow(ValidationError);
    expect(() => validateLoginInput({ username: 5, password: 'x' })).toThrow(ValidationError);
    expect(() =>
      validateLoginInput({ username: 'agent', password: 'x', serverUrl: 'not-a-url' }),
    ).toThrow(ValidationError);
    expect(() =>
      validateLoginInput({ username: 'agent', password: 'x', serverUrl: 'ftp://evil.example' }),
    ).toThrow(ValidationError);
  });
});

describe('validateWatcherCreateInput', () => {
  it('accepts a valid payload with optional fields', () => {
    const input = validateWatcherCreateInput({
      ...validLocationIds,
      mode: 'book',
      interval_seconds: 300,
      notify: true,
    });
    expect(input.mode).toBe('book');
    expect(input.interval_seconds).toBe(300);
  });

  it('rejects bad mode, bad ids and out-of-range values', () => {
    expect(() =>
      validateWatcherCreateInput({ ...validLocationIds, mode: 'aggressive' }),
    ).toThrow(ValidationError);
    expect(() =>
      validateWatcherCreateInput({ ...validLocationIds, provider_id: -1, mode: 'book' }),
    ).toThrow(ValidationError);
    expect(() =>
      validateWatcherCreateInput({ ...validLocationIds, mode: 'book', interval_seconds: 0 }),
    ).toThrow(ValidationError);
    expect(() =>
      validateWatcherCreateInput({ ...validLocationIds, mode: 'book', days_ahead: 999 }),
    ).toThrow(ValidationError);
  });
});

describe('validateWatcherSettingsPatch', () => {
  it('accepts partial patches and rejects bad types', () => {
    expect(validateWatcherSettingsPatch({ notify: false })).toEqual({
      notify: false,
      interval_seconds: undefined,
      days_ahead: undefined,
      desired_bookings: undefined,
    });
    expect(() => validateWatcherSettingsPatch({ notify: 'yes' })).toThrow(ValidationError);
  });
});

describe('validateBookNowInput', () => {
  const base = { ...validLocationIds, client_ids: [10, 11], idempotency_key: 'key-1' };

  it('accepts valid slots', () => {
    const input = validateBookNowInput({ ...base, slots: ['2026-08-01|10:30'] });
    expect(input.slots).toEqual(['2026-08-01|10:30']);
  });

  it('rejects malformed slots and client ids', () => {
    expect(() => validateBookNowInput({ ...base, slots: ['01-08-2026 10:30'] })).toThrow(
      ValidationError,
    );
    expect(() => validateBookNowInput({ ...base, client_ids: [] })).toThrow(ValidationError);
  });
});

describe('validateAppSettingsPatch', () => {
  it('accepts valid patches', () => {
    const patch = validateAppSettingsPatch({
      notificationsEnabled: false,
      theme: 'light',
      apiUrl: 'https://server.example.com',
      defaultIntervalSeconds: 600,
    });
    expect(patch.theme).toBe('light');
    expect(patch.apiUrl).toBe('https://server.example.com');
  });

  it('allows clearing the dev apiUrl with null', () => {
    expect(validateAppSettingsPatch({ apiUrl: null }).apiUrl).toBeNull();
  });

  it('rejects bad enums, bad urls and wrong types', () => {
    expect(() => validateAppSettingsPatch({ theme: 'dark' })).toThrow(ValidationError);
    expect(() => validateAppSettingsPatch({ apiUrl: 'javascript:alert(1)' })).toThrow(
      ValidationError,
    );
    expect(() => validateAppSettingsPatch({ soundEnabled: 1 })).toThrow(ValidationError);
    expect(() => validateAppSettingsPatch({ defaultDaysAhead: -5 })).toThrow(ValidationError);
  });
});
