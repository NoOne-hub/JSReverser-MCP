/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import puppeteerExtra from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';

import {logger} from './logger.js';
import {
  StealthScripts2025,
  type StealthPreset,
  type StealthInjectionOptions,
} from './modules/stealth/index.js';
import type {
  Browser,
  ChromeReleaseChannel,
  LaunchOptions,
  Page,
  Target,
} from './third_party/index.js';
import {puppeteer} from './third_party/index.js';

let browserManager: BrowserManager | undefined;

/**
 * 获取主浏览器管理器单例（未初始化返回 undefined——CLI 命令等不启动浏览器的
 * 场景调用方需自行判空）。2026-09-02 双栈合并：采集栈（CodeCollector）与主栈
 * 共用此单例，消除 --isolated 下第二浏览器实例（状态分裂根因）。
 */
export function getBrowserManager(): BrowserManager | undefined {
  return browserManager;
}

function makeTargetFilter() {
  const ignoredPrefixes = new Set([
    'chrome://',
    'chrome-extension://',
    'chrome-untrusted://',
  ]);

  return function targetFilter(target: Target): boolean {
    if (target.url() === 'chrome://newtab/') {
      return true;
    }
    for (const prefix of ignoredPrefixes) {
      if (target.url().startsWith(prefix)) {
        return false;
      }
    }
    return true;
  };
}

export async function ensureBrowserConnected(options: {
  browserURL?: string;
  wsEndpoint?: string;
  wsHeaders?: Record<string, string>;
  devtools: boolean;
}) {
  // Use BrowserManager for connection management
  const config: BrowserManagerConfig = {
    browserURL: options.browserURL,
    wsEndpoint: options.wsEndpoint,
    wsHeaders: options.wsHeaders,
    devtools: options.devtools,
  };

  const manager = BrowserManager.getInstance(config);
  return manager.ensureBrowser();
}

export async function resolveAutoConnectTarget(options?: {
  candidates?: string[];
  fetchImpl?: typeof fetch;
}): Promise<{browserURL: string; wsEndpoint?: string} | undefined> {
  const candidates = options?.candidates ?? [
    'http://127.0.0.1:9222',
    'http://127.0.0.1:9223',
    'http://127.0.0.1:9224',
    'http://127.0.0.1:9225',
  ];
  const fetchImpl = options?.fetchImpl ?? fetch;

  for (const candidate of candidates) {
    try {
      const response = await fetchImpl(`${candidate}/json/version`);
      if (!response.ok) {
        continue;
      }
      const payload = (await response.json()) as {
        webSocketDebuggerUrl?: string;
      };
      return {
        browserURL: candidate,
        wsEndpoint: payload.webSocketDebuggerUrl,
      };
    } catch {
      // Keep probing the next candidate.
    }
  }

  return undefined;
}

interface McpLaunchOptions {
  acceptInsecureCerts?: boolean;
  executablePath?: string;
  channel?: Channel;
  userDataDir?: string;
  headless: boolean;
  isolated: boolean;
  logFile?: fs.WriteStream;
  viewport?: {
    width: number;
    height: number;
  };
  args?: string[];
  devtools: boolean;
}

