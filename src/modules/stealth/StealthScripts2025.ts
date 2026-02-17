/**
 * StealthScripts2025 - 2024-2026 最新反检测脚本注入
 *
 * 基于 puppeteer-extra-plugin-stealth / undetected-chromedriver / playwright-stealth 最佳实践
 * 覆盖所有主流浏览器指纹检测维度
 */

import type { Page } from 'puppeteer';
import { logger } from '../../logger.js';

// ==================== 类型定义 ====================

/** 插件配置 */
export interface PluginConfig {
  name: string;
  filename: string;
  description: string;
  mimeTypes: Array<{ type: string; description: string; suffixes?: string }>;
}

/** 平台预设名称 */
export type StealthPreset =
  | 'windows-chrome'
  | 'mac-chrome'
  | 'mac-safari'
  | 'linux-chrome'
  | 'windows-edge';

/** 屏幕分辨率配置 */
export interface ScreenConfig {
  width: number;
  height: number;
  availWidth?: number;
  availHeight?: number;
  colorDepth?: number;
  pixelDepth?: number;
}

/** 网络连接信息 */
export interface ConnectionConfig {
  effectiveType: string; // '4g' | '3g' | '2g' | 'slow-2g'
  downlink: number;
  rtt: number;
  saveData: boolean;
}

/** Stealth 完整选项 */
export interface StealthInjectionOptions {
  /** 平台预设 - 自动配置全部一致性参数 */
  preset?: StealthPreset;

  // === Navigator ===
  userAgent?: string;
  languages?: string[];
  navigatorPlatform?: string; // navigator.platform
  hardwareConcurrency?: number;
  deviceMemory?: number;
  maxTouchPoints?: number;
  vendor?: string; // navigator.vendor

  // === Plugins ===
  plugins?: PluginConfig[];

  // === WebGL ===
  webglVendor?: string;
  webglRenderer?: string;

  // === Screen ===
  screen?: ScreenConfig;

  // === Battery ===
  battery?: { charging: boolean; level: number };

  // === Media Devices ===
  mediaDevices?: { audioInputs?: number; videoInputs?: number; speakers?: number };

  // === Network ===
  connection?: ConnectionConfig;

  // === Timezone ===
  timezone?: string;

  // === 功能开关（默认全部开启） ===
  hideWebDriver?: boolean;       // 隐藏 webdriver 属性 (default: true)
  mockChrome?: boolean;          // 模拟 chrome 对象 (default: true)
  fixPermissions?: boolean;      // 修复 Permissions API (default: true)
  canvasNoise?: boolean;         // Canvas 指纹噪声 (default: true)
  webglOverride?: boolean;       // WebGL 厂商/渲染器覆盖 (default: true)
  audioContextNoise?: boolean;   // AudioContext 指纹噪声 (default: true)
  performanceNoise?: boolean;    // performance.now() 微量噪声 (default: false - 可能影响调试)
  mockBatteryAPI?: boolean;      // 模拟 Battery API (default: true)
  mockMediaDevicesAPI?: boolean; // 模拟 MediaDevices (default: true)
  mockNotificationAPI?: boolean; // 模拟 Notification (default: true)
  overrideScreen?: boolean;      // 覆盖 screen 属性 (default: false)
  mockConnection?: boolean;      // 模拟 NetworkInformation (default: true)
  focusOverride?: boolean;       // document.hasFocus() 覆盖 (default: true)
}

/** 注入后的状态报告 */
export interface StealthReport {
  preset: string;
  injectedFeatures: string[];
  skippedFeatures: string[];
  userAgent: string;
  platform: string;
}

// ==================== 平台预设 ====================

