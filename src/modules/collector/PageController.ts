/**
 * 页面控制器 - 薄封装Puppeteer API
 * 
 * 设计原则:
 * - 不重复实现Puppeteer已有的功能
 * - 直接调用page.click(), page.type()等API
 * - 依赖CodeCollector获取Page实例
 * - 所有方法都是薄封装，不超过5行代码
 */

import type { CodeCollector } from './CodeCollector.js';
import { logger } from '../../utils/logger.js';
import fs from 'fs';
import path from 'path';

export interface NavigationOptions {
  waitUntil?: 'load' | 'domcontentloaded' | 'networkidle0' | 'networkidle2';
  timeout?: number;
}

export interface ClickOptions {
  button?: 'left' | 'right' | 'middle';
  clickCount?: number;
  delay?: number;
}

export interface TypeOptions {
  delay?: number;
}

export interface ScrollOptions {
  x?: number;
  y?: number;
}

export interface ReplayAction {
  action: 'navigate' | 'click' | 'type' | 'wait' | 'scroll' | 'pressKey' | 'evaluate';
  url?: string;
  selector?: string;
  text?: string;
  delay?: number;
  timeout?: number;
  x?: number;
  y?: number;
  key?: string;
  code?: string;
}

export interface ScreenshotOptions {
  path?: string;
  type?: 'png' | 'jpeg';
  quality?: number;
  fullPage?: boolean;
}

export class PageController {
  constructor(private collector: CodeCollector) {}

  /**
   * 导航到指定URL（薄封装page.goto）
   */
  async navigate(url: string, options?: NavigationOptions): Promise<{
    url: string;
    title: string;
    loadTime: number;
  }> {
    const page = await this.collector.getActivePage();
    const startTime = Date.now();

    await page.goto(url, {
      waitUntil: options?.waitUntil || 'networkidle2',
      timeout: options?.timeout || 30000,
    });

    const loadTime = Date.now() - startTime;
    const title = await page.title();
    const currentUrl = page.url();

    logger.info(`Navigated to: ${url}`);

    return {
      url: currentUrl,
      title,
      loadTime,
    };
  }

  /**
   * 重新加载页面（薄封装page.reload）
   */
  async reload(options?: NavigationOptions): Promise<void> {
    const page = await this.collector.getActivePage();
    await page.reload({
      waitUntil: options?.waitUntil || 'networkidle2',
      timeout: options?.timeout || 30000,
    });
    logger.info('Page reloaded');
  }

  /**
   * 后退（薄封装page.goBack）
   */
  async goBack(): Promise<void> {
    const page = await this.collector.getActivePage();
    await page.goBack();
    logger.info('Navigated back');
  }

  /**
   * 前进（薄封装page.goForward）
   */
  async goForward(): Promise<void> {
    const page = await this.collector.getActivePage();
    await page.goForward();
    logger.info('Navigated forward');
  }

  /**
   * 点击元素（薄封装page.click）
   */
  async click(selector: string, options?: ClickOptions): Promise<void> {
    const page = await this.collector.getActivePage();
    await page.click(selector, {
      button: options?.button || 'left',
      clickCount: options?.clickCount || 1,
      delay: options?.delay,
    });
    logger.info(`Clicked: ${selector}`);
  }

  /**
   * 输入文本（薄封装page.type）
   */
  async type(selector: string, text: string, options?: TypeOptions): Promise<void> {
    const page = await this.collector.getActivePage();
    await page.type(selector, text, {
      delay: options?.delay,
    });
    logger.info(`Typed into ${selector}: ${text.substring(0, 20)}...`);
  }

  /**
   * 选择下拉框选项（薄封装page.select）
   */
  async select(selector: string, ...values: string[]): Promise<void> {
    const page = await this.collector.getActivePage();
    await page.select(selector, ...values);
    logger.info(`Selected in ${selector}: ${values.join(', ')}`);
  }

  /**
   * 鼠标悬停（薄封装page.hover）
   */
  async hover(selector: string): Promise<void> {
    const page = await this.collector.getActivePage();
    await page.hover(selector);
    logger.info(`Hovered: ${selector}`);
  }

