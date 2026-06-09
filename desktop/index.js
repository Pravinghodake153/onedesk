const { app, Tray, Menu, BrowserWindow } = require('electron');
const path = require('path');
const { io } = require('socket.io-client');

let tray = null;
let mainWindow = null;
let socket = null;

// Don't show the app in the dock
if (process.platform === 'darwin') {
  app.dock.hide();
}

function createTray() {
  // Using a native image or empty icon for MVP. 
  // In a real app, you'd use a 16x16 icon for mac (Template image).
  tray = new Tray(path.join(__dirname, 'icon.png')); // We will need to create a dummy icon or use nativeImage

  const contextMenu = Menu.buildFromTemplate([
    { label: 'One Computer Everywhere', enabled: false },
    { type: 'separator' },
    { label: 'Status: Offline', id: 'status' },
    { type: 'separator' },
    { 
      label: 'Open Workspaces...', 
      click: () => {
        openClientWindow();
      } 
    },
    { type: 'separator' },
    { 
      label: 'Quit', 
      click: () => {
        app.isQuiting = true;
        app.quit();
      } 
    }
  ]);

  tray.setToolTip('One Computer Everywhere');
  tray.setContextMenu(contextMenu);
}

function updateTrayStatus(status) {
  if (tray) {
    const menu = tray.ContextMenu || Menu.getApplicationMenu() || tray.contextMenu; // contextMenu is cached
    // Workaround to update menu item
    const contextMenu = Menu.buildFromTemplate([
      { label: 'One Computer Everywhere', enabled: false },
      { type: 'separator' },
      { label: `Status: ${status}`, id: 'status' },
      { type: 'separator' },
      { 
        label: 'Open Workspaces...', 
        click: () => {
          openClientWindow();
        } 
      },
      { type: 'separator' },
      { 
        label: 'Quit', 
        click: () => {
          app.isQuiting = true;
          app.quit();
        } 
      }
    ]);
    tray.setContextMenu(contextMenu);
  }
}

function openClientWindow() {
  if (mainWindow) {
    mainWindow.show();
    return;
  }

  mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  mainWindow.loadFile('index.html');

  mainWindow.on('close', (event) => {
    if (!app.isQuiting) {
      event.preventDefault();
      mainWindow.hide();
    }
    return false;
  });
}

function connectToSignalingServer() {
  socket = io('http://localhost:3000'); // Assuming backend is on port 3000

  socket.on('connect', () => {
    console.log('Connected to signaling server');
    updateTrayStatus('Online');
    
    // Register as host by default for MVP
    socket.emit('register-device', {
      deviceId: 'local-mac-or-win',
      deviceName: require('os').hostname(),
      type: 'host'
    });
  });

  socket.on('disconnect', () => {
    console.log('Disconnected from signaling server');
    updateTrayStatus('Offline');
  });

  socket.on('device-list-updated', (devices) => {
    console.log('Available devices:', devices);
    if (mainWindow) {
      mainWindow.webContents.send('device-list-updated', devices);
    }
  });
}

app.whenReady().then(() => {
  // Create an empty icon for the tray to avoid crash if icon.png is missing
  const { nativeImage } = require('electron');
  let icon = nativeImage.createEmpty();
  
  tray = new Tray(icon);
  tray.setTitle('OCE'); // Show text on Mac menu bar
  
  const contextMenu = Menu.buildFromTemplate([
    { label: 'One Computer Everywhere', enabled: false },
    { type: 'separator' },
    { label: 'Status: Offline', id: 'status' },
    { type: 'separator' },
    { 
      label: 'Open Workspaces...', 
      click: () => {
        openClientWindow();
      } 
    },
    { type: 'separator' },
    { 
      label: 'Quit', 
      click: () => {
        app.isQuiting = true;
        app.quit();
      } 
    }
  ]);
  tray.setToolTip('One Computer Everywhere');
  tray.setContextMenu(contextMenu);

  connectToSignalingServer();
});

app.on('window-all-closed', () => {
  // Do nothing. Keep app running in tray.
});
