import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";

interface User {
  id: string;
  name: string;
  color: string;
  isOnline: boolean;
  lastActive: number;
}

interface Connection {
  id: string; // Sorted IDs "userId1_userId2"
  user1Id: string;
  user2Id: string;
  user1Name: string;
  user2Name: string;
  user1Color: string;
  user2Color: string;
  pokesCount: number;
  lastPokeTime: number;
  lastPokeFrom: string;
}

// In-memory data store
const users: Map<string, User> = new Map();
const connections: Map<string, Connection> = new Map();
const sseClients: Map<string, express.Response[]> = new Map();

function getSortedConnectionId(u1: string, u2: string): string {
  return [u1, u2].sort().join("_");
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // API: Register/update a user's presence & profile details
  app.post("/api/users/register", (req, res) => {
    const { id, name, color } = req.body;
    if (!id || !name || !color) {
      res.status(400).json({ error: "Missing required fields (id, name, color)" });
      return;
    }

    const existingUser = users.get(id);
    const updatedUser: User = {
      id,
      name,
      color,
      isOnline: existingUser ? existingUser.isOnline : true,
      lastActive: Date.now(),
    };

    users.set(id, updatedUser);
    res.json({ success: true, user: updatedUser });
  });

  // API: Poke another user
  app.post("/api/poke", (req, res) => {
    const { fromUserId, toUserId } = req.body;
    if (!fromUserId || !toUserId) {
      res.status(400).json({ error: "Missing fromUserId or toUserId" });
      return;
    }

    const sender = users.get(fromUserId);
    const receiver = users.get(toUserId);

    if (!sender) {
      res.status(404).json({ error: "Sender not found" });
      return;
    }

    const connId = getSortedConnectionId(fromUserId, toUserId);
    let conn = connections.get(connId);

    // If connection doesn't exist yet, we create it dynamically on first poke
    if (!conn) {
      conn = {
        id: connId,
        user1Id: fromUserId,
        user2Id: toUserId,
        user1Name: sender.name,
        user2Name: receiver ? receiver.name : "Anonymous Wave",
        user1Color: sender.color,
        user2Color: receiver ? receiver.color : "#3b82f6",
        pokesCount: 1,
        lastPokeTime: Date.now(),
        lastPokeFrom: fromUserId,
      };
    } else {
      conn.pokesCount += 1;
      conn.lastPokeTime = Date.now();
      conn.lastPokeFrom = fromUserId;

      // Update names or colors if they changed
      if (conn.user1Id === fromUserId) {
        conn.user1Name = sender.name;
        conn.user1Color = sender.color;
        if (receiver) {
          conn.user2Name = receiver.name;
          conn.user2Color = receiver.color;
        }
      } else {
        conn.user2Name = sender.name;
        conn.user2Color = sender.color;
        if (receiver) {
          conn.user1Name = receiver.name;
          conn.user1Color = receiver.color;
        }
      }
    }

    connections.set(connId, conn);

    // Push SSE real-time notifications to both users
    const payload = JSON.stringify({
      type: "poke",
      connection: conn,
      fromUserId,
      toUserId,
      pokesCount: conn.pokesCount,
    });

    [fromUserId, toUserId].forEach((userId) => {
      const clients = sseClients.get(userId) || [];
      clients.forEach((client) => {
        client.write(`data: ${payload}\n\n`);
      });
    });

    res.json({ success: true, connection: conn });
  });

  // API: Force add a connection (e.g. via join link / invite)
  app.post("/api/connections/join", (req, res) => {
    const { myUserId, otherUserId, otherUserName, otherUserColor } = req.body;
    if (!myUserId || !otherUserId) {
      res.status(400).json({ error: "Missing myUserId or otherUserId" });
      return;
    }

    // Ensure users exist or register them
    const me = users.get(myUserId);
    if (!me) {
      res.status(404).json({ error: "My user profile not found. Please register first." });
      return;
    }

    // Register or retrieve other user
    let other = users.get(otherUserId);
    if (!other && otherUserName && otherUserColor) {
      other = {
        id: otherUserId,
        name: otherUserName,
        color: otherUserColor,
        isOnline: false,
        lastActive: Date.now() - 3600 * 1000, // assume inactive unless they connect
      };
      users.set(otherUserId, other);
    }

    const connId = getSortedConnectionId(myUserId, otherUserId);
    let conn = connections.get(connId);

    if (!conn) {
      conn = {
        id: connId,
        user1Id: myUserId,
        user2Id: otherUserId,
        user1Name: me.name,
        user2Name: other ? other.name : (otherUserName || "Explorer"),
        user1Color: me.color,
        user2Color: other ? other.color : (otherUserColor || "#ec4899"),
        pokesCount: 0,
        lastPokeTime: Date.now(),
        lastPokeFrom: "",
      };
      connections.set(connId, conn);
    }

    // Notify both users about connection creation/update
    const payload = JSON.stringify({
      type: "connection_created",
      connection: conn,
    });

    [myUserId, otherUserId].forEach((userId) => {
      const clients = sseClients.get(userId) || [];
      clients.forEach((client) => {
        client.write(`data: ${payload}\n\n`);
      });
    });

    res.json({ success: true, connection: conn });
  });

  // SSE Stream for Real-time events
  app.get("/api/stream", (req, res) => {
    const userId = req.query.userId as string;
    const name = req.query.name as string;
    const color = req.query.color as string;

    if (!userId) {
      res.status(400).send("userId parameter is required");
      return;
    }

    // Setup SSE headers
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no", // Disable buffering in nginx for immediate deliveries
    });

    // Write initial comment to keep connection alive
    res.write(":ok\n\n");

    // Register user profile details and mark them as online
    const u: User = {
      id: userId,
      name: name || "Anonymous Waver",
      color: color || "#22c55e",
      isOnline: true,
      lastActive: Date.now(),
    };
    users.set(userId, u);

    // Save client reference
    const clients = sseClients.get(userId) || [];
    clients.push(res);
    sseClients.set(userId, clients);

    // Helper to send all active connections & users to this client on initial load
    const userConns = Array.from(connections.values()).filter(
      (c) => c.user1Id === userId || c.user2Id === userId
    );

    // Enriched list of connections including real-time online status of the other user
    const enrichedConns = userConns.map((c) => {
      const partnerId = c.user1Id === userId ? c.user2Id : c.user1Id;
      const partner = users.get(partnerId);
      return {
        ...c,
        partnerOnline: partner ? partner.isOnline : false,
        partnerLastActive: partner ? partner.lastActive : 0,
      };
    });

    // Send initial sync event
    res.write(
      `data: ${JSON.stringify({
        type: "init",
        connections: enrichedConns,
        user: u,
      })}\n\n`
    );

    // Broadcast user is online to everyone
    const broadcastPresence = () => {
      const presencePayload = JSON.stringify({
        type: "presence",
        userId,
        isOnline: true,
        lastActive: Date.now(),
      });

      // Find all connected partners
      userConns.forEach((c) => {
        const partnerId = c.user1Id === userId ? c.user2Id : c.user1Id;
        const partnerClients = sseClients.get(partnerId) || [];
        partnerClients.forEach((client) => {
          client.write(`data: ${presencePayload}\n\n`);
        });
      });
    };

    broadcastPresence();

    // Heartbeat to prevent socket close
    const heartbeatTimer = setInterval(() => {
      res.write(":keepalive\n\n");
    }, 15000);

    // Handle client disconnect
    req.on("close", () => {
      clearInterval(heartbeatTimer);
      const currentClients = sseClients.get(userId) || [];
      const updatedClients = currentClients.filter((c) => c !== res);

      if (updatedClients.length === 0) {
        sseClients.delete(userId);
        // Mark user as offline
        const userObj = users.get(userId);
        if (userObj) {
          userObj.isOnline = false;
          userObj.lastActive = Date.now();
          users.set(userId, userObj);
        }

        // Broadcast user is offline to everyone
        const presencePayload = JSON.stringify({
          type: "presence",
          userId,
          isOnline: false,
          lastActive: Date.now(),
        });

        userConns.forEach((c) => {
          const partnerId = c.user1Id === userId ? c.user2Id : c.user1Id;
          const partnerClients = sseClients.get(partnerId) || [];
          partnerClients.forEach((client) => {
            client.write(`data: ${presencePayload}\n\n`);
          });
        });
      } else {
        sseClients.set(userId, updatedClients);
      }
    });
  });

  // Vite integration
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on port ${PORT}`);
  });
}

startServer();
