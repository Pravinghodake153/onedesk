const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

// Serve the web client
app.use(express.static(path.join(__dirname, 'public')));

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
    const { targetSocketId, offer } = data;
    const sender = devices.get(socket.id);
    console.log(`[Offer] ${sender?.deviceName || socket.id} → ${targetSocketId}`);
    
    socket.to(targetSocketId).emit('webrtc-offer', {
      senderSocketId: socket.id,
      senderDeviceName: sender?.deviceName || 'Unknown',
      offer
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
    
    // Remove device
    devices.delete(socket.id);
    
    // Clean up any active connections involving this socket
    for (const [connId, conn] of connections) {
      if (conn.hostSocketId === socket.id || conn.clientSocketId === socket.id) {
        connections.delete(connId);
      }
    }
    
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
