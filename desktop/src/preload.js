const { contextBridge, ipcRenderer } = require('electron');

/**
 * Preload — secure context bridge for all OneDesk features.
 * 
 * Every IPC channel is explicitly listed here. The renderer
 * processes can ONLY communicate through window.onedesk.
 */
contextBridge.exposeInMainWorld('onedesk', {
  // ──────────────────────────────────────────────────────────────────
  // Device Discovery
  // ──────────────────────────────────────────────────────────────────
  onDevicesUpdated: (callback) => {
    ipcRenderer.on('devices-updated', (_, data) => callback(data));
  },

  connectToDevice: (device) => {
    ipcRenderer.send('connect-to-device', device);
  },

  // ──────────────────────────────────────────────────────────────────
  // Signaling (WebRTC offer/answer/ICE relay)
  // ──────────────────────────────────────────────────────────────────
  sendSignal: (event, payload) => {
    ipcRenderer.send('signal-send', { event, payload });
  },

  onWebRTCOffer: (callback) => {
    ipcRenderer.on('webrtc-offer', (_, data) => callback(data));
  },

  onWebRTCAnswer: (callback) => {
    ipcRenderer.on('webrtc-answer', (_, data) => callback(data));
  },

  onWebRTCIceCandidate: (callback) => {
    ipcRenderer.on('webrtc-ice-candidate', (_, data) => callback(data));
  },

  // ──────────────────────────────────────────────────────────────────
  // Viewer
  // ──────────────────────────────────────────────────────────────────
  onStartViewing: (callback) => {
    ipcRenderer.on('start-viewing', (_, data) => callback(data));
  },

  // ──────────────────────────────────────────────────────────────────
  // Screen Sources (for host-side screen capture)
  // ──────────────────────────────────────────────────────────────────
  getScreenSources: () => {
    return ipcRenderer.invoke('get-screen-sources');
  },

  requestMediaAccess: (mediaType) => {
    return ipcRenderer.invoke('request-media-access', mediaType);
  },

  // ──────────────────────────────────────────────────────────────────
  // Host-specific channels
  // ──────────────────────────────────────────────────────────────────
  onHostIncomingOffer: (callback) => {
    ipcRenderer.on('host-incoming-offer', (_, data) => callback(data));
  },

  onHostIceCandidate: (callback) => {
    ipcRenderer.on('host-ice-candidate', (_, data) => callback(data));
  },

  // ──────────────────────────────────────────────────────────────────
  // Input Simulation (host renderer → main process → native OS)
  // ──────────────────────────────────────────────────────────────────
  simulateInput: (inputEvent) => {
    ipcRenderer.send('simulate-input', inputEvent);
  },

  // ──────────────────────────────────────────────────────────────────
  // Clipboard Sync
  // ──────────────────────────────────────────────────────────────────
  onClipboardChanged: (callback) => {
    ipcRenderer.on('clipboard-changed', (_, data) => callback(data));
  },

  writeClipboardFromRemote: (clipboardData) => {
    ipcRenderer.send('clipboard-write-remote', clipboardData);
  },

  // ──────────────────────────────────────────────────────────────────
  // File Transfer
  // ──────────────────────────────────────────────────────────────────
  onFileTransferStarted: (callback) => {
    ipcRenderer.on('file-transfer-started', (_, data) => callback(data));
  },

  onFileTransferProgress: (callback) => {
    ipcRenderer.on('file-transfer-progress', (_, data) => callback(data));
  },

  onFileReceived: (callback) => {
    ipcRenderer.on('file-received', (_, data) => callback(data));
  },

  sendFileChunk: (chunk) => {
    ipcRenderer.send('file-send-chunk', chunk);
  },

  receiveFileMessage: (message) => {
    ipcRenderer.send('file-receive-message', message);
  },

  // ──────────────────────────────────────────────────────────────────
  // Quality Control
  // ──────────────────────────────────────────────────────────────────
  onStatsUpdated: (callback) => {
    ipcRenderer.on('stats-updated', (_, data) => callback(data));
  },

  onQualityChanged: (callback) => {
    ipcRenderer.on('quality-changed', (_, data) => callback(data));
  },

  setQualityPreset: (preset) => {
    ipcRenderer.send('set-quality-preset', preset);
  },

  getQualityInfo: () => {
    return ipcRenderer.invoke('get-quality-info');
  },

  // ──────────────────────────────────────────────────────────────────
  // Screen Info
  // ──────────────────────────────────────────────────────────────────
  getScreenInfo: () => {
    return ipcRenderer.invoke('get-screen-info');
  },

  // ──────────────────────────────────────────────────────────────────
  // Connection State
  // ──────────────────────────────────────────────────────────────────
  onConnectionStateChanged: (callback) => {
    ipcRenderer.on('connection-state-changed', (_, data) => callback(data));
  }
});
