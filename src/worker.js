// Custom Worker entry. Routes /ws WebSocket upgrades to the GameDO Durable
// Object; everything else falls through to the SvelteKit-generated worker
// emitted by adapter-cloudflare (see wrangler.adapter.jsonc).

import skHandler from '../.svelte-kit/cf-worker/index.js';

export { GameDO } from './lib/server/gameDO.js';

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    if (url.pathname === '/ws') {
      if (req.headers.get('upgrade')?.toLowerCase() !== 'websocket') {
        return new Response('Expected WebSocket', { status: 426 });
      }
      const id = env.GAME_DO.idFromName('default');
      const stub = env.GAME_DO.get(id);
      return stub.fetch(req);
    }
    return skHandler.fetch(req, env, ctx);
  }
};
