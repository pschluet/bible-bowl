/**
 * @vitest-environment node
 */
import { describe, expect, it, vi } from 'vitest';
import {
  RESERVED_SLUGS,
  compareTeamOrder,
  listAll,
  normalizeGroupType,
  normalizeSlug,
  parseBulkTeams,
  scoreId,
  teamOptionLabel,
  validateSlug,
} from '@/app/lib/constants';

describe('scoreId', () => {
  it('joins teamId and questionNumber with a #', () => {
    expect(scoreId('team-1', 3)).toBe('team-1#3');
  });
});

describe('normalizeSlug', () => {
  it('lowercases, replaces spaces with hyphens, and strips invalid characters', () => {
    expect(normalizeSlug('  My Game!  ')).toBe('my-game');
  });

  it('collapses repeated hyphens', () => {
    expect(normalizeSlug('a---b')).toBe('a-b');
  });

  it('collapses whitespace runs (tabs/newlines count as whitespace)', () => {
    expect(normalizeSlug('a\t\n  b')).toBe('a-b');
  });

  it('trims leading/trailing hyphens produced by stripping', () => {
    expect(normalizeSlug('!!!hello!!!')).toBe('hello');
  });

  it('strips non-ASCII characters rather than transliterating them', () => {
    expect(normalizeSlug('café')).toBe('caf');
  });

  it('strips underscores', () => {
    expect(normalizeSlug('my_game')).toBe('mygame');
  });

  it('returns an empty string for input with no valid characters', () => {
    expect(normalizeSlug('!!!')).toBe('');
  });
});

describe('validateSlug', () => {
  it('requires a non-empty slug', () => {
    expect(validateSlug('')).toBe('Game code is required.');
  });

  it('rejects a 1-character slug as too short', () => {
    expect(validateSlug('a')).toBe('Game code must be at least 2 characters.');
  });

  it('accepts a 2-character slug', () => {
    expect(validateSlug('ab')).toBeNull();
  });

  it('accepts exactly 64 characters', () => {
    expect(validateSlug('a'.repeat(64))).toBeNull();
  });

  it('rejects 65 characters as too long', () => {
    expect(validateSlug('a'.repeat(65))).toBe('Game code must be 64 characters or fewer.');
  });

  it('rejects a slug starting with a hyphen', () => {
    expect(validateSlug('-abc')).toMatch(/start and end with a letter or number/);
  });

  it('rejects a slug ending with a hyphen', () => {
    expect(validateSlug('abc-')).toMatch(/start and end with a letter or number/);
  });

  it('rejects characters outside [a-z0-9-]', () => {
    expect(validateSlug('ab_cd')).toMatch(/start and end with a letter or number/);
  });

  it('accepts internal hyphens', () => {
    expect(validateSlug('my-game-2026')).toBeNull();
  });

  it.each([...RESERVED_SLUGS].filter((w) => w.length >= 2))(
    'rejects the reserved word "%s"',
    (word) => {
      expect(validateSlug(word)).toBe(
        `"${word}" is a reserved word and cannot be used as a game code.`
      );
    }
  );

  it('never reaches the reserved-word check for the single-character reserved word "g" (the length check rejects it first)', () => {
    // RESERVED_SLUGS includes 'g', but the length check runs before the
    // reserved-word check, so 'g' always fails on length instead — the
    // reserved-word message for 'g' is unreachable in practice.
    expect(RESERVED_SLUGS.has('g')).toBe(true);
    expect(validateSlug('g')).toBe('Game code must be at least 2 characters.');
  });

  it('is case-sensitive for reserved words (validateSlug is only ever called with an already-lowercased slug)', () => {
    expect(validateSlug('ADMIN')).toMatch(/start and end with a letter or number/);
  });
});

describe('listAll', () => {
  it('makes a single call when there is no nextToken', async () => {
    const listFn = vi.fn().mockResolvedValue({ data: [1, 2, 3], nextToken: null });
    const result = await listAll(listFn);
    expect(result).toEqual([1, 2, 3]);
    expect(listFn).toHaveBeenCalledTimes(1);
    expect(listFn).toHaveBeenCalledWith({ nextToken: undefined, limit: 1000 });
  });

  it('follows nextToken across multiple pages and concatenates results in order', async () => {
    const listFn = vi
      .fn()
      .mockResolvedValueOnce({ data: [1, 2], nextToken: 'page2' })
      .mockResolvedValueOnce({ data: [3, 4], nextToken: 'page3' })
      .mockResolvedValueOnce({ data: [5], nextToken: null });
    const result = await listAll(listFn);
    expect(result).toEqual([1, 2, 3, 4, 5]);
    expect(listFn).toHaveBeenCalledTimes(3);
    expect(listFn).toHaveBeenNthCalledWith(2, { nextToken: 'page2', limit: 1000 });
  });

  it('treats an empty-string nextToken as terminal', async () => {
    const listFn = vi.fn().mockResolvedValue({ data: [1], nextToken: '' });
    const result = await listAll(listFn);
    expect(result).toEqual([1]);
    expect(listFn).toHaveBeenCalledTimes(1);
  });
});

describe('teamOptionLabel', () => {
  it('appends the human-readable group label when groupType is recognized', () => {
    expect(teamOptionLabel({ name: 'Faith Community', groupType: 'PreTeen' })).toBe(
      'Faith Community — Pre-Teen'
    );
  });

  it('falls back to the bare name when groupType is missing', () => {
    expect(teamOptionLabel({ name: 'Grace Chapel' })).toBe('Grace Chapel');
  });

  it('falls back to the bare name when groupType is unrecognized', () => {
    expect(teamOptionLabel({ name: 'Grace Chapel', groupType: 'Bogus' })).toBe('Grace Chapel');
  });

  it('falls back to the bare name when groupType is null', () => {
    expect(teamOptionLabel({ name: 'Grace Chapel', groupType: null })).toBe('Grace Chapel');
  });
});

