import { describe, expect, it } from 'vitest';
import { formatRelativeTime } from '../../src/renderer/src/lib/format';

describe('formatRelativeTime', () => {
  it('shows a few seconds ago as "just now"', () => {
    const now = new Date('2026-07-21T10:00:00.000Z').getTime();
    expect(formatRelativeTime('2026-07-21T09:59:58.000Z', now)).toBe('just now');
  });

  it('shows minutes ago', () => {
    const now = new Date('2026-07-21T10:00:00.000Z').getTime();
    expect(formatRelativeTime('2026-07-21T09:55:00.000Z', now)).toBe('5 min ago');
  });

  it('shows hours ago', () => {
    const now = new Date('2026-07-21T10:00:00.000Z').getTime();
    expect(formatRelativeTime('2026-07-21T07:30:00.000Z', now)).toBe('2 h ago');
  });

  it('shows days ago', () => {
    const now = new Date('2026-07-21T10:00:00.000Z').getTime();
    expect(formatRelativeTime('2026-07-20T09:00:00.000Z', now)).toBe('1 d ago');
  });

  it('returns "never" for null or invalid values', () => {
    expect(formatRelativeTime(null)).toBe('never');
    expect(formatRelativeTime(undefined)).toBe('never');
    expect(formatRelativeTime('not a date')).toBe('never');
  });
});
