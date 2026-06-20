import { redirect } from 'next/navigation';
import { getServerSession } from '@/app/lib/auth';
import ScorekeeperHeader from './ScorekeeperHeader';
import GameEndedView from '@/app/components/GameEndedView';

export const dynamic = 'force-dynamic';

export default async function ScorekeeperLayout({ children }: { children: React.ReactNode }) {
  const session = await getServerSession();

  // No session: covers End Game sign-out AND a fresh device that hasn't scanned yet.
  // Show the "game has ended" / "scoring is closed" screen instead of a login redirect
  // so scorekeepers see a clean message rather than an Authenticator form.
  if (!session) {
    return <GameEndedView />;
  }

  // Admin who wandered to /scorekeeper — send them back to the admin area
  if (!session.isScorekeeper) {
    redirect('/admin/scores');
  }

  return (
    <div className="flex min-h-full flex-col">
      <ScorekeeperHeader />
      <div className="mx-auto w-full max-w-md px-4 py-6">{children}</div>
    </div>
  );
}
