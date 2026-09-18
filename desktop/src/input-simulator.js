const { screen } = require('electron');
const { displayPowerManager } = require('./display-power');

/**
 * InputSimulator — translates normalized input events from the remote
 * client into native OS mouse/keyboard actions.
 * 
 * Input events arrive with coordinates normalized to [0, 1].
 * We denormalize them to actual screen pixels using the primary display size.
 * 
 * Uses @nut-tree-fork/nut-js for cross-platform input simulation.
 * Falls back to a no-op logger if the native module fails to load.
 */
class InputSimulator {
  constructor() {
    this.mouse = null;
    this.keyboard = null;
    this.ready = false;
    this.screenWidth = 1920;
    this.screenHeight = 1080;
    this._init();
  }

  async _init() {
    try {
      // Get actual screen dimensions
      const primaryDisplay = screen.getPrimaryDisplay();
      this.screenWidth = primaryDisplay.size.width;
      this.screenHeight = primaryDisplay.size.height;
      console.log(`[Input] Screen: ${this.screenWidth}x${this.screenHeight}`);

      // Load nut-js
      const nutjs = require('@nut-tree-fork/nut-js');
      this.mouse = nutjs.mouse;
      this.keyboard = nutjs.keyboard;
      this.Key = nutjs.Key;
      this.Button = nutjs.Button;
      this.Point = nutjs.Point;

      // Configure nut-js for low-latency
      this.mouse.config.autoDelayMs = 0;
      this.mouse.config.mouseSpeed = 2000; // pixels per second (fast)
      this.keyboard.config.autoDelayMs = 0;

      this.ready = true;
      console.log('[Input] Native input simulator ready');
    } catch (err) {
      console.warn('[Input] Native input simulation unavailable:', err.message);
      console.warn('[Input] Input events will be logged but not simulated');
      this.ready = false;
    }
  }

  /**
   * Process an input event from the remote client.
   * @param {Object} event - The input event with type, coordinates, etc.
   */
  async handleEvent(event) {
    if (!this.ready) {
      // Fallback: just log
      return;
    }

    try {
      switch (event.type) {
        case 'mousemove':
          await this._handleMouseMove(event);
          break;
        case 'mousedown':
          await this._handleMouseDown(event);
          break;
        case 'mouseup':
          await this._handleMouseUp(event);
          break;
        case 'scroll':
          await this._handleScroll(event);
          break;
        case 'doubleClick':
        case 'doubleclick':
          await this._handleDoubleClick(event);
          break;
        case 'keydown':
          await this._handleKeyDown(event);
          break;
        case 'keyup':
          await this._handleKeyUp(event);
          break;
        case 'typeText':
          await this._handleTypeText(event);
          break;
        case 'toggle-blank-screen':
        case 'blank-screen':
          if (typeof event.blank === 'boolean') {
            await displayPowerManager.setBlankScreen(event.blank);
          } else {
            await displayPowerManager.toggleBlankScreen();
          }
          break;
        default:
          console.warn(`[Input] Unknown event type: ${event.type}`);
      }
    } catch (err) {
      console.error(`[Input] Error handling ${event.type}:`, err.message);
    }
  }

  // ─── Mouse ──────────────────────────────────────────────────────────────────

  async _handleMouseMove(event) {
    const x = Math.round(event.x * this.screenWidth);
    const y = Math.round(event.y * this.screenHeight);
    this._lastMouseX = x;
    this._lastMouseY = y;
    await this.mouse.setPosition(new this.Point(x, y));
  }

  async _handleMouseDown(event) {
    const x = Math.round(event.x * this.screenWidth);
    const y = Math.round(event.y * this.screenHeight);
    this._lastMouseX = x;
    this._lastMouseY = y;
    await this.mouse.setPosition(new this.Point(x, y));

    // Release any stuck Control modifier before left-clicking so macOS doesn't turn it into a right click
    if (event.button === 0 && !event.ctrlKey) {
      if (this.ready && this.keyboard && this.Key) {
        try { await this.keyboard.releaseKey(this.Key.LeftControl); } catch (e) {}
        try { await this.keyboard.releaseKey(this.Key.RightControl); } catch (e) {}
      }
    }

    const button = this._mapButton(event.button);
    await this.mouse.pressButton(button);
  }

  async _handleMouseUp(event) {
    const x = Math.round(event.x * this.screenWidth);
    const y = Math.round(event.y * this.screenHeight);
    this._lastMouseX = x;
    this._lastMouseY = y;
    await this.mouse.setPosition(new this.Point(x, y));

    const button = this._mapButton(event.button);
    await this.mouse.releaseButton(button);

    if (event.button === 0 && !event.ctrlKey) {
      if (this.ready && this.keyboard && this.Key) {
        try { await this.keyboard.releaseKey(this.Key.LeftControl); } catch (e) {}
        try { await this.keyboard.releaseKey(this.Key.RightControl); } catch (e) {}
      }
    }
  }

