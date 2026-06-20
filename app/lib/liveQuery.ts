import type { Observable } from 'rxjs';

// observeQuery mutates and re-emits the SAME `items` array on every snapshot.
// React's setState bails out when the new value is reference-identical to the
// previous one, so without this copy every delta and every list() page after
// the first would be silently dropped. Shallow-copy here once; no call-site
// changes needed.
type Snapshot<M> = { items: M[]; isSynced: boolean };

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
 * Returns a cleanup function that tears down the subscription.
 */
export function subscribeLive<M>(
  makeObservable: () => Observable<Snapshot<M>>,
  onSnapshot: (snapshot: Snapshot<M>) => void,
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
