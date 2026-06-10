const WebSocket = require('ws');
const EventEmitter = require('events');

class ExtensionServer extends EventEmitter {
  constructor() {
    super();
    this.wss = null;
    this.activeClient = null;
  }

  start(port = 9090) {
    this.wss = new WebSocket.Server({ port });

    this.wss.on('connection', (ws) => {
      console.log('[ExtensionServer] Extension connected.');
      this.activeClient = ws;
      
      this.emit('connection');

      ws.on('message', (message) => {
        try {
          const data = JSON.parse(message);
          if (data.type === 'SYNC_COOKIES') {
            console.log(`[ExtensionServer] Received ${data.cookies.length} cookies from extension.`);
            this.emit('cookies-received', data.cookies);
          }
        } catch (e) {
          console.error('[ExtensionServer] Message parse error:', e);
        }
      });

      ws.on('close', () => {
        console.log('[ExtensionServer] Extension disconnected.');
        if (this.activeClient === ws) {
          this.activeClient = null;
        }
      });
    });

    console.log(`[ExtensionServer] Listening on ws://localhost:${port}`);
  }

  requestCookies() {
    if (this.activeClient && this.activeClient.readyState === WebSocket.OPEN) {
      console.log('[ExtensionServer] Requesting cookies from extension...');
      this.activeClient.send(JSON.stringify({ type: 'REQUEST_COOKIES' }));
      return true;
    } else {
      console.log('[ExtensionServer] No active extension connected.');
      return false;
    }
  }
}

module.exports = new ExtensionServer();
