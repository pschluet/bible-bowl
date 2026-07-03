/**
 * Concurrency and retry utilities for throttle-safe bulk operations.
 *
 * Use `mapWithConcurrency` + `withRetry` together to fan out many parallel
 * mutations without tripping AppSync / DynamoDB / Cognito rate limits.
 */

/**
 * Error patterns that indicate a transient throttle or auth-session rate limit
 * from Cognito, AppSync, or DynamoDB.  These are safe to retry with backoff.
 */
export const RETRYABLE_RE =
  /TooManyRequests|Rate exceeded|Throttl|NoSignedUser|ProvisionedThroughputExceeded/i;

/**
 * Wraps `fn` with exponential-backoff retry.  Only retries when the thrown
 * error message matches RETRYABLE_RE — non-retryable errors are re-thrown
 * immediately on the first attempt.
 *
 * Default: 5 retries, 250 ms base delay → max ~8 s total wait before giving up.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: { retries?: number; baseDelayMs?: number } = {}
): Promise<T> {
  const { retries = 5, baseDelayMs = 250 } = options;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!RETRYABLE_RE.test(msg) || attempt === retries) throw err;
      // Exponential backoff with full jitter
      const delay = baseDelayMs * 2 ** attempt + Math.random() * baseDelayMs;
      await new Promise<void>((r) => setTimeout(r, delay));
    }
  }
  /* istanbul ignore next — loop always throws before reaching here */
  throw new Error('withRetry: unreachable');
}

/**
 * Like `Promise.all(items.map(fn))` but runs at most `limit` concurrent
 * promises at a time.  Result order matches input order.
 *
 * If `fn` throws the error propagates; wrap `fn` in a try/catch if you need
 * settled-style "run all regardless" behaviour.
 */
export async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  if (items.length === 0) return [];
  const results: R[] = new Array(items.length);
  let next = 0;

  async function worker(): Promise<void> {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}
