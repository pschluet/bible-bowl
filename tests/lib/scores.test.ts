/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest';
import {
  buildScoreMap,
  dedupeScoresByCell,
  findDuplicateScoreIds,
  isValidPoints,
  mergeLatestById,
  pickLatestScore,
  pruneStaleOptimistic,
  teamTotal,
} from '@/app/lib/scores';

describe('isValidPoints', () => {
  it.each([0, 1, 2, 3])('accepts %d', (p) => {
    expect(isValidPoints(p)).toBe(true);
  });

  it.each([-1, 4, 1.5, NaN, '2', null, undefined, {}])('rejects %p', (p) => {
    expect(isValidPoints(p)).toBe(false);
  });
});

describe('pickLatestScore', () => {
  it('returns the candidate when it has a strictly later updatedAt', () => {
    const a = { updatedAt: '2026-01-01T00:00:00.000Z' };
    const b = { updatedAt: '2026-01-02T00:00:00.000Z' };
    expect(pickLatestScore(a, b)).toBe(b);
  });

  it('keeps the incumbent on an exact updatedAt tie', () => {
    const a = { updatedAt: '2026-01-01T00:00:00.000Z' };
    const b = { updatedAt: '2026-01-01T00:00:00.000Z' };
    expect(pickLatestScore(a, b)).toBe(a);
  });

  it('falls back to createdAt when updatedAt is missing on both', () => {
    const a = { createdAt: '2026-01-01T00:00:00.000Z' };
    const b = { createdAt: '2026-01-02T00:00:00.000Z' };
    expect(pickLatestScore(a, b)).toBe(b);
  });

  it('keeps the incumbent when both lack updatedAt and createdAt', () => {
    const a = {};
    const b = {};
    expect(pickLatestScore(a, b)).toBe(a);
  });
});

describe('mergeLatestById', () => {
  it('returns the exact base reference when overlay is empty', () => {
    const base = [{ id: '1', updatedAt: 't1' }];
    expect(mergeLatestById(base, [])).toBe(base);
  });

  it('adds overlay entries not present in base', () => {
    const base = [{ id: '1', updatedAt: 't1' }];
    const overlay = [{ id: '2', updatedAt: 't1' }];
    const result = mergeLatestById(base, overlay);
    expect(result.map((s) => s.id).sort()).toEqual(['1', '2']);
  });

  it('overlay wins when its updatedAt is newer than the base entry', () => {
    const base = [{ id: '1', updatedAt: '2026-01-01T00:00:00.000Z', points: 1 }];
    const overlay = [{ id: '1', updatedAt: '2026-01-02T00:00:00.000Z', points: 2 }];
    const result = mergeLatestById(base, overlay);
    expect(result).toEqual([{ id: '1', updatedAt: '2026-01-02T00:00:00.000Z', points: 2 }]);
  });

  it('base wins when the overlay entry is not newer', () => {
    const base = [{ id: '1', updatedAt: '2026-01-02T00:00:00.000Z', points: 1 }];
    const overlay = [{ id: '1', updatedAt: '2026-01-01T00:00:00.000Z', points: 2 }];
    const result = mergeLatestById(base, overlay);
    expect(result).toEqual([{ id: '1', updatedAt: '2026-01-02T00:00:00.000Z', points: 1 }]);
  });
});

describe('pruneStaleOptimistic', () => {
  it('drops an optimistic entry once the streamed record catches up (as-new-or-newer)', () => {
    const optimistic = [{ id: '1', updatedAt: '2026-01-01T00:00:00.000Z' }];
    const streamed = [{ id: '1', updatedAt: '2026-01-01T00:00:00.000Z' }];
    expect(pruneStaleOptimistic(optimistic, streamed)).toEqual([]);
  });

  it('keeps an optimistic entry that is still strictly newer than the streamed record', () => {
    const optimistic = [{ id: '1', updatedAt: '2026-01-02T00:00:00.000Z' }];
    const streamed = [{ id: '1', updatedAt: '2026-01-01T00:00:00.000Z' }];
    expect(pruneStaleOptimistic(optimistic, streamed)).toEqual(optimistic);
  });

  it('keeps an optimistic entry with no corresponding streamed record at all', () => {
    const optimistic = [{ id: 'new', updatedAt: '2026-01-01T00:00:00.000Z' }];
    expect(pruneStaleOptimistic(optimistic, [])).toEqual(optimistic);
  });
});

