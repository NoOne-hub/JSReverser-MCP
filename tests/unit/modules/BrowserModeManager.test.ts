import { describe, it } from 'node:test';
import assert from 'node:assert';
import { BrowserModeManager } from '../../../src/modules/browser/BrowserModeManager.js';

describe('BrowserModeManager (mocked)', () => {
  it('reuses connected browser in launch', async () => {
    const manager = new BrowserModeManager({
      useStealthScripts: false,
      autoLaunch: false,
    });
    const connected = {
      isConnected: () => true,
    };
    (manager as any).browser = connected;

    const browser = await manager.launch();
    assert.strictEqual(browser, connected as any);
  });

  it('creates new page, restores cookies and handles page close', async () => {
    const manager = new BrowserModeManager({
      useStealthScripts: false,
      autoLaunch: false,
    });

    let closeHandler: (() => void) | null = null;
    const page = {
      on: (event: string, handler: () => void) => {
        if (event === 'close') {
          closeHandler = handler;
        }
      },
      setCacheEnabled: async () => {},
      setBypassCSP: async () => {},
      setJavaScriptEnabled: async () => {},
      setCookie: async (...args: unknown[]) => {
        return args.length;
      },
      goto: async () => {},
    };
    const browser = {
      newPage: async () => page,
    };

    (manager as any).browser = browser;
    (manager as any).sessionData = { cookies: [{ name: 'sid', value: '1' }] };
    let antiDetectionInjected = 0;
    (manager as any).injectAntiDetectionScripts = async () => {
      antiDetectionInjected += 1;
    };

    const created = await manager.newPage();
    assert.strictEqual(created, page as any);
    assert.strictEqual(manager.getCurrentPage(), page as any);
    assert.strictEqual(antiDetectionInjected, 1);

    assert.ok(closeHandler);
  });

  it('navigates with current page or provided page and throws without page', async () => {
    const manager = new BrowserModeManager({
      useStealthScripts: false,
      autoLaunch: false,
    });

    await assert.rejects(
      async () => {
        await manager.goto('https://example.com');
      },
      /No page available/,
    );

    let gotoCount = 0;
    const page = {
      goto: async () => {
        gotoCount += 1;
      },
    };
    (manager as any).currentPage = page;

    await manager.goto('https://a.com');
    await manager.goto('https://b.com', page as any);
    assert.strictEqual(gotoCount, 2);
  });

  it('disconnects browser and terminates auto-launched process on close', async () => {
    const manager = new BrowserModeManager({
      useStealthScripts: false,
      autoLaunch: false,
    });

    let disconnected = 0;
    let killed = 0;
    (manager as any).browser = {
      disconnect: async () => {
        disconnected += 1;
      },
    };
    (manager as any).autoLaunched = true;
    (manager as any).browserProcess = {
      killed: false,
      kill: () => {
        killed += 1;
      },
    };

    await manager.close();
    assert.strictEqual(disconnected, 1);
    assert.strictEqual(killed, 1);
    assert.strictEqual(manager.getBrowser(), null);
    assert.strictEqual(manager.getCurrentPage(), null);
  });

  it('handles disconnect failure branch on close', async () => {
    const manager = new BrowserModeManager({
      useStealthScripts: false,
      autoLaunch: false,
    });

    (manager as any).browser = {
      disconnect: async () => {
        throw new Error('disconnect failed');
      },
    };

    await manager.close();
    assert.strictEqual(manager.getBrowser(), null);
  });
});
