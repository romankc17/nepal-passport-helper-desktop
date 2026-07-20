import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

// Tiny JSON persistence for non-sensitive data only (settings, device id,
// watcher runtime snapshot). Tokens never go here — see vault.ts.
export class JsonStore<T extends object> {
  private data: T;
  private writing = false;

  constructor(
    private readonly filePath: string,
    private readonly defaults: T,
  ) {
    this.data = this.load();
  }

  private load(): T {
    let raw: string;
    try {
      raw = readFileSync(this.filePath, 'utf8');
    } catch {
      return { ...this.defaults };
    }
    try {
      const parsed: unknown = JSON.parse(raw);
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        return { ...this.defaults };
      }
      return { ...this.defaults, ...(parsed as Partial<T>) };
    } catch {
      // Corrupt file: back it up for forensics and fall back to defaults.
      try {
        renameSync(this.filePath, `${this.filePath}.corrupt-${Date.now()}`);
      } catch {
        // Backup is best-effort; defaults are already safe.
      }
      return { ...this.defaults };
    }
  }

  get(): Readonly<T> {
    return this.data;
  }

  update(patch: Partial<T>): T {
    this.data = { ...this.data, ...patch };
    this.persist();
    return this.data;
  }

  replace(next: T): T {
    this.data = next;
    this.persist();
    return this.data;
  }

  private persist(): void {
    if (this.writing) return;
    this.writing = true;
    try {
      mkdirSync(dirname(this.filePath), { recursive: true });
      const tmpPath = join(dirname(this.filePath), `.${Date.now()}-${process.pid}.tmp`);
      writeFileSync(tmpPath, JSON.stringify(this.data, null, 2), 'utf8');
      renameSync(tmpPath, this.filePath);
    } finally {
      this.writing = false;
    }
  }
}
