/**
 * /scan?token=<UUID>
 *
 * Public entry point for scorekeeper QR-code onboarding.
 * No auth guard — this page bootstraps the session.
 *
 * The searchParams promise is resolved here (server component) so the client
 * component receives a plain string and doesn't need a Suspense boundary.
 */

import ScanClient from './ScanClient';

// Force dynamic rendering so searchParams is always evaluated at request time
export const dynamic = 'force-dynamic';

export default async function ScanPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  return <ScanClient token={token ?? null} />;
}
