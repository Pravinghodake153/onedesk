const { exec, execFile } = require('child_process');
const path = require('path');

/**
 * DisplayPowerManager — controls physical monitor screen blanking / curtain mode.
 * 
 * Sets display brightness to 0.0 to completely turn off the monitor backlight,
 * saving physical energy and providing total privacy while the remote user is connected.
 * 
 * The virtual framebuffer and GPU continue compositing at full color and 60fps,
 * so remote WebRTC streaming and input simulation continue without any interruption.
 */
class DisplayPowerManager {
  constructor() {
    this.isScreenBlanked = false;
    this.savedBrightness = new Map();
    this.defaultBrightness = 0.5;
    this.isMac = process.platform === 'darwin';
    this.isWin = process.platform === 'win32';
    this.scriptPath = path.join(__dirname, 'brightness.py');

    // Automatically restore screen on process termination
    const restoreHandler = () => {
      if (this.isScreenBlanked) {
        this.restoreSync();
      }
    };
    process.on('exit', restoreHandler);
    process.on('SIGINT', () => { restoreHandler(); process.exit(); });
    process.on('SIGTERM', () => { restoreHandler(); process.exit(); });
  }

  /**
   * Set blank screen (turns physical monitor dark/off for privacy & energy saving)
   * @param {boolean} blank - true to turn off, false to restore
   */
  async setBlankScreen(blank = true) {
    if (blank) {
      if (this.isScreenBlanked) return { success: true, blanked: true };

      // 1. Save current brightness
      await this._saveCurrentBrightness();

      // 2. Set brightness to 0.0
      const ok = await this._applyBrightness(0.0);
      if (ok) {
        this.isScreenBlanked = true;
        console.log('[DisplayPower] Remote screen blanked / turned OFF (Energy Saver active)');
      }
      return { success: ok, blanked: this.isScreenBlanked };
    } else {
      if (!this.isScreenBlanked) return { success: true, blanked: false };

      // Restore saved brightness
      const ok = await this._restoreSavedBrightness();
      this.isScreenBlanked = false;
      console.log('[DisplayPower] Remote screen restored to normal brightness');
      return { success: ok, blanked: false };
    }
  }

  async toggleBlankScreen() {
    return await this.setBlankScreen(!this.isScreenBlanked);
  }

  getStatus() {
    return {
      supported: true,
      blanked: this.isScreenBlanked
    };
  }

  async _saveCurrentBrightness() {
    if (this.isMac) {
      return new Promise((resolve) => {
        execFile('python3', [this.scriptPath, 'get'], (err, stdout) => {
          if (!err && stdout) {
            try {
              const data = JSON.parse(stdout.trim());
              if (data.displays && Array.isArray(data.displays)) {
                for (const item of data.displays) {
                  if (item.brightness > 0.05) {
                    this.savedBrightness.set(item.display, item.brightness);
                    this.defaultBrightness = item.brightness;
                  }
                }
              }
            } catch (e) {}
          }
          resolve();
        });
      });
    }
  }

  async _applyBrightness(val) {
    if (this.isMac) {
      return new Promise((resolve) => {
        execFile('python3', [this.scriptPath, 'set', String(val)], (err, stdout) => {
          if (err) {
            console.warn('[DisplayPower] Failed to set brightness:', err.message);
            resolve(false);
            return;
          }
          resolve(true);
        });
      });
    } else if (this.isWin) {
      const pct = Math.round(val * 100);
      return new Promise((resolve) => {
        exec(`powershell -Command "(Get-WmiObject -Namespace root/wmi -Class WmiMonitorBrightnessMethods).WmiSetBrightness(1, ${pct})"`, (err) => {
          resolve(!err);
        });
      });
    } else {
      const pct = Math.round(val * 100);
      return new Promise((resolve) => {
        exec(`brightnessctl set ${pct}% || xrandr --brightness ${val}`, (err) => {
          resolve(!err);
        });
      });
    }
  }

  async _restoreSavedBrightness() {
    const val = this.defaultBrightness || 0.5;
    return await this._applyBrightness(val);
  }

  restoreSync() {
    try {
      const val = this.defaultBrightness || 0.5;
      if (this.isMac) {
        const { execFileSync } = require('child_process');
        execFileSync('python3', [this.scriptPath, 'set', String(val)]);
      }
    } catch (e) {}
  }
}

const displayPowerManager = new DisplayPowerManager();
module.exports = { displayPowerManager };
