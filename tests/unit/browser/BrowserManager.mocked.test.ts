import { beforeEach, afterEach, describe, it } from 'node:test';
import assert from 'node:assert';
import { BrowserManager } from '../../../src/browser.js';
import { StealthScripts2025 } from '../../../src/modules/stealth/StealthScripts2025.js';

describe('BrowserManager mocked', () => {
  let originalInjectAll: typeof StealthScripts2025.injectAll;

  beforeEach(() => {
    BrowserManager.resetInstance();
    originalInjectAll = StealthScripts2025.injectAll;
  });

  afterEach(async () => {
    (StealthScripts2025 as any).injectAll = originalInjectAll;
    try {
      const manager = BrowserManager.getInstance({
        headless: true,
        isolated: true,
      });
      await manager.close();
    } catch {
      // no-op
    }
    BrowserManager.resetInstance();
  });

  it('uses connected browser directly in ensureBrowser', async () => {
    const manager = BrowserManager.getInstance({
      headless: true,
      isolated: true,
    });
    const existing = { connected: true };
    (manager as any).browser = existing;

    const browser = await manager.ensureBrowser();
    assert.strictEqual(browser, existing as any);
  });

  it('selects remote connect or launch path', async () => {
    const remote = BrowserManager.getInstance({
      remoteDebuggingUrl: 'http://127.0.0.1:9222',
      headless: true,
      isolated: true,
    });
    let remoteCalled = 0;
    (remote as any).connectToRemoteBrowser = async () => {
      remoteCalled += 1;
      return { connected: true };
    };
    await remote.ensureBrowser();
    assert.strictEqual(remoteCalled, 1);

    BrowserManager.resetInstance();

    const local = BrowserManager.getInstance({
      headless: true,
      isolated: true,
    });
    let launchCalled = 0;
    (local as any).launchBrowser = async () => {
      launchCalled += 1;
      return { connected: true };
    };
    await local.ensureBrowser();
    assert.strictEqual(launchCalled, 1);
  });

  it('injects stealth scripts once and handles new page targets', async () => {
    const manager = BrowserManager.getInstance({
      headless: true,
      isolated: true,
    });

    const pageA = { id: 'a' };
    const pageB = { id: 'b' };
    let onTargetCreated: any = null;
    const browser = {
      pages: async () => [pageA, pageB],
      on: (event: string, handler: (target: any) => Promise<void>) => {
        if (event === 'targetcreated') {
          onTargetCreated = handler;
        }
      },
      close: async () => {},
      connected: true,
    };
    (manager as any).browser = browser;

    let injectedCount = 0;
    (StealthScripts2025 as any).injectAll = async () => {
      injectedCount += 1;
    };

    await manager.injectStealth('linux-chrome', { mockConnection: false });
    assert.strictEqual(injectedCount, 2);

    await manager.injectStealth();
    assert.strictEqual(injectedCount, 2);

    assert.ok(onTargetCreated);
    await onTargetCreated!({
      type: () => 'page',
      page: async () => ({ id: 'c' }),
    });
    assert.strictEqual(injectedCount, 3);
  });

  it('handles injectStealth failures and connection helpers', async () => {
    const manager = BrowserManager.getInstance({
      headless: true,
      isolated: true,
    });

    await assert.rejects(
      async () => {
        await manager.injectStealth();
      },
      /Browser not initialized/,
    );

    (manager as any).browser = {
      pages: async () => [{}],
      on: () => {},
      close: async () => {},
      connected: true,
    };

    (StealthScripts2025 as any).injectAll = async () => {
      throw new Error('inject failed');
    };

    await assert.rejects(
      async () => {
        await manager.injectStealth();
      },
      /Failed to inject stealth scripts: inject failed/,
    );

    assert.strictEqual(manager.getStealthFeatures().includes('mockChrome'), true);
    assert.strictEqual(manager.getStealthPresets().length > 0, true);
    assert.strictEqual(manager.isConnected(), true);
  });

  it('restarts and closes browser with cleanup', async () => {
    const manager = BrowserManager.getInstance({
      headless: true,
      isolated: true,
    });

    let closeCalled = 0;
    (manager as any).browser = {
      connected: true,
      close: async () => {
        closeCalled += 1;
        throw new Error('close fail');
      },
      on: () => {},
    };

    await manager.close();
    assert.strictEqual(closeCalled, 1);
    assert.strictEqual(manager.isConnected(), false);

    let restarted = 0;
    (manager as any).close = async () => {
      restarted += 1;
    };
    (manager as any).ensureBrowser = async () => {
      restarted += 1;
      return { connected: true };
    };
    await manager.restart();
    assert.strictEqual(restarted, 2);
  });
});