/** Chrome 131 (2025-2026) 系列 UA */
const PRESETS: Record<StealthPreset, Omit<StealthInjectionOptions, 'preset'>> = {
  'windows-chrome': {
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    navigatorPlatform: 'Win32',
    vendor: 'Google Inc.',
    languages: ['zh-CN', 'zh', 'en-US', 'en'],
    hardwareConcurrency: 12,
    deviceMemory: 8,
    maxTouchPoints: 0,
    webglVendor: 'Google Inc. (NVIDIA)',
    webglRenderer:
      'ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0, D3D11)',
    screen: { width: 1920, height: 1080, colorDepth: 24, pixelDepth: 24 },
    connection: { effectiveType: '4g', downlink: 10, rtt: 50, saveData: false },
  },
  'mac-chrome': {
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    navigatorPlatform: 'MacIntel',
    vendor: 'Google Inc.',
    languages: ['zh-CN', 'zh', 'en-US', 'en'],
    hardwareConcurrency: 10,
    deviceMemory: 8,
    maxTouchPoints: 0,
    webglVendor: 'Google Inc. (Apple)',
    webglRenderer:
      'ANGLE (Apple, Apple M1 Pro, OpenGL 4.1)',
    screen: { width: 1920, height: 1080, colorDepth: 30, pixelDepth: 30 },
    connection: { effectiveType: '4g', downlink: 10, rtt: 50, saveData: false },
  },
  'mac-safari': {
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.2 Safari/605.1.15',
    navigatorPlatform: 'MacIntel',
    vendor: 'Apple Computer, Inc.',
    languages: ['zh-CN', 'zh', 'en-US', 'en'],
    hardwareConcurrency: 10,
    deviceMemory: undefined, // Safari 不暴露此属性
    maxTouchPoints: 0,
    webglVendor: 'Apple Inc.',
    webglRenderer: 'Apple GPU',
    screen: { width: 1920, height: 1080, colorDepth: 30, pixelDepth: 30 },
    connection: undefined, // Safari 不暴露 NetworkInformation
  },
  'linux-chrome': {
    userAgent:
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    navigatorPlatform: 'Linux x86_64',
    vendor: 'Google Inc.',
    languages: ['en-US', 'en'],
    hardwareConcurrency: 8,
    deviceMemory: 8,
    maxTouchPoints: 0,
    webglVendor: 'Google Inc. (Mesa)',
    webglRenderer:
      'ANGLE (Mesa, llvmpipe (LLVM 15.0.7 256 bits), OpenGL 4.5)',
    screen: { width: 1920, height: 1080, colorDepth: 24, pixelDepth: 24 },
    connection: { effectiveType: '4g', downlink: 10, rtt: 50, saveData: false },
  },
  'windows-edge': {
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0',
    navigatorPlatform: 'Win32',
    vendor: 'Google Inc.',
    languages: ['zh-CN', 'zh', 'en-US', 'en'],
    hardwareConcurrency: 12,
    deviceMemory: 8,
    maxTouchPoints: 0,
    webglVendor: 'Google Inc. (NVIDIA)',
    webglRenderer:
      'ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0, D3D11)',
    screen: { width: 1920, height: 1080, colorDepth: 24, pixelDepth: 24 },
    connection: { effectiveType: '4g', downlink: 10, rtt: 50, saveData: false },
  },
};

// ==================== 默认插件 ====================

const DEFAULT_PLUGINS: PluginConfig[] = [
  {
    name: 'PDF Viewer',
    filename: 'internal-pdf-viewer',
    description: 'Portable Document Format',
    mimeTypes: [
      { type: 'application/pdf', description: 'Portable Document Format', suffixes: 'pdf' },
    ],
  },
  {
    name: 'Chrome PDF Viewer',
    filename: 'internal-pdf-viewer',
    description: 'Portable Document Format',
    mimeTypes: [
      { type: 'application/pdf', description: 'Portable Document Format', suffixes: 'pdf' },
    ],
  },
  {
    name: 'Chromium PDF Viewer',
    filename: 'internal-pdf-viewer',
    description: 'Portable Document Format',
    mimeTypes: [
      { type: 'application/pdf', description: 'Portable Document Format', suffixes: 'pdf' },
    ],
  },
  {
    name: 'Microsoft Edge PDF Viewer',
    filename: 'internal-pdf-viewer',
    description: 'Portable Document Format',
    mimeTypes: [
      { type: 'application/pdf', description: 'Portable Document Format', suffixes: 'pdf' },
    ],
  },
  {
    name: 'WebKit built-in PDF',
    filename: 'internal-pdf-viewer',
    description: 'Portable Document Format',
    mimeTypes: [
      { type: 'application/pdf', description: 'Portable Document Format', suffixes: 'pdf' },
    ],
  },
];

