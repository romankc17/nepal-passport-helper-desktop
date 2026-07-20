import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { safeStorage } from 'electron';

export interface StoredTokens {
  accessToken: string;
  refreshToken: string;
  accessExpiresAt: number;
  refreshExpiresAt: number;
}

export class VaultUnavailableError extends Error {
  constructor() {
    super('Secure token storage is unavailable on this system (OS keychain not accessible)');
    this.name = 'VaultUnavailableError';
  }
}

// Token storage backed by Electron safeStorage (OS keychain). Token material
// is never logged and never written in plaintext.
export class Vault {
  constructor(private readonly filePath: string) {}

  isAvailable(): boolean {
    return safeStorage.isEncryptionAvailable();
  }

  saveTokens(tokens: StoredTokens): void {
    if (!this.isAvailable()) throw new VaultUnavailableError();
    const encrypted = safeStorage.encryptString(JSON.stringify(tokens));
    writeFileSync(this.filePath, encrypted);
  }

  loadTokens(): StoredTokens | null {
    if (!this.isAvailable()) return null;
    if (!existsSync(this.filePath)) return null;
    try {
      const decrypted = safeStorage.decryptString(readFileSync(this.filePath));
      const parsed: unknown = JSON.parse(decrypted);
      if (!isStoredTokens(parsed)) {
        this.clear();
        return null;
      }
      return parsed;
    } catch {
      // Undecryptable or corrupt vault (e.g. keychain reset): drop it.
      this.clear();
      return null;
    }
  }

  clear(): void {
    try {
      if (existsSync(this.filePath)) rmSync(this.filePath);
    } catch {
      // Nothing sensible to do — a stale vault is overwritten on next login.
    }
  }
}

function isStoredTokens(value: unknown): value is StoredTokens {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.accessToken === 'string' &&
    typeof candidate.refreshToken === 'string' &&
    typeof candidate.accessExpiresAt === 'number' &&
    typeof candidate.refreshExpiresAt === 'number'
  );
}