  async _handleDoubleClick(event) {
    const x = Math.round(event.x * this.screenWidth);
    const y = Math.round(event.y * this.screenHeight);
    this._lastMouseX = x;
    this._lastMouseY = y;
    await this.mouse.setPosition(new this.Point(x, y));
    await this.mouse.doubleClick(this.Button.LEFT);
  }

  async _handleScroll(event) {
    // If pointer coordinates are provided and moved significantly, position cursor
    if (typeof event.x === 'number' && typeof event.y === 'number') {
      const x = Math.round(event.x * this.screenWidth);
      const y = Math.round(event.y * this.screenHeight);
      const dist = Math.hypot((this._lastMouseX ?? 0) - x, (this._lastMouseY ?? 0) - y);
      if (dist > 12) {
        this._lastMouseX = x;
        this._lastMouseY = y;
        await this.mouse.setPosition(new this.Point(x, y));
      }
    }

    // Accumulate scroll deltas for smooth, natural trackpad inertia
    this._accumScrollY = (this._accumScrollY || 0) + (event.deltaY || 0);
    this._accumScrollX = (this._accumScrollX || 0) + (event.deltaX || 0);

    // Clear accumulated remainder if user stops scrolling for 120ms
    clearTimeout(this._scrollResetTimer);
    this._scrollResetTimer = setTimeout(() => {
      this._accumScrollY = 0;
      this._accumScrollX = 0;
    }, 120);

    // Proportional stepping:
    // deltaMode 1 (DOM_DELTA_LINE, mouse wheel notch) -> 1 unit step
    // deltaMode 0 (DOM_DELTA_PIXEL, laptop precision trackpad) -> threshold 10
    const STEP = (event.deltaMode === 1) ? 1 : 10;

    const ticksY = Math.trunc(this._accumScrollY / STEP);
    if (ticksY !== 0) {
      this._accumScrollY -= ticksY * STEP;
      if (ticksY > 0) {
        await this.mouse.scrollDown(Math.abs(ticksY));
      } else {
        await this.mouse.scrollUp(Math.abs(ticksY));
      }
    }

    const ticksX = Math.trunc(this._accumScrollX / STEP);
    if (ticksX !== 0) {
      this._accumScrollX -= ticksX * STEP;
      if (ticksX > 0) {
        await this.mouse.scrollRight(Math.abs(ticksX));
      } else {
        await this.mouse.scrollLeft(Math.abs(ticksX));
      }
    }
  }

  _mapButton(button) {
    switch (button) {
      case 0: return this.Button.LEFT;
      case 1: return this.Button.MIDDLE;
      case 2: return this.Button.RIGHT;
      default: return this.Button.LEFT;
    }
  }

  // ─── Keyboard ───────────────────────────────────────────────────────────────

  async _handleKeyDown(event) {
    // Check for desktop spaces / Mission Control navigation
    // Ctrl + Arrows for switching spaces and Mission Control.
    // Option + Arrows is preserved as native word/line text navigation on laptops!
    const isArrow = (event.code === 'ArrowRight' || event.code === 'ArrowLeft' || event.code === 'ArrowUp' || event.code === 'ArrowDown');
    if (event.isDesktopNav || (isArrow && event.ctrlKey && !event.altKey)) {
      await this._handleDesktopNavigation(event);
      return;
    }

    // Synchronize modifiers and CapsLock before simulating key to prevent stuck Shift/CapsLock
    await this._syncModifiers(event);

    const key = this._mapKey(event.code, event.key);
    if (key !== null) {
      // Handle modifier combos (e.g., Ctrl+C)
      const modifiers = this._getModifiers(event);
      if (modifiers.length > 0) {
        for (const mod of modifiers) {
          await this.keyboard.pressKey(mod);
        }
        await this.keyboard.pressKey(key);
      } else {
        await this.keyboard.pressKey(key);
      }
    }
  }

