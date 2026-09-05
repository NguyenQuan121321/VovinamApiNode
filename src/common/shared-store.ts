import { Injectable, type OnModuleDestroy } from '@nestjs/common';

export const SHARED_STORE = Symbol('SHARED_STORE');

export type SharedStoreValue = number | string | boolean;

export interface SharedStoreEntry {
  value: SharedStoreValue;
  expiresAt: number | null;
}

export interface SharedStore {
  get(key: string): SharedStoreValue | undefined;
  set(key: string, value: SharedStoreValue, ttlMs?: number): void;
  delete(key: string): void;
  increment(key: string, ttlMs?: number): number;
}

/**
 * Single-instance store behind the SharedStore interface (plan section 3): the jti
 * denylist, lockout and rate-limit counters live here until a Redis-backed
 * implementation is needed for horizontal scaling.
 */
@Injectable()
export class InMemorySharedStore implements SharedStore, OnModuleDestroy {
  private readonly entries = new Map<string, SharedStoreEntry>();
  private readonly sweeper: NodeJS.Timeout;

  constructor() {
    // No constructor parameters: with useClass DI every param would be treated as
    // an injectable dependency and fail resolution.
    this.sweeper = setInterval(() => this.sweep(), 60_000);
    this.sweeper.unref();
  }

  get(key: string): SharedStoreValue | undefined {
    return this.getEntry(key)?.value;
  }

  set(key: string, value: SharedStoreValue, ttlMs?: number): void {
    this.entries.set(key, {
      value,
      expiresAt: ttlMs === undefined ? null : Date.now() + ttlMs,
    });
  }

  delete(key: string): void {
    this.entries.delete(key);
  }

  increment(key: string, ttlMs?: number): number {
    const entry = this.getEntry(key);
    const current = entry !== undefined && typeof entry.value === 'number' ? entry.value : 0;
    const next = current + 1;
    this.entries.set(key, {
      value: next,
      expiresAt: entry?.expiresAt ?? (ttlMs === undefined ? null : Date.now() + ttlMs),
    });
    return next;
  }

  onModuleDestroy(): void {
    clearInterval(this.sweeper);
  }

  private getEntry(key: string): SharedStoreEntry | undefined {
    const entry = this.entries.get(key);
    if (entry === undefined) {
      return undefined;
    }
    if (entry.expiresAt !== null && entry.expiresAt <= Date.now()) {
      this.entries.delete(key);
      return undefined;
    }
    return entry;
  }

  private sweep(): void {
    const now = Date.now();
    for (const [key, entry] of this.entries) {
      if (entry.expiresAt !== null && entry.expiresAt <= now) {
        this.entries.delete(key);
      }
    }
  }
}