  /**
   * 滚动页面（薄封装page.evaluate）
   */
  async scroll(options: ScrollOptions): Promise<void> {
    const page = await this.collector.getActivePage();
    await page.evaluate((opts) => {
      window.scrollTo(opts.x || 0, opts.y || 0);
    }, options);
    logger.info(`Scrolled to: x=${options.x || 0}, y=${options.y || 0}`);
  }

  /**
   * 等待选择器出现并返回元素信息（增强版）
   */
  async waitForSelector(selector: string, timeout?: number): Promise<{
    success: boolean;
    element?: any;
    message: string;
  }> {
    try {
      const page = await this.collector.getActivePage();

      // 等待元素出现
      await page.waitForSelector(selector, {
        timeout: timeout || 30000,
      });

      // 获取元素信息
      const element = await page.evaluate((sel) => {
        const el = document.querySelector(sel);
        if (!el) return null;

        return {
          tagName: el.tagName.toLowerCase(),
          id: el.id || undefined,
          className: el.className || undefined,
          textContent: el.textContent?.trim().substring(0, 100) || undefined,
          attributes: Array.from(el.attributes).reduce((acc, attr) => {
            acc[attr.name] = attr.value;
            return acc;
          }, {} as Record<string, string>),
        };
      }, selector);

      logger.info(`Selector appeared: ${selector}`);

      return {
        success: true,
        element,
        message: `Selector appeared: ${selector}`,
      };
    } catch (error: any) {
      logger.error(`waitForSelector timeout for ${selector}:`, error);
      return {
        success: false,
        message: `Timeout waiting for selector: ${selector}`,
      };
    }
  }

  /**
   * 等待导航完成（薄封装page.waitForNavigation）
   */
  async waitForNavigation(timeout?: number): Promise<void> {
    const page = await this.collector.getActivePage();
    await page.waitForNavigation({
      waitUntil: 'networkidle2',
      timeout: timeout || 30000,
    });
    logger.info('Navigation completed');
  }

  /**
   * 执行JavaScript代码（薄封装page.evaluate）
   */
  async evaluate<T>(code: string): Promise<T> {
    const page = await this.collector.getActivePage();
    const result = await page.evaluate(code);
    logger.info('JavaScript executed');
    return result as T;
  }

  /**
   * 获取页面URL（薄封装page.url）
   */
  async getURL(): Promise<string> {
    const page = await this.collector.getActivePage();
    return page.url();
  }

  /**
   * 获取页面标题（薄封装page.title）
   */
  async getTitle(): Promise<string> {
    const page = await this.collector.getActivePage();
    return await page.title();
  }

  /**
   * 获取页面HTML内容（薄封装page.content）
   */
  async getContent(): Promise<string> {
    const page = await this.collector.getActivePage();
    return await page.content();
  }

  /**
   * 截图（薄封装page.screenshot）
   */
  async screenshot(options?: ScreenshotOptions): Promise<Buffer> {
    const page = await this.collector.getActivePage();

    // 🆕 自动创建截图目录
    if (options?.path) {
      const dir = path.dirname(options.path);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
        logger.debug(`Screenshot directory created: ${dir}`);
      }
    }