describe('buildScoreMap', () => {
  it('groups scores by teamId then questionNumber', () => {
    const scores = [
      { teamId: 't1', questionNumber: 1, points: 2, updatedAt: 'a' },
      { teamId: 't1', questionNumber: 2, points: 3, updatedAt: 'a' },
      { teamId: 't2', questionNumber: 1, points: 1, updatedAt: 'a' },
    ];
    const map = buildScoreMap(scores);
    expect(map.get('t1')?.get(1)?.points).toBe(2);
    expect(map.get('t1')?.get(2)?.points).toBe(3);
    expect(map.get('t2')?.get(1)?.points).toBe(1);
  });

  it('keeps only the most recently updated record per (teamId, questionNumber) cell', () => {
    const scores = [
      { teamId: 't1', questionNumber: 1, points: 1, updatedAt: '2026-01-01T00:00:00.000Z' },
      { teamId: 't1', questionNumber: 1, points: 9, updatedAt: '2026-01-02T00:00:00.000Z' },
    ];
    const map = buildScoreMap(scores);
    expect(map.get('t1')?.get(1)?.points).toBe(9);
  });
});

describe('dedupeScoresByCell', () => {
  it('flattens to one record per (teamId, questionNumber) cell', () => {
    const scores = [
      { teamId: 't1', questionNumber: 1, points: 1, updatedAt: '2026-01-01T00:00:00.000Z' },
      { teamId: 't1', questionNumber: 1, points: 9, updatedAt: '2026-01-02T00:00:00.000Z' },
      { teamId: 't1', questionNumber: 2, points: 3, updatedAt: '2026-01-01T00:00:00.000Z' },
    ];
    const result = dedupeScoresByCell(scores);
    expect(result).toHaveLength(2);
    expect(result.find((s) => s.questionNumber === 1)?.points).toBe(9);
  });
});

describe('findDuplicateScoreIds', () => {
  it('returns [] when there are no duplicate cells', () => {
    const scores = [
      { id: 'a', teamId: 't1', questionNumber: 1, updatedAt: 't1' },
      { id: 'b', teamId: 't1', questionNumber: 2, updatedAt: 't1' },
    ];
    expect(findDuplicateScoreIds(scores)).toEqual([]);
  });

  it('returns the ids of every record except the most recently updated one per cell', () => {
    const scores = [
      { id: 'old', teamId: 't1', questionNumber: 1, updatedAt: '2026-01-01T00:00:00.000Z' },
      { id: 'newer', teamId: 't1', questionNumber: 1, updatedAt: '2026-01-02T00:00:00.000Z' },
      { id: 'newest', teamId: 't1', questionNumber: 1, updatedAt: '2026-01-03T00:00:00.000Z' },
    ];
    const result = findDuplicateScoreIds(scores);
    expect(result.sort()).toEqual(['newer', 'old']);
  });

  it('handles multiple duplicate groups independently', () => {
    const scores = [
      { id: 'a1', teamId: 't1', questionNumber: 1, updatedAt: '2026-01-01T00:00:00.000Z' },
      { id: 'a2', teamId: 't1', questionNumber: 1, updatedAt: '2026-01-02T00:00:00.000Z' },
      { id: 'b1', teamId: 't2', questionNumber: 1, updatedAt: '2026-01-01T00:00:00.000Z' },
      { id: 'b2', teamId: 't2', questionNumber: 1, updatedAt: '2026-01-02T00:00:00.000Z' },
    ];
    expect(findDuplicateScoreIds(scores).sort()).toEqual(['a1', 'b1']);
  });
});

describe('teamTotal', () => {
  it('sums points across all scored questions', () => {
    const byQuestion = new Map([
      [1, { points: 2 }],
      [2, { points: 3 }],
    ]);
    expect(teamTotal(byQuestion)).toBe(5);
  });

  it('returns 0 for undefined', () => {
    expect(teamTotal(undefined)).toBe(0);
  });

  it('returns 0 for an empty map', () => {
    expect(teamTotal(new Map())).toBe(0);
  });
});
