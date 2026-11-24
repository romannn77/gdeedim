import Guide from '../components/Guide';
import { catalog } from '../lib/catalog.mjs';
export const dynamic = 'force-dynamic';
export default async function Home() {
  return <Guide initial={await catalog()} />;
}
