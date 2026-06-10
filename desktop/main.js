const { app, BrowserWindow, ipcMain, desktopCapturer, screen, Notification } = require('electron');
const path = require('path');
const os = require('os');
const { SignalingClient } = require('./src/signaling');
const { InputSimulator } = require('./src/input-simulator');
const { ClipboardSync } = require('./src/clipboard-sync');
const { FileTransfer } = require('./src/file-transfer');
const { QualityController } = require('./src/quality-controller');

// ─── State ───────────────────────────────────────────────────────────────────
let hostWindow = null;
let signaling = null;
let inputSimulator = null;
let clipboardSync = null;
let fileTransfer = null;
let qualityController = null;

const DEVICE_ID = `${os.hostname()}-${process.platform}-${Date.now()}`;
const DEVICE_NAME = os.hostname();

// ─── Platform Setup ─────────────────────────────────────────────────────────
if (process.platform === 'darwin') {
  app.dock.hide();
}

// Disable WebRTC mDNS obfuscation to fix '.local' resolution errors on local networks
app.commandLine.appendSwitch('disable-features', 'WebRtcHideLocalIpsWithMdns');

const gotSingleLock = app.requestSingleInstanceLock();
if (!gotSingleLock) {
  app.quit();
}

// ─── Host Window (Hidden) ───────────────────────────────────────────────────
function createHostWindow() {
  if (hostWindow) return;

  hostWindow = new BrowserWindow({
    show: false, // Completely hidden
    skipTaskbar: true, // Hide from Windows taskbar
    width: 1,
    height: 1,
    webPreferences: {
      preload: path.join(__dirname, 'src', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  hostWindow.loadFile(path.join(__dirname, 'ui', 'host.html'));

  hostWindow.webContents.on('console-message', (event, level, message, line, sourceId) => {
    console.log(`[Host Renderer] ${message}`);
  });

  hostWindow.on('closed', () => {
    hostWindow = null;
  });

  console.log('[Main] Hidden host renderer created');
}

// ─── IPC Handlers ───────────────────────────────────────────────────────────
function setupIPC() {
  // Screen sources
  ipcMain.handle('get-screen-sources', async () => {
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: 320, height: 180 }
    });
    return sources.map(s => ({
      id: s.id,
      name: s.name,
      thumbnail: s.thumbnail.toDataURL()
    }));
  });

  // Screen info
  ipcMain.handle('get-screen-info', () => {
    const primaryDisplay = screen.getPrimaryDisplay();
    return {
      width: primaryDisplay.size.width,
      height: primaryDisplay.size.height,
      scaleFactor: primaryDisplay.scaleFactor
    };
  });

  // Signaling relay
  ipcMain.on('signal-send', (_, data) => {
    if (signaling) {
      signaling.send(data.event, data.payload);
    }
  });

  // Input Simulation
  ipcMain.on('simulate-input', (_, inputEvent) => {
    if (inputSimulator) {
      inputSimulator.handleEvent(inputEvent);
    }
  });

  // Clipboard
  ipcMain.on('clipboard-write-remote', (_, clipboardData) => {
    if (clipboardSync) {
      clipboardSync.writeFromRemote(clipboardData);
    }
  });

  // File Transfer
  ipcMain.on('file-receive-message', (_, message) => {
    if (fileTransfer) {
      fileTransfer.handleMessage(message);
    }
  });

  // Quality Control
  ipcMain.on('set-quality-preset', (_, preset) => {
    if (qualityController) {
      qualityController.setPreset(preset);
    }
  });

  ipcMain.handle('get-quality-info', () => {
    return qualityController ? qualityController.getInfo() : null;
  });
}

// ─── Cleanup ────────────────────────────────────────────────────────────────
function cleanup() {
  if (signaling) signaling.disconnect();
  if (clipboardSync) clipboardSync.stop();
  if (qualityController) qualityController.stopMonitoring();
}

// ─── App Lifecycle ──────────────────────────────────────────────────────────
app.whenReady().then(() => {
  // Setup IPC
  setupIPC();

  // Initialize production modules
  inputSimulator = new InputSimulator();
  
  clipboardSync = new ClipboardSync();
  clipboardSync.start(500);
  clipboardSync.on('clipboard-changed', (data) => {
    if (hostWindow && !hostWindow.isDestroyed()) {
      hostWindow.webContents.send('clipboard-changed', data);
    }
  });

  fileTransfer = new FileTransfer();
  fileTransfer.on('file-received', (data) => {
    if (Notification.isSupported()) {
      new Notification({
        title: 'File Received',
        body: `${data.name} saved to ${data.path}`
      }).show();
    }
  });

  qualityController = new QualityController();

  // Initialize signaling
  const SIGNALING_URL = process.env.SIGNALING_URL || 'https://onedesk-upet.onrender.com';
  console.log(`[Main] Connecting to signaling server at ${SIGNALING_URL}`);
  
  signaling = new SignalingClient(SIGNALING_URL, {
    deviceId: DEVICE_ID,
    deviceName: DEVICE_NAME,
    type: 'host'
  });

  signaling.on('connected', () => {
    console.log('[Main] Connected to signaling server');
  });

  signaling.on('disconnected', () => {
    console.log('[Main] Disconnected from signaling server');
  });

  // WebRTC signaling relay
  signaling.on('webrtc-offer', (data) => {
    console.log(`[Main] Incoming offer from ${data.senderSocketId}`);
    if (hostWindow && !hostWindow.isDestroyed()) {
      hostWindow.webContents.send('webrtc-offer', data);
    }
  });

  signaling.on('webrtc-ice-candidate', (data) => {
    if (hostWindow && !hostWindow.isDestroyed()) {
      hostWindow.webContents.send('webrtc-ice-candidate', data);
    }
  });

  signaling.connect();

  // Create hidden host renderer
  createHostWindow();

  console.log(`[Main] OneDesk started — Device: ${DEVICE_NAME} (${DEVICE_ID})`);
});

app.on('window-all-closed', () => {
  // Stay running in the background unconditionally
  if (process.platform === 'darwin') {
    app.dock.hide();
  }
});

app.on('before-quit', () => {
  app.isQuiting = true;
  cleanup();
});
