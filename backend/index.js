const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.text({ type: ['text/*', 'application/json'] }));

// Serve the web client
app.use(express.static(path.join(__dirname, 'public')));

// Production page routes
const pageRoutes = [
  '/',
  '/app',
  '/browse',
  '/files',
  '/screen',
  '/camera',
  '/mic',
  '/av',
  '/terminal',
  '/claude',
  '/dashboard'
];

pageRoutes.forEach(route => {
  app.get(route, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'app.html'));
  });
});

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
  pingInterval: 10000,
  pingTimeout: 5000,
  maxHttpBufferSize: 10e6 // 10MB for file transfer chunks
});

// ─── State ──────────────────────────────────────────────────────────────────
const devices = new Map();      // socketId -> device info
const connections = new Map();  // connectionId -> { host, client, startedAt }

// ─── REST Endpoints ─────────────────────────────────────────────────────────
app.get('/api', (req, res) => {
  res.json({
    name: 'OneDesk Signaling Server',
    version: '1.0.0',
    status: 'running',
    devices: devices.size,
    activeConnections: connections.size,
    uptime: Math.round(process.uptime())
  });
});

app.get('/devices', (req, res) => {
  res.json(Array.from(devices.values()).map(d => ({
    deviceId: d.deviceId,
    deviceName: d.deviceName,
    type: d.type,
    online: true,
    connectedAt: d.connectedAt
  })));
});

app.get('/stats', (req, res) => {
  res.json({
    totalDevices: devices.size,
    activeConnections: connections.size,
    connections: Array.from(connections.values()).map(c => ({
      host: c.hostName,
      client: c.clientName,
      duration: Math.round((Date.now() - c.startedAt) / 1000) + 's'
    })),
    uptime: Math.round(process.uptime())
  });
});

// Disconnect endpoint for sendBeacon (reliable delivery during page unload)
app.post('/api/disconnect', (req, res) => {
  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch (e) {}
  }
  const { targetSocketId, senderSocketId } = body || {};
  if (targetSocketId) {
    console.log(`[API Disconnect] ${senderSocketId || 'unknown'} → ${targetSocketId}`);
    io.to(targetSocketId).emit('webrtc-disconnect', {
      senderSocketId: senderSocketId || 'unknown'
    });

    // Clean up connection tracking
    for (const [connId, conn] of connections) {
      if ((conn.clientSocketId === senderSocketId && conn.hostSocketId === targetSocketId) ||
          conn.hostSocketId === targetSocketId) {
        connections.delete(connId);
      }
    }
  }
  res.status(200).json({ ok: true });
});