// ==================== 核心类 ====================

export class StealthScripts2025 {
  /** 当前生效的配置 */
  private static currentOptions: StealthInjectionOptions | null = null;

  /** 获取可用预设列表 */
  static getPresets(): Array<{ name: StealthPreset; userAgent: string; platform: string }> {
    return (Object.entries(PRESETS) as Array<[StealthPreset, Omit<StealthInjectionOptions, 'preset'>]>).map(
      ([name, config]) => ({
        name,
        userAgent: config.userAgent ?? '',
        platform: config.navigatorPlatform ?? '',
      }),
    );
  }

  /** 获取当前注入的选项 */
  static getCurrentOptions(): StealthInjectionOptions | null {
    return this.currentOptions;
  }

  /** 解析选项：合并预设 + 用户覆盖 */
  static resolveOptions(options: StealthInjectionOptions = {}): Required<
    Pick<StealthInjectionOptions, 'userAgent' | 'navigatorPlatform' | 'languages'>
  > & StealthInjectionOptions {
    const preset = options.preset ?? 'windows-chrome';
    const base = PRESETS[preset] ?? PRESETS['windows-chrome'];

    return {
      ...base,
      ...options,
      // 保持预设中的值，除非用户显式覆盖
      userAgent: options.userAgent ?? base.userAgent ?? '',
      navigatorPlatform: options.navigatorPlatform ?? base.navigatorPlatform ?? 'Win32',
      languages: options.languages ?? base.languages ?? ['en-US', 'en'],
    };
  }

  // ==================== 主入口 ====================

  /**
   * 注入全部反检测脚本
   * @returns 注入报告
   */
  static async injectAll(page: Page, options: StealthInjectionOptions = {}): Promise<StealthReport> {
    const resolved = this.resolveOptions(options);
    this.currentOptions = resolved;

    logger(`🛡️ Injecting stealth scripts (preset: ${options.preset ?? 'windows-chrome'})`);

    const injected: string[] = [];
    const skipped: string[] = [];

    const featureMap: Array<{
      name: string;
      enabled: boolean;
      inject: () => Promise<void>;
    }> = [
      {
        name: 'hideWebDriver',
        enabled: resolved.hideWebDriver !== false,
        inject: () => this.hideWebDriver(page),
      },
      {
        name: 'mockChrome',
        enabled: resolved.mockChrome !== false,
        inject: () => this.mockChrome(page),
      },
      {
        name: 'setUserAgent',
        enabled: true,
        inject: () => this.setUserAgentConsistent(page, resolved),
      },
      {
        name: 'fixPermissions',
        enabled: resolved.fixPermissions !== false,
        inject: () => this.fixPermissions(page),
      },
      {
        name: 'mockPlugins',
        enabled: true,
        inject: () => this.mockPlugins(page, resolved),
      },
      {
        name: 'canvasNoise',
        enabled: resolved.canvasNoise !== false,
        inject: () => this.mockCanvas(page),
      },
      {
        name: 'webglOverride',
        enabled: resolved.webglOverride !== false,
        inject: () => this.mockWebGL(page, resolved),
      },
      {
        name: 'audioContextNoise',
        enabled: resolved.audioContextNoise !== false,
        inject: () => this.mockAudioContext(page),
      },
      {
        name: 'fixLanguages',
        enabled: true,
        inject: () => this.fixLanguages(page, resolved),
      },
      {
        name: 'mockBattery',
        enabled: resolved.mockBatteryAPI !== false,
        inject: () => this.mockBattery(page, resolved),
      },
      {
        name: 'mockMediaDevices',
        enabled: resolved.mockMediaDevicesAPI !== false,
        inject: () => this.fixMediaDevices(page, resolved),
      },
      {
        name: 'mockNotifications',
        enabled: resolved.mockNotificationAPI !== false,
        inject: () => this.mockNotifications(page),
      },
      {
        name: 'mockConnection',
        enabled: resolved.mockConnection !== false && !!resolved.connection,
        inject: () => this.mockConnection(page, resolved),
      },
      {
        name: 'focusOverride',
        enabled: resolved.focusOverride !== false,
        inject: () => this.mockFocus(page),
      },
      {
        name: 'performanceNoise',
        enabled: resolved.performanceNoise === true, // 默认关闭
        inject: () => this.mockPerformanceNow(page),
      },
      {
        name: 'overrideScreen',
        enabled: resolved.overrideScreen === true && !!resolved.screen,
        inject: () => this.mockScreen(page, resolved),
      },
    ];

    // 并行注入
    const tasks = featureMap.map(async (feature) => {
      if (feature.enabled) {
        try {
          await feature.inject();
          injected.push(feature.name);
        } catch (error) {
          logger(`⚠️ Stealth feature ${feature.name} failed:`, error);
          skipped.push(`${feature.name} (error)`);
        }
      } else {
        skipped.push(feature.name);
      }
    });

    await Promise.all(tasks);

    logger(`✅ Stealth injected: ${injected.length} features, ${skipped.length} skipped`);

    return {
      preset: options.preset ?? 'windows-chrome',
      injectedFeatures: injected,
      skippedFeatures: skipped,
      userAgent: resolved.userAgent!,
      platform: resolved.navigatorPlatform!,
    };
  }

