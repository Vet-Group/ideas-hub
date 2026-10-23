import { getMe } from '@/lib/api-v1/handlers';
import { deps } from '@/lib/api-v1/runtime';

export const dynamic = 'force-dynamic';

export const GET = (req: Request) => getMe(req, deps);
