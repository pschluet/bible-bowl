'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { generateClient } from 'aws-amplify/data';
import { fetchAuthSession } from 'aws-amplify/auth';
import type { Schema } from '@/amplify/data/resource';
import { GAME_STATE_ID } from '@/app/lib/constants';
import TeamPicker from '@/app/components/TeamPicker';
import ScoreEntry from '@/app/components/ScoreEntry';

type Team = Schema['Team']['type'];

const POLL_MS = 5000;

const client = generateClient<Schema>({ authMode: 'userPool' });

export default function ScorekeeperPage() {
  const [loading, setLoading] = useState(true);
  const [claiming, setClaiming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const claimingRef = useRef(false);

  const [myTeam, setMyTeam] = useState<Team | null>(null);
  const [unclaimedTeams, setUnclaimedTeams] = useState<Team[]>([]);
  const [currentQuestion, setCurrentQuestion] = useState<number | null>(null);
  const [existingScore, setExistingScore] = useState<number | null>(null);
  const [scoreId, setScoreId] = useState<string | null>(null);

  const load = useCallback(async (silent = false) => {
    if (!silent) {
      setLoading(true);
      setError(null);
    }

    const session = await fetchAuthSession();
    const userSub = (session.tokens?.accessToken?.payload.sub as string | undefined) ?? null;

    const [teamsRes, gameStateRes] = await Promise.all([
      client.models.Team.list(),
      client.models.GameState.get({ id: GAME_STATE_ID }),
    ]);

    const teams = teamsRes.data;
    const claimed = teams.find((t) => t.scorekeeperUserId === userSub) ?? null;
    const question = gameStateRes.data?.currentQuestion ?? null;

    // Fetch the existing score for this question before touching state, so that
    // all setState calls below are in one synchronous block. React batches them
    // into a single render, ensuring currentQuestion and existingScore are never
    // seen in an inconsistent intermediate state (which would cause ScoreEntry to
    // remount with a stale existingScore before it's cleared).
    let existingPoints: number | null = null;
    let existingId: string | null = null;
    if (claimed && question !== null) {
      const scoresRes = await client.models.Score.list({
        filter: {
          teamId: { eq: claimed.id },
          questionNumber: { eq: question },
        },
      });
      const existing = scoresRes.data[0];
      existingPoints = existing?.points ?? null;
      existingId = existing?.id ?? null;
    }

    // All state updates in one synchronous block → single React render.
    setMyTeam(claimed);
    setCurrentQuestion(question);
    setUnclaimedTeams(teams.filter((t) => !t.scorekeeperUserId));
    setExistingScore(existingPoints);
    setScoreId(existingId);
    if (!silent) setLoading(false);
  }, []);

  useEffect(() => {
    // Initial load + poll every 5 s so question advances without a manual refresh.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
    const interval = setInterval(() => {
      // Skip the poll while a claim is in flight to avoid overwriting optimistic state.
      if (!claimingRef.current) void load(true);
    }, POLL_MS);
    return () => clearInterval(interval);
  }, [load]);

  const handleClaim = useCallback(
    async (teamId: string) => {
      claimingRef.current = true;
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
          return;
        }
        await load();
      } catch {
        setError('Could not claim team. Please try again.');
      } finally {
        claimingRef.current = false;
        setClaiming(false);
      }
    },
    [load]
  );

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
      scoreId={scoreId}
    />
  );
}
