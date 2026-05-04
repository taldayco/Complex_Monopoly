import { handler } from './build/handler.js';
import { createServer } from 'node:http';
import { WebSocketServer } from 'ws';
import { attachGameServer } from './src/lib/server/wsServer.js';

const PORT = Number(process.env.PORT || 3000);
const server = createServer(handler);
const wss = new WebSocketServer({ noServer: true });
attachGameServer(wss);

server.on('upgrade', (req, socket, head) => {
  if (req.url === '/ws') {
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req);
    });
  } else {
    socket.destroy();
  }
});

server.listen(PORT, () => {
  console.log(`monopoly server listening on http://localhost:${PORT}`);
});
