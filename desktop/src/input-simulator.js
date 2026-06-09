const { screen } = require('electron');

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
        case 'keydown':
          await this._handleKeyDown(event);
          break;
        case 'keyup':
          await this._handleKeyUp(event);
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
    await this.mouse.setPosition(new this.Point(x, y));
  }

  async _handleMouseDown(event) {
    const x = Math.round(event.x * this.screenWidth);
    const y = Math.round(event.y * this.screenHeight);
    await this.mouse.setPosition(new this.Point(x, y));

    const button = this._mapButton(event.button);
    await this.mouse.pressButton(button);
  }

  async _handleMouseUp(event) {
    const x = Math.round(event.x * this.screenWidth);
    const y = Math.round(event.y * this.screenHeight);
    await this.mouse.setPosition(new this.Point(x, y));

    const button = this._mapButton(event.button);
    await this.mouse.releaseButton(button);
  }

  async _handleScroll(event) {
    const amount = Math.round(event.deltaY / 10); // Normalize scroll amount
    if (amount > 0) {
      await this.mouse.scrollDown(Math.abs(amount));
    } else if (amount < 0) {
      await this.mouse.scrollUp(Math.abs(amount));
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
    const key = this._mapKey(event.code, event.key);
    if (key !== null) {
      // Handle modifier combos (e.g., Ctrl+C)
      const modifiers = this._getModifiers(event);
      if (modifiers.length > 0) {
        // Press modifiers first, then the key
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
    const key = this._mapKey(event.code, event.key);
    if (key !== null) {
      await this.keyboard.releaseKey(key);
      // Release modifiers too
      const modifiers = this._getModifiers(event);
      for (const mod of modifiers) {
        await this.keyboard.releaseKey(mod);
      }
    }
  }

  _getModifiers(event) {
    const mods = [];
    if (event.ctrlKey) mods.push(this.Key.LeftControl);
    if (event.shiftKey) mods.push(this.Key.LeftShift);
    if (event.altKey) mods.push(this.Key.LeftAlt);
    if (event.metaKey) mods.push(this.Key.LeftSuper);
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
