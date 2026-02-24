import http from "http";
import { WebSocketServer } from "ws";

const server = http.createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end("ok\n");
});

const wss = new WebSocketServer({ server });

/** Map<roomId, Set<WebSocket>> */
const rooms = new Map();

function safeSend(ws, obj) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(obj));
}

function peersOf(roomId) {
  return rooms.get(roomId) || new Set();
}

function sendToOthers(roomId, fromWs, msgObj) {
  for (const peer of peersOf(roomId)) {
    if (peer !== fromWs) safeSend(peer, msgObj);
  }
}

function sendToAll(roomId, msgObj) {
  for (const peer of peersOf(roomId)) safeSend(peer, msgObj);
}

wss.on("connection", (ws) => {
  ws.roomId = null;

  ws.on("message", (data) => {
    let msg;
    try { msg = JSON.parse(data.toString()); } catch { return; }

    if (msg.type === "join") {
      const roomId = String(msg.room || "").trim();
      if (!roomId) return;

      // leave old room
      if (ws.roomId) {
        const old = rooms.get(ws.roomId);
        if (old) {
          old.delete(ws);
          if (old.size === 0) rooms.delete(ws.roomId);
          else sendToAll(ws.roomId, { type: "peer_left" });
        }
      }

      ws.roomId = roomId;
      if (!rooms.has(roomId)) rooms.set(roomId, new Set());
      const room = rooms.get(roomId);

      // 2 max
      if (room.size >= 2) {
        safeSend(ws, { type: "room_full" });
        ws.close();
        return;
      }

      room.add(ws);

      const role = room.size === 1 ? "caller" : "callee";
      safeSend(ws, { type: "joined", room: roomId, role });

      // IMPORTANT: tell *everyone* in the room that a peer is present.
      // This ensures both sides get a deterministic "peer_joined" signal.
      if (room.size === 2) {
        sendToAll(roomId, { type: "peer_joined" });
      }

      return;
    }

    // Relay signaling messages to the other peer
    if (ws.roomId && (msg.type === "offer" || msg.type === "answer" || msg.type === "ice")) {
      sendToOthers(ws.roomId, ws, msg);
      return;
    }
  });

  ws.on("close", () => {
    if (!ws.roomId) return;
    const roomId = ws.roomId;
    const room = rooms.get(roomId);
    if (!room) return;

    room.delete(ws);
    if (room.size === 0) rooms.delete(roomId);
    else sendToAll(roomId, { type: "peer_left" });
  });
});

const PORT = process.env.PORT || 8080;
server.listen(PORT, () => console.log(`Signaling server on :${PORT}`));