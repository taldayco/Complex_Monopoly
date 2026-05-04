import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';
import { WebSocketServer } from 'ws';
import { attachGameServer } from './src/lib/server/wsServer.js';

const wsDevPlugin = {
  name: 'ws-dev-plugin',
  configureServer(server) {
    if (!server.httpServer) return;
    const wss = new WebSocketServer({ noServer: true });
    attachGameServer(wss);
    server.httpServer.on('upgrade', (req, socket, head) => {
      if (req.url === '/ws') {
        wss.handleUpgrade(req, socket, head, (ws) => {
          wss.emit('connection', ws, req);
        });
      }
    });
  }
};

export default defineConfig({
  plugins: [sveltekit(), wsDevPlugin]
});
