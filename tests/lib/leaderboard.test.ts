/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest';
import {
  assignCompetitionRanks,
  groupTeamsByType,
  rankLabel,
  readFavorites,
  serializeFavorites,
  sortLeaderboardTeams,
} from '@/app/lib/leaderboard';

describe('rankLabel', () => {
  it('renders medals for the top 3 ranks', () => {
    expect(rankLabel(1)).toBe('🥇');
    expect(rankLabel(2)).toBe('🥈');
    expect(rankLabel(3)).toBe('🥉');
  });

  it('renders a plain number for rank 4 and beyond', () => {
    expect(rankLabel(4)).toBe('4');
    expect(rankLabel(10)).toBe('10');
  });
});

describe('assignCompetitionRanks', () => {
  it('assigns sequential ranks when there are no ties', () => {
    const teams = [
      { id: 'a', total: 30 },
      { id: 'b', total: 20 },
      { id: 'c', total: 10 },
    ];
    const ranked = assignCompetitionRanks(teams);
    expect(ranked.map((r) => r.rank)).toEqual([1, 2, 3]);
  });

  it('gives tied teams the same rank, and the next distinct total skips ahead (1, 1, 3)', () => {
    const teams = [
      { id: 'a', total: 30 },
      { id: 'b', total: 30 },
      { id: 'c', total: 10 },
    ];
    const ranked = assignCompetitionRanks(teams);
    expect(ranked.map((r) => ({ id: r.team.id, rank: r.rank }))).toEqual([
      { id: 'a', rank: 1 },
      { id: 'b', rank: 1 },
      { id: 'c', rank: 3 },
    ]);
  });

  it('handles a 3-way tie at the top followed by a distinct 4th team (1, 1, 1, 4)', () => {
    const teams = [
      { id: 'a', total: 10 },
      { id: 'b', total: 10 },
      { id: 'c', total: 10 },
      { id: 'd', total: 5 },
    ];
    expect(assignCompetitionRanks(teams).map((r) => r.rank)).toEqual([1, 1, 1, 4]);
  });

  it('returns [] for an empty list', () => {
    expect(assignCompetitionRanks([])).toEqual([]);
  });
});

describe('sortLeaderboardTeams', () => {
  it('sorts descending by total', () => {
    const teams = [
      { name: 'B', total: 1 },
      { name: 'A', total: 5 },
    ];
    expect(sortLeaderboardTeams(teams).map((t) => t.name)).toEqual(['A', 'B']);
  });

  it('tie-breaks by name ascending', () => {
    const teams = [
      { name: 'Zebra', total: 5 },
      { name: 'Antelope', total: 5 },
    ];
    expect(sortLeaderboardTeams(teams).map((t) => t.name)).toEqual(['Antelope', 'Zebra']);
  });

  it('does not mutate the input array', () => {
    const teams = [
      { name: 'B', total: 1 },
      { name: 'A', total: 5 },
    ];
    const copy = [...teams];
    sortLeaderboardTeams(teams);
    expect(teams).toEqual(copy);
  });
});

describe('groupTeamsByType', () => {
  it('buckets teams into Teen/PreTeen/Adult/Other', () => {
    const teams = [
      { id: '1', groupType: 'Teen' },
      { id: '2', groupType: 'Adult' },
      { id: '3', groupType: null },
    ];
    const byGroup = groupTeamsByType(teams);
    expect(byGroup.get('Teen')?.map((t) => t.id)).toEqual(['1']);
    expect(byGroup.get('Adult')?.map((t) => t.id)).toEqual(['2']);
    expect(byGroup.get('Other')?.map((t) => t.id)).toEqual(['3']);
    expect(byGroup.get('PreTeen')).toEqual([]);
  });

  it('buckets an unrecognized groupType string into Other', () => {
    const teams = [{ id: '1', groupType: 'Bogus' }];
    expect(
      groupTeamsByType(teams)
        .get('Other')
        ?.map((t) => t.id)
    ).toEqual(['1']);
  });

  it('always includes every group key, even when empty', () => {
    const byGroup = groupTeamsByType([]);
    expect([...byGroup.keys()]).toEqual(['Teen', 'PreTeen', 'Adult', 'Other']);
  });
});

describe('readFavorites', () => {
  it('returns an empty set for null input', () => {
    expect(readFavorites(null)).toEqual(new Set());
  });

  it('parses a JSON array of ids', () => {
    expect(readFavorites('["a","b"]')).toEqual(new Set(['a', 'b']));
  });

  it('falls back to a legacy bare-string single favorite on malformed JSON', () => {
    expect(readFavorites('team-123')).toEqual(new Set(['team-123']));
  });

  it('falls back to the bare-string format for valid-but-non-array JSON', () => {
    expect(readFavorites('"123"')).toEqual(new Set(['"123"']));
    expect(readFavorites('{}')).toEqual(new Set(['{}']));
  });
});

describe('serializeFavorites', () => {
  it('serializes a non-empty set as a JSON array', () => {
    expect(serializeFavorites(new Set(['a', 'b']))).toBe('["a","b"]');
  });

  it('returns null for an empty set, signaling "remove the key"', () => {
    expect(serializeFavorites(new Set())).toBeNull();
  });
});
