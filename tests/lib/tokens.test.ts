/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest';
import { pickTokensPerTeam } from '@/app/lib/tokens';

const teams = [
  { id: 't1', name: 'Team One', groupType: 'Teen' as const },
  { id: 't2', name: 'Team Two', groupType: 'Adult' as const },
];

describe('pickTokensPerTeam', () => {
  it('returns one entry per team, ordered to match the teams list', () => {
    const tokens = [
      { tokenId: 'tok-2', teamId: 't2', status: 'UNUSED', expiresAt: '2026-01-01T00:00:00.000Z' },
      { tokenId: 'tok-1', teamId: 't1', status: 'UNUSED', expiresAt: '2026-01-01T00:00:00.000Z' },
    ];
    const result = pickTokensPerTeam(tokens, teams);
    expect(result.map((r) => r.teamId)).toEqual(['t1', 't2']);
  });

  it('omits teams with no token at all', () => {
    const tokens = [
      { tokenId: 'tok-1', teamId: 't1', status: 'UNUSED', expiresAt: '2026-01-01T00:00:00.000Z' },
    ];
    const result = pickTokensPerTeam(tokens, teams);
    expect(result.map((r) => r.teamId)).toEqual(['t1']);
  });

  it('prefers an UNUSED token over a CONSUMED one for the same team', () => {
    const tokens = [
      { tokenId: 'old', teamId: 't1', status: 'CONSUMED', expiresAt: '2026-01-01T00:00:00.000Z' },
      { tokenId: 'new', teamId: 't1', status: 'UNUSED', expiresAt: '2026-01-02T00:00:00.000Z' },
    ];
    const result = pickTokensPerTeam(tokens, teams);
    expect(result.find((r) => r.teamId === 't1')?.tokenId).toBe('new');
  });

  it('on a same-status tie, prefers the token with the later expiresAt', () => {
    const tokens = [
      {
        tokenId: 'earlier',
        teamId: 't1',
        status: 'CONSUMED',
        expiresAt: '2026-01-01T00:00:00.000Z',
      },
      { tokenId: 'later', teamId: 't1', status: 'CONSUMED', expiresAt: '2026-01-02T00:00:00.000Z' },
    ];
    const result = pickTokensPerTeam(tokens, teams);
    expect(result.find((r) => r.teamId === 't1')?.tokenId).toBe('later');
  });

  it('does not fall back to consumedAt for the tie-break (bug #5: expiresAt is always set)', () => {
    // If the dead `?? consumedAt` fallback were still present, a token with
    // no expiresAt but a later consumedAt could incorrectly win. It must not.
    const tokens = [
      {
        tokenId: 'has-expiry',
        teamId: 't1',
        status: 'CONSUMED',
        expiresAt: '2026-01-01T00:00:00.000Z',
        consumedAt: '2020-01-01T00:00:00.000Z',
      },
      {
        tokenId: 'no-expiry-but-later-consumedAt',
        teamId: 't1',
        status: 'CONSUMED',
        expiresAt: null,
        consumedAt: '2030-01-01T00:00:00.000Z',
      },
    ];
    const result = pickTokensPerTeam(tokens, teams);
    // 'has-expiry' wins: '2026-...' > '' (the no-expiry token's date reads as
    // empty string, not its consumedAt).
    expect(result.find((r) => r.teamId === 't1')?.tokenId).toBe('has-expiry');
  });

  it('maps groupType and defaults status to UNUSED when absent', () => {
    const tokens = [{ tokenId: 'tok-1', teamId: 't1' }];
    const result = pickTokensPerTeam(tokens, teams);
    expect(result[0]).toMatchObject({
      tokenId: 'tok-1',
      teamId: 't1',
      teamName: 'Team One',
      groupType: 'Teen',
      status: 'UNUSED',
    });
  });
});
