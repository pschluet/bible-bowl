import type { Observable } from 'rxjs';

// observeQuery mutates and re-emits the SAME `items` array on every snapshot.
// React's setState bails out when the new value is reference-identical to the
// previous one, so without this copy every delta and every list() page after
// the first would be silently dropped. Shallow-copy here once; no call-site
// changes needed.
type Snapshot<M> = { items: M[]; isSynced: boolean };

type Listener = (snapshot: Snapshot<unknown>) => void;

type SharedEntry = {
  refCount: number;
  latest: Snapshot<unknown> | null;
  listeners: Set<Listener>;
  teardown: () => void;
};

/**
 * Reference-counted cache of live subscriptions, keyed by a caller-supplied
 * string (e.g. `` `score:${slug}` ``). Subscribers that pass the same key
 * share ONE underlying observeQuery subscription (and its backoff/retry
 * logic) instead of each caller opening its own WebSocket + full initial
 * list() sync. A late subscriber immediately receives the most recent
 * snapshot instead of waiting for the next delta.
 *
 * This only collapses duplicate subscriptions *within one JS context* (e.g.
 * React StrictMode's dev-time double-mount, or two components on the same
 * page independently needing the same query) — it cannot reduce connections
 * across separate tabs/devices, since those are separate module instances.
 * That would require a server-side fan-out layer.
 *
 * Callers that omit `key` get the original unshared, per-call behavior.
 */
const shared = new Map<string, SharedEntry>();

/**
 * Subscribes to an observeQuery Observable and recreates it on hard error
 * (server GQL_ERROR / auth failure) with a 2 s backoff. A dropped WebSocket
 * surfaces as an error and is recovered the same way.
 *
 * Does NOT re-subscribe on tab focus or network events — the persistent
 * subscription already delivers live deltas while the tab is backgrounded, so
 * a focus-triggered re-list would discard current data and rebuild from scratch,
 * causing a visible count-up through partial list() pages.
 *
 * Pass `key` to share the underlying subscription with other callers using
 * the same key (see module doc comment above). Omit it for the previous
 * always-independent behavior.
 *
 * Returns a cleanup function that tears down the subscription (or, for a
 * shared key, releases this caller's reference — the underlying subscription
 * only tears down once every sharer has unsubscribed).
 */
export function subscribeLive<M>(
  makeObservable: () => Observable<Snapshot<M>>,
  onSnapshot: (snapshot: Snapshot<M>) => void,
  key?: string
): () => void {
  if (!key) return subscribeUnshared(makeObservable, onSnapshot);

  const listener = onSnapshot as Listener;
  let entry = shared.get(key);
  if (!entry) {
    entry = createSharedEntry(makeObservable as () => Observable<Snapshot<unknown>>);
    shared.set(key, entry);
  }
  entry.refCount++;
  entry.listeners.add(listener);
  // Replay the latest snapshot immediately so a late joiner isn't stuck
  // waiting for the next delta to get data that's already available.
  if (entry.latest) listener(entry.latest);

  let released = false;
  return () => {
    if (released) return;
    released = true;
    const e = shared.get(key);
    if (!e) return;
    e.listeners.delete(listener);
    e.refCount--;
    if (e.refCount <= 0) {
      e.teardown();
      shared.delete(key);
    }
  };
}

function createSharedEntry(makeObservable: () => Observable<Snapshot<unknown>>): SharedEntry {
  const entry: SharedEntry = {
    refCount: 0,
    latest: null,
    listeners: new Set(),
    teardown: () => {},
  };

  let sub: { unsubscribe: () => void } | null = null;
  let backoff: ReturnType<typeof setTimeout> | null = null;
  let torn = false;

  const start = () => {
    if (torn) return;
    sub?.unsubscribe();
    sub = makeObservable().subscribe({
      next: ({ items, isSynced }) => {
        const snapshot: Snapshot<unknown> = { items: [...items], isSynced };
        entry.latest = snapshot;
        for (const listener of entry.listeners) listener(snapshot);
      },
      error: () => {
        if (torn) return;
        if (backoff) clearTimeout(backoff);
        backoff = setTimeout(start, 2000);
      },
    });
  };

  start();

  entry.teardown = () => {
    torn = true;
    if (backoff) clearTimeout(backoff);
    sub?.unsubscribe();
  };

  return entry;
}

function subscribeUnshared<M>(
  makeObservable: () => Observable<Snapshot<M>>,
  onSnapshot: (snapshot: Snapshot<M>) => void
): () => void {
  let sub: { unsubscribe: () => void } | null = null;
  let backoff: ReturnType<typeof setTimeout> | null = null;
  let torn = false;

  const start = () => {
    if (torn) return;
    sub?.unsubscribe();
    sub = makeObservable().subscribe({
      // Spread items so React sees a new reference and re-renders.
      next: ({ items, isSynced }) => onSnapshot({ items: [...items], isSynced }),
      error: () => {
        if (torn) return;
        if (backoff) clearTimeout(backoff);
        backoff = setTimeout(start, 2000);
      },
    });
  };

  start();

  return () => {
    torn = true;
    if (backoff) clearTimeout(backoff);
    sub?.unsubscribe();
  };
}
