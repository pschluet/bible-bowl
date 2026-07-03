'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { signOut } from 'aws-amplify/auth';

interface AdminNavProps {
  adminEmail: string;
  isSuperAdmin: boolean;
}

function linkClasses(active: boolean): string {
  return active ? 'bg-indigo-100 text-indigo-700 font-semibold' : 'text-gray-600 hover:bg-gray-100';
}

/**
 * Extract the game slug from the current pathname, if we're inside a game context.
 * Matches /admin/games/<slug>/... paths.
 */
function extractGameSlug(pathname: string): string | null {
  const match = pathname.match(/^\/admin\/games\/([^/]+)(?:\/|$)/);
  return match ? match[1] : null;
}

export default function AdminNav({ adminEmail, isSuperAdmin }: AdminNavProps) {
  const pathname = usePathname();
  const router = useRouter();

  const gameSlug = extractGameSlug(pathname);

  async function handleSignOut() {
    await signOut();
    router.push('/login');
  }

  // Build nav links depending on whether we're in a game context
  const gameLinks = gameSlug
    ? [
        { href: `/admin/games/${gameSlug}/scores`, label: 'Scores' },
        { href: `/admin/games/${gameSlug}/teams`, label: 'Teams' },
        { href: `/admin/games/${gameSlug}/users`, label: 'Scorekeepers' },
      ]
    : [];

  const topLinks = [
    { href: '/admin/games', label: 'Games' },
    ...(isSuperAdmin ? [{ href: '/admin/users', label: 'Users' }] : []),
  ];

  return (
    <>
      {/* Mobile: compact top bar */}
      <div className="flex flex-col gap-2 border-b border-gray-200 bg-white px-4 py-3 print:hidden md:hidden">
        <div className="flex items-center justify-between">
          <Link href="/" className="text-lg font-bold text-indigo-600 hover:text-indigo-800">
            Bible Bowl Admin
          </Link>
          <button
            type="button"
            onClick={handleSignOut}
            className="text-sm font-medium text-gray-500 hover:text-gray-800"
          >
            Sign out
          </button>
        </div>
        <nav className="flex gap-2 overflow-x-auto">
          {topLinks.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className={`rounded-md px-3 py-1.5 text-sm whitespace-nowrap ${linkClasses(
                pathname === link.href || pathname.startsWith(link.href + '/')
              )}`}
            >
              {link.label}
            </Link>
          ))}
          {gameLinks.length > 0 && <span className="self-center text-gray-300 text-sm">›</span>}
          {gameLinks.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className={`rounded-md px-3 py-1.5 text-sm whitespace-nowrap ${linkClasses(
                pathname.startsWith(link.href)
              )}`}
            >
              {link.label}
            </Link>
          ))}
          {gameSlug && (
            <Link
              href={`/g/${gameSlug}`}
              target="_blank"
              rel="noopener noreferrer"
              className={`rounded-md px-3 py-1.5 text-sm whitespace-nowrap ${linkClasses(false)}`}
            >
              Leaderboard ↗
            </Link>
          )}
        </nav>
        <span className="truncate text-xs text-gray-400">Signed in as {adminEmail}</span>
      </div>

      {/* Desktop: vertical sidebar */}
      <div className="hidden h-full w-56 flex-col border-r border-gray-200 bg-white print:hidden md:flex">
        <div className="px-4 py-5">
          <Link href="/" className="text-lg font-bold text-indigo-600 hover:text-indigo-800">
            Bible Bowl
          </Link>
          <p className="text-xs text-gray-400">{isSuperAdmin ? 'Super Admin' : 'Admin'}</p>
        </div>
        <nav className="flex flex-1 flex-col gap-1 px-3 pb-3">
          {topLinks.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className={`rounded-md px-3 py-2 text-sm ${linkClasses(
                pathname === link.href || pathname.startsWith(link.href + '/')
              )}`}
            >
              {link.label}
            </Link>
          ))}
          {gameLinks.length > 0 && (
            <>
              <div className="my-1 border-t border-gray-100" />
              {gameLinks.map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  className={`rounded-md px-3 py-2 text-sm ${linkClasses(
                    pathname.startsWith(link.href)
                  )}`}
                >
                  {link.label}
                </Link>
              ))}
              <Link
                href={`/g/${gameSlug}`}
                target="_blank"
                rel="noopener noreferrer"
                className={`rounded-md px-3 py-2 text-sm ${linkClasses(false)}`}
              >
                Leaderboard ↗
              </Link>
            </>
          )}
        </nav>
        <div className="border-t border-gray-200 p-3">
          <p className="mb-2 truncate text-xs text-gray-400">Signed in as {adminEmail}</p>
          <button
            type="button"
            onClick={handleSignOut}
            className="w-full rounded-md px-3 py-2 text-left text-sm font-medium text-gray-600 hover:bg-gray-100"
          >
            Sign out
          </button>
        </div>
      </div>
    </>
  );
}