  async _handleKeyUp(event) {
    const isArrow = (event.code === 'ArrowRight' || event.code === 'ArrowLeft' || event.code === 'ArrowUp' || event.code === 'ArrowDown');
    if (event.isDesktopNav || (isArrow && event.ctrlKey && !event.altKey)) {
      // Ensure arrow keys and Ctrl modifier are cleanly released
      try {
        if (this.Key) {
          if (event.code === 'ArrowRight') await this.keyboard.releaseKey(this.Key.Right);
          if (event.code === 'ArrowLeft') await this.keyboard.releaseKey(this.Key.Left);
          if (event.code === 'ArrowUp') await this.keyboard.releaseKey(this.Key.Up);
          if (event.code === 'ArrowDown') await this.keyboard.releaseKey(this.Key.Down);
          await this.keyboard.releaseKey(this.Key.LeftControl);
        }
      } catch (e) {}
      return;
    }

    const key = this._mapKey(event.code, event.key);
    if (key !== null) {
      await this.keyboard.releaseKey(key);
    }

    // Ensure all unpressed modifiers are cleanly released on host OS
    await this._syncModifiers(event);
  }

  async _syncModifiers(event) {
    if (!this.ready || !this.keyboard || !this.Key) return;

    // Release Shift if user is not holding Shift (prevents stuck uppercase)
    if (!event.shiftKey) {
      try { await this.keyboard.releaseKey(this.Key.LeftShift); } catch (e) {}
      try { await this.keyboard.releaseKey(this.Key.RightShift); } catch (e) {}
    }
    // Release Ctrl if not holding Ctrl
    if (!event.ctrlKey && !event.isDesktopNav) {
      try { await this.keyboard.releaseKey(this.Key.LeftControl); } catch (e) {}
      try { await this.keyboard.releaseKey(this.Key.RightControl); } catch (e) {}
    }
    // Release Alt if not holding Alt
    if (!event.altKey) {
      try { await this.keyboard.releaseKey(this.Key.LeftAlt); } catch (e) {}
      try { await this.keyboard.releaseKey(this.Key.RightAlt); } catch (e) {}
    }
    // Release Meta/Command if not holding Meta
    if (!event.metaKey) {
      try { await this.keyboard.releaseKey(this.Key.LeftSuper); } catch (e) {}
      try { await this.keyboard.releaseKey(this.Key.RightSuper); } catch (e) {}
    }

    // Align Caps Lock state between client and host on macOS
    if (typeof event.capsLock === 'boolean' && process.platform === 'darwin') {
      this._syncCapsLockState(event.capsLock);
    }
  }

  _syncCapsLockState(clientCapsLock) {
    const now = Date.now();
    if (this._lastCapsLockCheck && (now - this._lastCapsLockCheck < 400)) return;
    this._lastCapsLockCheck = now;

    const { exec } = require('child_process');
    exec(`python3 -c "import ctypes; cg = ctypes.cdll.LoadLibrary('/System/Library/Frameworks/CoreGraphics.framework/CoreGraphics'); print(1 if (cg.CGEventSourceFlagsState(1) & 0x10000) else 0)"`, async (err, stdout) => {
      if (!err && stdout) {
        const hostCapsLock = stdout.trim() === '1';
        if (hostCapsLock !== clientCapsLock) {
          console.log(`[Input] Aligning host CapsLock (${hostCapsLock}) with client (${clientCapsLock})`);
          try {
            await this.keyboard.pressKey(this.Key.CapsLock);
            await this.keyboard.releaseKey(this.Key.CapsLock);
          } catch (e) {}
        }
      }
    });
  }

  async _handleDesktopNavigation(event) {
    const isMac = process.platform === 'darwin';

    if (isMac) {
      const { exec } = require('child_process');
      let keyCode = null;
      if (event.code === 'ArrowRight') keyCode = 124;      // Next desktop / space
      else if (event.code === 'ArrowLeft') keyCode = 123;  // Prev desktop / space
      else if (event.code === 'ArrowUp') keyCode = 126;    // Mission Control (all windows)
      else if (event.code === 'ArrowDown') keyCode = 125;  // Application windows (App Exposé)

      if (keyCode) {
        exec(`osascript -e 'tell application "System Events" to key code ${keyCode} using control down'`, (err) => {
          if (err) console.warn('[Input] Desktop navigation AppleScript warning:', err.message);
        });
      }
    }

    // Also simulate via nut-js keyboard for universal cross-platform support
    if (this.ready && this.keyboard && this.Key) {
      try {
        let key = null;
        if (event.code === 'ArrowRight') key = this.Key.Right;
        else if (event.code === 'ArrowLeft') key = this.Key.Left;
        else if (event.code === 'ArrowUp') key = this.Key.Up;
        else if (event.code === 'ArrowDown') key = this.Key.Down;

        if (key !== null) {
          // Release any Alt key so OS treats it strictly as Control+Arrow
          try { await this.keyboard.releaseKey(this.Key.LeftAlt); } catch (e) {}
          try { await this.keyboard.releaseKey(this.Key.RightAlt); } catch (e) {}

          await this.keyboard.pressKey(this.Key.LeftControl);
          await this.keyboard.pressKey(key);
          await new Promise(r => setTimeout(r, 50));
          await this.keyboard.releaseKey(key);
          await this.keyboard.releaseKey(this.Key.LeftControl);
        }
      } catch (e) {
        console.warn('[Input] nut-js navigation combo warning:', e.message);
      }
    }
  }