    const buffer = await page.screenshot({
      path: options?.path,
      type: options?.type || 'png',
      quality: options?.quality,
      fullPage: options?.fullPage || false,
    });
    logger.info(`Screenshot taken${options?.path ? `: ${options.path}` : ''}`);
    return buffer as Buffer;
  }

  /**
   * 🆕 获取页面性能指标
   */
  async getPerformanceMetrics(): Promise<any> {
    const page = await this.collector.getActivePage();

    const metrics = await page.evaluate(() => {
      const perf = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming;

      return {
        // 页面加载时间
        domContentLoaded: perf.domContentLoadedEventEnd - perf.domContentLoadedEventStart,
        loadComplete: perf.loadEventEnd - perf.loadEventStart,

        // 网络时间
        dns: perf.domainLookupEnd - perf.domainLookupStart,
        tcp: perf.connectEnd - perf.connectStart,
        request: perf.responseStart - perf.requestStart,
        response: perf.responseEnd - perf.responseStart,

        // 总时间
        total: perf.loadEventEnd - perf.fetchStart,

        // 资源统计
        resources: performance.getEntriesByType('resource').length,
      };
    });

    logger.info('Performance metrics retrieved');
    return metrics;
  }

  /**
   * 🆕 注入JavaScript代码到页面
   */
  async injectScript(scriptContent: string): Promise<void> {
    const page = await this.collector.getActivePage();

    await page.evaluate((script) => {
      const scriptElement = document.createElement('script');
      scriptElement.textContent = script;
      document.head.appendChild(scriptElement);
    }, scriptContent);

    logger.info('Script injected into page');
  }

  /**
   * 🆕 设置Cookie
   */
  async setCookies(cookies: Array<{
    name: string;
    value: string;
    domain?: string;
    path?: string;
    expires?: number;
    httpOnly?: boolean;
    secure?: boolean;
    sameSite?: 'Strict' | 'Lax' | 'None';
  }>): Promise<void> {
    const page = await this.collector.getActivePage();
    await page.setCookie(...cookies);
    logger.info(`Set ${cookies.length} cookies`);
  }

  /**
   * 🆕 获取Cookie
   */
  async getCookies(): Promise<any[]> {
    const page = await this.collector.getActivePage();
    const cookies = await page.cookies();
    logger.info(`Retrieved ${cookies.length} cookies`);
    return cookies;
  }

  /**
   * 🆕 清除Cookie
   */
  async clearCookies(): Promise<void> {
    const page = await this.collector.getActivePage();
    const cookies = await page.cookies();
    await page.deleteCookie(...cookies);
    logger.info('All cookies cleared');
  }

  /**
   * 🆕 设置视口大小
   */
  async setViewport(width: number, height: number): Promise<void> {
    const page = await this.collector.getActivePage();
    await page.setViewport({ width, height });
    logger.info(`Viewport set to ${width}x${height}`);
  }

  /**
   * 🆕 模拟设备
   */
  async emulateDevice(deviceName: 'iPhone' | 'iPad' | 'Android'): Promise<void> {
    const page = await this.collector.getActivePage();

    const devices = {
      iPhone: {
        viewport: { width: 375, height: 812, isMobile: true },
        userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 14_0 like Mac OS X) AppleWebKit/605.1.15',
      },
      iPad: {
        viewport: { width: 768, height: 1024, isMobile: true },
        userAgent: 'Mozilla/5.0 (iPad; CPU OS 14_0 like Mac OS X) AppleWebKit/605.1.15',
      },
      Android: {
        viewport: { width: 360, height: 640, isMobile: true },
        userAgent: 'Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36 Chrome/91.0.4472.120',
      },
    };

    const device = devices[deviceName];
    await page.setViewport(device.viewport);
    await page.setUserAgent(device.userAgent);

    logger.info(`Emulating ${deviceName}`);
  }

  /**
   * 🆕 等待网络空闲
   */
  async waitForNetworkIdle(timeout = 30000): Promise<void> {
    const page = await this.collector.getActivePage();
    await page.waitForNetworkIdle({ timeout });
    logger.info('Network is idle');
  }

  /**
   * 🆕 获取LocalStorage
   */
  async getLocalStorage(): Promise<Record<string, string>> {
    const page = await this.collector.getActivePage();

    const storage = await page.evaluate(() => {
      const items: Record<string, string> = {};
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key) {
          items[key] = localStorage.getItem(key) || '';
        }
      }
      return items;
    });

    logger.info(`Retrieved ${Object.keys(storage).length} localStorage items`);
    return storage;
  }

  /**
   * 🆕 设置LocalStorage
   */
  async setLocalStorage(key: string, value: string): Promise<void> {
    const page = await this.collector.getActivePage();

    await page.evaluate((k, v) => {
      localStorage.setItem(k, v);
    }, key, value);

    logger.info(`Set localStorage: ${key}`);
  }

  /**
   * 🆕 清除LocalStorage
   */
  async clearLocalStorage(): Promise<void> {
    const page = await this.collector.getActivePage();

    await page.evaluate(() => {
      localStorage.clear();
    });

    logger.info('LocalStorage cleared');
  }

  /**
   * 获取SessionStorage
   */
  async getSessionStorage(): Promise<Record<string, string>> {
    const page = await this.collector.getActivePage();
    const storage = await page.evaluate(() => {
      const items: Record<string, string> = {};
      for (let i = 0; i < sessionStorage.length; i++) {
        const key = sessionStorage.key(i);
        if (key) {
          items[key] = sessionStorage.getItem(key) || '';
        }
      }
      return items;
    });
    logger.info(`Retrieved ${Object.keys(storage).length} sessionStorage items`);
    return storage;
  }

  /**
   * 设置SessionStorage
   */
  async setSessionStorage(key: string, value: string): Promise<void> {
    const page = await this.collector.getActivePage();
    await page.evaluate((k, v) => {
      sessionStorage.setItem(k, v);
    }, key, value);
    logger.info(`Set sessionStorage: ${key}`);
  }

  /**
   * 清除SessionStorage
   */
  async clearSessionStorage(): Promise<void> {
    const page = await this.collector.getActivePage();
    await page.evaluate(() => {
      sessionStorage.clear();
    });
    logger.info('SessionStorage cleared');
  }

  /**
   * 🆕 模拟键盘按键
   */
  async pressKey(key: string): Promise<void> {
    const page = await this.collector.getActivePage();
    await page.keyboard.press(key as any);
    logger.info(`Pressed key: ${key}`);
  }

  /**
   * 🆕 上传文件
   */
  async uploadFile(selector: string, filePath: string): Promise<void> {
    const page = await this.collector.getActivePage();
    const input = await page.$(selector);

    if (!input) {
      throw new Error(`File input not found: ${selector}`);
    }

    await (input as any).uploadFile(filePath);
    logger.info(`File uploaded: ${filePath}`);
  }

  /**
   * 🆕 获取页面所有链接
   */
  async getAllLinks(): Promise<Array<{ text: string; href: string }>> {
    const page = await this.collector.getActivePage();

    const links = await page.evaluate(() => {
      const anchors = document.querySelectorAll('a[href]');
      const result: Array<{ text: string; href: string }> = [];

      for (let i = 0; i < anchors.length; i++) {
        const anchor = anchors[i] as HTMLAnchorElement;
        result.push({
          text: anchor.textContent?.trim() || '',
          href: anchor.href,
        });
      }

      return result;
    });

    logger.info(`Found ${links.length} links`);
    return links;
  }

  /**
   * 🆕 获取当前Page实例（用于验证码检测等高级功能）
   */
  async getPage() {
    return await this.collector.getActivePage();
  }

  /**
   * 执行交互回放，用于在采样前自动触发关键动作。
   */
  async replayActions(actions: ReplayAction[]): Promise<Array<{index: number; action: string; success: boolean; message: string}>> {
    const results: Array<{index: number; action: string; success: boolean; message: string}> = [];
    for (let index = 0; index < actions.length; index += 1) {
      const item = actions[index];
      try {
        switch (item.action) {
          case 'navigate':
            if (!item.url) {
              throw new Error('navigate action requires url');
            }
            await this.navigate(item.url, {timeout: item.timeout});
            break;
          case 'click':
            if (!item.selector) {
              throw new Error('click action requires selector');
            }
            await this.click(item.selector);
            break;
          case 'type':
            if (!item.selector) {
              throw new Error('type action requires selector');
            }
            await this.type(item.selector, item.text ?? '', {delay: item.delay});
            break;
          case 'wait':
            if (!item.selector) {
              throw new Error('wait action requires selector');
            }
            await this.waitForSelector(item.selector, item.timeout);
            break;
          case 'scroll':
            await this.scroll({x: item.x, y: item.y});
            break;
          case 'pressKey':
            if (!item.key) {
              throw new Error('pressKey action requires key');
            }
            await this.pressKey(item.key);
            break;
          case 'evaluate':
            if (!item.code) {
              throw new Error('evaluate action requires code');
            }
            await this.evaluate(item.code);
            break;
          default:
            throw new Error(`Unsupported action: ${(item as {action?: string}).action ?? 'unknown'}`);
        }
        results.push({index, action: item.action, success: true, message: 'ok'});
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        results.push({index, action: item.action, success: false, message});
      }
    }
    return results;
  }
}
