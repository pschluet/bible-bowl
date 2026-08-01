/**
 * Pure "best onboarding token per team" picker, used by the admin
 * scorekeepers page to collapse a game's full OnboardingToken list (which
 * can include stale/consumed tokens from earlier QR regenerations) down to
 * one token per team for display.
 */

import type { GroupType } from './constants';

export interface TokenLike {
  tokenId: string;
  teamId: string;
  status?: string | null;
  expiresAt?: string | null;
}

export interface TeamLike {
  id: string;
  name: string;
  groupType?: GroupType | null;
}

export interface QrTokenResult {
  tokenId: string;
  teamId: string;
  teamName: string;
  groupType: GroupType | null;
  status: 'UNUSED' | 'CONSUMED';
}

/**
 * Picks the single best token per team — preferring UNUSED over CONSUMED,
 * then the later-expiring token on a same-status tie (expiresAt is always
 * set at token creation and never cleared, so it tracks creation order) —
 * and maps the result into display shape, ordered to match `teams`.
 */
export function pickTokensPerTeam(tokens: TokenLike[], teams: TeamLike[]): QrTokenResult[] {
  const byTeam = new Map<string, TokenLike>();
  for (const item of tokens) {
    const existing = byTeam.get(item.teamId);
    if (!existing) {
      byTeam.set(item.teamId, item);
      continue;
    }
    if (item.status === 'UNUSED' && existing.status !== 'UNUSED') {
      byTeam.set(item.teamId, item);
      continue;
    }
    if (item.status === existing.status) {
      const itemDate = item.expiresAt ?? '';
      const existingDate = existing.expiresAt ?? '';
      if (itemDate > existingDate) byTeam.set(item.teamId, item);
    }
  }

  return teams.flatMap((team): QrTokenResult[] => {
    const t = byTeam.get(team.id);
    if (!t) return [];
    return [
      {
        tokenId: t.tokenId,
        teamId: t.teamId,
        teamName: team.name,
        groupType: team.groupType ?? null,
        status: (t.status ?? 'UNUSED') as 'UNUSED' | 'CONSUMED',
      },
    ];
  });
}
