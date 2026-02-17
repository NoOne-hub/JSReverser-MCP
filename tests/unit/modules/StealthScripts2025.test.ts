import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { StealthScripts2025 } from '../../../src/modules/stealth/StealthScripts2025.js';

describe('StealthScripts2025', () => {
  let originals: Record<string, any>;

  beforeEach(() => {
    originals = {
      hideWebDriver: (StealthScripts2025 as any).hideWebDriver,
      mockChrome: (StealthScripts2025 as any).mockChrome,
      setUserAgentConsistent: (StealthScripts2025 as any).setUserAgentConsistent,
      fixPermissions: (StealthScripts2025 as any).fixPermissions,
      mockPlugins: (StealthScripts2025 as any).mockPlugins,
      mockCanvas: (StealthScripts2025 as any).mockCanvas,
      mockWebGL: (StealthScripts2025 as any).mockWebGL,
      mockAudioContext: (StealthScripts2025 as any).mockAudioContext,
      fixLanguages: (StealthScripts2025 as any).fixLanguages,
      mockBattery: (StealthScripts2025 as any).mockBattery,
      fixMediaDevices: (StealthScripts2025 as any).fixMediaDevices,
      mockNotifications: (StealthScripts2025 as any).mockNotifications,
      mockConnection: (StealthScripts2025 as any).mockConnection,
      mockFocus: (StealthScripts2025 as any).mockFocus,
      mockPerformanceNow: (StealthScripts2025 as any).mockPerformanceNow,
      mockScreen: (StealthScripts2025 as any).mockScreen,
    };
  });

  afterEach(() => {
    Object.assign(StealthScripts2025 as any, originals);
  });

  it('returns presets, resolves options and tracks current options', async () => {
    const presets = StealthScripts2025.getPresets();
    assert.ok(presets.length > 0);
    assert.ok(presets.some((p) => p.name === 'windows-chrome'));

    const resolved = StealthScripts2025.resolveOptions({
      preset: 'linux-chrome',
      languages: ['en-US'],
    });
    assert.strictEqual(resolved.navigatorPlatform, 'Linux x86_64');
    assert.deepStrictEqual(resolved.languages, ['en-US']);

    const page = {
      setUserAgent: async () => {},
      evaluateOnNewDocument: async () => {},
    };
    await StealthScripts2025.injectAll(page as any, {
      preset: 'mac-chrome',
      mockConnection: false,
      performanceNoise: false,
      overrideScreen: false,
    });
    const current = StealthScripts2025.getCurrentOptions();
    assert.strictEqual(current?.preset, 'mac-chrome');
  });

  it('injectAll honors enabled/skipped/error feature paths', async () => {
    const called: string[] = [];
    (StealthScripts2025 as any).hideWebDriver = async () => called.push('hideWebDriver');
    (StealthScripts2025 as any).mockChrome = async () => called.push('mockChrome');
    (StealthScripts2025 as any).setUserAgentConsistent = async () => called.push('setUserAgent');
    (StealthScripts2025 as any).fixPermissions = async () => {
      throw new Error('perm fail');
    };
    (StealthScripts2025 as any).mockPlugins = async () => called.push('mockPlugins');
    (StealthScripts2025 as any).mockCanvas = async () => called.push('mockCanvas');
    (StealthScripts2025 as any).mockWebGL = async () => called.push('mockWebGL');
    (StealthScripts2025 as any).mockAudioContext = async () => called.push('mockAudioContext');
    (StealthScripts2025 as any).fixLanguages = async () => called.push('fixLanguages');
    (StealthScripts2025 as any).mockBattery = async () => called.push('mockBattery');
    (StealthScripts2025 as any).fixMediaDevices = async () => called.push('mockMediaDevices');
    (StealthScripts2025 as any).mockNotifications = async () => called.push('mockNotifications');
    (StealthScripts2025 as any).mockConnection = async () => called.push('mockConnection');
    (StealthScripts2025 as any).mockFocus = async () => called.push('focusOverride');
    (StealthScripts2025 as any).mockPerformanceNow = async () => called.push('performanceNoise');
    (StealthScripts2025 as any).mockScreen = async () => called.push('overrideScreen');

    const page = {
      setUserAgent: async () => {},
      evaluateOnNewDocument: async () => {},
    };

    const report = await StealthScripts2025.injectAll(page as any, {
      preset: 'windows-chrome',
      mockConnection: false,
      performanceNoise: false,
      overrideScreen: false,
    });

    assert.ok(called.includes('setUserAgent'));
    assert.ok(report.injectedFeatures.includes('hideWebDriver'));
    assert.ok(report.skippedFeatures.includes('mockConnection'));
    assert.ok(report.skippedFeatures.includes('performanceNoise'));
    assert.ok(report.skippedFeatures.includes('overrideScreen'));
    assert.ok(report.skippedFeatures.some((s) => s.includes('fixPermissions')));
  });

  it('covers direct helper invocations and compatibility helper', async () => {
    const page = {
      setUserAgent: async () => {},
      evaluateOnNewDocument: async () => {},
    };

    await StealthScripts2025.hideWebDriver(page as any);
    await StealthScripts2025.mockChrome(page as any);
    await StealthScripts2025.setUserAgentConsistent(page as any, {
      userAgent: 'UA',
      navigatorPlatform: 'Win32',
      vendor: 'Google Inc.',
    });
    await StealthScripts2025.fixPermissions(page as any);
    await StealthScripts2025.mockPlugins(page as any, {});
    await StealthScripts2025.mockCanvas(page as any);
    await StealthScripts2025.mockWebGL(page as any, {});
    await StealthScripts2025.mockAudioContext(page as any);
    await StealthScripts2025.fixLanguages(page as any, {});
    await StealthScripts2025.mockBattery(page as any, {});
    await StealthScripts2025.fixMediaDevices(page as any, {});
    await StealthScripts2025.mockNotifications(page as any);
    await StealthScripts2025.mockConnection(page as any, {});
    await StealthScripts2025.mockFocus(page as any);
    await StealthScripts2025.mockPerformanceNow(page as any);
    await StealthScripts2025.mockScreen(page as any, {
      screen: { width: 1280, height: 720 },
    });

    await StealthScripts2025.setRealisticUserAgent(page as any, 'linux');
  });

  it('executes injected callbacks against mocked browser globals', async () => {
    const backup = {
      navigator: (globalThis as any).navigator,
      window: (globalThis as any).window,
      document: (globalThis as any).document,
      Document: (globalThis as any).Document,
      Notification: (globalThis as any).Notification,
      screen: (globalThis as any).screen,
      performance: (globalThis as any).performance,
    };

    class DocMock {}
    const nav: any = {
      permissions: { query: async (_p: any) => ({ state: 'granted' }) },
      mediaDevices: { enumerateDevices: async () => [] },
    };
    const doc: any = new DocMock();
    doc.hasFocus = () => false;

    const setGlobal = (key: string, value: unknown) => {
      Object.defineProperty(globalThis, key, {
        value,
        configurable: true,
        writable: true,
      });
    };

    setGlobal('navigator', nav);
    setGlobal('window', { navigator: nav });
    setGlobal('document', doc);
    setGlobal('Document', DocMock);
    setGlobal('Notification', {
      permission: 'denied',
      requestPermission: async () => 'denied',
    });
    setGlobal('screen', {});
    setGlobal('performance', { now: () => 1 });

    try {
      const page = {
        setUserAgent: async () => {},
        evaluateOnNewDocument: async (fn: (...args: any[]) => unknown, ...args: any[]) => {
          fn(...args);
        },
      };

      await StealthScripts2025.setUserAgentConsistent(page as any, {
        userAgent: 'UA-1',
        navigatorPlatform: 'Win32',
        vendor: 'Google Inc.',
        hardwareConcurrency: 16,
      });
      await StealthScripts2025.fixLanguages(page as any, { languages: ['zh-CN', 'en'] });
      await StealthScripts2025.mockNotifications(page as any);
      await StealthScripts2025.mockConnection(page as any, {
        connection: { effectiveType: '4g', downlink: 10, rtt: 50, saveData: false },
      });
      await StealthScripts2025.mockFocus(page as any);
      await StealthScripts2025.mockPerformanceNow(page as any);
      await StealthScripts2025.mockScreen(page as any, {
        screen: { width: 1200, height: 800 },
      });

      assert.strictEqual((globalThis as any).navigator.userAgent, 'UA-1');
      assert.deepStrictEqual((globalThis as any).navigator.languages, ['zh-CN', 'en']);
      assert.strictEqual((globalThis as any).Notification.permission, 'default');
      assert.strictEqual(typeof (globalThis as any).navigator.connection, 'object');
      assert.strictEqual((globalThis as any).document.hidden, false);
      assert.ok((globalThis as any).performance.now() >= 1);
      assert.strictEqual((globalThis as any).screen.width, 1200);
    } finally {
      setGlobal('navigator', backup.navigator);
      setGlobal('window', backup.window);
      setGlobal('document', backup.document);
      setGlobal('Document', backup.Document);
      setGlobal('Notification', backup.Notification);
      setGlobal('screen', backup.screen);
      setGlobal('performance', backup.performance);
    }
  });

  it('executes canvas/webgl/audio callback patches on mocked constructors', async () => {
    const backup = {
      HTMLCanvasElement: (globalThis as any).HTMLCanvasElement,
      CanvasRenderingContext2D: (globalThis as any).CanvasRenderingContext2D,
      WebGLRenderingContext: (globalThis as any).WebGLRenderingContext,
      WebGL2RenderingContext: (globalThis as any).WebGL2RenderingContext,
      AudioBuffer: (globalThis as any).AudioBuffer,
      OfflineAudioContext: (globalThis as any).OfflineAudioContext,
      navigator: (globalThis as any).navigator,
      window: (globalThis as any).window,
      document: (globalThis as any).document,
      Document: (globalThis as any).Document,
      Notification: (globalThis as any).Notification,
      screen: (globalThis as any).screen,
      performance: (globalThis as any).performance,
    };
    const setGlobal = (key: string, value: unknown) => {
      Object.defineProperty(globalThis, key, {
        value,
        configurable: true,
        writable: true,
      });
    };

    class CanvasCtxMock {
      getImageData() {
        return { data: new Uint8ClampedArray([10, 10, 10, 255]) };
      }
      putImageData() {}
    }
    class CanvasMock {
      width = 1;
      height = 1;
      getContext() {
        return new CanvasCtxMock() as any;
      }
      toDataURL() {
        return 'data:orig';
      }
      toBlob(cb?: (b: any) => void) {
        cb?.(null);
      }
    }
    class WebGL1Mock {
      getParameter(param: number) {
        return `orig-${param}`;
      }
    }
    class WebGL2Mock {
      getParameter(param: number) {
        return `orig2-${param}`;
      }
    }
    class AudioBufferMock {
      private arr = new Float32Array([0.1, 0.2]);
      copyFromChannel(dest: Float32Array) {
        dest[0] = this.arr[0]!;
      }
      getChannelData() {
        return this.arr;
      }
    }
    class DocMock {}
    const nav: any = {
      permissions: { query: async (_p: any) => ({ state: 'granted' }) },
      mediaDevices: { enumerateDevices: async () => [] },
    };

    setGlobal('HTMLCanvasElement', CanvasMock);
    setGlobal('CanvasRenderingContext2D', CanvasCtxMock);
    setGlobal('WebGLRenderingContext', WebGL1Mock);
    setGlobal('WebGL2RenderingContext', WebGL2Mock);
    setGlobal('AudioBuffer', AudioBufferMock);
    setGlobal('OfflineAudioContext', function OfflineAudioContext() {});
    setGlobal('navigator', nav);
    setGlobal('window', { navigator: nav });
    setGlobal('document', new DocMock());
    setGlobal('Document', DocMock);
    setGlobal('Notification', { permission: 'default', requestPermission: async () => 'default' });
    setGlobal('screen', {});
    setGlobal('performance', { now: () => 1, timing: {
      responseStart: 1,
      domContentLoadedEventEnd: 2,
      loadEventEnd: 3,
      navigationStart: 0,
    } });

    try {
      const page = {
        evaluateOnNewDocument: async (fn: (...args: any[]) => unknown, ...args: any[]) => {
          fn(...args);
        },
      };

      await StealthScripts2025.mockCanvas(page as any);
      await StealthScripts2025.mockWebGL(page as any, {
        webglVendor: 'VENDOR-X',
        webglRenderer: 'RENDERER-Y',
      });
      await StealthScripts2025.mockAudioContext(page as any);

      const canvas = new (globalThis as any).HTMLCanvasElement();
      assert.strictEqual(canvas.toDataURL().startsWith('data:'), true);

      const gl1 = new (globalThis as any).WebGLRenderingContext();
      const gl2 = new (globalThis as any).WebGL2RenderingContext();
      assert.strictEqual(gl1.getParameter(0x9245), 'VENDOR-X');
      assert.strictEqual(gl1.getParameter(0x9246), 'RENDERER-Y');
      assert.strictEqual(gl2.getParameter(0x9245), 'VENDOR-X');
      assert.strictEqual(gl2.getParameter(0x9246), 'RENDERER-Y');

      const audio = new (globalThis as any).AudioBuffer();
      const dest = new Float32Array(1);
      audio.copyFromChannel(dest, 0, 0);
      assert.notStrictEqual(dest[0], 0);
      const channel = audio.getChannelData(0);
      assert.ok(channel[0] !== undefined);
    } finally {
      setGlobal('HTMLCanvasElement', backup.HTMLCanvasElement);
      setGlobal('CanvasRenderingContext2D', backup.CanvasRenderingContext2D);
      setGlobal('WebGLRenderingContext', backup.WebGLRenderingContext);
      setGlobal('WebGL2RenderingContext', backup.WebGL2RenderingContext);
      setGlobal('AudioBuffer', backup.AudioBuffer);
      setGlobal('OfflineAudioContext', backup.OfflineAudioContext);
      setGlobal('navigator', backup.navigator);
      setGlobal('window', backup.window);
      setGlobal('document', backup.document);
      setGlobal('Document', backup.Document);
      setGlobal('Notification', backup.Notification);
      setGlobal('screen', backup.screen);
      setGlobal('performance', backup.performance);
    }
  });

  it('executes hideWebDriver/mockChrome/permissions/plugins/media/battery branches', async () => {
    const backup = {
      navigator: (globalThis as any).navigator,
      window: (globalThis as any).window,
      Notification: (globalThis as any).Notification,
      performance: (globalThis as any).performance,
      WebGLRenderingContext: (globalThis as any).WebGLRenderingContext,
      WebGL2RenderingContext: (globalThis as any).WebGL2RenderingContext,
    };
    const setGlobal = (key: string, value: unknown) => {
      Object.defineProperty(globalThis, key, {
        value,
        configurable: true,
        writable: true,
      });
    };

    const nav: any = {
      permissions: { query: async (_p: any) => ({ state: 'granted' }) },
      mediaDevices: { enumerateDevices: async () => [] },
    };
    setGlobal('navigator', nav);
    setGlobal('window', { navigator: nav });
    setGlobal('Notification', {
      permission: 'granted',
      requestPermission: async () => 'granted',
    });
    setGlobal('performance', {
      timing: {
        responseStart: 1,
        domContentLoadedEventEnd: 2,
        loadEventEnd: 3,
        navigationStart: 0,
      },
    });
    class WebGL1Mock {
      getParameter(param: number) {
        return `orig-${param}`;
      }
    }
    // 覆盖分支：WebGL2 不存在
    setGlobal('WebGLRenderingContext', WebGL1Mock);
    setGlobal('WebGL2RenderingContext', undefined);

    try {
      const page = {
        setUserAgent: async () => {},
        evaluateOnNewDocument: async (fn: (...args: any[]) => unknown, ...args: any[]) => {
          fn(...args);
        },
      };

      await StealthScripts2025.hideWebDriver(page as any);
      await StealthScripts2025.mockChrome(page as any);
      await StealthScripts2025.fixPermissions(page as any);
      await StealthScripts2025.mockPlugins(page as any, {
        plugins: [
          {
            name: 'P1',
            filename: 'p1',
            description: 'p1',
            mimeTypes: [{ type: 'application/p1', description: 'd', suffixes: 'p1' }],
          },
        ],
      });
      await StealthScripts2025.mockBattery(page as any, { battery: { charging: false, level: 0.5 } });
      await StealthScripts2025.fixMediaDevices(page as any, {
        mediaDevices: { audioInputs: 2, videoInputs: 1, speakers: 1 },
      });
      await StealthScripts2025.mockWebGL(page as any, {
        webglVendor: 'Vendor-Only',
        webglRenderer: 'Renderer-Only',
      });

      // hideWebDriver
      assert.strictEqual((globalThis as any).navigator.webdriver, undefined);
      assert.strictEqual(Object.getOwnPropertyNames((globalThis as any).navigator).includes('webdriver'), false);
      assert.strictEqual(Object.prototype.hasOwnProperty.call(Object.getOwnPropertyDescriptors((globalThis as any).navigator), 'webdriver'), false);

      // mockChrome
      const chromeObj = (globalThis as any).window.chrome;
      assert.ok(chromeObj.runtime);
      assert.strictEqual(chromeObj.runtime.onMessage.hasListeners(), false);
      assert.ok(chromeObj.loadTimes());
      assert.ok(chromeObj.csi());

      // fixPermissions
      const perm = await (globalThis as any).navigator.permissions.query({ name: 'notifications' });
      assert.strictEqual(perm.state, 'granted');

      // mockPlugins
      const plugins = (globalThis as any).navigator.plugins;
      assert.strictEqual(plugins.length, 1);
      assert.ok(plugins.item(0));
      assert.ok(plugins.namedItem('P1'));

      // mockBattery
      const battery = await (globalThis as any).navigator.getBattery();
      assert.strictEqual(battery.charging, false);
      assert.strictEqual(typeof battery.level, 'number');

      // fixMediaDevices
      const devices = await (globalThis as any).navigator.mediaDevices.enumerateDevices();
      assert.strictEqual(devices.length, 4);
      assert.strictEqual(devices[0]?.kind, 'audioinput');

      // mockWebGL with no WebGL2
      const gl1 = new (globalThis as any).WebGLRenderingContext();
      assert.strictEqual(gl1.getParameter(0x9245), 'Vendor-Only');
      assert.strictEqual(gl1.getParameter(0x9246), 'Renderer-Only');
    } finally {
      setGlobal('navigator', backup.navigator);
      setGlobal('window', backup.window);
      setGlobal('Notification', backup.Notification);
      setGlobal('performance', backup.performance);
      setGlobal('WebGLRenderingContext', backup.WebGLRenderingContext);
      setGlobal('WebGL2RenderingContext', backup.WebGL2RenderingContext);
    }
  });
});
