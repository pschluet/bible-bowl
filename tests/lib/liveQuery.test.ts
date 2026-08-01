/**
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { subscribeLive } from '@/app/lib/liveQuery';
import { createFakeObservable } from '../support/observable';

// Each test uses a distinct `key` (when it uses one at all) so the module's
// internal `shared` Map — global, module-level state — never leaks between
// tests without needing `vi.resetModules()`.
let keyCounter = 0;
function uniqueKey(): string {
  keyCounter += 1;
  return `test-key-${keyCounter}`;
}

describe('subscribeLive — unshared (no key)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('delivers a shallow-copied items array (new reference) to the listener', () => {
    const fake = createFakeObservable<{ id: string }>();
    const makeObservable = vi.fn(() => fake.observable);
    const received: unknown[] = [];
    subscribeLive(makeObservable, (snap) => received.push(snap));

    const items = [{ id: '1' }];
    fake.emit({ items, isSynced: true });

    expect(received).toEqual([{ items: [{ id: '1' }], isSynced: true }]);
    expect((received[0] as { items: unknown[] }).items).not.toBe(items);
  });

  it('unsubscribes the underlying subscription when the returned cleanup is called', () => {
    const fake = createFakeObservable();
    const unsubscribe = subscribeLive(
      () => fake.observable,
      () => {}
    );
    expect(fake.subscriberCount()).toBe(1);
    unsubscribe();
    expect(fake.unsubscribeSpy).toHaveBeenCalledTimes(1);
    expect(fake.subscriberCount()).toBe(0);
  });

  it('re-subscribes after a 2s backoff on error', () => {
    const fake = createFakeObservable();
    const makeObservable = vi.fn(() => fake.observable);
    subscribeLive(makeObservable, () => {});
    expect(makeObservable).toHaveBeenCalledTimes(1);

    fake.emitError(new Error('boom'));
    expect(makeObservable).toHaveBeenCalledTimes(1); // not yet — still backing off

    vi.advanceTimersByTime(2000);
    expect(makeObservable).toHaveBeenCalledTimes(2);
  });

  it('does not re-subscribe after teardown, even if the backoff timer fires', () => {
    const fake = createFakeObservable();
    const makeObservable = vi.fn(() => fake.observable);
    const unsubscribe = subscribeLive(makeObservable, () => {});
    fake.emitError(new Error('boom'));
    unsubscribe();
    vi.advanceTimersByTime(5000);
    expect(makeObservable).toHaveBeenCalledTimes(1);
  });
});

describe('subscribeLive — shared (with key)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('creates only one underlying subscription for two callers sharing a key', () => {
    const key = uniqueKey();
    const fake = createFakeObservable();
    const makeObservable = vi.fn(() => fake.observable);

    subscribeLive(makeObservable, () => {}, key);
    subscribeLive(makeObservable, () => {}, key);

    expect(makeObservable).toHaveBeenCalledTimes(1);
  });

  it('immediately replays the latest snapshot to a late subscriber', () => {
    const key = uniqueKey();
    const fake = createFakeObservable<{ id: string }>();
    subscribeLive(
      () => fake.observable,
      () => {},
      key
    );
    fake.emit({ items: [{ id: '1' }], isSynced: true });

    const received: unknown[] = [];
    subscribeLive(
      () => fake.observable,
      (snap) => received.push(snap),
      key
    );

    expect(received).toEqual([{ items: [{ id: '1' }], isSynced: true }]);
  });

  it('does not replay anything to a late subscriber when there is no snapshot yet', () => {
    const key = uniqueKey();
    const fake = createFakeObservable();
    subscribeLive(
      () => fake.observable,
      () => {},
      key
    );

    const received: unknown[] = [];
    subscribeLive(
      () => fake.observable,
      (snap) => received.push(snap),
      key
    );

    expect(received).toEqual([]);
  });

  it('keeps the underlying subscription alive until every sharer has unsubscribed', () => {
    const key = uniqueKey();
    const fake = createFakeObservable();
    const unsubA = subscribeLive(
      () => fake.observable,
      () => {},
      key
    );
    subscribeLive(
      () => fake.observable,
      () => {},
      key
    );

    unsubA();
    expect(fake.unsubscribeSpy).not.toHaveBeenCalled();
  });

  it('tears down the underlying subscription once refCount reaches 0', () => {
    const key = uniqueKey();
    const fake = createFakeObservable();
    const unsubA = subscribeLive(
      () => fake.observable,
      () => {},
      key
    );
    const unsubB = subscribeLive(
      () => fake.observable,
      () => {},
      key
    );

    unsubA();
    unsubB();
    expect(fake.unsubscribeSpy).toHaveBeenCalledTimes(1);
  });

  it('is idempotent — calling the same cleanup twice does not double-decrement refCount', () => {
    const key = uniqueKey();
    const fake = createFakeObservable();
    const unsubA = subscribeLive(
      () => fake.observable,
      () => {},
      key
    );
    const unsubB = subscribeLive(
      () => fake.observable,
      () => {},
      key
    );

    unsubA();
    unsubA(); // second call is a no-op
    expect(fake.unsubscribeSpy).not.toHaveBeenCalled(); // B is still holding a ref

    unsubB();
    expect(fake.unsubscribeSpy).toHaveBeenCalledTimes(1);
  });

  it('a fresh subscribe after full teardown creates a brand-new underlying subscription', () => {
    const key = uniqueKey();
    const fakeA = createFakeObservable();
    const fakeB = createFakeObservable();
    let calls = 0;
    const makeObservable = () => (calls++ === 0 ? fakeA.observable : fakeB.observable);

    const unsub = subscribeLive(makeObservable, () => {}, key);
    unsub();
    expect(calls).toBe(1);

    subscribeLive(makeObservable, () => {}, key);
    expect(calls).toBe(2);
  });

  it('re-subscribes after a 2s backoff on error, unsubscribing the old one first', () => {
    const key = uniqueKey();
    const fake = createFakeObservable();
    const makeObservable = vi.fn(() => fake.observable);
    subscribeLive(makeObservable, () => {}, key);

    fake.emitError(new Error('boom'));
    vi.advanceTimersByTime(2000);

    expect(makeObservable).toHaveBeenCalledTimes(2);
    expect(fake.unsubscribeSpy).toHaveBeenCalledTimes(1); // old sub torn down before resubscribing
  });
});
