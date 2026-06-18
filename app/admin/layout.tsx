import { redirect } from 'next/navigation';
import { getServerSession } from '@/app/lib/auth';
import AdminNav from '@/app/components/AdminNav';

export const dynamic = 'force-dynamic';

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await getServerSession();

  if (!session || !session.isAdmin) {
    redirect('/login?redirect=/admin/scores');
  }

  return (
    <div className="flex min-h-screen flex-col bg-gray-50 md:flex-row">
      <AdminNav adminEmail={session.email} />
      <main className="flex-1 overflow-y-auto p-4 md:p-8">{children}</main>
    </div>
  );
}
