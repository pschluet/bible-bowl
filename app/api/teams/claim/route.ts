import { NextResponse } from 'next/server';
import { generateServerClientUsingCookies } from '@aws-amplify/adapter-nextjs/data';
import { cookies } from 'next/headers';
import outputs from '@/amplify_outputs.json';
import type { Schema } from '@/amplify/data/resource';
import { getServerSession } from '@/app/lib/auth';

export async function POST(request: Request) {
  const session = await getServerSession();
  if (!session?.isScorekeeper) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: { teamId?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { teamId } = body;
  if (!teamId || typeof teamId !== 'string') {
    return NextResponse.json({ error: 'teamId is required' }, { status: 400 });
  }

  const dataClient = generateServerClientUsingCookies<Schema>({
    config: outputs,
    cookies,
    authMode: 'apiKey',
  });

  const { data: team } = await dataClient.models.Team.get({ id: teamId });
  if (!team) {
    return NextResponse.json({ error: 'Team not found' }, { status: 404 });
  }

  if (team.scorekeeperUserId && team.scorekeeperUserId !== session.sub) {
    return NextResponse.json({ error: 'Team already claimed' }, { status: 409 });
  }

  await dataClient.models.Team.update({
    id: teamId,
    scorekeeperUserId: session.sub,
    scorekeeperEmail: session.email,
  });

  return NextResponse.json({ success: true, teamId });
}
