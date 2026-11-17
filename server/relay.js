import http from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';

const PORT = Number(process.env.PORT || 8080);

// rooms: Map<code, { host: WebSocket, guests: Map<guestId, WebSocket>, nextGuestNum: number }>
const rooms = new Map();

const server = http.createServer((req, res) => {
  res.writeHead(200, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
  });
  res.end(JSON.stringify({ ok: true, rooms: rooms.size }));
});

const wss = new WebSocketServer({ server });

function sendJson(ws, obj) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(obj));
  }
}

wss.on('connection', (ws, req) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  const role = url.searchParams.get('role');
  const code = String(url.searchParams.get('code') || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

  ws.isAlive = true;
  ws.on('pong', () => {
    ws.isAlive = true;
  });

  if (!code || code.length !== 8 || (role !== 'host' && role !== 'guest')) {
    sendJson(ws, { type: 'relay-error', reason: 'INVALID ROOM PARAMS' });
    ws.close(1008, 'Invalid params');
    return;
  }

  if (role === 'host') {
    if (rooms.has(code)) {
      sendJson(ws, { type: 'relay-error', reason: 'ROOM CODE IN USE' });
      ws.close(1008, 'Code in use');
      return;
    }

    const room = { host: ws, guests: new Map(), nextGuestNum: 1 };
    rooms.set(code, room);
    sendJson(ws, { type: 'room-created', code });

    ws.on('message', (data, isBinary) => {
      if (isBinary) {
        for (const g of room.guests.values()) {
          if (g.readyState === WebSocket.OPEN) {
            g.send(data, { binary: true });
          }
        }
        return;
      }

      let msg;
      try {
        msg = JSON.parse(data.toString());
      } catch {
        return;
      }

      if (msg.targetGuestId) {
        const target = room.guests.get(msg.targetGuestId);
        if (target) sendJson(target, msg);
      } else {
        for (const g of room.guests.values()) {
          sendJson(g, msg);
        }
      }
    });

    const cleanupHost = () => {
      if (rooms.get(code) !== room) return;
      rooms.delete(code);
      for (const g of room.guests.values()) {
        sendJson(g, { type: 'host-left' });
        try { g.close(1000, 'Host closed room'); } catch {}
      }
      room.guests.clear();
    };

    ws.on('close', cleanupHost);
    ws.on('error', cleanupHost);
    return;
  }

  // Guest flow
  const room = rooms.get(code);
  if (!room || !room.host || room.host.readyState !== WebSocket.OPEN) {
    sendJson(ws, { type: 'relay-error', reason: 'SESSION NOT FOUND' });
    ws.close(1008, 'Room not found');
    return;
  }

  const guestId = `g${room.nextGuestNum++}`;
  room.guests.set(guestId, ws);
  sendJson(ws, { type: 'room-joined', code, guestId });
  sendJson(room.host, { type: 'guest-joined', guestId });

  ws.on('message', (data, isBinary) => {
    if (room.host.readyState !== WebSocket.OPEN) return;
    if (isBinary) {
      room.host.send(data, { binary: true });
      return;
    }

    let msg;
    try {
      msg = JSON.parse(data.toString());
    } catch {
      return;
    }
    msg.fromGuestId = guestId;
    sendJson(room.host, msg);
  });

  const cleanupGuest = () => {
    if (!room.guests.has(guestId)) return;
    room.guests.delete(guestId);
    sendJson(room.host, { type: 'guest-left', guestId });
  };

  ws.on('close', cleanupGuest);
  ws.on('error', cleanupGuest);
});

const heartbeat = setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) {
      ws.terminate();
      continue;
    }
    ws.isAlive = false;
    ws.ping();
  }
}, 25000);

wss.on('close', () => clearInterval(heartbeat));

server.listen(PORT, () => {
  console.log(`Average Car Game WS Relay listening on :${PORT}`);
});
