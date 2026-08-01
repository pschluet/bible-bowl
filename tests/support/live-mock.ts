/**
 * A fake `subscribeLive` (app/lib/liveQuery.ts) for page tests. Rather than
 * exercise the real rxjs Observable plumbing (already covered by
 * tests/lib/liveQuery.test.ts), this lets a test push a snapshot directly to
 * whichever `subscribeLive(..., key)` call is listening for that key — the
 * page's `makeObservable` factory argument is captured but never invoked.
 *
 * Usage in a page test file:
 *
 *   vi.mock('@/app/lib/liveQuery', async () => {
 *     const { createLiveRegistry } = await import('../support/live-mock');
 *     const registry = createLiveRegistry();
 *     return { subscribeLive: registry.subscribeLive, __registry: registry };
 *   });
 *   ...
 *   const { __registry: live } = (await import('@/app/lib/liveQuery')) as unknown as {
 *     __registry: ReturnType<typeof import('../support/live-mock').createLiveRegistry>;
 *   };
 *   ...
 *   live.emit('game:bySlug:g1', { items: [game], isSynced: true });
 */
import { vi } from 'vitest';

export interface Snapshot<M = unknown> {
  items: M[];
  isSynced: boolean;
}

type Listener = (snapshot: Snapshot) => void;

export interface LiveRegistry {
  subscribeLive: ReturnType<typeof vi.fn>;
  /** Pushes a snapshot to every current subscriber registered under `key`. */
  emit: (key: string, snapshot: Snapshot) => void;
  /** Number of active subscribers currently registered under `key`. */
  subscriberCount: (key: string) => number;
}

export function createLiveRegistry(): LiveRegistry {
  const listeners = new Map<string, Set<Listener>>();
  let anonCounter = 0;

  const subscribeLive = vi.fn(
    (_makeObservable: unknown, onSnapshot: Listener, key?: string): (() => void) => {
      const k = key ?? `__unshared_${anonCounter++}`;
      let set = listeners.get(k);
      if (!set) {
        set = new Set();
        listeners.set(k, set);
      }
      set.add(onSnapshot);
      let released = false;
      return () => {
        if (released) return;
        released = true;
        set!.delete(onSnapshot);
      };
    }
  );

  return {
    subscribeLive,
    emit(key, snapshot) {
      const set = listeners.get(key);
      if (!set) return;
      for (const fn of set) fn(snapshot);
    },
    subscriberCount(key) {
      return listeners.get(key)?.size ?? 0;
    },
  };
}
