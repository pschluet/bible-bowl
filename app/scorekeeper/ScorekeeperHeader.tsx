'use client';

import { useRouter } from 'next/navigation';
import { signOut } from 'aws-amplify/auth';

export default function ScorekeeperHeader() {
  const router = useRouter();

  async function handleSignOut() {
    await signOut();
    router.push('/login');
  }

  return (
    <header className="flex items-center justify-between border-b border-gray-200 bg-white px-4 py-3">
      <span className="font-semibold text-indigo-700">Bible Bowl Scorekeeper</span>
      <button
        type="button"
        onClick={handleSignOut}
        className="text-sm font-medium text-gray-500 hover:text-gray-900"
      >
        Sign out
      </button>
    </header>
  );
}
