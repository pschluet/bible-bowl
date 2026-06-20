'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { generateClient } from 'aws-amplify/data';
import { fetchAuthSession } from 'aws-amplify/auth';
import type { Schema } from '@/amplify/data/resource';
import { subscribeLive } from '@/app/lib/liveQuery';
import TeamPicker from '@/app/components/TeamPicker';
import ScoreEntry from '@/app/components/ScoreEntry';

type Team = Schema['Team']['type'];
type Score = Schema['Score']['type'];
type GameState = Schema['GameState']['type'];

const client = generateClient<Schema>({ authMode: 'userPool' });

export default function ScorekeeperPage() {
  const [claiming, setClaiming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Raw stream state
  const [userSub, setUserSub] = useState<string | null>(null);
  const [allTeams, setAllTeams] = useState<Team[]>([]);
  const [gameStateItems, setGameStateItems] = useState<GameState[]>([]);
  const [teamScores, setTeamScores] = useState<Score[]>([]);

  // Track when each stream has completed its initial sync; loading derived directly
  const [teamsSynced, setTeamsSynced] = useState(false);
  const [gameStateSynced, setGameStateSynced] = useState(false);
  const loading = !teamsSynced || !gameStateSynced;

  // Derived state
  const myTeam = useMemo(
    () => allTeams.find((t) => t.scorekeeperUserId === userSub) ?? null,
    [allTeams, userSub]
  );
  const unclaimedTeams = useMemo(() => allTeams.filter((t) => !t.scorekeeperUserId), [allTeams]);
  const currentQuestion = useMemo(
    () => gameStateItems[0]?.currentQuestion ?? null,
    [gameStateItems]
  );
  const existingScore = useMemo(() => {
    if (!myTeam || currentQuestion === null) return null;
    return teamScores.find((s) => s.questionNumber === currentQuestion)?.points ?? null;
  }, [myTeam, currentQuestion, teamScores]);
  const existingScoreId = useMemo(() => {
    if (!myTeam || currentQuestion === null) return null;
    return teamScores.find((s) => s.questionNumber === currentQuestion)?.id ?? null;
  }, [myTeam, currentQuestion, teamScores]);

  // Primitive dep for the Score subscription so it only restarts when the team id changes
  const myTeamId = myTeam?.id ?? null;

  // Fetch userSub once on mount
  useEffect(() => {
    void fetchAuthSession().then((session) => {
      setUserSub((session.tokens?.accessToken?.payload.sub as string | undefined) ?? null);
    });
  }, []);

  // Team + GameState streams — set loading false once both initial syncs complete
  useEffect(() => {
    const unsubTeam = subscribeLive(
      () => client.models.Team.observeQuery({ authMode: 'userPool' }),
      ({ items, isSynced }) => {
        setAllTeams(items);
        if (isSynced) setTeamsSynced(true);
      },
    );
    const unsubGs = subscribeLive(
      () => client.models.GameState.observeQuery({ authMode: 'userPool' }),
      ({ items, isSynced }) => {
        setGameStateItems(items);
        if (isSynced) setGameStateSynced(true);
      },
    );
    return () => {
      unsubTeam();
      unsubGs();
    };
  }, []);

  // Score stream — filtered to myTeam, reopens when the team changes
  useEffect(() => {
    if (!myTeamId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setTeamScores([]);
      return;
    }
    return subscribeLive(
      () =>
        client.models.Score.observeQuery({
          authMode: 'userPool',
          filter: { teamId: { eq: myTeamId } },
        }),
      ({ items }) => setTeamScores(items),
    );
  }, [myTeamId]);

  const handleClaim = useCallback(async (teamId: string) => {
    setClaiming(true);
    setError(null);
    try {
      const res = await fetch('/api/teams/claim', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ teamId }),
      });
      if (!res.ok) {
        setError('Could not claim team. Please try again.');
      }
      // Team stream delivers the updated scorekeeperUserId — no reload needed
    } catch {
      setError('Could not claim team. Please try again.');
    } finally {
      setClaiming(false);
    }
  }, []);

  if (loading) {
    return (
      <div className="flex justify-center py-20">
        <div className="h-10 w-10 animate-spin rounded-full border-4 border-gray-200 border-t-indigo-600" />
      </div>
    );
  }

  if (!myTeam) {
    return (
      <div className="space-y-4">
        <TeamPicker unclaimedTeams={unclaimedTeams} onClaim={handleClaim} loading={claiming} />
        {error && <p className="text-center text-sm text-red-600">{error}</p>}
      </div>
    );
  }

  return (
    <ScoreEntry
      key={currentQuestion ?? 'none'}
      team={myTeam}
      currentQuestion={currentQuestion}
      existingScore={existingScore}
      scoreId={existingScoreId}
    />
  );
}
