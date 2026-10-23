import { getBriefing } from '@/lib/api-v1/handlers';
import { deps } from '@/lib/api-v1/runtime';

export const dynamic = 'force-dynamic';

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return getBriefing(req, deps, (await params).id);
}