describe('compareTeamOrder', () => {
  it('sorts ascending by displayOrder', () => {
    const teams = [
      { name: 'B', displayOrder: 2 },
      { name: 'A', displayOrder: 1 },
    ];
    expect([...teams].sort(compareTeamOrder).map((t) => t.name)).toEqual(['A', 'B']);
  });

  it('honors displayOrder: 0 (does not treat it as missing)', () => {
    const teams = [
      { name: 'B', displayOrder: 5 },
      { name: 'A', displayOrder: 0 },
    ];
    expect([...teams].sort(compareTeamOrder).map((t) => t.name)).toEqual(['A', 'B']);
  });

  it('sorts teams with no displayOrder after teams with one', () => {
    const teams = [
      { name: 'NoOrder', displayOrder: null },
      { name: 'HasOrder', displayOrder: 3 },
    ];
    expect([...teams].sort(compareTeamOrder).map((t) => t.name)).toEqual(['HasOrder', 'NoOrder']);
  });

  it('falls back to alphabetical-by-name when both teams lack displayOrder', () => {
    const teams = [
      { name: 'Zebra', displayOrder: undefined },
      { name: 'Antelope', displayOrder: undefined },
    ];
    expect([...teams].sort(compareTeamOrder).map((t) => t.name)).toEqual(['Antelope', 'Zebra']);
  });

  it('falls back to alphabetical-by-name on an exact displayOrder tie', () => {
    const teams = [
      { name: 'Zebra', displayOrder: 1 },
      { name: 'Antelope', displayOrder: 1 },
    ];
    expect([...teams].sort(compareTeamOrder).map((t) => t.name)).toEqual(['Antelope', 'Zebra']);
  });
});

describe('normalizeGroupType', () => {
  it.each([
    ['teen', 'Teen'],
    ['TEEN', 'Teen'],
    ['Pre-Teen', 'PreTeen'],
    ['pre teen', 'PreTeen'],
    ['PRETEEN', 'PreTeen'],
    [' adult ', 'Adult'],
  ])('normalizes "%s" to %s', (input, expected) => {
    expect(normalizeGroupType(input)).toBe(expected);
  });

  it('returns null for an unrecognized value', () => {
    expect(normalizeGroupType('youth')).toBeNull();
  });

  it('does not strip underscores (so "pre_teen" is unrecognized)', () => {
    expect(normalizeGroupType('pre_teen')).toBeNull();
  });

  it('returns null for empty input', () => {
    expect(normalizeGroupType('')).toBeNull();
  });
});

describe('parseBulkTeams', () => {
  it('pairs names and types line by line', () => {
    const result = parseBulkTeams('Church A\nChurch B', 'Teen\nAdult');
    expect(result).toEqual([
      { lineNumber: 1, name: 'Church A', groupType: 'Teen', error: null },
      { lineNumber: 2, name: 'Church B', groupType: 'Adult', error: null },
    ]);
  });

  it('applies the single-type shortcut when exactly one non-blank type line is given', () => {
    const result = parseBulkTeams('Church A\nChurch B\nChurch C', 'Teen');
    expect(result.every((r) => r.groupType === 'Teen')).toBe(true);
    expect(result).toHaveLength(3);
  });

  it('skips a row where both name and type are blank', () => {
    const result = parseBulkTeams('Church A\n\nChurch B', 'Teen\n\nAdult');
    expect(result.map((r) => r.name)).toEqual(['Church A', 'Church B']);
  });

  it('reports "missing team name" for a blank name with a non-blank type', () => {
    const result = parseBulkTeams('\nChurch B', 'Teen\nAdult');
    expect(result[0]).toMatchObject({ name: '', error: 'missing team name' });
  });

  it('reports "missing type" for a non-blank name with a blank type', () => {
    // Two non-blank type lines (Teen, Adult), so the single-type shortcut
    // does NOT kick in and row 2's blank type line is read literally.
    const result = parseBulkTeams('Church A\nChurch B\nChurch C', 'Teen\n\nAdult');
    expect(result[1]).toMatchObject({ name: 'Church B', error: 'missing type' });
  });

  it('reports unknown type "X" verbatim for an unrecognized type', () => {
    const result = parseBulkTeams('Church A', 'Youth Group');
    expect(result[0]).toMatchObject({ error: 'unknown type "Youth Group"' });
  });

  it.each(['Pre Teen', 'pre-teen', 'PRETEEN'])(
    'normalizes type-column variant "%s" to PreTeen',
    (typeInput) => {
      const result = parseBulkTeams('Church A', typeInput);
      expect(result[0]).toMatchObject({ groupType: 'PreTeen', error: null });
    }
  );

  it('produces a spurious "missing team name" row when the single-type shortcut is active and names has a trailing blank line', () => {
    // Documents a real edge case: with a shortcut type active, typeRaw is
    // always truthy, so the usual "both blank -> skip" rule never applies to
    // a trailing blank name line.
    const result = parseBulkTeams('Church A\n', 'Teen');
    expect(result).toHaveLength(2);
    expect(result[1]).toMatchObject({ name: '', error: 'missing team name' });
  });

  it('1-indexes lineNumber based on the longer of the two inputs', () => {
    const result = parseBulkTeams('A\nB\nC', 'Teen');
    expect(result.map((r) => r.lineNumber)).toEqual([1, 2, 3]);
  });
});
