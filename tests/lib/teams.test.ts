/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest';
import { computeReorderUpdates, nextDisplayOrder } from '@/app/lib/teams';
import { compareTeamOrder } from '@/app/lib/constants';

describe('nextDisplayOrder', () => {
  it('returns 0 for an empty team list', () => {
    expect(nextDisplayOrder([])).toBe(0);
  });

  it('returns one past the current maximum displayOrder', () => {
    const teams = [{ displayOrder: 0 }, { displayOrder: 3 }, { displayOrder: 1 }];
    expect(nextDisplayOrder(teams)).toBe(4);
  });

  it('treats missing displayOrder as -1 for the purpose of the max', () => {
    const teams = [{ displayOrder: null }, { displayOrder: undefined }];
    expect(nextDisplayOrder(teams)).toBe(0);
  });
});

describe('computeReorderUpdates', () => {
  it('emits an update only for teams whose index actually changed', () => {
    const reordered = [
      { id: 'a', displayOrder: 1 }, // was 1, now index 0 -> changed
      { id: 'b', displayOrder: 1 }, // was 1, now index 1 -> unchanged
      { id: 'c', displayOrder: 2 }, // was 2, now index 2 -> unchanged
    ];
    expect(computeReorderUpdates(reordered)).toEqual([{ id: 'a', displayOrder: 0 }]);
  });

  it('returns [] when no positions changed', () => {
    const reordered = [
      { id: 'a', displayOrder: 0 },
      { id: 'b', displayOrder: 1 },
    ];
    expect(computeReorderUpdates(reordered)).toEqual([]);
  });

  it('treats a null displayOrder as always needing an update', () => {
    const reordered = [{ id: 'a', displayOrder: null }];
    expect(computeReorderUpdates(reordered)).toEqual([{ id: 'a', displayOrder: 0 }]);
  });
});

describe('compareTeamOrder tiebreak (documents known-bug #7: displayOrder collisions)', () => {
  it('two teams with the same client-computed displayOrder do not crash — they fall back to alphabetical order', () => {
    // This is the scenario in REQUIREMENTS.md known-bug #7: two concurrent
    // adds can compute the same displayOrder from stale client state. The
    // atomic-sequence fix is deferred; this pins the current, documented
    // fallback behavior so the collision degrades gracefully rather than
    // silently.
    const teams = [
      { name: 'Zebra Church', displayOrder: 5 },
      { name: 'Antelope Church', displayOrder: 5 },
    ];
    const sorted = [...teams].sort(compareTeamOrder);
    expect(sorted.map((t) => t.name)).toEqual(['Antelope Church', 'Zebra Church']);
  });
});
