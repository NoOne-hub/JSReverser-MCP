import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert';
import { BrowserManager, launch } from '../../../src/browser.js';
import { puppeteer } from '../../../src/third_party/index.js';
import { StealthScripts2025 } from '../../../src/modules/stealth/StealthScripts2025.js';

describe('browser.ts mocked', () => {
  let originalLaunch: typeof puppeteer.launch;
  let originalConnect: typeof puppeteer.connect;
  let originalInjectAll: typeof StealthScripts2025.injectAll;

  beforeEach(() => {
    BrowserManager.resetInstance();
    originalLaunch = puppeteer.launch;
    originalConnect = puppeteer.connect;
    originalInjectAll = StealthScripts2025.injectAll;
  });

  afterEach(async () => {
    puppeteer.launch = originalLaunch;
    puppeteer.connect = originalConnect;
    (StealthScripts2025 as any).injectAll = originalInjectAll;
    try {
      const m = BrowserManager.getInstance({ headless: true, isolated: true });
      await m.close();
    } catch {
      // no-op
    }
    BrowserManager.resetInstance();
  });

  it('launch() passes options, resizes viewport and handles already running error', async () => {
    let launchArgs: Record<string, unknown> | null = null;
    let resized = 0;
    const fakeBrowser = {
      process: () => ({
        stderr: { pipe: () => {} },
        stdout: { pipe: () => {} },
      }),
      pages: async () => [
        {
          resize: async () => {
            resized += 1;
          },
        },
      ],
    };

    puppeteer.launch = async (opts: any) => {
      launchArgs = opts;
      return fakeBrowser as any;
    };

    const out = await launch({
      headless: true,
      isolated: true,
      devtools: true,
      args: ['--x-test'],
      viewport: { width: 800, height: 600 },
      logFile: { write: () => {} } as any,
    } as any);

    assert.strictEqual(out, fakeBrowser as any);
    assert.ok(launchArgs);
    assert.strictEqual(Array.isArray((launchArgs as any)?.args), true);
    assert.strictEqual(resized, 1);

    puppeteer.launch = async () => {
      throw new Error('The browser is already running');
    };
    await assert.rejects(
      async () => {
        await launch({
          headless: false,
          isolated: false,
          devtools: false,
          userDataDir: '/tmp/browser-profile',
        } as any);
      },
      /Use --isolated/,
    );
  });

  it('connectToRemoteBrowser handles success and failure', async () => {
    const manager = BrowserManager.getInstance({
      remoteDebuggingUrl: 'http://127.0.0.1:9222',
      wsHeaders: { Authorization: 'x' },
      isolated: true,
      headless: true,
    });

    const browser = {
      connected: true,
      on: () => {},
      pages: async () => [],
      close: async () => {},
    };
    puppeteer.connect = async () => browser as any;

    const connected = await (manager as any).connectToRemoteBrowser();
    assert.strictEqual(connected, browser as any);

    puppeteer.connect = async () => {
      throw new Error('refused');
    };
    await assert.rejects(
      async () => {
        await (manager as any).connectToRemoteBrowser();
      },
      /Failed to connect to remote browser: refused/,
    );
  });

  it('launchBrowser handles success path and failure wrapping', async () => {
    const manager = BrowserManager.getInstance({
      isolated: true,
      headless: true,
      devtools: false,
      args: ['--a'],
    });

    const browser = {
      connected: true,
      on: () => {},
      pages: async () => [],
      close: async () => {},
    };
    puppeteer.launch = async () => browser as any;
    const launched = await (manager as any).launchBrowser();
    assert.strictEqual(launched, browser as any);
    assert.strictEqual(manager.isConnected(), true);

    puppeteer.launch = async () => {
      throw new Error('failed to spawn');
    };
    await assert.rejects(
      async () => {
        await (manager as any).launchBrowser();
      },
      /Failed to launch browser: failed to spawn/,
    );
  });

  it('injectStealth supports duplicate skip and targetcreated injection', async () => {
    const manager = BrowserManager.getInstance({
      headless: true,
      isolated: true,
    });
    let createdHandler: any = null;
    const browser = {
      connected: true,
      pages: async () => [{ id: 'a' }],
      on: (event: string, handler: unknown) => {
        if (event === 'targetcreated') {
          createdHandler = handler;
        }
      },
      close: async () => {},
    };
    (manager as any).browser = browser;

    let injectCount = 0;
    (StealthScripts2025 as any).injectAll = async () => {
      injectCount += 1;
    };

    await manager.injectStealth('windows-chrome');
    assert.strictEqual(injectCount, 1);

    await manager.injectStealth();
    assert.strictEqual(injectCount, 1);

    await createdHandler({
      type: () => 'page',
      page: async () => ({ id: 'new-page' }),
    });
    assert.strictEqual(injectCount, 2);
  });
});
