const { app, Tray, Menu, BrowserWindow, ipcMain, desktopCapturer, nativeImage, screen, dialog, Notification } = require('electron');
const path = require('path');
const os = require('os');
const { SignalingClient } = require('./src/signaling');
const { InputSimulator } = require('./src/input-simulator');
const { ClipboardSync } = require('./src/clipboard-sync');
const { FileTransfer } = require('./src/file-transfer');
const { QualityController } = require('./src/quality-controller');

// ─── State ───────────────────────────────────────────────────────────────────
let tray = null;
let workspaceWindow = null;
let viewerWindow = null;
let hostWindow = null;
let signaling = null;
let inputSimulator = null;
let clipboardSync = null;
let fileTransfer = null;
let qualityController = null;

const DEVICE_ID = `${os.hostname()}-${process.platform}-${Date.now()}`;
const DEVICE_NAME = os.hostname();
let currentDevices = [];
let currentStatus = 'Connecting...';
let activeConnections = 0;

// ─── Platform Setup ─────────────────────────────────────────────────────────
if (process.platform === 'darwin') {
  app.dock.hide();
}

const gotSingleLock = app.requestSingleInstanceLock();
if (!gotSingleLock) {
  app.quit();
}

// ─── Tray ────────────────────────────────────────────────────────────────────
function buildTrayMenu(status, devices) {
  const otherDevices = devices.filter(d => d.deviceId !== DEVICE_ID);
  const deviceItems = otherDevices.map(device => ({
    label: `  ${device.deviceName}`,
    click: () => connectToDevice(device)
  }));

  const template = [
    { label: 'OneDesk', enabled: false },
    { type: 'separator' },
    { label: `Status: ${status}`, enabled: false },
    { label: `Device: ${DEVICE_NAME}`, enabled: false },
    ...(activeConnections > 0 ? [{ label: `Active Sessions: ${activeConnections}`, enabled: false }] : []),
    { type: 'separator' },
    ...(deviceItems.length > 0
      ? [
          { label: 'Available Computers:', enabled: false },
          ...deviceItems,
        ]
      : [{ label: 'No other computers online', enabled: false }]
    ),
    { type: 'separator' },
    {
      label: 'Open Workspaces...',
      accelerator: 'CommandOrControl+Shift+O',
      click: () => openWorkspaceWindow()
    },
    { type: 'separator' },
    {
      label: 'Quit OneDesk',
      accelerator: 'CommandOrControl+Q',
      click: () => {
        app.isQuiting = true;
        cleanup();
        app.quit();
      }
    }
  ];

  return Menu.buildFromTemplate(template);
}

function refreshTray() {
  if (!tray) return;
  tray.setContextMenu(buildTrayMenu(currentStatus, currentDevices));
  // Update tray title with connection indicator
  if (activeConnections > 0) {
    tray.setTitle(`⬡ ${activeConnections}`);
  } else {
    tray.setTitle('⬡');
  }
}

