import { redirect } from 'next/navigation';

interface Props {
  params: Promise<{ slug: string }>;
}

export default async function GamePage({ params }: Props) {
  const { slug } = await params;
  redirect(`/admin/games/${slug}/scores`);
}
