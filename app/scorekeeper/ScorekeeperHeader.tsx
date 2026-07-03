'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { signOut, fetchAuthSession } from 'aws-amplify/auth';
import { generateClient } from 'aws-amplify/data';
import type { Schema } from '@/amplify/data/resource';

const client = generateClient<Schema>({ authMode: 'userPool' });

export default function ScorekeeperHeader() {
  const router = useRouter();
  const [gameSlug, setGameSlug] = useState<string | null>(null);

  useEffect(() => {
    void fetchAuthSession().then(async (session) => {
      const sub = session.tokens?.accessToken?.payload.sub as string | undefined;
      if (!sub) return;
      const { data: teams } = await client.models.Team.list({
        filter: { scorekeeperUserId: { eq: sub } },
        authMode: 'userPool',
      });
      setGameSlug(teams[0]?.gameId ?? null);
    });
  }, []);

  async function handleSignOut() {
    await signOut();
    router.push('/login');
  }

  return (
    <header className="flex items-center justify-between border-b border-gray-200 bg-white px-4 py-3">
      <span className="font-semibold text-indigo-700">Bible Bowl Scorekeeper</span>
      <div className="flex items-center gap-4">
        <Link
          href={gameSlug ? `/g/${gameSlug}` : '/'}
          className="text-sm font-medium text-indigo-600 hover:text-indigo-800"
        >
          Leaderboard
        </Link>
        <button
          type="button"
          onClick={handleSignOut}
          className="text-sm font-medium text-gray-500 hover:text-gray-900"
        >
          Sign out
        </button>
      </div>
    </header>
  );
}
