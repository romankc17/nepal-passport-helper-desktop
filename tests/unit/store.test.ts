import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { JsonStore } from '../../src/main/store';

interface TestConfig {
  count: number;
  name: string;
  nested: { flag: boolean };
}

const defaults: TestConfig = {
  count: 0,
  name: 'default',
  nested: { flag: false },
};

describe('JsonStore', () => {
  let dir: string;
  let filePath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'epp-store-test-'));
    filePath = join(dir, 'config.json');
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('returns defaults when the file does not exist', () => {
    const store = new JsonStore<TestConfig>(filePath, defaults);
    expect(store.get()).toEqual(defaults);
  });

  it('persists updates and reads them back with a fresh instance', () => {
    const store = new JsonStore<TestConfig>(filePath, defaults);
    store.update({ count: 42, name: 'updated' });

    const reloaded = new JsonStore<TestConfig>(filePath, defaults);
    expect(reloaded.get().count).toBe(42);
    expect(reloaded.get().name).toBe('updated');
  });

  it('writes atomically, leaving no temp files behind', () => {
    const store = new JsonStore<TestConfig>(filePath, defaults);
    store.update({ count: 1 });
    store.update({ count: 2 });

    const files = readdirSync(dir);
    expect(files).toEqual(['config.json']);
    expect(JSON.parse(readFileSync(filePath, 'utf8'))).toMatchObject({ count: 2 });
  });

  it('recovers from a corrupt file by returning defaults and backing it up', () => {
    writeFileSync(filePath, '{ this is not json !!!', 'utf8');

    const store = new JsonStore<TestConfig>(filePath, defaults);
    expect(store.get()).toEqual(defaults);

    const files = readdirSync(dir);
    expect(files.some((file) => file.startsWith('config.json.corrupt-'))).toBe(true);

    store.update({ count: 7 });
    const reloaded = new JsonStore<TestConfig>(filePath, defaults);
    expect(reloaded.get().count).toBe(7);
  });

  it('returns defaults when the file contains valid JSON of the wrong shape', () => {
    writeFileSync(filePath, JSON.stringify([1, 2, 3]), 'utf8');
    const store = new JsonStore<TestConfig>(filePath, defaults);
    expect(store.get()).toEqual(defaults);
  });

  it('merges stored partial data over defaults', () => {
    writeFileSync(filePath, JSON.stringify({ count: 5 }), 'utf8');
    const store = new JsonStore<TestConfig>(filePath, defaults);
    expect(store.get()).toEqual({ ...defaults, count: 5 });
  });
});
