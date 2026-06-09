const { desktopCapturer } = require('electron');

/**
 * HostManager — handles the "host" side of a remote connection.
 * 
 * When a client connects, the host:
 * 1. Captures the screen using Electron's desktopCapturer
 * 2. Creates a WebRTC peer connection
 * 3. Adds the screen MediaStream to the connection
 * 4. Opens a DataChannel for receiving mouse/keyboard input
 * 5. Simulates the input events on the host OS
 * 
 * Design principle: This runs entirely in the main process (Node.js side).
 * For the MVP, we use Electron's built-in WebRTC via a hidden renderer.
 * In production, we'd use a native WebRTC library or wrtc npm package.
 */
class HostManager {
  constructor(signaling) {
    this.signaling = signaling;
    this.activePeers = new Map(); // socketId -> { pc, dataChannel }
    this.screenStream = null;
  }

  /**
   * Handle an incoming WebRTC offer from a client who wants to view our screen.
   * This is called from the main process when the signaling server relays an offer.
   */
  async handleOffer(data, signaling) {
    const { senderSocketId, offer } = data;
    console.log(`[Host] Handling offer from ${senderSocketId}`);

    // We need to handle WebRTC in a renderer process because Electron's
    // main process doesn't have WebRTC APIs. We'll relay through IPC.
    // For now, store the offer and let the host renderer handle it.
    this.signaling.emit('host-incoming-offer', {
      senderSocketId,
      offer
    });
  }

  handleIceCandidate(data) {
    const { senderSocketId, candidate } = data;
    this.signaling.emit('host-ice-candidate', {
      senderSocketId,
      candidate
    });
  }

  cleanup() {
    for (const [socketId, peer] of this.activePeers) {
      if (peer.pc) peer.pc.close();
    }
    this.activePeers.clear();
    if (this.screenStream) {
      this.screenStream.getTracks().forEach(t => t.stop());
      this.screenStream = null;
    }
  }
}

module.exports = { HostManager };
