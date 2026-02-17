import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import puppeteer from 'puppeteer';
import fs from 'node:fs';
import { BrowserModeManager } from '../../../src/modules/browser/BrowserModeManager.js';
import { StealthScripts2025 } from '../../../src/modules/stealth/StealthScripts2025.js';

describe('BrowserModeManager extended', () => {
  let originalConnect: typeof puppeteer.connect;

  beforeEach(() => {
    originalConnect = puppeteer.connect;
  });

  afterEach(() => {
    puppeteer.connect = originalConnect;
    (BrowserModeManager as any).detectedBrowsersCache = null;
    (StealthScripts2025 as any).injectAll = originalInjectAll;
  });

  let originalInjectAll: typeof StealthScripts2025.injectAll;

  beforeEach(() => {
    originalInjectAll = StealthScripts2025.injectAll;
  });

  it('detects custom browser path when provided', () => {
    const manager = new BrowserModeManager({
      browserPath: process.cwd(),
      autoLaunch: false,
      useStealthScripts: false,
    });
    const list = (manager as any).detectAllBrowsers();
    assert.strictEqual(list.length, 1);
    assert.strictEqual(list[0]?.name, 'Custom Browser');
  });

  it('waitForBrowser succeeds when connect works and fails on timeout', async () => {
    const manager = new BrowserModeManager({
      autoLaunch: false,
      useStealthScripts: false,
    });

    puppeteer.connect = async () => ({ disconnect: () => {} } as any);
    await (manager as any).waitForBrowser(20);

    puppeteer.connect = async () => {
      throw new Error('down');
    };
    await assert.rejects(
      async () => {
        await (manager as any).waitForBrowser(30);
      },
      /Browser failed to start within timeout/,
    );
  });

  it('launch handles direct connect, autoLaunch fallback, and no-autoLaunch failure', async () => {
    const manager = new BrowserModeManager({
      autoLaunch: true,
      useStealthScripts: false,
    });

    // direct connect success
    const browser = { isConnected: () => true };
    puppeteer.connect = async () => browser as any;
    const direct = await manager.launch();
    assert.strictEqual(direct, browser as any);

    // force reconnect path
    (manager as any).browser = null;
    let callCount = 0;
    puppeteer.connect = async () => {
      callCount += 1;
      if (callCount === 1) {
        throw new Error('first failed');
      }
      return browser as any;
    };
    (manager as any).launchBrowserProcess = async () => {};
    const fallback = await manager.launch();
    assert.strictEqual(fallback, browser as any);

    // no autoLaunch -> throw
    const managerNoAuto = new BrowserModeManager({
      autoLaunch: false,
      useStealthScripts: false,
      remoteDebuggingPort: 9333,
    });
    puppeteer.connect = async () => {
      throw new Error('connect fail');
    };
    await assert.rejects(
      async () => {
        await managerNoAuto.launch();
      },
      /Failed to connect to browser/,
    );
  });

  it('injects anti-detection scripts and exposes getters', async () => {
    const manager = new BrowserModeManager({
      autoLaunch: false,
      useStealthScripts: false,
    });

    let injected = 0;
    const page = {
      evaluateOnNewDocument: async () => {
        injected += 1;
      },
    };
    await (manager as any).injectAntiDetectionScripts(page);
    assert.strictEqual(injected, 1);

    (manager as any).browser = { id: 'b' };
    (manager as any).currentPage = { id: 'p' };
    assert.ok(manager.getBrowser());
    assert.ok(manager.getCurrentPage());
  });

  it('returns cached detected browser list when available', () => {
    (BrowserModeManager as any).detectedBrowsersCache = [{ name: 'Cached', path: '/tmp/browser' }];
    const manager = new BrowserModeManager({
      autoLaunch: false,
      useStealthScripts: false,
    });

    const list = (manager as any).detectAllBrowsers();
    assert.deepStrictEqual(list, [{ name: 'Cached', path: '/tmp/browser' }]);
  });

  it('newPage triggers stealth injection when enabled', async () => {
    let injected = 0;
    (StealthScripts2025 as any).injectAll = async () => {
      injected += 1;
    };

    const manager = new BrowserModeManager({
      autoLaunch: false,
      useStealthScripts: true,
      stealthPreset: 'linux-chrome',
    });

    const page = {
      on: () => {},
      setCacheEnabled: async () => {},
      setBypassCSP: async () => {},
      setJavaScriptEnabled: async () => {},
      setCookie: async () => {},
      evaluateOnNewDocument: async () => {},
    };
    (manager as any).browser = {
      newPage: async () => page,
    };

    await manager.newPage();
    assert.strictEqual(injected, 1);
  });

  it('launchBrowserProcess covers empty and success paths', async () => {
    const manager = new BrowserModeManager({
      autoLaunch: true,
      useStealthScripts: false,
      remoteDebuggingPort: 9555,
      waitForBrowserTimeoutMs: 10,
      waitForBrowserPollMs: 1,
    });

    (manager as any).detectAllBrowsers = () => [];
    await assert.rejects(
      async () => {
        await (manager as any).launchBrowserProcess();
      },
      /Cannot find browser executable/,
    );

    (manager as any).detectAllBrowsers = () => [
      { name: 'Echo', path: '/bin/echo' },
      { name: 'Echo2', path: '/bin/echo' },
    ];
    (manager as any).waitForBrowser = async () => {};

    await (manager as any).launchBrowserProcess();
    assert.strictEqual((manager as any).autoLaunched, true);
    assert.ok((manager as any).browserProcess);
  });

  it('covers detectAllBrowsers default scan path and goto branches', async () => {
    const manager = new BrowserModeManager({
      autoLaunch: false,
      useStealthScripts: false,
    });

    const found = (manager as any).detectAllBrowsers();
    assert.ok(Array.isArray(found));

    await assert.rejects(
      async () => {
        await manager.goto('https://example.com');
      },
      /No page available/,
    );

    let navigated = 0;
    const page = {
      goto: async (url: string) => {
        navigated += Number(url.includes('example.com'));
      },
    };
    (manager as any).currentPage = page;
    const out = await manager.goto('https://example.com');
    assert.strictEqual(out, page as any);
    assert.strictEqual(navigated, 1);
  });

  it('covers launch autoLaunch failure branch with actionable message', async () => {
    const manager = new BrowserModeManager({
      autoLaunch: true,
      useStealthScripts: false,
      remoteDebuggingPort: 9444,
    });

    puppeteer.connect = async () => {
      throw new Error('connect failed');
    };
    (manager as any).launchBrowserProcess = async () => {
      throw new Error('spawn failed');
    };

    await assert.rejects(
      async () => {
        await manager.launch();
      },
      /Failed to connect and auto-launch browser/,
    );
  });

  it('covers newPage launch-on-demand and close handler cleanup', async () => {
    const manager = new BrowserModeManager({
      autoLaunch: false,
      useStealthScripts: false,
    }) as any;

    let closeHandler: (() => void) | undefined;
    const page = {
      on: (event: string, handler: () => void) => {
        if (event === 'close') {
          closeHandler = handler;
        }
      },
      setCacheEnabled: async () => {},
      setBypassCSP: async () => {},
      setJavaScriptEnabled: async () => {},
      setCookie: async () => {},
      evaluateOnNewDocument: async () => {},
    };

    manager.injectAntiDetectionScripts = async () => {};
    manager.launch = async () => {
      manager.browser = { newPage: async () => page };
      return manager.browser;
    };
    manager.sessionData = { cookies: [{ name: 'k', value: 'v' }] };

    const out = await manager.newPage();
    assert.strictEqual(out, page as any);
    assert.ok(closeHandler);

    closeHandler!();
    assert.strictEqual(manager.getCurrentPage(), null);
  });

  it('covers windows scanning branch and registerFound dedupe', () => {
    const originalPlatform = process.platform;
    const fakeWinPath = 'C:\\Google\\Chrome\\Application\\chrome.exe';

    // On POSIX, this is treated as a normal relative filename and can be created.
    fs.writeFileSync(fakeWinPath, 'x');
    Object.defineProperty(process, 'platform', { value: 'win32' });

    try {
      const manager = new BrowserModeManager({
        autoLaunch: false,
        useStealthScripts: false,
      });

      const list = (manager as any).detectAllBrowsers();
      assert.ok(list.some((b: any) => String(b.path).includes(fakeWinPath)));

      // cached branch still works after first detection
      const list2 = (manager as any).detectAllBrowsers();
      assert.ok(Array.isArray(list2));
    } finally {
      Object.defineProperty(process, 'platform', { value: originalPlatform });
      if (fs.existsSync(fakeWinPath)) {
        fs.unlinkSync(fakeWinPath);
      }
      (BrowserModeManager as any).detectedBrowsersCache = null;
    }
  });

  it('executes anti-detection callback and close cleanup branches', async () => {
    const backup = {
      navigator: (globalThis as any).navigator,
      window: (globalThis as any).window,
      Notification: (globalThis as any).Notification,
    };
    const setGlobal = (key: string, value: unknown) => {
      Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
    };

    const nav: any = { permissions: { query: (_p: any) => Promise.resolve({ state: 'granted' }) } };
    setGlobal('navigator', nav);
    setGlobal('window', { navigator: nav });
    setGlobal('Notification', { permission: 'default' });

    try {
      const manager = new BrowserModeManager({
        autoLaunch: false,
        useStealthScripts: false,
      });
      const page = {
        evaluateOnNewDocument: async (fn: () => void) => {
          fn();
        },
      };
      await (manager as any).injectAntiDetectionScripts(page);
      assert.strictEqual((globalThis as any).navigator.webdriver, undefined);

      const killer = {
        killed: false,
        kill: () => {
          killer.killed = true;
        },
      };
      (manager as any).browser = {
        disconnect: async () => {
          throw new Error('disconnect failed');
        },
      };
      (manager as any).browserProcess = killer;
      (manager as any).autoLaunched = true;

      await manager.close();
      assert.strictEqual((manager as any).browser, null);
      assert.strictEqual((manager as any).currentPage, null);
      assert.strictEqual((manager as any).autoLaunched, false);
      assert.strictEqual(killer.killed, true);
    } finally {
      setGlobal('navigator', backup.navigator);
      setGlobal('window', backup.window);
      setGlobal('Notification', backup.Notification);
    }
  });
});
