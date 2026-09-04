import { InMemorySharedStore, type SharedStoreEntry } from './shared-store';

describe('InMemorySharedStore', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('stores, reads and deletes values', () => {
    const store = new InMemorySharedStore();
    store.set('key', 'value');
    expect(store.get('key')).toBe('value');
    store.delete('key');
    expect(store.get('key')).toBeUndefined();
  });

  it('expires entries after their ttl', () => {
    const store = new InMemorySharedStore();
    store.set('key', 'value', 1_000);
    jest.advanceTimersByTime(1_001);
    expect(store.get('key')).toBeUndefined();
  });

  it('increments counters and keeps the original ttl', () => {
    const store = new InMemorySharedStore();
    expect(store.increment('counter', 5_000)).toBe(1);
    expect(store.increment('counter')).toBe(2);
    expect(store.get('counter')).toBe(2);
    jest.advanceTimersByTime(5_001);
    expect(store.get('counter')).toBeUndefined();
  });

  it('anchors the window at the first increment (fixed window)', () => {
    const store = new InMemorySharedStore();
    store.increment('counter', 10_000);
    jest.advanceTimersByTime(5_000);
    expect(store.increment('counter', 10_000)).toBe(2);
    jest.advanceTimersByTime(5_001);
    expect(store.get('counter')).toBeUndefined();
  });

  it('sweeps expired entries on the sweeper interval', () => {
    const store = new InMemorySharedStore();
    store.set('short-lived', 'value', 1_000);
    jest.advanceTimersByTime(60_001);
    const entries = (store as unknown as { entries: Map<string, SharedStoreEntry> }).entries;
    expect(entries.size).toBe(0);
  });

  it('stops sweeping on module destroy', () => {
    const store = new InMemorySharedStore();
    store.set('key', 'value', 1_000);
    store.onModuleDestroy();
    jest.advanceTimersByTime(120_001);
    // get() expires lazily regardless, so assert on the internal map: nothing was swept.
    const entries = (store as unknown as { entries: Map<string, SharedStoreEntry> }).entries;
    expect(entries.size).toBe(1);
  });
});
