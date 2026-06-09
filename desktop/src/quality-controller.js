const EventEmitter = require('events');

/**
 * QualityController — adaptive video quality based on WebRTC stats.
 * 
 * Monitors RTCPeerConnection statistics (bandwidth, RTT, packet loss)
 * and dynamically adjusts the video constraints to maintain a smooth
 * experience. Provides quality presets and auto mode.
 * 
 * Presets:
 *   - low:    640x360  @ 15fps, 500kbps
 *   - medium: 1280x720 @ 24fps, 1500kbps
 *   - high:   1920x1080 @ 30fps, 3000kbps
 *   - auto:   Dynamically switches between presets based on network stats
 */
class QualityController extends EventEmitter {
  constructor() {
    super();
    this.currentPreset = 'auto';
    this.currentEffectivePreset = 'high'; // What auto mode is currently using
    this.statsInterval = null;
    this.statsHistory = []; // Last N stat snapshots for trend analysis
    this.maxHistory = 10;

    this.presets = {
      low: {
        width: 640,
        height: 360,
        frameRate: 15,
        maxBitrate: 500000, // 500kbps
        label: 'Low (360p)'
      },
      medium: {
        width: 1280,
        height: 720,
        frameRate: 24,
        maxBitrate: 1500000, // 1.5Mbps
        label: 'Medium (720p)'
      },
      high: {
        width: 1920,
        height: 1080,
        frameRate: 30,
        maxBitrate: 3000000, // 3Mbps
        label: 'High (1080p)'
      }
    };
  }

  /**
   * Start monitoring WebRTC stats and adjusting quality.
   * @param {RTCPeerConnection} pc - The peer connection to monitor
   * @param {number} intervalMs - Stats polling interval (default 2000ms)
   */
  startMonitoring(pc, intervalMs = 2000) {
    this.pc = pc;
    this.statsInterval = setInterval(() => this._collectStats(), intervalMs);
    console.log('[Quality] Monitoring started');
  }

  /**
   * Stop monitoring.
   */
  stopMonitoring() {
    if (this.statsInterval) {
      clearInterval(this.statsInterval);
      this.statsInterval = null;
    }
    this.statsHistory = [];
  }

  /**
   * Set quality preset.
   * @param {'low' | 'medium' | 'high' | 'auto'} preset
   */
  setPreset(preset) {
    this.currentPreset = preset;
    if (preset !== 'auto') {
      this.currentEffectivePreset = preset;
      this._applyConstraints(this.presets[preset]);
    }
    console.log(`[Quality] Preset set to: ${preset}`);
  }

  /**
   * Get current quality info.
   */
  getInfo() {
    return {
      preset: this.currentPreset,
      effectivePreset: this.currentEffectivePreset,
      constraints: this.presets[this.currentEffectivePreset],
      stats: this.statsHistory.length > 0 ? this.statsHistory[this.statsHistory.length - 1] : null
    };
  }

  /**
   * Get the video constraints for screen capture.
   * @returns {Object} MediaStreamConstraints-compatible object
   */
  getConstraints() {
    const preset = this.presets[this.currentEffectivePreset];
    return {
      maxWidth: preset.width,
      maxHeight: preset.height,
      maxFrameRate: preset.frameRate
    };
  }

  // ─── Internal ─────────────────────────────────────────────────────────────

  async _collectStats() {
    if (!this.pc) return;

    try {
      const stats = await this.pc.getStats();
      let rtt = 0;
      let packetLoss = 0;
      let bytesSent = 0;
      let bytesReceived = 0;
      let framesPerSecond = 0;

      stats.forEach(report => {
        if (report.type === 'candidate-pair' && report.state === 'succeeded') {
          rtt = report.currentRoundTripTime || 0;
        }
        if (report.type === 'outbound-rtp' && report.kind === 'video') {
          bytesSent = report.bytesSent || 0;
          framesPerSecond = report.framesPerSecond || 0;
        }
        if (report.type === 'inbound-rtp' && report.kind === 'video') {
          bytesReceived = report.bytesReceived || 0;
          packetLoss = report.packetsLost || 0;
          framesPerSecond = report.framesPerSecond || framesPerSecond;
        }
        if (report.type === 'remote-inbound-rtp') {
          packetLoss = report.packetsLost || packetLoss;
          rtt = report.roundTripTime || rtt;
        }
      });

      const snapshot = {
        timestamp: Date.now(),
        rtt: Math.round(rtt * 1000), // Convert to ms
        packetLoss,
        bytesSent,
        bytesReceived,
        framesPerSecond: Math.round(framesPerSecond)
      };

      this.statsHistory.push(snapshot);
      if (this.statsHistory.length > this.maxHistory) {
        this.statsHistory.shift();
      }

      // Emit stats for UI
      this.emit('stats-updated', snapshot);

      // Auto-adjust if in auto mode
      if (this.currentPreset === 'auto') {
        this._autoAdjust(snapshot);
      }
    } catch (err) {
      // Stats collection can fail during state transitions
    }
  }

  _autoAdjust(snapshot) {
    const { rtt, packetLoss } = snapshot;
    let targetPreset = this.currentEffectivePreset;

    // High latency or packet loss → downgrade
    if (rtt > 200 || packetLoss > 50) {
      targetPreset = 'low';
    } else if (rtt > 100 || packetLoss > 20) {
      targetPreset = 'medium';
    } else if (rtt < 50 && packetLoss < 5) {
      targetPreset = 'high';
    }

    if (targetPreset !== this.currentEffectivePreset) {
      console.log(`[Quality] Auto-adjusting: ${this.currentEffectivePreset} → ${targetPreset} (RTT: ${rtt}ms, Loss: ${packetLoss})`);
      this.currentEffectivePreset = targetPreset;
      this._applyConstraints(this.presets[targetPreset]);
      this.emit('quality-changed', {
        preset: targetPreset,
        reason: `RTT: ${rtt}ms, Packet Loss: ${packetLoss}`
      });
    }
  }

  async _applyConstraints(preset) {
    if (!this.pc) return;

    try {
      const senders = this.pc.getSenders();
      const videoSender = senders.find(s => s.track && s.track.kind === 'video');
      
      if (videoSender) {
        const params = videoSender.getParameters();
        if (!params.encodings || params.encodings.length === 0) {
          params.encodings = [{}];
        }
        params.encodings[0].maxBitrate = preset.maxBitrate;
        params.encodings[0].maxFramerate = preset.frameRate;
        await videoSender.setParameters(params);
        console.log(`[Quality] Applied: ${preset.label} (${preset.maxBitrate / 1000}kbps)`);
      }
    } catch (err) {
      console.error('[Quality] Failed to apply constraints:', err.message);
    }
  }
}

module.exports = { QualityController };
