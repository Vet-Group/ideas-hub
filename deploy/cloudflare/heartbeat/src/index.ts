import { type Env, tick } from './heartbeat';

export default {
  async scheduled(_controller: unknown, env: Env): Promise<void> {
    await tick(env, new Date());
  },
};
