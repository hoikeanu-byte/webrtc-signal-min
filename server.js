import http from "http";
import { WebSocketServer } from "ws";

const server = http.createServer((req, res) => {
  // simple health response (nice for platforms + debugging)
  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end("ok");
});

const wss = new WebSocketServer({ server });

// roomId -> Set(ws)
const rooms = new Map();

function send(ws, obj) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(obj));
}

function relay(roomId, from, msg) {
  const peers = rooms.get(roomId);
  if (!peers) return;
  for (const p of peers) if (p !== from) send(p, msg);
}

wss.on("connection", (ws) => {
  ws.roomId = null;

  ws.on("message", (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }

    if (msg.type === "join") {
      const room = String(msg.room || "").trim();
      if (!room) return;

      ws.roomId = room;
      if (!rooms.has(room)) rooms.set(room, new Set());
      const peers = rooms.get(room);

      if (peers.size >= 2) {
        send(ws, { type: "room_full" });
        ws.close();
        return;
      }

      peers.add(ws);
      const role = peers.size === 1 ? "caller" : "callee";
      send(ws, { type: "joined", role, room });
      relay(room, ws, { type: "peer_joined" });
      return;
    }

    if (ws.roomId && (msg.type === "offer" || msg.type === "answer" || msg.type === "ice")) {
      relay(ws.roomId, ws, msg);
    }
  });

  ws.on("close", () => {
    const room = ws.roomId;
    if (!room) return;
    const peers = rooms.get(room);
    if (!peers) return;
    peers.delete(ws);
    if (peers.size === 0) rooms.delete(room);
    else for (const p of peers) send(p, { type: "peer_left" });
  });
});

// IMPORTANT: platforms provide PORT env var
const PORT = process.env.PORT || 8080;
server.listen(PORT, "0.0.0.0", () => console.log("Signaling server on", PORT));