// ─── Workspace Window ───────────────────────────────────────────────────────
function openWorkspaceWindow() {
  if (workspaceWindow) {
    workspaceWindow.show();
    workspaceWindow.focus();
    return;
  }

  workspaceWindow = new BrowserWindow({
    width: 480,
    height: 520,
    resizable: false,
    titleBarStyle: 'hiddenInset',
    vibrancy: 'under-window',
    visualEffectState: 'active',
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, 'src', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  workspaceWindow.loadFile(path.join(__dirname, 'ui', 'workspaces.html'));

  workspaceWindow.on('close', (event) => {
    if (!app.isQuiting) {
      event.preventDefault();
      workspaceWindow.hide();
    }
  });

  workspaceWindow.on('closed', () => {
    workspaceWindow = null;
  });

  workspaceWindow.webContents.on('did-finish-load', () => {
    workspaceWindow.webContents.send('devices-updated', {
      devices: currentDevices, // Include self for testing
      selfId: DEVICE_ID
    });
  });
}

// ─── Viewer Window ──────────────────────────────────────────────────────────
function openViewerWindow(targetDevice) {
  if (viewerWindow) {
    viewerWindow.close();
  }

  const primaryDisplay = screen.getPrimaryDisplay();
  const { width, height } = primaryDisplay.workAreaSize;

  viewerWindow = new BrowserWindow({
    width: Math.min(1440, width),
    height: Math.min(900, height),
    title: `${targetDevice.deviceName} — OneDesk`,
    titleBarStyle: 'hidden',
    trafficLightPosition: { x: 12, y: 12 },
    backgroundColor: '#000000',
    webPreferences: {
      preload: path.join(__dirname, 'src', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  viewerWindow.loadFile(path.join(__dirname, 'ui', 'viewer.html'));

  viewerWindow.webContents.on('did-finish-load', () => {
    viewerWindow.webContents.send('start-viewing', {
      targetDevice,
      selfId: DEVICE_ID
    });
  });

  viewerWindow.on('closed', () => {
    viewerWindow = null;
    activeConnections = Math.max(0, activeConnections - 1);
    refreshTray();
  });

  activeConnections++;
  refreshTray();

  // Show the dock icon when viewer is open (macOS)
  if (process.platform === 'darwin') {
    app.dock.show();
  }
}

// ─── Host Window (Hidden) ───────────────────────────────────────────────────
function createHostWindow() {
  if (hostWindow) return;

  hostWindow = new BrowserWindow({
    show: false,
    width: 1,
    height: 1,
    webPreferences: {
      preload: path.join(__dirname, 'src', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  hostWindow.loadFile(path.join(__dirname, 'ui', 'host.html'));

  hostWindow.on('closed', () => {
    hostWindow = null;
  });

  console.log('[Main] Hidden host renderer created');
}

// ─── Connection Logic ───────────────────────────────────────────────────────
function connectToDevice(device) {
  console.log(`[Main] Connecting to ${device.deviceName}...`);
  
  // Show notification
  if (Notification.isSupported()) {
    new Notification({
      title: 'OneDesk',
      body: `Connecting to ${device.deviceName}...`,
      silent: true
    }).show();
  }

  openViewerWindow(device);
}

// ─── IPC Handlers ───────────────────────────────────────────────────────────
function setupIPC() {
  // Device connection
  ipcMain.on('connect-to-device', (_, device) => {
    connectToDevice(device);
  });

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

  // ─── Input Simulation ──────────────────────────────────────────────
  ipcMain.on('simulate-input', (_, inputEvent) => {
    if (inputSimulator) {
      inputSimulator.handleEvent(inputEvent);
    }
  });

  // ─── Clipboard ─────────────────────────────────────────────────────
  ipcMain.on('clipboard-write-remote', (_, clipboardData) => {
    if (clipboardSync) {
      clipboardSync.writeFromRemote(clipboardData);
    }
  });

  // ─── File Transfer ─────────────────────────────────────────────────
  ipcMain.on('file-receive-message', (_, message) => {
    if (fileTransfer) {
      fileTransfer.handleMessage(message);
    }
  });

  // ─── Quality Control ───────────────────────────────────────────────
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
  // Create tray
  const icon = nativeImage.createEmpty();
  tray = new Tray(icon);
  tray.setTitle('⬡');
  tray.setToolTip('OneDesk — Your Computer Everywhere');
  refreshTray();

  // Setup IPC
  setupIPC();

  // Initialize production modules
  inputSimulator = new InputSimulator();
  
  clipboardSync = new ClipboardSync();
  clipboardSync.start(500);
  clipboardSync.on('clipboard-changed', (data) => {
    // Forward clipboard changes to all connected windows
    if (viewerWindow && !viewerWindow.isDestroyed()) {
      viewerWindow.webContents.send('clipboard-changed', data);
    }
    if (hostWindow && !hostWindow.isDestroyed()) {
      hostWindow.webContents.send('clipboard-changed', data);
    }
  });

  fileTransfer = new FileTransfer();
  fileTransfer.on('transfer-started', (data) => {
    if (viewerWindow && !viewerWindow.isDestroyed()) {
      viewerWindow.webContents.send('file-transfer-started', data);
    }
  });
  fileTransfer.on('transfer-progress', (data) => {
    if (viewerWindow && !viewerWindow.isDestroyed()) {
      viewerWindow.webContents.send('file-transfer-progress', data);
    }
  });
  fileTransfer.on('file-received', (data) => {
    if (viewerWindow && !viewerWindow.isDestroyed()) {
      viewerWindow.webContents.send('file-received', data);
    }
    if (Notification.isSupported()) {
      new Notification({
        title: 'File Received',
        body: `${data.name} saved to ${data.path}`
      }).show();
    }
  });

  qualityController = new QualityController();
  qualityController.on('stats-updated', (data) => {
    if (viewerWindow && !viewerWindow.isDestroyed()) {
      viewerWindow.webContents.send('stats-updated', data);
    }
  });
  qualityController.on('quality-changed', (data) => {
    if (viewerWindow && !viewerWindow.isDestroyed()) {
      viewerWindow.webContents.send('quality-changed', data);
    }
  });

  // Initialize signaling
  const SIGNALING_URL = process.env.SIGNALING_URL || 'http://localhost:3000';
  console.log(`[Main] Connecting to signaling server at ${SIGNALING_URL}`);
  
  signaling = new SignalingClient(SIGNALING_URL, {
    deviceId: DEVICE_ID,
    deviceName: DEVICE_NAME,
    type: 'host'
  });

  signaling.on('connected', () => {
    currentStatus = '🟢 Online';
    refreshTray();
  });

  signaling.on('disconnected', () => {
    currentStatus = '⚪ Offline';
    currentDevices = [];
    refreshTray();
  });

  signaling.on('devices-updated', (devices) => {
    currentDevices = devices;
    refreshTray();
    if (workspaceWindow && !workspaceWindow.isDestroyed()) {
      workspaceWindow.webContents.send('devices-updated', {
        devices: devices, // Include self for testing
        selfId: DEVICE_ID
      });
    }
  });

  // WebRTC signaling relay
  signaling.on('webrtc-offer', (data) => {
    console.log(`[Main] Incoming offer from ${data.senderSocketId}`);
    if (hostWindow && !hostWindow.isDestroyed()) {
      hostWindow.webContents.send('webrtc-offer', data);
    }
  });

  signaling.on('webrtc-answer', (data) => {
    if (viewerWindow && !viewerWindow.isDestroyed()) {
      viewerWindow.webContents.send('webrtc-answer', data);
    }
  });

  signaling.on('webrtc-ice-candidate', (data) => {
    if (viewerWindow && !viewerWindow.isDestroyed()) {
      viewerWindow.webContents.send('webrtc-ice-candidate', data);
    }
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
  // Stay in tray
  if (process.platform === 'darwin') {
    app.dock.hide();
  }
});

app.on('before-quit', () => {
  app.isQuiting = true;
  cleanup();
});
