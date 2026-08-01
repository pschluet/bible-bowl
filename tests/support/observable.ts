/**
 * A hand-rolled, rxjs-shaped fake Observable for testing `subscribeLive`
 * (app/lib/liveQuery.ts) and any page/component that subscribes to an
 * Amplify `observeQuery` stream. `subscribeLive`'s only import from rxjs is
 * `import type { Observable }`, which is erased at compile time — so this
 * duck-typed object is a complete stand-in at runtime, no rxjs dependency
 * needed. The real `Observable` class has private internal fields, so
 * `tsc --noEmit` won't structurally accept a plain duck-typed object in its
 * place — hence the `as unknown as Observable<...>` cast below. It's a
 * type-level-only assertion; nothing about runtime behavior changes.
 */
import { vi } from 'vitest';
import type { Observable } from 'rxjs';

export interface Snapshot<M> {
  items: M[];
  isSynced: boolean;
}

export interface FakeObservableController<M> {
  observable: Observable<Snapshot<M>>;
  emit: (snapshot: Snapshot<M>) => void;
  emitError: (error: unknown) => void;
  unsubscribeSpy: ReturnType<typeof vi.fn>;
  subscriberCount: () => number;
}

type SnapshotObserver<M> =
  | ((snapshot: Snapshot<M>) => void)
  | { next: (snapshot: Snapshot<M>) => void; error?: (error: unknown) => void };

/**
 * Creates a fake Observable plus a controller to drive it from a test:
 * `emit()` pushes a snapshot to every current subscriber, `emitError()`
 * pushes an error. Supports multiple concurrent subscribers, matching how
 * `subscribeLive`'s shared-key path re-subscribes.
 */
export function createFakeObservable<M>(): FakeObservableController<M> {
  const observers = new Set<{ next: (s: Snapshot<M>) => void; error?: (e: unknown) => void }>();
  const unsubscribeSpy = vi.fn();

  return {
    observable: {
      subscribe(observer: SnapshotObserver<M>) {
        const normalized = typeof observer === 'function' ? { next: observer } : { ...observer };
        observers.add(normalized);
        return {
          unsubscribe: () => {
            observers.delete(normalized);
            unsubscribeSpy();
          },
        };
      },
    } as unknown as Observable<Snapshot<M>>,
    emit(snapshot) {
      for (const o of observers) o.next(snapshot);
    },
    emitError(error) {
      for (const o of observers) o.error?.(error);
    },
    unsubscribeSpy,
    subscriberCount: () => observers.size,
  };
}