// ─── Socket.IO ──────────────────────────────────────────────────────────────
io.on('connection', (socket) => {
  console.log(`[+] ${socket.id}`);

  // ─── Device Registration ──────────────────────────────────────────
  socket.on('register-device', (data) => {
    const { deviceId, deviceName, type } = data;
    const device = {
      deviceId,
      deviceName,
      type,
      socketId: socket.id,
      connectedAt: new Date().toISOString(),
      lastHeartbeat: Date.now()
    };
    devices.set(socket.id, device);
    
    // Join a room based on deviceId for targeted messaging
    socket.join(`device:${deviceId}`);
    
    console.log(`[Register] ${deviceName} (${type}) — ${deviceId}`);
    broadcastDeviceList();
  });

  // ─── Heartbeat ────────────────────────────────────────────────────
  socket.on('heartbeat', () => {
    const device = devices.get(socket.id);
    if (device) {
      device.lastHeartbeat = Date.now();
    }
  });

  // ─── WebRTC Signaling ─────────────────────────────────────────────
  socket.on('webrtc-offer', (data) => {
    const { targetSocketId, offer, feature } = data;
    const sender = devices.get(socket.id);
    console.log(`[Offer] ${sender?.deviceName || socket.id} → ${targetSocketId} (${feature})`);
    
    socket.to(targetSocketId).emit('webrtc-offer', {
      senderSocketId: socket.id,
      senderDeviceName: sender?.deviceName || 'Unknown',
      offer,
      feature
    });

    // Track the connection
    const connId = `${socket.id}:${targetSocketId}`;
    connections.set(connId, {
      hostSocketId: targetSocketId,
      clientSocketId: socket.id,
      hostName: devices.get(targetSocketId)?.deviceName || 'Unknown',
      clientName: sender?.deviceName || 'Unknown',
      startedAt: Date.now()
    });
  });

  socket.on('webrtc-answer', (data) => {
    const { targetSocketId, answer } = data;
    const sender = devices.get(socket.id);
    console.log(`[Answer] ${sender?.deviceName || socket.id} → ${targetSocketId}`);
    
    socket.to(targetSocketId).emit('webrtc-answer', {
      senderSocketId: socket.id,
      answer
    });
  });

  socket.on('webrtc-ice-candidate', (data) => {
    const { targetSocketId, candidate } = data;
    socket.to(targetSocketId).emit('webrtc-ice-candidate', {
      senderSocketId: socket.id,
      candidate
    });
  });

  socket.on('webrtc-disconnect', (data) => {
    const { targetSocketId } = data;
    console.log(`[Disconnect] ${socket.id} → ${targetSocketId}`);
    socket.to(targetSocketId).emit('webrtc-disconnect', {
      senderSocketId: socket.id
    });

    // Clean up connection tracking
    const connId = `${socket.id}:${targetSocketId}`;
    connections.delete(connId);
  });

  socket.on('stream-heartbeat', (data) => {
    const { targetSocketId, feature } = data || {};
    if (targetSocketId) {
      socket.to(targetSocketId).emit('stream-heartbeat', {
        senderSocketId: socket.id,
        feature
      });
    }
  });

  socket.on('device-command', (data) => {
    const { targetSocketId, command, payload } = data;
    socket.to(targetSocketId).emit('device-command', {
      senderSocketId: socket.id,
      command,
      payload
    });
  });

  // ─── File System Relay ────────────────────────────────────────────
  socket.on('file-system-request', (data) => {
    const { targetSocketId, action, path } = data;
    socket.to(targetSocketId).emit('file-system-request', {
      senderSocketId: socket.id,
      action,
      path
    });
  });

  socket.on('file-system-response', (data) => {
    const { targetSocketId, type, path, items, message } = data;
    socket.to(targetSocketId).emit('file-system-response', {
      senderSocketId: socket.id,
      type,
      path,
      items,
      message
    });
  });

  socket.on('file-download-chunk', (data) => {
    const { targetSocketId, status, index, data: chunkData, message } = data;
    socket.to(targetSocketId).emit('file-download-chunk', {
      senderSocketId: socket.id,
      status,
      index,
      data: chunkData,
      message
    });
  });

  // ─── Remote Browser Relay ─────────────────────────────────────────
  socket.on('remote-browser-request', (data) => {
    socket.to(data.targetSocketId).emit('remote-browser-request', {
      senderSocketId: socket.id,
      ...data
    });
  });

  socket.on('remote-browser-frame', (data) => {
    socket.to(data.targetSocketId).emit('remote-browser-frame', {
      senderSocketId: socket.id,
      ...data
    });
  });

  socket.on('remote-browser-url', (data) => {
    socket.to(data.targetSocketId).emit('remote-browser-url', {
      senderSocketId: socket.id,
      ...data
    });
  });

  socket.on('request-host-cookies', (data) => {
    socket.to(data.targetSocketId).emit('request-host-cookies', {
      senderSocketId: socket.id,
      ...data
    });
  });

  socket.on('host-cookies-response', (data) => {
    socket.to(data.targetSocketId).emit('host-cookies-response', {
      senderSocketId: socket.id,
      ...data
    });
  });

  // ─── Connection Request/Accept (optional pre-WebRTC handshake) ────
  socket.on('connection-request', (data) => {
    const { targetSocketId } = data;
    const requester = devices.get(socket.id);
    console.log(`[Request] ${requester?.deviceName} → ${targetSocketId}`);
    
    socket.to(targetSocketId).emit('connection-request', {
      requesterSocketId: socket.id,
      requesterName: requester?.deviceName || 'Unknown',
      requesterDeviceId: requester?.deviceId
    });
  });

  socket.on('connection-accepted', (data) => {
    const { targetSocketId, hostDeviceId } = data;
    console.log(`[Accepted] ${hostDeviceId} → ${targetSocketId}`);
    
    socket.to(targetSocketId).emit('connection-accepted', {
      hostSocketId: socket.id,
      hostDeviceId
    });
  });

  // ─── Disconnect ───────────────────────────────────────────────────
  socket.on('disconnect', (reason) => {
    const device = devices.get(socket.id);
    console.log(`[-] ${device?.deviceName || socket.id} (${reason})`);
    
    // Clean up any active connections involving this socket and immediately alert counterparts
    for (const [connId, conn] of connections) {
      if (conn.clientSocketId === socket.id) {
        console.log(`[Disconnect Relay] Client ${socket.id} closed — notifying host ${conn.hostSocketId} to immediately release camera/screen`);
        io.to(conn.hostSocketId).emit('webrtc-disconnect', {
          senderSocketId: socket.id
        });
        connections.delete(connId);
      } else if (conn.hostSocketId === socket.id) {
        console.log(`[Disconnect Relay] Host ${socket.id} disconnected — notifying client ${conn.clientSocketId}`);
        io.to(conn.clientSocketId).emit('webrtc-disconnect', {
          senderSocketId: socket.id
        });
        connections.delete(connId);
      }
    }
    
    // Remove device
    devices.delete(socket.id);
    broadcastDeviceList();
  });
});

// ─── Heartbeat Monitor ──────────────────────────────────────────────────────
// Check for stale devices every 30s
setInterval(() => {
  const now = Date.now();
  const staleThreshold = 30000; // 30s without heartbeat
  
  for (const [socketId, device] of devices) {
    if (now - device.lastHeartbeat > staleThreshold) {
      console.log(`[Stale] ${device.deviceName} — no heartbeat for ${Math.round((now - device.lastHeartbeat) / 1000)}s`);
      // Socket.IO's built-in ping/pong handles actual disconnection
      // This is just for monitoring
    }
  }
}, 30000);

// ─── Helpers ────────────────────────────────────────────────────────────────
function broadcastDeviceList() {
  io.emit('device-list-updated', Array.from(devices.values()));
}

// ─── Start ──────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log('');
  console.log('  ⬡ OneDesk Signaling Server v1.0.0');
  console.log(`  http://localhost:${PORT}`);
  console.log(`  http://localhost:${PORT}/stats`);
  console.log('');
  console.log('  Waiting for devices...');
  console.log('');
});