export async function launch(options: McpLaunchOptions): Promise<Browser> {
  const {channel, executablePath, headless, isolated} = options;
  const profileDirName =
    channel && channel !== 'stable'
      ? `chrome-profile-${channel}`
      : 'chrome-profile';

  let userDataDir = options.userDataDir;
  if (!isolated && !userDataDir) {
    userDataDir = path.join(
      os.homedir(),
      '.cache',
      'jsreverser-mcp',
      profileDirName,
    );
    await fs.promises.mkdir(userDataDir, {
      recursive: true,
    });
  }

  const args: LaunchOptions['args'] = [
    ...(options.args ?? []),
    '--hide-crash-restore-bubble',
  ];
  if (headless) {
    args.push('--screen-info={3840x2160}');
  }
  let puppeteerChannel: ChromeReleaseChannel | undefined;
  if (options.devtools) {
    args.push('--auto-open-devtools-for-tabs');
  }
  if (!executablePath) {
    puppeteerChannel =
      channel && channel !== 'stable'
        ? (`chrome-${channel}` as ChromeReleaseChannel)
        : 'chrome';
  }

  try {
    const browser = await puppeteer.launch({
      channel: puppeteerChannel,
      targetFilter: makeTargetFilter(),
      executablePath,
      defaultViewport: null,
      userDataDir,
      pipe: true,
      headless,
      args,
      acceptInsecureCerts: options.acceptInsecureCerts,
      handleDevToolsAsPage: true,
    });
    if (options.logFile) {
      // FIXME: we are probably subscribing too late to catch startup logs. We
      // should expose the process earlier or expose the getRecentLogs() getter.
      browser.process()?.stderr?.pipe(options.logFile);
      browser.process()?.stdout?.pipe(options.logFile);
    }
    if (options.viewport) {
      const [page] = await browser.pages();
      // @ts-expect-error internal API for now.
      await page?.resize({
        contentWidth: options.viewport.width,
        contentHeight: options.viewport.height,
      });
    }
    return browser;
  } catch (error) {
    if (
      userDataDir &&
      (error as Error).message.includes('The browser is already running')
    ) {
      throw new Error(
        `The browser is already running for ${userDataDir}. Use --isolated to run multiple browser instances.`,
        {
          cause: error,
        },
      );
    }
    throw error;
  }
}

export async function ensureBrowserLaunched(
  options: McpLaunchOptions,
): Promise<Browser> {
  // Use BrowserManager for browser management
  const config: BrowserManagerConfig = {
    headless: options.headless,
    executablePath: options.executablePath,
    channel: options.channel,
    isolated: options.isolated,
    userDataDir: options.userDataDir,
    acceptInsecureCerts: options.acceptInsecureCerts,
    viewport: options.viewport,
    args: options.args,
    devtools: options.devtools,
  };

  const manager = BrowserManager.getInstance(config);
  return manager.ensureBrowser();
}

export type Channel = 'stable' | 'canary' | 'beta' | 'dev';

/**
 * Configuration options for BrowserManager
 */
export interface BrowserManagerConfig {
  headless?: boolean;
  executablePath?: string;
  channel?: Channel;
  isolated?: boolean;
  browserURL?: string;
  wsEndpoint?: string;
  remoteDebuggingUrl?: string;
  wsHeaders?: Record<string, string>;
  useStealthScripts?: boolean;
  acceptInsecureCerts?: boolean;
  userDataDir?: string;
  viewport?: {
    width: number;
    height: number;
  };
  args?: string[];
  devtools?: boolean;
}

/**
 * Singleton BrowserManager class that manages a single browser instance
 * with support for stealth injection, crash detection, and auto-restart.
 */
export class BrowserManager {
  private browser?: Browser;
  private config: BrowserManagerConfig;
  private stealthInjected = false;
  private crashCheckInterval?: NodeJS.Timeout;
  private isRestarting = false;
  private currentPage: Page | null = null;
  private sessionData: {
    cookies?: any[];
    localStorage?: Record<string, string>;
    sessionStorage?: Record<string, string>;
  } = {};

  private constructor(config: BrowserManagerConfig) {
    const remoteDebuggingUrl = config.remoteDebuggingUrl;
    this.config = {
      headless: false,
      isolated: false,
      useStealthScripts: false,
      devtools: false,
      browserURL:
        config.browserURL ??
        (remoteDebuggingUrl?.startsWith('http')
          ? remoteDebuggingUrl
          : undefined),
      wsEndpoint:
        config.wsEndpoint ??
        (remoteDebuggingUrl?.startsWith('ws') ? remoteDebuggingUrl : undefined),
      ...config,
    };
  }

  /**
   * Get the singleton instance of BrowserManager
   */
  static getInstance(config?: BrowserManagerConfig): BrowserManager {
    if (!browserManager) {
      if (!config) {
        throw new Error(
          'BrowserManager must be initialized with config on first call',
        );
      }
      browserManager = new BrowserManager(config);
    }
    return browserManager;
  }

