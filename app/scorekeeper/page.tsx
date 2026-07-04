'use client';

import { useEffect, useMemo, useState } from 'react';
import { generateClient } from 'aws-amplify/data';
import { fetchAuthSession } from 'aws-amplify/auth';
import type { Schema } from '@/amplify/data/resource';
import { subscribeLive } from '@/app/lib/liveQuery';
import ScoreEntry from '@/app/components/ScoreEntry';
import GameEndedView from '@/app/components/GameEndedView';

type Team = Schema['Team']['type'];
type Score = Schema['Score']['type'];
type Game = Schema['Game']['type'];

const client = generateClient<Schema>({ authMode: 'userPool' });

export default function ScorekeeperPage() {
  const [userSub, setUserSub] = useState<string | null>(null);
  const [allTeams, setAllTeams] = useState<Team[]>([]);
  const [gameItems, setGameItems] = useState<Game[]>([]);
  const [teamScores, setTeamScores] = useState<Score[]>([]);

  const [teamsSynced, setTeamsSynced] = useState(false);
  const [gameSynced, setGameSynced] = useState(false);
  const [scoresSynced, setScoresSynced] = useState(false);

  // The Team stream below is already filtered server-side to this
  // scorekeeper's own team(s) (see the `byScorekeeper` index), so the first
  // item is their team.
  const myTeam = useMemo(() => allTeams[0] ?? null, [allTeams]);
  const myTeamId = myTeam?.id ?? null;

  // The game for this team — subscribed by gameId once we have a team
  const game = useMemo(() => gameItems[0] ?? null, [gameItems]);
  const currentQuestion = game?.currentQuestion ?? null;

  const existingScore = useMemo(() => {
    if (!myTeam || currentQuestion === null) return null;
    return teamScores.find((s) => s.questionNumber === currentQuestion)?.points ?? null;
  }, [myTeam, currentQuestion, teamScores]);

  const loading = !teamsSynced || !gameSynced || (myTeamId !== null && !scoresSynced);

  useEffect(() => {
    void fetchAuthSession().then((session) => {
      setUserSub((session.tokens?.accessToken?.payload.sub as string | undefined) ?? null);
    });
  }, []);

  // Team stream — narrowed server-side to this scorekeeper's own team(s) via
  // the `byScorekeeper` index, instead of streaming every team in every game
  // to every scorekeeper just to find one row.
  useEffect(() => {
    if (!userSub) return;
    return subscribeLive(
      () =>
        client.models.Team.observeQuery({
          authMode: 'userPool',
          filter: { scorekeeperUserId: { eq: userSub } },
        }),
      ({ items, isSynced }) => {
        setAllTeams(items);
        if (isSynced) setTeamsSynced(true);
      },
      `team:byScorekeeper:${userSub}`
    );
  }, [userSub]);

  // Game stream — subscribed by gameId once we know the team's game
  const gameId = myTeam?.gameId ?? null;
  useEffect(() => {
    if (!gameId) {
      // Resetting mirrored subscription state when there is no active subscription —
      // not a synchronous cascading render.
      /* eslint-disable react-hooks/set-state-in-effect */
      setGameSynced(true);
      setGameItems([]);
      /* eslint-enable react-hooks/set-state-in-effect */
      return;
    }
    return subscribeLive(
      () =>
        client.models.Game.observeQuery({
          authMode: 'userPool',
          filter: { slug: { eq: gameId } },
        }),
      ({ items, isSynced }) => {
        setGameItems(items);
        if (isSynced) setGameSynced(true);
      },
      `game:bySlug:${gameId}`
    );
  }, [gameId]);

  // Score stream — filtered to myTeam, reopens when the team changes
  useEffect(() => {
    if (!myTeamId) {
      // Resetting mirrored subscription state when there is no active subscription —
      // not a synchronous cascading render.
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
      ({ items, isSynced }) => {
        setTeamScores(items);
        if (isSynced) setScoresSynced(true);
      },
      `score:byTeam:${myTeamId}`
    );
  }, [myTeamId]);

  if (loading) {
    return (
      <div className="flex justify-center py-20">
        <div className="h-10 w-10 animate-spin rounded-full border-4 border-gray-200 border-t-indigo-600" />
      </div>
    );
  }

  // Admin pressed End Game — scoringOpen flipped to false
  if (game?.scoringOpen === false) {
    return <GameEndedView />;
  }

  // Signed in as a scorekeeper but no team is bound to this account yet
  if (!myTeam) {
    return (
      <div className="rounded-xl border border-gray-200 bg-white p-6 text-center text-gray-600">
        <p className="font-medium">No team assigned</p>
        <p className="mt-1 text-sm text-gray-400">
          Contact the event organizer to have your team assigned.
        </p>
      </div>
    );
  }

  return (
    <ScoreEntry
      key={currentQuestion ?? 'none'}
      team={myTeam}
      currentQuestion={currentQuestion}
      existingScore={existingScore}
    />
  );
}