  // ==================== 各注入模块 ====================

  /** 1. 隐藏 webdriver 属性 */
  static async hideWebDriver(page: Page): Promise<void> {
    await page.evaluateOnNewDocument(() => {
      // 删除 webdriver 属性
      Object.defineProperty(navigator, 'webdriver', {
        get: () => undefined,
        configurable: true,
      });

      // 从 Object.getOwnPropertyNames 中隐藏
      const _getOwnPropertyNames = Object.getOwnPropertyNames;
      Object.getOwnPropertyNames = function (obj: unknown) {
        const props = _getOwnPropertyNames(obj);
        if (obj === navigator || obj === Object.getPrototypeOf(navigator)) {
          return props.filter((p) => p !== 'webdriver');
        }
        return props;
      };

      // 从 Object.getOwnPropertyDescriptors 中隐藏
      const _getOwnPropertyDescriptors = Object.getOwnPropertyDescriptors;
      (Object as any).getOwnPropertyDescriptors = function (obj: unknown) {
        const descs = _getOwnPropertyDescriptors(obj as any);
        if (obj === navigator || obj === Object.getPrototypeOf(navigator)) {
          delete (descs as Record<string, unknown>).webdriver;
        }
        return descs;
      };
    });
  }

  /** 2. 模拟 chrome 对象 */
  static async mockChrome(page: Page): Promise<void> {
    await page.evaluateOnNewDocument(() => {
      /* eslint-disable @typescript-eslint/no-explicit-any */
      const w = window as any;
      if (!w.chrome) {
        w.chrome = {};
      }
      w.chrome.runtime = {
        connect: () => {},
        sendMessage: () => {},
        onMessage: {
          addListener: () => {},
          removeListener: () => {},
          hasListener: () => false,
          hasListeners: () => false,
        },
        id: undefined,
        PlatformOs: { MAC: 'mac', WIN: 'win', ANDROID: 'android', CROS: 'cros', LINUX: 'linux' },
      };
      w.chrome.loadTimes = () => ({
        commitLoadTime: performance.timing.responseStart / 1000,
        connectionInfo: 'http/1.1',
        finishDocumentLoadTime: performance.timing.domContentLoadedEventEnd / 1000,
        finishLoadTime: performance.timing.loadEventEnd / 1000,
        firstPaintAfterLoadTime: 0,
        firstPaintTime: performance.timing.domContentLoadedEventEnd / 1000,
        navigationType: 'Other',
        npnNegotiatedProtocol: 'unknown',
        requestTime: performance.timing.navigationStart / 1000,
        startLoadTime: performance.timing.navigationStart / 1000,
        wasAlternateProtocolAvailable: false,
        wasFetchedViaSpdy: false,
        wasNpnNegotiated: false,
      });
      w.chrome.csi = () => ({
        onloadT: performance.timing.domContentLoadedEventEnd,
        pageT: Date.now() - performance.timing.navigationStart,
        startE: performance.timing.navigationStart,
        tran: 15,
      });
      w.chrome.app = {
        isInstalled: false,
        InstallState: { INSTALLED: 'installed', NOT_INSTALLED: 'not_installed', DISABLED: 'disabled' },
        RunningState: { RUNNING: 'running', CANNOT_RUN: 'cannot_run', READY_TO_RUN: 'ready_to_run' },
      };
      /* eslint-enable */
    });
  }