  /**
   * Reset the singleton instance (useful for testing)
   */
  static resetInstance(): void {
    if (browserManager) {
      browserManager.close().catch(err => {
        logger('Error closing browser during reset:', err);
      });
      browserManager = undefined;
    }
  }

  /**
   * Ensure browser is connected and running
   */
  async ensureBrowser(): Promise<Browser> {
    if (this.browser?.connected) {
      return this.browser;
    }

    // If we have a remote debugging URL, connect to existing browser
    if (
      this.config.browserURL ||
      this.config.wsEndpoint ||
      this.config.remoteDebuggingUrl
    ) {
      return this.connectToRemoteBrowser();
    }

    // Otherwise launch a new browser
    return this.launchBrowser();
  }

  /**
   * Get the current browser instance
   */
  async getBrowser(): Promise<Browser> {
    return this.ensureBrowser();
  }

  /**
   * Connect to a remote browser instance via debugging port
   */
  private async connectToRemoteBrowser(): Promise<Browser> {
    try {
      logger(
        'Connecting to remote browser at:',
        this.config.wsEndpoint ??
          this.config.browserURL ??
          this.config.remoteDebuggingUrl,
      );

      const connectOptions: Parameters<typeof puppeteer.connect>[0] = {
        targetFilter: makeTargetFilter(),
        defaultViewport: null,
      };

      if (this.config.wsEndpoint) {
        connectOptions.browserWSEndpoint = this.config.wsEndpoint;
      } else {
        connectOptions.browserURL =
          this.config.browserURL ?? this.config.remoteDebuggingUrl;
      }

      // Add headers if provided
      if (this.config.wsHeaders) {
        connectOptions.headers = this.config.wsHeaders;
      }

      this.browser = await puppeteer.connect(connectOptions);
      logger('Connected to remote browser');

      // Set up crash detection
      this.setupCrashDetection();

      // Inject stealth if configured
      if (this.config.useStealthScripts) {
        await this.injectStealth();
      }

      return this.browser;
    } catch (error) {
      throw new Error(
        `Failed to connect to remote browser: ${(error as Error).message}`,
        {
          cause: error,
        },
      );
    }
  }

  /**
   * Launch a new browser instance
   */
  private async launchBrowser(): Promise<Browser> {
    const {channel, executablePath, headless, isolated, useStealthScripts} =
      this.config;

    // Use puppeteer-extra with stealth plugin if stealth is enabled
    const puppeteerInstance = useStealthScripts
      ? puppeteerExtra.use(StealthPlugin())
      : puppeteer;

    const profileDirName =
      channel && channel !== 'stable'
        ? `chrome-profile-${channel}`
        : 'chrome-profile';

    let userDataDir = this.config.userDataDir;
    if (!isolated && !userDataDir) {
      userDataDir = path.join(
        os.homedir(),
        '.cache',
        'jsreverser-mcp',
        profileDirName,
      );
      await fs.promises.mkdir(userDataDir, {
        recursive: true,
      });
    }

    const args: LaunchOptions['args'] = [
      ...(this.config.args ?? []),
      '--hide-crash-restore-bubble',
    ];

    if (headless) {
      args.push('--screen-info={3840x2160}');
    }

    let puppeteerChannel: ChromeReleaseChannel | undefined;
    if (this.config.devtools) {
      args.push('--auto-open-devtools-for-tabs');
    }

    if (!executablePath) {
      puppeteerChannel =
        channel && channel !== 'stable'
          ? (`chrome-${channel}` as ChromeReleaseChannel)
          : 'chrome';
    }

    try {
      logger('Launching browser with config:', {
        channel: puppeteerChannel,
        executablePath,
        headless,
        isolated,
        useStealthScripts,
      });

      const launchedBrowser = await puppeteerInstance.launch({
        channel: puppeteerChannel,
        targetFilter: makeTargetFilter(),
        executablePath,
        defaultViewport: null,
        userDataDir,
        pipe: true,
        headless,
        args,
        acceptInsecureCerts: this.config.acceptInsecureCerts,
        handleDevToolsAsPage: true,
      });
      this.browser = launchedBrowser;

      logger('Browser launched successfully');

      // Set up crash detection
      this.setupCrashDetection();

      // Set viewport if configured
      if (this.config.viewport) {
        const [page] = await launchedBrowser.pages();
        if (page) {
          await page.resize({
            contentWidth: this.config.viewport.width,
            contentHeight: this.config.viewport.height,
          });
        }
      }

      // Mark stealth as injected if using puppeteer-extra
      if (useStealthScripts) {
        this.stealthInjected = true;
      }

      return launchedBrowser;
    } catch (error) {
      if (
        userDataDir &&
        (error as Error).message.includes('The browser is already running')
      ) {
        throw new Error(
          `The browser is already running for ${userDataDir}. Use --isolated to run multiple browser instances.`,
          {
            cause: error,
          },
        );
      }
      throw new Error(`Failed to launch browser: ${(error as Error).message}`, {
        cause: error,
      });
    }
  }

