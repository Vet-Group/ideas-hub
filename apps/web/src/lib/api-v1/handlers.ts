// One function per /api/v1 route: its scope and its endpoint. The route files and the tests both call these,
// so the scope table is checked where it is used.
import { briefing, briefings, idea, ideaImage, ideas, latestBriefing, me, storeFunnel, stores, unknownPath } from './endpoints';
import { type V1Deps, handleV1 } from './pipeline';

type H = (req: Request, deps: V1Deps) => Promise<Response>;
type HId = (req: Request, deps: V1Deps, id: string) => Promise<Response>;

export const getMe: H = (req, deps) => handleV1(req, deps, null, me);
export const getStores: H = (req, deps) => handleV1(req, deps, null, stores);
export const getBriefings: H = (req, deps) => handleV1(req, deps, 'briefings:read', briefings);
export const getLatestBriefing: H = (req, deps) => handleV1(req, deps, 'briefings:read', latestBriefing);
export const getBriefing: HId = (req, deps, id) => handleV1(req, deps, 'briefings:read', (ctx) => briefing(ctx, id));
export const getIdeas: H = (req, deps) => handleV1(req, deps, 'ideas:read', ideas);
export const getIdea: HId = (req, deps, id) => handleV1(req, deps, 'ideas:read', (ctx) => idea(ctx, id));
export const getIdeaImage: HId = (req, deps, id) => handleV1(req, deps, 'ideas:read', (ctx) => ideaImage(ctx, id));
export const getStoreFunnel: HId = (req, deps, id) => handleV1(req, deps, 'ideas:read', (ctx) => storeFunnel(ctx, id));
/** Any other path under /api/v1 answers in the contract's error shape, after the token check. */
export const getUnknown: H = (req, deps) => handleV1(req, deps, null, async () => unknownPath());
