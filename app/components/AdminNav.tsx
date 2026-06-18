'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { signOut } from 'aws-amplify/auth';

const LINKS = [
  { href: '/admin/scores', label: 'Scores' },
  { href: '/admin/teams', label: 'Teams' },
  { href: '/admin/users', label: 'Users' },
] as const;

function linkClasses(active: boolean): string {
  return active ? 'bg-indigo-100 text-indigo-700 font-semibold' : 'text-gray-600 hover:bg-gray-100';
}

export default function AdminNav({ adminEmail }: { adminEmail: string }) {
  const pathname = usePathname();
  const router = useRouter();

  async function handleSignOut() {
    await signOut();
    router.push('/login');
  }

  return (
    <>
      {/* Mobile: compact top bar */}
      <div className="flex flex-col gap-2 border-b border-gray-200 bg-white px-4 py-3 md:hidden">
        <div className="flex items-center justify-between">
          <span className="text-lg font-bold text-indigo-600">Bible Bowl Admin</span>
          <button
            type="button"
            onClick={handleSignOut}
            className="text-sm font-medium text-gray-500 hover:text-gray-800"
          >
            Sign out
          </button>
        </div>
        <nav className="flex gap-2 overflow-x-auto">
          {LINKS.map((link) => (
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
        </nav>
        <span className="truncate text-xs text-gray-400">Signed in as {adminEmail}</span>
      </div>

      {/* Desktop: vertical sidebar */}
      <div className="hidden h-full w-56 flex-col border-r border-gray-200 bg-white md:flex">
        <div className="px-4 py-5">
          <span className="text-lg font-bold text-indigo-600">Bible Bowl</span>
          <p className="text-xs text-gray-400">Admin</p>
        </div>
        <nav className="flex flex-1 flex-col gap-1 px-3">
          {LINKS.map((link) => (
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