  /**
   * Set up crash detection and auto-restart
   */
  private setupCrashDetection(): void {
    if (!this.browser) return;

    // Clear any existing interval
    if (this.crashCheckInterval) {
      clearInterval(this.crashCheckInterval);
    }

    // Listen for disconnect events
    this.browser.on('disconnected', () => {
      logger('Browser disconnected');
      if (!this.isRestarting) {
        void this.handleBrowserCrash();
      }
    });

    // Periodically check if browser is still connected
    this.crashCheckInterval = setInterval(() => {
      if (this.browser && !this.browser.connected && !this.isRestarting) {
        logger('Browser connection lost, attempting restart');
        void this.handleBrowserCrash();
      }
    }, 5000); // Check every 5 seconds
  }

  /**
   * Handle browser crash by attempting to restart
   */
  private async handleBrowserCrash(): Promise<void> {
    if (this.isRestarting) return;

    this.isRestarting = true;
    logger('Attempting to restart browser after crash');

    try {
      // Clean up old browser instance
      if (this.browser) {
        try {
          await this.browser.close();
        } catch (err) {
          // Ignore errors when closing crashed browser
          logger('Error closing crashed browser:', err);
        }
        this.browser = undefined;
      }

      // Wait a bit before restarting
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Restart browser
      await this.ensureBrowser();
      logger('Browser restarted successfully');
    } catch (error) {
      logger('Failed to restart browser:', error);
    } finally {
      this.isRestarting = false;
    }
  }

  /**
   * Inject stealth scripts into all pages using advanced StealthScripts2025
   * @param preset - Platform preset (windows-chrome, mac-chrome, etc.)
   * @param options - Custom stealth options to override preset
   */
  async injectStealth(
    preset?: StealthPreset,
    options?: StealthInjectionOptions,
  ): Promise<void> {
    if (!this.browser) {
      throw new Error('Browser not initialized');
    }

    if (this.stealthInjected) {
      logger('Stealth scripts already injected');
      return;
    }

    try {
      const stealthOptions: StealthInjectionOptions = {
        preset: preset ?? 'windows-chrome',
        ...options,
      };

      const pages = await this.browser.pages();
      for (const page of pages) {
        await StealthScripts2025.injectAll(page, stealthOptions);
      }

      // Listen for new pages and inject stealth
      this.browser.on('targetcreated', async target => {
        if (target.type() === 'page') {
          const page = await target.page();
          if (page) {
            await StealthScripts2025.injectAll(page, stealthOptions);
          }
        }
      });

      this.stealthInjected = true;
      logger('Advanced stealth scripts injected successfully');
    } catch (error) {
      throw new Error(
        `Failed to inject stealth scripts: ${(error as Error).message}`,
        {
          cause: error,
        },
      );
    }
  }

