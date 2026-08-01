/**
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RETRYABLE_RE, mapWithConcurrency, withRetry } from '@/app/lib/concurrency';

describe('RETRYABLE_RE', () => {
  it.each([
    'TooManyRequestsException',
    'Rate exceeded',
    'ThrottlingException',
    'NoSignedUser',
    'ProvisionedThroughputExceededException',
    'rate exceeded (lowercase)',
  ])('matches "%s"', (msg) => {
    expect(RETRYABLE_RE.test(msg)).toBe(true);
  });

  it('does not match an unrelated error message', () => {
    expect(RETRYABLE_RE.test('Item not found')).toBe(false);
  });
});

describe('withRetry', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('returns the result on first success without retrying', async () => {
    const fn = vi.fn().mockResolvedValue('ok');
    await expect(withRetry(fn)).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries on a retryable error and eventually succeeds', async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error('TooManyRequestsException'))
      .mockRejectedValueOnce(new Error('Rate exceeded'))
      .mockResolvedValueOnce('ok');

    const promise = withRetry(fn, { baseDelayMs: 10 });
    // Let all pending backoff timers fire; runAllTimersAsync also flushes the
    // microtasks in between so the retried calls actually happen.
    await vi.runAllTimersAsync();
    await expect(promise).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('throws immediately on a non-retryable error, without retrying', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('Item not found'));
    await expect(withRetry(fn)).rejects.toThrow('Item not found');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('gives up after exhausting all retries and throws the last error', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('ThrottlingException'));
    const promise = withRetry(fn, { retries: 2, baseDelayMs: 5 });
    const assertion = expect(promise).rejects.toThrow('ThrottlingException');
    await vi.runAllTimersAsync();
    await assertion;
    // retries: 2 -> attempts 0, 1, 2 = 3 total calls
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('stringifies a non-Error throw when testing retryability', async () => {
    // A thrown plain object stringifies to "[object Object]", which never
    // matches RETRYABLE_RE, so it's treated as non-retryable.
    const fn = vi.fn().mockRejectedValue({ some: 'object' });
    await expect(withRetry(fn)).rejects.toEqual({ some: 'object' });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('respects a custom retries count of 0 (single attempt, no retry)', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('Rate exceeded'));
    await expect(withRetry(fn, { retries: 0 })).rejects.toThrow('Rate exceeded');
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

describe('mapWithConcurrency', () => {
  it('returns [] and never calls fn for an empty input array', async () => {
    const fn = vi.fn();
    const result = await mapWithConcurrency([], 5, fn);
    expect(result).toEqual([]);
    expect(fn).not.toHaveBeenCalled();
  });

  it('preserves input order regardless of completion order', async () => {
    const delays = [30, 10, 20];
    const fn = vi.fn(
      (item: number, index: number) =>
        new Promise<number>((resolve) => setTimeout(() => resolve(item), delays[index]))
    );
    const result = await mapWithConcurrency([100, 200, 300], 3, fn);
    expect(result).toEqual([100, 200, 300]);
  });

  it('never runs more than `limit` calls concurrently', async () => {
    let active = 0;
    let maxActive = 0;
    const fn = vi.fn(async () => {
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise((r) => setTimeout(r, 5));
      active--;
    });
    await mapWithConcurrency([1, 2, 3, 4, 5, 6], 2, fn);
    expect(maxActive).toBeLessThanOrEqual(2);
  });

  it('spawns zero workers and never calls fn when limit <= 0', async () => {
    const fn = vi.fn();
    const result = await mapWithConcurrency([1, 2, 3], 0, fn);
    expect(fn).not.toHaveBeenCalled();
    expect(result).toHaveLength(3);
    expect(result.every((v) => v === undefined)).toBe(true);
  });

  it('propagates the first rejection while other in-flight workers keep draining the queue', async () => {
    const seen: number[] = [];
    const fn = vi.fn(async (item: number) => {
      if (item === 0) throw new Error('boom');
      await new Promise((r) => setTimeout(r, 10));
      seen.push(item);
      return item;
    });

    await expect(mapWithConcurrency([0, 1, 2, 3], 2, fn)).rejects.toThrow('boom');

    // The other worker (handling items 1, 2, 3) is not cancelled by the
    // rejection — it keeps running in the background.
    await new Promise((r) => setTimeout(r, 50));
    expect(seen).toEqual(expect.arrayContaining([1, 2, 3]));
  });
});
