const { clipboard } = require('electron');
const EventEmitter = require('events');

/**
 * ClipboardSync — bidirectional clipboard synchronization.
 * 
 * Polls the local clipboard for changes and emits 'clipboard-changed'
 * when the content changes. Also provides a method to write remote
 * clipboard data to the local clipboard.
 * 
 * Design: Uses Electron's built-in `clipboard` module (no native deps).
 * The sync happens over a dedicated WebRTC DataChannel named 'clipboard'.
 */
class ClipboardSync extends EventEmitter {
  constructor() {
    super();
    this.lastText = '';
    this.lastImage = null;
    this.pollInterval = null;
    this.isRemoteUpdate = false; // Prevent echo loops
    this.enabled = true;
  }

  /**
   * Start polling the local clipboard for changes.
   * @param {number} intervalMs - Poll interval in milliseconds (default 500ms)
   */
  start(intervalMs = 500) {
    // Initialize with current clipboard content
    this.lastText = clipboard.readText() || '';

    this.pollInterval = setInterval(() => {
      if (!this.enabled) return;
      this._checkClipboard();
    }, intervalMs);

    console.log(`[Clipboard] Sync started (polling every ${intervalMs}ms)`);
  }

  /**
   * Stop polling.
   */
  stop() {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
    console.log('[Clipboard] Sync stopped');
  }

  /**
   * Check if the clipboard content has changed locally.
   */
  _checkClipboard() {
    if (this.isRemoteUpdate) {
      this.isRemoteUpdate = false;
      return;
    }

    try {
      const currentText = clipboard.readText() || '';
      
      if (currentText !== this.lastText && currentText.length > 0) {
        this.lastText = currentText;
        this.emit('clipboard-changed', {
          type: 'text',
          data: currentText,
          timestamp: Date.now()
        });
      }
    } catch (err) {
      // Clipboard read can occasionally fail; just skip this cycle
    }
  }

  /**
   * Write remote clipboard data to the local clipboard.
   * Called when we receive clipboard data from the remote peer.
   * @param {Object} clipboardData - { type: 'text', data: string }
   */
  writeFromRemote(clipboardData) {
    if (!clipboardData || !clipboardData.data) return;

    try {
      this.isRemoteUpdate = true; // Prevent echo on next poll

      if (clipboardData.type === 'text') {
        clipboard.writeText(clipboardData.data);
        this.lastText = clipboardData.data;
        console.log(`[Clipboard] Remote text written (${clipboardData.data.length} chars)`);
      }
    } catch (err) {
      console.error('[Clipboard] Failed to write remote data:', err.message);
    }
  }

  /**
   * Get current clipboard content.
   */
  getCurrentContent() {
    return {
      type: 'text',
      data: clipboard.readText() || '',
      timestamp: Date.now()
    };
  }
}

module.exports = { ClipboardSync };
