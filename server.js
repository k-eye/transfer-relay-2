const http = require("http");
const WebSocket = require("ws");

const PORT = process.env.PORT || 3000;

const server = http.createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
  res.end("Transfer Relay läuft");
});

const wss = new WebSocket.Server({ server });

const rooms = new Map();

function getRoom(code) {
  if (!rooms.has(code)) rooms.set(code, new Set());
  return rooms.get(code);
}

function cleanupRoom(code) {
  const room = rooms.get(code);
  if (room && room.size === 0) rooms.delete(code);
}

wss.on("connection", (socket, req) => {
  const url = new URL(req.url, "http://localhost");
  const code = String(url.searchParams.get("code") || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 12);

  if (!code) {
    socket.close(1008, "Kein Code");
    return;
  }

  socket.roomCode = code;
  socket.deviceId = Math.random().toString(36).slice(2);
  socket.isAlive = true;

  const room = getRoom(code);
  room.add(socket);

  socket.send(JSON.stringify({
    type: "relay_ready",
    code,
    deviceId: socket.deviceId
  }));

  for (const peer of room) {
    if (peer !== socket && peer.readyState === WebSocket.OPEN) {
      peer.send(JSON.stringify({
        type: "peer_joined"
      }));
    }
  }

  socket.on("pong", () => {
    socket.isAlive = true;
  });

  socket.on("message", (data) => {
    if (typeof data !== "string" && !Buffer.isBuffer(data)) return;

    const room = rooms.get(socket.roomCode);
    if (!room) return;

    for (const peer of room) {
      if (peer !== socket && peer.readyState === WebSocket.OPEN) {
        peer.send(data);
      }
    }
  });

  socket.on("close", () => {
    const room = rooms.get(socket.roomCode);
    if (room) {
      room.delete(socket);

      for (const peer of room) {
        if (peer.readyState === WebSocket.OPEN) {
          peer.send(JSON.stringify({
            type: "peer_left"
          }));
        }
      }
    }

    cleanupRoom(socket.roomCode);
  });
});

setInterval(() => {
  for (const socket of wss.clients) {
    if (!socket.isAlive) {
      socket.terminate();
      continue;
    }

    socket.isAlive = false;
    socket.ping();
  }
}, 30000);

server.listen(PORT, () => {
  console.log("Transfer Relay läuft auf Port", PORT);
});