  /** 3. 设置 UA + navigator 属性一致性 */
  static async setUserAgentConsistent(page: Page, options: StealthInjectionOptions): Promise<void> {
    const ua = options.userAgent ?? '';
    const platform = options.navigatorPlatform ?? 'Win32';
    const vendor = options.vendor ?? 'Google Inc.';
    const concurrency = options.hardwareConcurrency ?? 8;
    const memory = options.deviceMemory;
    const touchPoints = options.maxTouchPoints ?? 0;

    await page.setUserAgent(ua);

    await page.evaluateOnNewDocument(
      (uaStr: string, plat: string, vend: string, cores: number, mem: number | null, touch: number) => {
        Object.defineProperty(navigator, 'userAgent', { get: () => uaStr });
        Object.defineProperty(navigator, 'platform', { get: () => plat });
        Object.defineProperty(navigator, 'vendor', { get: () => vend });
        Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => cores });
        Object.defineProperty(navigator, 'maxTouchPoints', { get: () => touch });

        // appVersion 与 UA 一致
        Object.defineProperty(navigator, 'appVersion', {
          get: () => uaStr.replace('Mozilla/', ''),
        });

        // deviceMemory 可能某些浏览器不暴露
        if (mem !== undefined && mem !== null) {
          Object.defineProperty(navigator, 'deviceMemory', { get: () => mem });
        }
      },
      ua, platform, vendor, concurrency, memory ?? null, touchPoints,
    );
  }

  /** 4. 修复 Permissions API */
  static async fixPermissions(page: Page): Promise<void> {
    await page.evaluateOnNewDocument(() => {
      const originalQuery = window.navigator.permissions.query;
      window.navigator.permissions.query = function (
        parameters: PermissionDescriptor,
      ): Promise<PermissionStatus> {
        if (parameters?.name === 'notifications') {
          return Promise.resolve({
            state: Notification.permission,
            onchange: null,
            addEventListener: () => {},
            removeEventListener: () => {},
            dispatchEvent: () => true,
          } as unknown as PermissionStatus);
        }
        return originalQuery.call(this, parameters);
      };
    });
  }

  /** 5. 模拟 Plugins */
  static async mockPlugins(page: Page, options: StealthInjectionOptions): Promise<void> {
    const plugins = options.plugins && options.plugins.length > 0 ? options.plugins : DEFAULT_PLUGINS;

    await page.evaluateOnNewDocument((pluginPayload: PluginConfig[]) => {
      /* eslint-disable @typescript-eslint/no-explicit-any */
      Object.defineProperty(navigator, 'plugins', {
        get: () => {
          const list: any[] = pluginPayload.map((p: any) => {
            const entry: Record<string, any> = {
              description: p.description,
              filename: p.filename,
              length: p.mimeTypes.length,
              name: p.name,
              item: (idx: number) => entry[idx] ?? null,
              namedItem: (name: string) => (entry.name === name ? entry : null),
              [Symbol.iterator]: function* () { for (let i = 0; i < p.mimeTypes.length; i++) yield entry[i]; },
            };
            p.mimeTypes.forEach((mime: any, idx: number) => {
              entry[idx] = {
                type: mime.type,
                suffixes: mime.suffixes || '',
                description: mime.description || '',
                enabledPlugin: entry,
              };
            });
            return entry;
          });
          (list as any).item = (idx: number) => list[idx] ?? null;
          (list as any).namedItem = (name: string) => list.find((p) => p.name === name) ?? null;
          (list as any).refresh = () => {};
          return list;
        },
      });
      /* eslint-enable */
    }, plugins);
  }

  /** 6. Canvas 指纹噪声（每个会话随机种子） */
  static async mockCanvas(page: Page): Promise<void> {
    await page.evaluateOnNewDocument(() => {
      // 生成会话级随机种子
      const seed = Math.floor(Math.random() * 256);

      const _toDataURL = HTMLCanvasElement.prototype.toDataURL;
      const _toBlob = HTMLCanvasElement.prototype.toBlob;
      const _getImageData = CanvasRenderingContext2D.prototype.getImageData;

      // 简单确定性噪声函数（基于像素索引 + 种子）
      const noise = (idx: number) => ((idx * 1103515245 + seed) >>> 16) & 3; // 0-3

      const addNoise = (imageData: ImageData): ImageData => {
        const d = imageData.data;
        for (let i = 0; i < d.length; i += 4) {
          const n = noise(i);
          d[i] = Math.min(255, Math.max(0, d[i]! + n - 1));
          d[i + 1] = Math.min(255, Math.max(0, d[i + 1]! + n - 1));
          d[i + 2] = Math.min(255, Math.max(0, d[i + 2]! + n - 1));
        }
        return imageData;
      };

      HTMLCanvasElement.prototype.toDataURL = function (...args) {
        const ctx = this.getContext('2d');
        if (ctx) {
          try {
            const imgData = _getImageData.call(ctx, 0, 0, this.width, this.height);
            addNoise(imgData);
            ctx.putImageData(imgData, 0, 0);
          } catch { /* cross-origin */ }
        }
        return _toDataURL.apply(this, args);
      };

      HTMLCanvasElement.prototype.toBlob = function (callback, ...rest) {
        const ctx = this.getContext('2d');
        if (ctx) {
          try {
            const imgData = _getImageData.call(ctx, 0, 0, this.width, this.height);
            addNoise(imgData);
            ctx.putImageData(imgData, 0, 0);
          } catch { /* cross-origin */ }
        }
        return _toBlob.call(this, callback, ...rest);
      };

      CanvasRenderingContext2D.prototype.getImageData = function (...args) {
        const imgData = _getImageData.apply(this, args);
        return addNoise(imgData);
      };
    });
  }

  /** 7. WebGL 厂商/渲染器覆盖（同时覆盖 WebGL2） */
  static async mockWebGL(page: Page, options: StealthInjectionOptions): Promise<void> {
    const vendor = options.webglVendor ?? 'Intel Inc.';
    const renderer = options.webglRenderer ?? 'Intel(R) UHD Graphics 770';

    await page.evaluateOnNewDocument(
      (v: string, r: string) => {
        const VENDOR_PARAM = 0x9245; // UNMASKED_VENDOR_WEBGL
        const RENDERER_PARAM = 0x9246; // UNMASKED_RENDERER_WEBGL

        // WebGLRenderingContext
        const _getParam1 = WebGLRenderingContext.prototype.getParameter;
        WebGLRenderingContext.prototype.getParameter = function (param) {
          if (param === VENDOR_PARAM) return v;
          if (param === RENDERER_PARAM) return r;
          return _getParam1.call(this, param);
        };

        // WebGL2RenderingContext
        if (typeof WebGL2RenderingContext !== 'undefined') {
          const _getParam2 = WebGL2RenderingContext.prototype.getParameter;
          WebGL2RenderingContext.prototype.getParameter = function (param) {
            if (param === VENDOR_PARAM) return v;
            if (param === RENDERER_PARAM) return r;
            return _getParam2.call(this, param);
          };
        }
      },
      vendor,
      renderer,
    );
  }

  /** 8. AudioContext 指纹噪声 */
  static async mockAudioContext(page: Page): Promise<void> {
    await page.evaluateOnNewDocument(() => {
      const noiseSeed = Math.random() * 0.0001;

      if (typeof OfflineAudioContext !== 'undefined') {
        const _copyFromChannel = AudioBuffer.prototype.copyFromChannel;
        AudioBuffer.prototype.copyFromChannel = function (dest, channelNumber, startInChannel) {
          _copyFromChannel.call(this, dest, channelNumber, startInChannel);
          for (let i = 0; i < dest.length; i++) {
            dest[i] = dest[i]! + noiseSeed;
          }
        };

        const _getChannelData = AudioBuffer.prototype.getChannelData;
        AudioBuffer.prototype.getChannelData = function (channel) {
          const data = _getChannelData.call(this, channel);
          for (let i = 0; i < data.length; i++) {
            data[i] = data[i]! + noiseSeed;
          }
          return data;
        };
      }
    });
  }

  /** 9. Navigator languages */
  static async fixLanguages(page: Page, options: StealthInjectionOptions): Promise<void> {
    const languages = options.languages && options.languages.length > 0
      ? options.languages
      : ['en-US', 'en'];

    await page.evaluateOnNewDocument((langs: string[]) => {
      Object.defineProperty(navigator, 'languages', { get: () => Object.freeze([...langs]) });
      Object.defineProperty(navigator, 'language', { get: () => langs[0] });
    }, languages);
  }

  /** 10. Battery API */
  static async mockBattery(page: Page, options: StealthInjectionOptions): Promise<void> {
    const battery = options.battery ?? { charging: true, level: 0.87 + Math.random() * 0.12 };

    await page.evaluateOnNewDocument(
      (charging: boolean, level: number) => {
        /* eslint-disable @typescript-eslint/no-explicit-any */
        (navigator as any).getBattery = () =>
          Promise.resolve({
            charging,
            chargingTime: charging ? 0 : Infinity,
            dischargingTime: charging ? Infinity : 12000 + Math.random() * 3600,
            level,
            onchargingchange: null,
            onchargingtimechange: null,
            ondischargingtimechange: null,
            onlevelchange: null,
            addEventListener: () => {},
            removeEventListener: () => {},
            dispatchEvent: () => true,
          });
        /* eslint-enable */
      },
      battery.charging,
      battery.level,
    );
  }

  /** 11. MediaDevices 模拟 */
  static async fixMediaDevices(page: Page, options: StealthInjectionOptions): Promise<void> {
    const counts = {
      audioInputs: options.mediaDevices?.audioInputs ?? 1,
      videoInputs: options.mediaDevices?.videoInputs ?? 1,
      speakers: options.mediaDevices?.speakers ?? 1,
    };

    await page.evaluateOnNewDocument((c: { audioInputs: number; videoInputs: number; speakers: number }) => {
      if (navigator.mediaDevices && typeof navigator.mediaDevices.enumerateDevices === 'function') {
        const _enumerate = navigator.mediaDevices.enumerateDevices.bind(navigator.mediaDevices);

        navigator.mediaDevices.enumerateDevices = async function () {
          const devices: MediaDeviceInfo[] = [];

          const makeDevice = (kind: MediaDeviceKind, idx: number): MediaDeviceInfo => ({
            deviceId: `${kind}-${idx}`,
            groupId: `group-${kind}-${idx}`,
            kind,
            label: '',
            toJSON() { return this; },
          });

          for (let i = 0; i < c.audioInputs; i++) devices.push(makeDevice('audioinput', i));
          for (let i = 0; i < c.videoInputs; i++) devices.push(makeDevice('videoinput', i));
          for (let i = 0; i < c.speakers; i++) devices.push(makeDevice('audiooutput', i));

          return devices.length > 0 ? devices : _enumerate();
        };
      }
    }, counts);
  }

  /** 12. Notification API */
  static async mockNotifications(page: Page): Promise<void> {
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(Notification, 'permission', { get: () => 'default' });
      Notification.requestPermission = (...args: unknown[]) => {
        if (typeof args[0] === 'function') {
          (args[0] as (p: NotificationPermission) => void)('default');
        }
        return Promise.resolve('default' as NotificationPermission);
      };
    });
  }

  /** 13. NetworkInformation API */
  static async mockConnection(page: Page, options: StealthInjectionOptions): Promise<void> {
    const conn = options.connection ?? { effectiveType: '4g', downlink: 10, rtt: 50, saveData: false };

    await page.evaluateOnNewDocument((c: ConnectionConfig) => {
      /* eslint-disable @typescript-eslint/no-explicit-any */
      if (!('connection' in navigator)) {
        Object.defineProperty(navigator, 'connection', {
          get: () => ({
            effectiveType: c.effectiveType,
            downlink: c.downlink,
            rtt: c.rtt,
            saveData: c.saveData,
            onchange: null,
            addEventListener: () => {},
            removeEventListener: () => {},
            dispatchEvent: () => true,
          }),
          configurable: true,
        });
      }
      /* eslint-enable */
    }, conn);
  }

  /** 14. document.hasFocus() 覆盖 */
  static async mockFocus(page: Page): Promise<void> {
    await page.evaluateOnNewDocument(() => {
      Document.prototype.hasFocus = function () { return true; };
      Object.defineProperty(document, 'visibilityState', { get: () => 'visible' });
      Object.defineProperty(document, 'hidden', { get: () => false });
    });
  }

  /** 15. performance.now() 微量噪声（默认关闭，开启可能影响调试精度） */
  static async mockPerformanceNow(page: Page): Promise<void> {
    await page.evaluateOnNewDocument(() => {
      const _now = performance.now.bind(performance);
      performance.now = function () {
        return _now() + Math.random() * 0.05;
      };
    });
  }

  /** 16. Screen 属性覆盖 */
  static async mockScreen(page: Page, options: StealthInjectionOptions): Promise<void> {
    const s = options.screen;
    if (!s) return;

    const screenData = {
      width: s.width,
      height: s.height,
      availWidth: s.availWidth ?? s.width,
      availHeight: s.availHeight ?? s.height - 40,
      colorDepth: s.colorDepth ?? 24,
      pixelDepth: s.pixelDepth ?? s.colorDepth ?? 24,
    };

    await page.evaluateOnNewDocument((sc: { width: number; height: number; availWidth: number; availHeight: number; colorDepth: number; pixelDepth: number }) => {
      for (const [key, value] of Object.entries(sc)) {
        Object.defineProperty(screen, key, { get: () => value, configurable: true });
      }
      Object.defineProperty(window, 'outerWidth', { get: () => sc.width });
      Object.defineProperty(window, 'outerHeight', { get: () => sc.height });
      Object.defineProperty(window, 'innerWidth', { get: () => sc.availWidth });
      Object.defineProperty(window, 'innerHeight', { get: () => sc.availHeight });
    }, screenData);
  }

  // ==================== 便捷方法 ====================

  /**
   * 快速设置 UA（确保 navigator 属性一致）
   * @deprecated 使用 injectAll 的 preset 参数代替
   */
  static async setRealisticUserAgent(
    page: Page,
    platform: 'windows' | 'mac' | 'linux' = 'windows',
  ): Promise<void> {
    const presetMap: Record<string, StealthPreset> = {
      windows: 'windows-chrome',
      mac: 'mac-chrome',
      linux: 'linux-chrome',
    };
    const resolved = this.resolveOptions({ preset: presetMap[platform] });
    await this.setUserAgentConsistent(page, resolved);
    logger(`🧬 User-Agent overridden for ${platform}`);
  }
}
