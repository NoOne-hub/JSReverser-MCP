import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert';
import { BrowserManager } from '../../../src/browser.js';

describe('BrowserManager crash handling', () => {
  const originalSetInterval = global.setInterval;
  const originalClearInterval = global.clearInterval;
  const originalSetTimeout = global.setTimeout;

  beforeEach(() => {
    BrowserManager.resetInstance();
  });

  afterEach(async () => {
    global.setInterval = originalSetInterval;
    global.clearInterval = originalClearInterval;
    global.setTimeout = originalSetTimeout;
    try {
      const manager = BrowserManager.getInstance({ headless: true, isolated: true });
      await manager.close();
    } catch {
      // no-op
    }
    BrowserManager.resetInstance();
  });

  it('setupCrashDetection registers handlers and periodic check triggers crash handling', () => {
    const manager = BrowserManager.getInstance({ headless: true, isolated: true }) as any;

    let disconnectedHandler: (() => void) | undefined;
    manager.browser = {
      connected: true,
      on: (event: string, handler: () => void) => {
        if (event === 'disconnected') {
          disconnectedHandler = handler;
        }
      },
      close: async () => {},
    };

    let intervalTick: (() => void) | undefined;
    global.setInterval = ((fn: () => void) => {
      intervalTick = fn;
      return 99 as any;
    }) as any;
    global.clearInterval = (() => {}) as any;

    let crashed = 0;
    manager.handleBrowserCrash = async () => {
      crashed += 1;
    };

    manager.setupCrashDetection();
    assert.ok(disconnectedHandler);
    disconnectedHandler!();
    assert.strictEqual(crashed, 1);

    manager.browser.connected = false;
    intervalTick!();
    assert.strictEqual(crashed, 2);
  });

  it('setupCrashDetection clears existing interval and skips when browser is absent', () => {
    const manager = BrowserManager.getInstance({ headless: true, isolated: true }) as any;
    manager.browser = undefined;
    manager.setupCrashDetection();

    let clearedId: any;
    global.clearInterval = ((id: any) => {
      clearedId = id;
    }) as any;
    global.setInterval = ((fn: () => void) => {
      void fn;
      return 12 as any;
    }) as any;

    manager.browser = {
      connected: true,
      on: () => {},
      close: async () => {},
    };
    manager.crashCheckInterval = 7 as any;
    manager.setupCrashDetection();
    assert.strictEqual(clearedId, 7);
  });

  it('handleBrowserCrash restarts browser and always resets restarting flag', async () => {
    const manager = BrowserManager.getInstance({ headless: true, isolated: true }) as any;
    let closed = 0;
    manager.browser = {
      connected: false,
      on: () => {},
      close: async () => {
        closed += 1;
        throw new Error('close failed');
      },
    };

    global.setTimeout = ((fn: (...args: any[]) => void) => {
      fn();
      return 1 as any;
    }) as any;

    let ensured = 0;
    manager.ensureBrowser = async () => {
      ensured += 1;
      return { connected: true };
    };

    await manager.handleBrowserCrash();
    assert.strictEqual(closed, 1);
    assert.strictEqual(ensured, 1);
    assert.strictEqual(manager.isRestarting, false);
  });

  it('handleBrowserCrash early returns when already restarting', async () => {
    const manager = BrowserManager.getInstance({ headless: true, isolated: true }) as any;
    manager.isRestarting = true;
    let ensured = 0;
    manager.ensureBrowser = async () => {
      ensured += 1;
      return { connected: true };
    };

    await manager.handleBrowserCrash();
    assert.strictEqual(ensured, 0);
    assert.strictEqual(manager.isRestarting, true);
  });
});
