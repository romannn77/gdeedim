import { notFound, redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { session, cookieName } from '../../lib/actions.mjs';
import Workspace from '../../components/Workspace';
export const dynamic = 'force-dynamic';
export default async function Protected({ params }: { params: Promise<{ workspace: string }> }) {
  const { workspace } = await params;
  if (workspace !== 'partner' && workspace !== 'admin') notFound();
  const user = await session((await cookies()).get(cookieName)?.value);
  if (user?.role !== workspace) redirect('/?access=' + workspace);
  return <Workspace kind={workspace} />;
}
