const { io } = require('socket.io-client');
const EventEmitter = require('events');

/**
 * SignalingClient — manages the persistent Socket.IO connection
 * to the OneDesk backend. Handles device registration, heartbeat,
 * and relaying WebRTC signaling events.
 */
class SignalingClient extends EventEmitter {
  constructor(serverUrl, deviceInfo) {
    super();
    this.serverUrl = serverUrl;
    this.deviceInfo = deviceInfo;
    this.socket = null;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 50;
  }

  connect() {
    this.socket = io(this.serverUrl, {
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 10000,
      reconnectionAttempts: this.maxReconnectAttempts,
      transports: ['websocket', 'polling']
    });

    this.socket.on('connect', () => {
      console.log(`[Signaling] Connected: ${this.socket.id}`);
      this.reconnectAttempts = 0;

      // Register this device
      this.socket.emit('register-device', this.deviceInfo);
      this.emit('connected');
    });

    this.socket.on('disconnect', (reason) => {
      console.log(`[Signaling] Disconnected: ${reason}`);
      this.emit('disconnected', reason);
    });

    this.socket.on('reconnect_attempt', (attempt) => {
      this.reconnectAttempts = attempt;
      console.log(`[Signaling] Reconnect attempt ${attempt}`);
    });

    // Device list updates
    this.socket.on('device-list-updated', (devices) => {
      this.emit('devices-updated', devices);
    });

    // WebRTC signaling events — relay to main process
    this.socket.on('webrtc-offer', (data) => {
      this.emit('webrtc-offer', data);
    });

    this.socket.on('webrtc-answer', (data) => {
      this.emit('webrtc-answer', data);
    });

    this.socket.on('webrtc-ice-candidate', (data) => {
      this.emit('webrtc-ice-candidate', data);
    });

    // Device commands (e.g. toggle auto-start)
    this.socket.on('device-command', (data) => {
      this.emit('device-command', data);
    });

    // File System Request
    this.socket.on('file-system-request', (data) => {
      this.emit('file-system-request', data);
    });

    // Remote Browser Request
    this.socket.on('remote-browser-request', (data) => {
      this.emit('remote-browser-request', data);
    });

    // Connection request (someone wants to view our screen)
    this.socket.on('connection-request', (data) => {
      this.emit('connection-request', data);
    });

    // Connection accepted (host accepted our request)
    this.socket.on('connection-accepted', (data) => {
      this.emit('connection-accepted', data);
    });
  }

  send(event, payload) {
    if (this.socket && this.socket.connected) {
      this.socket.emit(event, payload);
    } else {
      console.warn(`[Signaling] Cannot send "${event}" — not connected`);
    }
  }

  getSocketId() {
    return this.socket ? this.socket.id : null;
  }

  disconnect() {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
    }
  }

  sendFileSystemResponse(targetSocketId, payload) {
    if (this.socket && this.socket.connected) {
      this.socket.emit('file-system-response', {
        targetSocketId,
        ...payload
      });
    }
  }

  sendFileDownloadChunk(targetSocketId, payload) {
    if (this.socket && this.socket.connected) {
      this.socket.emit('file-download-chunk', {
        targetSocketId,
        ...payload
      });
    }
  }

  sendRemoteBrowserFrame(targetSocketId, payload) {
    if (this.socket && this.socket.connected) {
      this.socket.emit('remote-browser-frame', {
        targetSocketId,
        ...payload
      });
    }
  }

  sendRemoteBrowserUrl(targetSocketId, payload) {
    if (this.socket && this.socket.connected) {
      this.socket.emit('remote-browser-url', {
        targetSocketId,
        ...payload
      });
    }
  }
}

module.exports = { SignalingClient };
