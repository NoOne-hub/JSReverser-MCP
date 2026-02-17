/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {logger} from './logger.js';
import type {
  Browser,
  ChromeReleaseChannel,
  LaunchOptions,
  Target,
  Page,
} from './third_party/index.js';
import {puppeteer} from './third_party/index.js';
import puppeteerExtra from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import {StealthScripts2025, type StealthPreset, type StealthInjectionOptions} from './modules/stealth/index.js';

let browser: Browser | undefined;
let browserManager: BrowserManager | undefined;

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
    remoteDebuggingUrl: options.browserURL || options.wsEndpoint,
    wsHeaders: options.wsHeaders,
    devtools: options.devtools,
  };

  const manager = BrowserManager.getInstance(config);
  return manager.ensureBrowser();
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
      'chrome-devtools-mcp',
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
  private stealthInjected: boolean = false;
  private crashCheckInterval?: NodeJS.Timeout;
  private isRestarting: boolean = false;

  private constructor(config: BrowserManagerConfig) {
    this.config = {
      headless: false,
      isolated: false,
      useStealthScripts: false,
      devtools: false,
      ...config,
    };
  }

  /**
   * Get the singleton instance of BrowserManager
   */
  static getInstance(config?: BrowserManagerConfig): BrowserManager {
    if (!browserManager) {
      if (!config) {
        throw new Error('BrowserManager must be initialized with config on first call');
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
    if (this.config.remoteDebuggingUrl) {
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
      logger('Connecting to remote browser at:', this.config.remoteDebuggingUrl);
      
      const connectOptions: Parameters<typeof puppeteer.connect>[0] = {
        browserURL: this.config.remoteDebuggingUrl,
        targetFilter: makeTargetFilter(),
        defaultViewport: null,
      };

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
      throw new Error(`Failed to connect to remote browser: ${(error as Error).message}`, {
        cause: error,
      });
    }
  }

  /**
   * Launch a new browser instance
   */
  private async launchBrowser(): Promise<Browser> {
    const {channel, executablePath, headless, isolated, useStealthScripts} = this.config;
    
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
        'chrome-devtools-mcp',
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

      this.browser = await puppeteerInstance.launch({
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

      logger('Browser launched successfully');

      // Set up crash detection
      this.setupCrashDetection();

      // Set viewport if configured
      if (this.config.viewport) {
        const [page] = await this.browser.pages();
        if (page) {
          // @ts-expect-error internal API for now.
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

      return this.browser;
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
        this.handleBrowserCrash();
      }
    });

    // Periodically check if browser is still connected
    this.crashCheckInterval = setInterval(() => {
      if (this.browser && !this.browser.connected && !this.isRestarting) {
        logger('Browser connection lost, attempting restart');
        this.handleBrowserCrash();
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
  async injectStealth(preset?: StealthPreset, options?: StealthInjectionOptions): Promise<void> {
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
      this.browser.on('targetcreated', async (target) => {
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
      throw new Error(`Failed to inject stealth scripts: ${(error as Error).message}`, {
        cause: error,
      });
    }
  }

  /**
   * Get available stealth presets
   */
  getStealthPresets(): Array<{ name: StealthPreset; userAgent: string; platform: string }> {
    return StealthScripts2025.getPresets();
  }

  /**
   * Get list of available stealth features
   */
  getStealthFeatures(): string[] {
    return [
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
