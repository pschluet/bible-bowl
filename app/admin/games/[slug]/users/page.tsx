'use client';

import { use, useEffect, useState } from 'react';
import { generateClient } from 'aws-amplify/data';
import type { Schema } from '@/amplify/data/resource';
import { subscribeLive } from '@/app/lib/liveQuery';
import { compareTeamOrder } from '@/app/lib/constants';
import { SCOREKEEPER_EMAIL_DOMAIN } from '@/app/lib/cognito';
import QrCodeDisplay, { type QrToken } from '@/app/components/QrCodeDisplay';
import QrCodePrintGrid from '@/app/components/QrCodePrintGrid';
import Spinner from '@/app/components/Spinner';

type Team = Schema['Team']['type'];
type Game = Schema['Game']['type'];

const client = generateClient<Schema>({ authMode: 'userPool' });

interface Props {
  params: Promise<{ slug: string }>;
}

export default function AdminGameUsersPage({ params }: Props) {
  const { slug } = use(params);

  // ── game state ─────────────────────────────────────────────────────────────
  const [game, setGame] = useState<Game | null>(null);
  const [teams, setTeams] = useState<Team[]>([]);

  // ── QR onboarding ──────────────────────────────────────────────────────────
  const [tokens, setTokens] = useState<QrToken[]>([]);
  const [generating, setGenerating] = useState(false);
  const [qrDisplayIndex, setQrDisplayIndex] = useState<number | null>(null);
  const [showPrintGrid, setShowPrintGrid] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);
  const [regeneratingTeam, setRegeneratingTeam] = useState<string | null>(null);

  // ── game controls ──────────────────────────────────────────────────────────
  const [togglingEntry, setTogglingEntry] = useState(false);
  const [endingGame, setEndingGame] = useState(false);
  const [endGameConfirm, setEndGameConfirm] = useState(false);
  const [endGameResult, setEndGameResult] = useState<string | null>(null);

  // ── Live game subscription ─────────────────────────────────────────────────
  useEffect(() => {
    return subscribeLive(
      () =>
        client.models.Game.observeQuery({
          authMode: 'userPool',
          filter: { slug: { eq: slug } },
        }),
      ({ items }) => setGame(items[0] ?? null),
      `game:bySlug:${slug}`
    );
  }, [slug]);

  // ── Live teams subscription ────────────────────────────────────────────────
  useEffect(() => {
    return subscribeLive(
      () =>
        client.models.Team.observeQuery({
          authMode: 'userPool',
          filter: { gameId: { eq: slug } },
        }),
      ({ items }) => {
        setTeams([...items].sort(compareTeamOrder));
      },
      `team:byGame:${slug}`
    );
  }, [slug]);

  // ── Live token subscription ────────────────────────────────────────────────
  useEffect(() => {
    if (teams.length === 0) return;

    return subscribeLive(
      () =>
        client.models.OnboardingToken.observeQuery({
          authMode: 'userPool',
          filter: { gameId: { eq: slug } },
        }),
      ({ items }) => {
        if (items.length === 0) {
          setTokens([]);
          return;
        }

        // Group all tokens by teamId; pick the best one per team
        const byTeam = new Map<string, (typeof items)[number]>();
        for (const item of items) {
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
            const itemDate = item.expiresAt ?? item.consumedAt ?? '';
            const existingDate = existing.expiresAt ?? existing.consumedAt ?? '';
            if (itemDate > existingDate) byTeam.set(item.teamId, item);
          }
        }

        const mapped: QrToken[] = teams.flatMap((team): QrToken[] => {
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

        setTokens(mapped);
      },
      `token:byGame:${slug}`
    );
  }, [teams, slug]);

  // ── QR generation ──────────────────────────────────────────────────────────
  async function handleGenerate() {
    setGenerating(true);
    setGenerateError(null);
    try {
      const res = await fetch('/api/scorekeeper/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ gameId: slug }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(data?.error ?? 'Failed to generate QR codes.');
      }
    } catch (err) {
      setGenerateError(err instanceof Error ? err.message : 'Failed to generate QR codes.');
    } finally {
      setGenerating(false);
    }
  }

  async function handleRegenerateTeam(teamId: string) {
    setRegeneratingTeam(teamId);
    setGenerateError(null);
    try {
      const res = await fetch('/api/scorekeeper/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ gameId: slug, teamId }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(data?.error ?? 'Failed to regenerate QR code.');
      }
    } catch (err) {
      setGenerateError(err instanceof Error ? err.message : 'Failed to regenerate QR code.');
    } finally {
      setRegeneratingTeam(null);
    }
  }

  // ── Toggle scorekeeper entry ───────────────────────────────────────────────
  async function handleToggleEntry() {
    if (!game) return;
    setTogglingEntry(true);
    try {
      const entryDisabled = game.scoringOpen === false;
      await client.models.Game.update(
        { slug, scoringOpen: entryDisabled },
        { authMode: 'userPool' }
      );
    } finally {
      setTogglingEntry(false);
    }
  }

  // ── End Game ───────────────────────────────────────────────────────────────
  // Ending a game with lots of scorekeepers can transiently fail server-side
  // (e.g. under load — same as handleDelete in app/admin/games/page.tsx). The
  // route is idempotent and convergent — each pass only touches whatever's
  // left — so a few automatic retries finish the job without making the admin
  // re-click End Game themselves.
  async function handleEndGame() {
    setEndingGame(true);
    setEndGameResult(null);
    setEndGameConfirm(false);

    const maxAttempts = 3;
    let lastError = 'Failed to end game.';
    try {
      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
          const res = await fetch('/api/scorekeeper/end-game', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ gameId: slug }),
          });
          if (res.ok) {
            const data = (await res.json()) as { deleted?: number; failures?: number };
            setEndGameResult(
              `Game ended. Deleted ${data.deleted ?? 0} scorekeeper(s).${
                (data.failures ?? 0) > 0 ? ` (${data.failures} failure(s) — see logs)` : ''
              }`
            );
            return;
          }
          const data = (await res.json().catch(() => null)) as { error?: string } | null;
          lastError = data?.error ?? lastError;
        } catch (err) {
          lastError = err instanceof Error ? err.message : lastError;
        }
        if (attempt < maxAttempts) {
          await new Promise((r) => setTimeout(r, 500 * attempt));
        }
      }
      setEndGameResult(lastError);
    } finally {
      setEndingGame(false);
    }
  }

  const gameExists = game !== null;
  const entryEnabled = game?.scoringOpen !== false;

  // Helper: team name from team list
  function teamName(teamId: string): string {
    return teams.find((t) => t.id === teamId)?.name ?? teamId;
  }

  // Map scorekeeperEmail to the QR-style username for display
  void SCOREKEEPER_EMAIL_DOMAIN; // suppress unused import warning

  return (
    <div className="mx-auto max-w-2xl space-y-8 print:hidden">
      <h1 className="text-2xl font-bold text-gray-900">Scorekeepers</h1>

      {/* ── Scorekeeper Onboarding ── */}
      <section className="rounded-lg border border-gray-200 bg-white p-6">
        <div className="mb-4">
          <h2 className="text-base font-semibold text-gray-900">Scorekeeper Onboarding</h2>
          <p className="mt-0.5 text-xs text-gray-500">
            Generate one QR code per team. Scorekeepers scan the code to sign in automatically.
          </p>
        </div>

        <div className="mb-4 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={handleGenerate}
            disabled={generating || teams.length === 0}
            className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            {generating
              ? 'Generating…'
              : tokens.length > 0
                ? 'Regenerate QR Codes'
                : 'Generate QR Codes'}
          </button>

          {tokens.length > 0 && (
            <>
              <button
                type="button"
                onClick={() => setQrDisplayIndex(0)}
                className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                Show All QR Codes
              </button>
              <button
                type="button"
                onClick={() => setShowPrintGrid(true)}
                className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                Print All
              </button>
            </>
          )}
        </div>

        {/* Toggle scorekeeper entry */}
        <div className="mb-4">
          <button
            type="button"
            role="switch"
            aria-checked={entryEnabled}
            onClick={() => void handleToggleEntry()}
            disabled={togglingEntry || !gameExists}
            title={!gameExists ? 'Game not found' : undefined}
            className="flex items-center gap-2 disabled:opacity-50"
          >
            <span
              className={`relative inline-flex h-5 w-9 shrink-0 rounded-full transition-colors duration-200 ${
                entryEnabled ? 'bg-green-500' : 'bg-gray-300'
              }`}
            >
              <span
                className={`inline-block h-4 w-4 translate-y-0.5 rounded-full bg-white shadow transition-transform duration-200 ${
                  entryEnabled ? 'translate-x-4' : 'translate-x-0.5'
                }`}
              />
            </span>
            <span className="text-xs font-medium text-gray-700">
              Scorekeeper Entry {entryEnabled ? 'Enabled' : 'Disabled'}
            </span>
          </button>
        </div>

        {generateError && (
          <div className="mb-4 rounded-md bg-red-50 px-4 py-2 text-sm text-red-700">
            {generateError}
          </div>
        )}

        {teams.length === 0 && (
          <p className="text-sm text-gray-400">Add teams first, then generate QR codes.</p>
        )}

        {tokens.length > 0 && (
          <ul className="divide-y divide-gray-100 rounded-lg border border-gray-200">
            {tokens.map((token, idx) => (
              <li
                key={token.tokenId}
                className="flex flex-col gap-2 px-4 py-2.5 sm:flex-row sm:flex-wrap sm:items-center sm:gap-3"
              >
                <div className="flex min-w-0 flex-1 items-center gap-2 sm:contents">
                  <div className="min-w-0 flex-1">
                    <p className="break-words text-sm font-medium text-gray-900">
                      {token.teamName}
                    </p>
                    {token.groupType && <p className="text-xs text-gray-400">{token.groupType}</p>}
                  </div>

                  <span
                    className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${
                      token.status === 'UNUSED'
                        ? 'bg-green-100 text-green-700'
                        : 'bg-gray-100 text-gray-500'
                    }`}
                  >
                    {token.status === 'UNUSED' ? 'Available' : 'Used'}
                  </span>
                </div>

                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => void handleRegenerateTeam(token.teamId)}
                    disabled={regeneratingTeam === token.teamId}
                    className="shrink-0 rounded-md border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-700 hover:bg-amber-100 disabled:opacity-50"
                  >
                    {regeneratingTeam === token.teamId ? 'Regenerating…' : 'Regenerate'}
                  </button>

                  <button
                    type="button"
                    onClick={() => setQrDisplayIndex(idx)}
                    className="shrink-0 rounded-md border border-indigo-200 bg-indigo-50 px-3 py-1 text-xs font-semibold text-indigo-700 hover:bg-indigo-100"
                  >
                    Show QR
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}

        {tokens.length === 0 && teams.length > 0 && !generating && (
          <p className="text-sm text-gray-400">
            No QR codes generated yet. Click &quot;Generate QR Codes&quot; to create them.
          </p>
        )}
      </section>

      {/* ── End Game ── */}
      <section className="rounded-lg border border-red-200 bg-red-50 p-6">
        <h2 className="mb-1 text-base font-semibold text-red-800">End Game</h2>
        <p className="mb-4 text-sm text-red-700">
          Signs out all scorekeepers for this game, clears their team bindings, and closes scoring.
          Scores and teams are preserved.
        </p>

        <div className="flex flex-wrap items-center gap-3">
          {endGameConfirm ? (
            <>
              <span className="text-xs text-gray-700">Delete all scorekeepers for this game?</span>
              <button
                type="button"
                onClick={handleEndGame}
                disabled={endingGame}
                className="rounded-md bg-red-600 px-3 py-1 text-xs font-semibold text-white hover:bg-red-700 disabled:opacity-50"
              >
                Confirm
              </button>
              <button
                type="button"
                onClick={() => setEndGameConfirm(false)}
                className="rounded-md border border-gray-300 px-3 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50"
              >
                Cancel
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => setEndGameConfirm(true)}
              disabled={endingGame}
              className="flex items-center gap-1.5 rounded-md bg-red-600 px-3 py-1 text-xs font-semibold text-white hover:bg-red-700 disabled:opacity-50"
            >
              {endingGame && (
                <Spinner className="h-3.5 w-3.5 border-2 border-red-200 border-t-white" />
              )}
              {endingGame ? 'Ending…' : 'End Game'}
            </button>
          )}
        </div>

        {endGameResult && <p className="mt-3 text-xs text-gray-600">{endGameResult}</p>}
      </section>

      {/* ── Current scorekeeper assignments ── */}
      {teams.some((t) => t.scorekeeperUserId) && (
        <section className="rounded-lg border border-gray-200 bg-white p-6">
          <h2 className="mb-3 text-base font-semibold text-gray-900">Active Scorekeepers</h2>
          <ul className="divide-y divide-gray-100 rounded-lg border border-gray-200">
            {teams
              .filter((t) => t.scorekeeperUserId)
              .map((t) => (
                <li key={t.id} className="flex items-center gap-2 px-4 py-2.5">
                  <span className="flex-1 text-sm font-medium text-gray-900">{teamName(t.id)}</span>
                  <span className="text-xs text-gray-400 font-mono truncate max-w-[180px]">
                    {t.scorekeeperEmail}
                  </span>
                </li>
              ))}
          </ul>
        </section>
      )}

      {/* ── QR display carousel ── */}
      {qrDisplayIndex !== null && tokens.length > 0 && (
        <QrCodeDisplay
          tokens={tokens}
          initialIndex={qrDisplayIndex}
          onClose={() => setQrDisplayIndex(null)}
        />
      )}

      {/* ── Print grid overlay ── */}
      {showPrintGrid && tokens.length > 0 && (
        <QrCodePrintGrid tokens={tokens} onClose={() => setShowPrintGrid(false)} />
      )}
    </div>
  );
}
