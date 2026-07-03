import { redirect, notFound } from 'next/navigation';
import { cookies } from 'next/headers';
import { generateServerClientUsingCookies } from '@aws-amplify/adapter-nextjs/data';
import outputs from '@/amplify_outputs.json';
import type { Schema } from '@/amplify/data/resource';
import { getServerSession } from '@/app/lib/auth';

export const dynamic = 'force-dynamic';

interface GameLayoutProps {
  children: React.ReactNode;
  params: Promise<{ slug: string }>;
}

export default async function GameLayout({ children, params }: GameLayoutProps) {
  const { slug } = await params;
  const session = await getServerSession();

  // Parent admin layout already guards isAdmin, but be explicit here
  if (!session?.isAdmin) {
    redirect('/login');
  }

  const dataClient = generateServerClientUsingCookies<Schema>({
    config: outputs,
    cookies,
    authMode: 'apiKey',
  });

  const { data: game } = await dataClient.models.Game.get({ slug });

  if (!game) {
    notFound();
  }

  // Regular admins can only access their own games
  if (!session.isSuperAdmin && game.ownerId !== session.sub) {
    redirect('/admin/games');
  }

  return <>{children}</>;
}
