import { redirect } from 'next/navigation';
import { getServerSession } from '@/app/lib/auth';
import ScorekeeperHeader from './ScorekeeperHeader';

export const dynamic = 'force-dynamic';

export default async function ScorekeeperLayout({ children }: { children: React.ReactNode }) {
  const session = await getServerSession();

  if (!session || !session.isScorekeeper) {
    redirect('/login?redirect=/scorekeeper');
  }

  return (
    <div className="flex min-h-full flex-col">
      <ScorekeeperHeader />
      <div className="mx-auto w-full max-w-md px-4 py-6">{children}</div>
    </div>
  );
}