  async _handleTypeText(event) {
    if (event.text) {
      await this.keyboard.type(event.text);
    }
  }

  _getModifiers(event) {
    const mods = [];
    if (event.ctrlKey && event.code !== 'ControlLeft' && event.code !== 'ControlRight') {
      mods.push(this.Key.LeftControl);
    }
    if (event.shiftKey && event.code !== 'ShiftLeft' && event.code !== 'ShiftRight') {
      mods.push(this.Key.LeftShift);
    }
    if (event.altKey && event.code !== 'AltLeft' && event.code !== 'AltRight') {
      mods.push(this.Key.LeftAlt);
    }
    if (event.metaKey && event.code !== 'MetaLeft' && event.code !== 'MetaRight') {
      mods.push(this.Key.LeftSuper);
    }
    return mods;
  }

  /**
   * Maps browser key codes to nut-js Key enum values.
   * This is a comprehensive mapping covering the most common keys.
   */
  _mapKey(code, key) {
    const K = this.Key;
    const mapping = {
      // Letters
      'KeyA': K.A, 'KeyB': K.B, 'KeyC': K.C, 'KeyD': K.D,
      'KeyE': K.E, 'KeyF': K.F, 'KeyG': K.G, 'KeyH': K.H,
      'KeyI': K.I, 'KeyJ': K.J, 'KeyK': K.K, 'KeyL': K.L,
      'KeyM': K.M, 'KeyN': K.N, 'KeyO': K.O, 'KeyP': K.P,
      'KeyQ': K.Q, 'KeyR': K.R, 'KeyS': K.S, 'KeyT': K.T,
      'KeyU': K.U, 'KeyV': K.V, 'KeyW': K.W, 'KeyX': K.X,
      'KeyY': K.Y, 'KeyZ': K.Z,
      // Numbers
      'Digit0': K.Num0, 'Digit1': K.Num1, 'Digit2': K.Num2,
      'Digit3': K.Num3, 'Digit4': K.Num4, 'Digit5': K.Num5,
      'Digit6': K.Num6, 'Digit7': K.Num7, 'Digit8': K.Num8,
      'Digit9': K.Num9,
      // Function keys
      'F1': K.F1, 'F2': K.F2, 'F3': K.F3, 'F4': K.F4,
      'F5': K.F5, 'F6': K.F6, 'F7': K.F7, 'F8': K.F8,
      'F9': K.F9, 'F10': K.F10, 'F11': K.F11, 'F12': K.F12,
      // Modifiers
      'ShiftLeft': K.LeftShift, 'ShiftRight': K.RightShift,
      'ControlLeft': K.LeftControl, 'ControlRight': K.RightControl,
      'AltLeft': K.LeftAlt, 'AltRight': K.RightAlt,
      'MetaLeft': K.LeftSuper, 'MetaRight': K.RightSuper,
      // Navigation
      'ArrowUp': K.Up, 'ArrowDown': K.Down,
      'ArrowLeft': K.Left, 'ArrowRight': K.Right,
      'Home': K.Home, 'End': K.End,
      'PageUp': K.PageUp, 'PageDown': K.PageDown,
      // Editing
      'Backspace': K.Backspace, 'Delete': K.Delete,
      'Enter': K.Return, 'Tab': K.Tab,
      'Escape': K.Escape, 'Space': K.Space,
      'Insert': K.Insert,
      // Punctuation
      'Minus': K.Minus, 'Equal': K.Equal,
      'BracketLeft': K.LeftBracket, 'BracketRight': K.RightBracket,
      'Backslash': K.Backslash, 'Semicolon': K.Semicolon,
      'Quote': K.Quote, 'Backquote': K.Grave,
      'Comma': K.Comma, 'Period': K.Period, 'Slash': K.Slash,
      // Misc
      'CapsLock': K.CapsLock, 'NumLock': K.NumLock,
      'PrintScreen': K.Print,
    };

    return mapping[code] || null;
  }

  /**
   * Get current screen dimensions (useful for resolution negotiation).
   */
  getScreenInfo() {
    const primaryDisplay = screen.getPrimaryDisplay();
    return {
      width: primaryDisplay.size.width,
      height: primaryDisplay.size.height,
      scaleFactor: primaryDisplay.scaleFactor
    };
  }
}

module.exports = { InputSimulator };