  /**
   * Get available stealth presets
   */
  getStealthPresets(): Array<{
    name: StealthPreset;
    userAgent: string;
    platform: string;
  }> {
    return StealthScripts2025.getPresets();
  }

  /**
   * Get list of available stealth features
   */
  getStealthFeatures(): string[] {    return [
      'hideWebDriver',
      'mockChrome',
      'setUserAgent',
      'fixPermissions',
      'mockPlugins',
      'canvasNoise',
      'webglOverride',
      'audioContextNoise',
      'fixLanguages',
      'mockBattery',
      'mockMediaDevices',
      'mockNotifications',
      'mockConnection',
      'focusOverride',
      'performanceNoise',
      'overrideScreen',
    ];
  }

  /**
   * 同步获取当前连接中的浏览器实例（不触发启动；采集栈 getStatus 等只读探测用）。
   */
  getConnectedBrowser(): Browser | undefined {
    return this.browser;
  }

  getCurrentPage(): Page | null {
    return this.currentPage;
  }

  setCurrentPage(page: Page | null): void {
    this.currentPage = page;
  }

  /**
   * 创建新页面（含反检测注入与会话恢复）——原 BrowserModeManager.newPage 能力并入主栈
   * （2026-09-02 双栈合并：采集栈与主栈共用同一浏览器实例，消除 --isolated 下
   * 第二浏览器导致的状态分裂）。stealth 注入由 injectStealth 的 targetcreated
   * 监听统一覆盖新页，这里只做基础反检测 + 会话恢复。
   */
  async newPage(): Promise<Page> {
    if (!this.browser) {
      await this.ensureBrowser();
    }

    const page = await this.browser!.newPage();
    this.currentPage = page;
    page.on('close', () => {
      if (this.currentPage === page) {
        this.currentPage = null;
      }
    });

    await page.setCacheEnabled(true);
    await page.setBypassCSP(true);
    await page.setJavaScriptEnabled(true);

    if (this.sessionData.cookies?.length) {
      await page.setCookie(...this.sessionData.cookies);
    }

    await this.injectAntiDetectionScripts(page);
    return page;
  }

  private async injectAntiDetectionScripts(page: Page): Promise<void> {
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, 'webdriver', {get: () => undefined});

      (window as any).chrome = {
        runtime: {
          connect: () => undefined,
          sendMessage: () => undefined,
          onMessage: {
            addListener: () => undefined,
            removeListener: () => undefined,
          },
        },
      };

      Object.defineProperty(navigator, 'plugins', {
        get: () => [
          {
            0: {
              type: 'application/pdf',
              suffixes: 'pdf',
              description: 'Portable Document Format',
            },
            description: 'Portable Document Format',
            filename: 'internal-pdf-viewer',
            length: 1,
            name: 'Chrome PDF Plugin',
          },
        ],
      });

      const originalQuery = window.navigator.permissions.query;
      window.navigator.permissions.query = (parameters: any) =>
        parameters.name === 'notifications'
          ? Promise.resolve({
              state: (Notification as any).permission,
            } as PermissionStatus)
          : originalQuery(parameters);

      Object.defineProperty(navigator, 'languages', {
        get: () => ['zh-CN', 'zh', 'en-US', 'en'],
      });
    });
  }

  /**
   * Check if browser is connected
   */
  isConnected(): boolean {
    return this.browser?.connected ?? false;
  }

  /**
   * Restart the browser
   */
  async restart(): Promise<void> {
    logger('Manually restarting browser');
    await this.close();
    await this.ensureBrowser();
  }

  /**
   * Close the browser and clean up resources
   */
  async close(): Promise<void> {
    // Clear crash detection interval
    if (this.crashCheckInterval) {
      clearInterval(this.crashCheckInterval);
      this.crashCheckInterval = undefined;
    }

    // Close browser
    if (this.browser) {
      try {
        await this.browser.close();
        logger('Browser closed successfully');
      } catch (error) {
        logger('Error closing browser:', error);
      }
      this.browser = undefined;
    }

    this.stealthInjected = false;
  }
}
