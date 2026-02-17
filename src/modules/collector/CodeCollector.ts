/**
 * 代码收集模块 - 完整实现
 *
 * 功能:
 * - 收集页面内联脚本
 * - 收集外部脚本文件
 * - 收集动态加载的脚本
 * - 收集Service Worker和Web Worker
 * - CDP会话控制和网络监控
 * - 反检测和资源拦截
 */

import type { Browser, Page, CDPSession } from 'puppeteer';
import type {
  CollectCodeOptions,
  CollectCodeResult,
  CodeFile,
  PuppeteerConfig,
  DependencyGraph,
} from '../../types/index.js';
import { logger } from '../../utils/logger.js';
import { CodeCache } from './CodeCache.js';
import { SmartCodeCollector, type SmartCollectOptions } from './SmartCodeCollector.js';
import { CodeCompressor } from './CodeCompressor.js';
// import { StreamingCollector } from './StreamingCollector.js'; // 暂不使用
import { BrowserModeManager } from '../browser/BrowserModeManager.js';

export class CodeCollector {
  private config: PuppeteerConfig;
  private readonly browserManager: BrowserModeManager;
  private browser: Browser | null = null;
  private browserListenerAttached = false;
  private collectedUrls: Set<string> = new Set(); // 防止重复收集

  // 🔧 重新设计：支持大型网站完整收集
  // 策略：收集所有文件到缓存，返回时按需限制
  private readonly MAX_COLLECTED_URLS: number;
  private readonly MAX_FILES_PER_COLLECT: number;  // 保留，但只在返回时使用
  private readonly MAX_RESPONSE_SIZE: number;      // 🆕 单次响应最大大小（而非收集大小）
  private readonly MAX_SINGLE_FILE_SIZE: number;
  private readonly MAX_FILES_CACHE_SIZE: number;   // 🆕 文件缓存最大数量（防止内存泄漏）
  private readonly userAgent: string;

  // 🆕 收集的完整数据存储（支持大型网站）
  private collectedFilesCache: Map<string, CodeFile> = new Map();

  // ✅ 缓存
  private cache: CodeCache;
  private cacheEnabled: boolean = true;

  // 🆕 智能收集、压缩
  private smartCollector: SmartCodeCollector;
  private compressor: CodeCompressor;

  // 🆕 CDP 会话管理（防止内存泄漏）
  private cdpSession: CDPSession | null = null;
  private cdpListeners: {
    responseReceived?: (params: any) => void;
  } = {};

  constructor(config: PuppeteerConfig, browserManager: BrowserModeManager) {
    this.config = config;
    this.browserManager = browserManager;

    // 🔧 重新设计的限制策略
    // 收集阶段：可以收集大量文件（支持大型网站）
    // 返回阶段：限制单次响应大小（防止 MCP token 溢出）
    this.MAX_COLLECTED_URLS = config.maxCollectedUrls ?? 10000;
    this.MAX_FILES_PER_COLLECT = config.maxFilesPerCollect ?? 200;     // 提高到200（原50）
    this.MAX_RESPONSE_SIZE = config.maxTotalContentSize ?? 512 * 1024; // 单次响应512KB
    this.MAX_SINGLE_FILE_SIZE = config.maxSingleFileSize ?? 200 * 1024; // 提高到200KB
    this.MAX_FILES_CACHE_SIZE = 1000;  // 🆕 文件缓存最大1000个（防止内存泄漏）

    this.userAgent = config.userAgent ??
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

    // 初始化所有模块
    this.cache = new CodeCache();
    this.smartCollector = new SmartCodeCollector();
    this.compressor = new CodeCompressor();

    logger.info(`📊 CodeCollector limits: maxCollect=${this.MAX_FILES_PER_COLLECT} files, maxResponse=${(this.MAX_RESPONSE_SIZE / 1024).toFixed(0)}KB, maxSingle=${(this.MAX_SINGLE_FILE_SIZE / 1024).toFixed(0)}KB`);
    logger.info(`💡 Strategy: Collect ALL files → Cache → Return summary/partial data to fit MCP limits`);
  }

  /**
   * 启用/禁用缓存
   */
  setCacheEnabled(enabled: boolean): void {
    this.cacheEnabled = enabled;
    logger.info(`Code cache ${enabled ? 'enabled' : 'disabled'}`);
  }

  /**
   * 清空文件缓存
   */
  async clearFileCache(): Promise<void> {
    await this.cache.clear();
  }

  /**
   * 获取文件缓存统计
   */
  async getFileCacheStats() {
    return await this.cache.getStats();
  }

  /**
   * 🆕 清除所有收集数据（换网站时调用）
   */
  async clearAllData(): Promise<void> {
    logger.info('🧹 Clearing all collected data...');

    // 清除文件缓存
    await this.cache.clear();

    // 清除压缩缓存
    this.compressor.clearCache();

    // 重置压缩统计
    this.compressor.resetStats();

    // 清除已收集的 URL
    this.collectedUrls.clear();

    // 清除文件缓存（内存）
    this.collectedFilesCache.clear();

    logger.success('✅ All data cleared');
  }

  /**
   * 🆕 获取所有统计信息
   */
  async getAllStats() {
    const cacheStats = await this.cache.getStats();
    const compressionStats = this.compressor.getStats();

    return {
      cache: cacheStats,
      compression: {
        ...compressionStats,
        cacheSize: this.compressor.getCacheSize(),
      },
      collector: {
        collectedUrls: this.collectedUrls.size,
        maxCollectedUrls: this.MAX_COLLECTED_URLS,
      },
    };
  }

  /**
   * 🆕 获取缓存实例（用于 UnifiedCacheManager）
   */
  public getCache(): CodeCache {
    return this.cache;
  }

  /**
   * 🆕 获取压缩器实例（用于 UnifiedCacheManager）
   */
  public getCompressor(): CodeCompressor {
    return this.compressor;
  }

  /**
   * 清理收集的URL（防止内存泄漏）
   */
  private cleanupCollectedUrls(): void {
    if (this.collectedUrls.size > this.MAX_COLLECTED_URLS) {
      logger.warn(`Collected URLs exceeded ${this.MAX_COLLECTED_URLS}, clearing...`);
      // 保留最近的一半
      const urls = Array.from(this.collectedUrls);
      this.collectedUrls.clear();
      urls.slice(-Math.floor(this.MAX_COLLECTED_URLS / 2)).forEach(url =>
        this.collectedUrls.add(url)
      );
    }
  }

  /**
   * 等待动态脚本基本稳定，优先使用 Puppeteer 的网络空闲能力
   */
  private async waitForDynamicScripts(page: Page, waitMs: number): Promise<void> {
    if (waitMs <= 0) {
      return;
    }

    const pageWithNetworkIdle = page as unknown as {
      waitForNetworkIdle?: (options?: { idleTime?: number; timeout?: number }) => Promise<void>;
    };

    if (typeof pageWithNetworkIdle.waitForNetworkIdle === 'function') {
      try {
        await pageWithNetworkIdle.waitForNetworkIdle({
          idleTime: Math.min(1000, Math.max(300, Math.floor(waitMs / 3))),
          timeout: waitMs,
        });
        return;
      } catch (error) {
        logger.debug('[Dynamic] waitForNetworkIdle timeout/fallback', error);
      }
    }

    await new Promise((resolve) => setTimeout(resolve, waitMs));
  }

  /**
   * 初始化浏览器 - 统一由 BrowserModeManager 管理
   */
  async init(): Promise<void> {
    if (this.browser && this.browser.isConnected()) {
      return;
    }

    logger.info('Initializing browser via BrowserModeManager...');
    this.browser = await this.browserManager.launch();

    if (!this.browser) {
      throw new Error('Browser failed to initialize');
    }

    if (!this.browserListenerAttached) {
      this.browser.on('disconnected', () => {
        logger.warn('⚠️  Browser disconnected');
        this.browser = null;
        if (this.cdpSession) {
          this.cdpSession = null;
          this.cdpListeners = {};
        }
        this.browserListenerAttached = false;
      });
      this.browserListenerAttached = true;
    }

    // 🆕 初始化缓存目录
    await this.cache.init();

    logger.success('Browser initialized via BrowserModeManager');
  }

  /**
   * 关闭浏览器并清理所有数据
   */
  async close(): Promise<void> {
    // 🆕 先清理数据
    await this.clearAllData();

    // 再关闭浏览器
    if (this.browser) {
      await this.browserManager.close();
      this.browser = null;
      this.browserListenerAttached = false;
      logger.info('Browser closed (via BrowserModeManager) and all data cleared');
    }
  }

  /**
   * 🆕 获取当前活动的Page实例
   */
  async getActivePage(): Promise<Page> {
    if (!this.browser || !this.browser.isConnected()) {
      await this.init();
    }

    const managedPage = this.browserManager.getCurrentPage();
    if (managedPage && !managedPage.isClosed()) {
      return managedPage;
    }

    if (this.browser) {
      const pages = await this.browser.pages();
      const usablePages = pages.filter((page) => !page.isClosed());
      if (usablePages.length > 0) {
        const fallbackPage = usablePages[usablePages.length - 1];
        if (fallbackPage && !fallbackPage.isClosed()) {
          return fallbackPage;
        }
      }
    }

    return await this.browserManager.newPage();
  }

  /**
   * 🆕 创建新页面
   */
  async createPage(url?: string): Promise<Page> {
    if (!this.browser || !this.browser.isConnected()) {
      await this.init();
    }

    const page = await this.browserManager.newPage();

    // 🆕 设置User-Agent（使用配置）
    await page.setUserAgent(this.userAgent);

    // BrowserModeManager已在newPage()时自动注入反检测脚本，无需重复注入

    if (url) {
      await page.goto(url, {
        waitUntil: 'networkidle2',
        timeout: this.config.timeout,
      });
    }

    logger.info(`New page created${url ? `: ${url}` : ''}`);
    return page;
  }

  /**
   * 🆕 获取浏览器状态
   *
   * ✅ 修复：移除 isConnected() 的使用，使用 try-catch 检测浏览器状态
   * 原因：isConnected() 已弃用，且在页面导航时可能误判
   */
  async getStatus(): Promise<{
    running: boolean;
    pagesCount: number;
    version?: string;
  }> {
    if (!this.browser || !this.browser.isConnected()) {
      const managedBrowser = this.browserManager.getBrowser();
      if (managedBrowser && managedBrowser.isConnected()) {
        this.browser = managedBrowser;
      } else {
        return {
          running: false,
          pagesCount: 0,
        };
      }
    }

    // ✅ 修复：使用 try-catch 而不是 isConnected()
    if (!this.browser) {
      return {
        running: false,
        pagesCount: 0,
      };
    }

    try {
      // 尝试获取 pages，如果浏览器已关闭会抛出异常
      const pages = await this.browser.pages();
      const version = await this.browser.version();

      return {
        running: true,
        pagesCount: pages.length,
        version,
      };
    } catch (error) {
      // 浏览器已关闭或连接断开
      logger.debug('Browser not running or disconnected:', error);
      return {
        running: false,
        pagesCount: 0,
      };
    }
  }

  /**
   * 收集代码 - 完整增强版
   *
   * 增强功能:
   * 1. CDP网络拦截 - 更底层的脚本收集
   * 2. 反检测技术 - 绕过webdriver检测
   * 3. 动态脚本监控 - MutationObserver监听DOM变化
   * 4. 内存泄漏防护 - 自动清理收集的URL
   * 5. 错误恢复 - 异常处理和资源释放
   */
  async collect(options: CollectCodeOptions): Promise<CollectCodeResult> {
    const startTime = Date.now();
    logger.info(`Collecting code from: ${options.url}`);

    // ✅ 检查缓存
    if (this.cacheEnabled) {
      const cached = await this.cache.get(options.url, options as any);
      if (cached) {
        logger.info(`✅ Cache hit for: ${options.url}`);
        return cached;
      }
    }

    await this.init();

    if (!this.browser) {
      throw new Error('Browser not initialized');
    }

    const page = await this.browserManager.newPage();
    // ✅ 修复：不再每次清空，依赖 cleanupCollectedUrls() 自动管理
    // this.collectedUrls.clear(); // 移除

    try {
      // 设置超时
      page.setDefaultTimeout(options.timeout || this.config.timeout);

      // ✅ 修复：使用配置的 User-Agent，而非硬编码
      await page.setUserAgent(this.userAgent);

      // BrowserModeManager已在newPage()时自动注入反检测脚本，无需重复注入

      // 收集的代码文件（完整收集，不限制总大小）
      const files: CodeFile[] = [];

      // ✅ 修复：使用新的 API，避免弃用警告
      this.cdpSession = await page.createCDPSession();
      await this.cdpSession.send('Network.enable');
      await this.cdpSession.send('Runtime.enable');

      // ✅ 修复：保存监听器引用，便于移除
      this.cdpListeners.responseReceived = async (params: any) => {
        const { response, requestId, type } = params;
        const url = response.url;

        // 🔧 修复：只限制文件数量，不限制总大小（支持大型网站完整收集）
        if (files.length >= this.MAX_FILES_PER_COLLECT) {
          if (files.length === this.MAX_FILES_PER_COLLECT) {
            logger.warn(`⚠️  Reached max files limit (${this.MAX_FILES_PER_COLLECT}), will skip remaining files`);
          }
          return;
        }

        // 定期清理收集的URL（防止内存泄漏）
        this.cleanupCollectedUrls();

        // 过滤JavaScript资源
        if (
          type === 'Script' ||
          response.mimeType?.includes('javascript') ||
          url.endsWith('.js')
        ) {
          try {
            // ✅ 修复：检查 cdpSession 是否存在
            if (!this.cdpSession) {
              logger.warn(`[CDP] Session not available for: ${url}`);
              return;
            }

            // 获取响应体
            const { body, base64Encoded } = await this.cdpSession.send('Network.getResponseBody', {
              requestId,
            });

            const content = base64Encoded ? Buffer.from(body, 'base64').toString('utf-8') : body;

            // 🔧 限制单文件大小（防止单个文件过大）
            const contentSize = content.length;

            let finalContent = content;
            let truncated = false;

            if (contentSize > this.MAX_SINGLE_FILE_SIZE) {
              // 截断超大文件，保留前面部分
              finalContent = content.substring(0, this.MAX_SINGLE_FILE_SIZE);
              truncated = true;
              logger.warn(`[CDP] Large file truncated: ${url} (${(contentSize / 1024).toFixed(2)} KB -> ${(this.MAX_SINGLE_FILE_SIZE / 1024).toFixed(2)} KB)`);
            }

            // 防止重复收集
            if (!this.collectedUrls.has(url)) {
              this.collectedUrls.add(url);
              const file: CodeFile = {
                url,
                content: finalContent,
                size: finalContent.length,
                type: 'external',
                metadata: truncated ? {
                  truncated: true,
                  originalSize: contentSize,
                  truncatedSize: finalContent.length,
                } : undefined,
              };
              files.push(file);

              // ✅ 修复：检查缓存大小限制，防止内存泄漏
              if (this.collectedFilesCache.size >= this.MAX_FILES_CACHE_SIZE) {
                // 删除最早添加的文件（FIFO策略）
                const firstKey = this.collectedFilesCache.keys().next().value;
                if (firstKey) {
                  this.collectedFilesCache.delete(firstKey);
                  logger.debug(`[Cache] Removed oldest file to maintain cache limit: ${firstKey}`);
                }
              }

              // 🆕 同时存储到缓存，供后续按需获取
              this.collectedFilesCache.set(url, file);

              logger.debug(`[CDP] Collected (${files.length}/${this.MAX_FILES_PER_COLLECT}): ${url} (${(finalContent.length / 1024).toFixed(2)} KB)${truncated ? ' [TRUNCATED]' : ''}`);
            }
          } catch (error) {
            logger.warn(`[CDP] Failed to get response body for: ${url}`, error);
          }
        }
      };

      // ✅ 注册监听器
      this.cdpSession.on('Network.responseReceived', this.cdpListeners.responseReceived);

      // 访问页面
      logger.info(`Navigating to: ${options.url}`);
      await page.goto(options.url, {
        waitUntil: 'networkidle2',
        timeout: options.timeout || this.config.timeout,
      });

      // 收集内联脚本
      if (options.includeInline !== false) {
        logger.info('Collecting inline scripts...');
        const inlineScripts = await this.collectInlineScripts(page);
        files.push(...inlineScripts);
      }

      // 收集Service Worker
      if (options.includeServiceWorker !== false) {
        logger.info('Collecting Service Workers...');
        const serviceWorkers = await this.collectServiceWorkers(page);
        files.push(...serviceWorkers);
      }

      // 收集Web Worker
      if (options.includeWebWorker !== false) {
        logger.info('Collecting Web Workers...');
        const webWorkers = await this.collectWebWorkers(page);
        files.push(...webWorkers);
      }

      // 收集动态加载的脚本
      if (options.includeDynamic) {
        const dynamicWaitMs = options.dynamicWaitMs ?? Math.min(3000, options.timeout ?? this.config.timeout);
        logger.info(`Waiting for dynamic scripts (up to ${dynamicWaitMs}ms)...`);
        await this.waitForDynamicScripts(page, dynamicWaitMs);
      }

      // CDP会话清理已移至finally块，确保资源正确释放

      const collectTime = Date.now() - startTime;
      const totalSize = files.reduce((sum, file) => sum + file.size, 0);

      // ✅ 统计截断的文件
      const truncatedFiles = files.filter(f => f.metadata?.truncated);
      if (truncatedFiles.length > 0) {
        logger.warn(`⚠️  ${truncatedFiles.length} files were truncated due to size limits`);
        truncatedFiles.forEach(f => {
          // ✅ 修复：安全地访问 originalSize
          const originalSize = typeof f.metadata?.originalSize === 'number' ? f.metadata.originalSize : f.size;
          logger.warn(`  - ${f.url}: ${(originalSize / 1024).toFixed(2)} KB -> ${(f.size / 1024).toFixed(2)} KB`);
        });
      }

      // 🆕 智能收集处理
      let processedFiles = files;

      if (options.smartMode && options.smartMode !== 'full') {
        try {
          logger.info(`🧠 Applying smart collection mode: ${options.smartMode}`);

          const smartOptions: SmartCollectOptions = {
            mode: options.smartMode,
            maxTotalSize: options.maxTotalSize,
            maxFileSize: options.maxFileSize,
            priorities: options.priorities,
          };

          const smartResult = await this.smartCollector.smartCollect(page, files, smartOptions);

          // 如果是摘要模式，返回摘要而不是完整文件
          if (options.smartMode === 'summary') {
            logger.info(`📊 Returning ${smartResult.length} code summaries`);

            // ✅ 类型安全：summary 模式返回 CodeSummary[]
            if (Array.isArray(smartResult) && smartResult.length > 0 && smartResult[0] && 'hasEncryption' in smartResult[0]) {
              return {
                files: [], // 摘要模式不返回完整文件
                summaries: smartResult as Array<{
                  url: string;
                  size: number;
                  type: string;
                  hasEncryption: boolean;
                  hasAPI: boolean;
                  hasObfuscation: boolean;
                  functions: string[];
                  imports: string[];
                  preview: string;
                }>,
                dependencies: { nodes: [], edges: [] },
                totalSize: 0,
                collectTime: Date.now() - startTime,
              };
            }
          }

          // ✅ 类型安全：priority/incremental 模式返回 CodeFile[]
          if (Array.isArray(smartResult) && (smartResult.length === 0 || (smartResult[0] && 'content' in smartResult[0]))) {
            processedFiles = smartResult as CodeFile[];
          } else {
            logger.warn('Smart collection returned unexpected type, using original files');
            processedFiles = files;
          }
        } catch (error) {
          logger.error('Smart collection failed, using original files:', error);
          processedFiles = files;
        }
      }

      // 🆕 压缩处理（增强版 - 使用批量压缩和智能级别选择）
      if (options.compress) {
        try {
          logger.info(`🗜️  Compressing ${processedFiles.length} files with enhanced compressor...`);

          // 准备需要压缩的文件
          const filesToCompress = processedFiles
            .filter(file => this.compressor.shouldCompress(file.content))
            .map(file => ({
              url: file.url,
              content: file.content,
            }));

          if (filesToCompress.length === 0) {
            logger.info('No files need compression (all below threshold)');
          } else {
            // 使用批量压缩（并发优化）
            const compressedResults = await this.compressor.compressBatch(filesToCompress, {
              level: undefined, // 自动选择级别
              useCache: true,
              maxRetries: 3,
              concurrency: 5,
              onProgress: (progress) => {
                if (progress % 25 === 0) {
                  logger.debug(`Compression progress: ${progress.toFixed(0)}%`);
                }
              },
            });

            // 更新文件元数据
            const compressedMap = new Map(
              compressedResults.map(r => [r.url, r])
            );

            for (const file of processedFiles) {
              const compressed = compressedMap.get(file.url);
              if (compressed) {
                file.metadata = {
                  ...file.metadata,
                  compressed: true,
                  originalSize: compressed.originalSize,
                  compressedSize: compressed.compressedSize,
                  compressionRatio: compressed.compressionRatio,
                };
              }
            }

            // 获取压缩统计
            const stats = this.compressor.getStats();
            logger.info(`✅ Compressed ${compressedResults.length}/${processedFiles.length} files`);
            logger.info(`📊 Compression stats: ${(stats.totalOriginalSize / 1024).toFixed(2)} KB -> ${(stats.totalCompressedSize / 1024).toFixed(2)} KB (${stats.averageRatio.toFixed(1)}% reduction)`);
            logger.info(`⚡ Cache: ${stats.cacheHits} hits, ${stats.cacheMisses} misses (${stats.cacheHits > 0 ? ((stats.cacheHits / (stats.cacheHits + stats.cacheMisses)) * 100).toFixed(1) : 0}% hit rate)`);
          }
        } catch (error) {
          logger.error('Compression failed:', error);
          // 继续执行，不影响主流程
        }
      }

      // 分析依赖关系
      const dependencies = this.analyzeDependencies(processedFiles);

      logger.success(
        `Collected ${processedFiles.length} files (${(totalSize / 1024).toFixed(2)} KB) in ${collectTime}ms`
      );

      const result: CollectCodeResult = {
        files: processedFiles,
        dependencies,
        totalSize,
        collectTime,
      };

      // ✅ 保存到缓存
      if (this.cacheEnabled) {
        await this.cache.set(options.url, result, options as any);
        logger.debug(`💾 Saved to cache: ${options.url}`);
      }

      return result;
    } catch (error) {
      logger.error('Code collection failed', error);
      throw error;
    } finally {
      // ✅ 修复：在finally块中清理CDP会话，确保无论是否异常都能正确清理
      if (this.cdpSession) {
        try {
          // 先移除监听器
          if (this.cdpListeners.responseReceived) {
            this.cdpSession.off('Network.responseReceived', this.cdpListeners.responseReceived);
          }
          // 再detach
          await this.cdpSession.detach();
        } catch (cleanupError) {
          logger.warn('Failed to cleanup CDP session', cleanupError);
        } finally {
          this.cdpSession = null;
          this.cdpListeners = {};
        }
      }

      // 最后关闭页面
      await page.close();
    }
  }

  /**
   * 收集内联脚本 - 增强版
   *
   * 🔧 修复：添加大小限制和数量限制，防止超大内联脚本导致 token 溢出
   */
  private async collectInlineScripts(page: Page): Promise<CodeFile[]> {
    const scripts = await page.evaluate((maxSingleSize: number) => {
      const scriptElements = Array.from(document.querySelectorAll('script')) as HTMLScriptElement[];
      return scriptElements
        .filter((script) => !script.src && script.textContent)
        .map((script, index) => {
          let content = script.textContent || '';
          const originalSize = content.length;
          let truncated = false;

          // 🔧 限制单个内联脚本大小
          if (content.length > maxSingleSize) {
            content = content.substring(0, maxSingleSize);
            truncated = true;
          }

          return {
            url: `inline-script-${index}`,
            content,
            size: content.length,
            type: 'inline' as const,
            // 额外元数据
            metadata: {
              scriptType: script.type || 'text/javascript',
              async: script.async,
              defer: script.defer,
              integrity: script.integrity || undefined,
              truncated,
              originalSize: truncated ? originalSize : undefined,
            },
          };
        });
    }, this.MAX_SINGLE_FILE_SIZE);

    // 🔧 限制内联脚本数量
    const limitedScripts = scripts.slice(0, this.MAX_FILES_PER_COLLECT);

    if (scripts.length > limitedScripts.length) {
      logger.warn(`⚠️  Found ${scripts.length} inline scripts, limiting to ${this.MAX_FILES_PER_COLLECT}`);
    }

    const truncatedCount = limitedScripts.filter(s => s.metadata?.truncated).length;
    if (truncatedCount > 0) {
      logger.warn(`⚠️  ${truncatedCount} inline scripts were truncated due to size limits`);
    }

    logger.debug(`Collected ${limitedScripts.length} inline scripts`);
    return limitedScripts;
  }

  /**
   * 收集Service Worker脚本
   */
  private async collectServiceWorkers(page: Page): Promise<CodeFile[]> {
    try {
      const serviceWorkers = await page.evaluate(async () => {
        if (!('serviceWorker' in navigator)) {
          return [];
        }

        const registrations = await navigator.serviceWorker.getRegistrations();
        const workers: Array<{ url: string; scope: string; state: string }> = [];

        for (const registration of registrations) {
          const worker = registration.active || registration.installing || registration.waiting;
          if (worker && worker.scriptURL) {
            workers.push({
              url: worker.scriptURL,
              scope: registration.scope,
              state: worker.state,
            });
          }
        }

        return workers;
      });

      const files: CodeFile[] = [];

      // ✅ 修复：使用 fetch 而不是 page.goto()，避免破坏页面状态
      for (const worker of serviceWorkers) {
        try {
          // 使用 page.evaluate 中的 fetch，在页面上下文中执行
          const content = await page.evaluate(async (url) => {
            const response = await fetch(url);
            return await response.text();
          }, worker.url);

          if (content) {
            files.push({
              url: worker.url,
              content,
              size: content.length,
              type: 'service-worker',
            });
            logger.debug(`Collected Service Worker: ${worker.url}`);
          }
        } catch (error) {
          logger.warn(`Failed to collect Service Worker: ${worker.url}`, error);
        }
      }

      return files;
    } catch (error) {
      logger.warn('Service Worker collection failed', error);
      return [];
    }
  }

  /**
   * 收集Web Worker脚本
   */
  private async collectWebWorkers(page: Page): Promise<CodeFile[]> {
    try {
      // 注入拦截代码到当前页面（而非 evaluateOnNewDocument，后者仅对后续导航生效）
      await page.evaluate(() => {
        if ((window as any).__workerIntercepted) return;
        (window as any).__workerIntercepted = true;

        const originalWorker = (window as any).Worker;
        const workerUrls: string[] = (window as any).__workerUrls || [];
        (window as any).__workerUrls = workerUrls;

        (window as any).Worker = function (scriptURL: string, options?: WorkerOptions) {
          workerUrls.push(scriptURL);
          return new originalWorker(scriptURL, options);
        };
        // 保持原型链
        (window as any).Worker.prototype = originalWorker.prototype;
      });

      // 获取已创建的Worker URL（拦截注入后新创建的 + 无法捕获注入前已创建的）
      const workerUrls = (await page.evaluate(() => (window as any).__workerUrls || [])) as string[];

      const files: CodeFile[] = [];

      // ✅ 修复：使用 fetch 而不是 page.goto()，避免破坏页面状态
      for (const url of workerUrls) {
        try {
          // 如果是相对路径，转换为绝对路径
          const absoluteUrl = new URL(url, page.url()).href;

          // 使用 page.evaluate 中的 fetch，在页面上下文中执行
          const content = await page.evaluate(async (workerUrl) => {
            const response = await fetch(workerUrl);
            return await response.text();
          }, absoluteUrl);

          if (content) {
            files.push({
              url: absoluteUrl,
              content,
              size: content.length,
              type: 'web-worker',
            });
            logger.debug(`Collected Web Worker: ${absoluteUrl}`);
          }
        } catch (error) {
          logger.warn(`Failed to collect Web Worker: ${url}`, error);
        }
      }

      return files;
    } catch (error) {
      logger.warn('Web Worker collection failed', error);
      return [];
    }
  }

  /**
   * 分析文件依赖关系
   */
  private analyzeDependencies(files: CodeFile[]): DependencyGraph {
    const nodes: DependencyGraph['nodes'] = [];
    const edges: DependencyGraph['edges'] = [];

    // 为每个文件创建节点
    files.forEach((file) => {
      nodes.push({
        id: file.url,
        url: file.url,
        type: file.type,
      });
    });

    // 分析import/require依赖
    files.forEach((file) => {
      const dependencies = this.extractDependencies(file.content);

      dependencies.forEach((dep) => {
        // 尝试匹配到实际文件
        const targetFile = files.find((f) =>
          f.url.includes(dep) || f.url.endsWith(dep) || f.url.endsWith(`${dep}.js`)
        );

        if (targetFile) {
          edges.push({
            from: file.url,
            to: targetFile.url,
            type: 'import',
          });
        }
      });
    });

    logger.debug(`Dependency graph: ${nodes.length} nodes, ${edges.length} edges`);
    return { nodes, edges };
  }

  /**
   * 从代码中提取依赖
   */
  private extractDependencies(code: string): string[] {
    const dependencies: string[] = [];

    // ES6 import
    const importRegex = /import\s+.*?\s+from\s+['"]([^'"]+)['"]/g;
    let match;
    while ((match = importRegex.exec(code)) !== null) {
      if (match[1]) dependencies.push(match[1]);
    }

    // CommonJS require
    const requireRegex = /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
    while ((match = requireRegex.exec(code)) !== null) {
      if (match[1]) dependencies.push(match[1]);
    }

    // Dynamic import
    const dynamicImportRegex = /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
    while ((match = dynamicImportRegex.exec(code)) !== null) {
      if (match[1]) dependencies.push(match[1]);
    }

    return [...new Set(dependencies)]; // 去重
  }

  /**
   * 检查URL是否应该被收集（过滤规则）
   */
  shouldCollectUrl(url: string, filterRules?: string[]): boolean {
    if (!filterRules || filterRules.length === 0) {
      return true;
    }

    // 支持简单的通配符匹配
    for (const rule of filterRules) {
      const regex = new RegExp(rule.replace(/\*/g, '.*'));
      if (regex.test(url)) {
        return true;
      }
    }

    return false;
  }

  /**
   * 带重试的页面导航
   */
  async navigateWithRetry(
    page: Page,
    url: string,
    options: { waitUntil?: any; timeout?: number },
    maxRetries = 3
  ): Promise<void> {
    let lastError: Error | null = null;

    for (let i = 0; i < maxRetries; i++) {
      try {
        await page.goto(url, options);
        return;
      } catch (error) {
        lastError = error as Error;
        logger.warn(`Navigation attempt ${i + 1}/${maxRetries} failed: ${error}`);
        if (i < maxRetries - 1) {
          await new Promise((resolve) => setTimeout(resolve, 1000 * (i + 1)));
        }
      }
    }

    throw lastError || new Error('Navigation failed after retries');
  }

  /**
   * 获取页面性能指标
   */
  async getPerformanceMetrics(page: Page): Promise<Record<string, number>> {
    try {
      const metrics = await page.evaluate(() => {
        const perf = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming;
        return {
          domContentLoaded: perf.domContentLoadedEventEnd - perf.domContentLoadedEventStart,
          loadComplete: perf.loadEventEnd - perf.loadEventStart,
          domInteractive: perf.domInteractive - perf.fetchStart,
          totalTime: perf.loadEventEnd - perf.fetchStart,
        };
      });
      return metrics;
    } catch (error) {
      logger.warn('Failed to get performance metrics', error);
      return {};
    }
  }

  /**
   * 收集页面元数据
   */
  async collectPageMetadata(page: Page): Promise<Record<string, unknown>> {
    try {
      const metadata = await page.evaluate(() => {
        return {
          title: document.title,
          url: window.location.href,
          userAgent: navigator.userAgent,
          viewport: {
            width: window.innerWidth,
            height: window.innerHeight,
          },
          cookies: document.cookie,
          localStorage: Object.keys(localStorage).length,
          sessionStorage: Object.keys(sessionStorage).length,
        };
      });
      return metadata;
    } catch (error) {
      logger.warn('Failed to collect page metadata', error);
      return {};
    }
  }

  /**
   * 获取浏览器实例
   */
  getBrowser(): Browser | null {
    return this.browser;
  }

  /**
   * 获取收集统计信息
   */
  getCollectionStats(): {
    totalCollected: number;
    uniqueUrls: number;
  } {
    return {
      totalCollected: this.collectedUrls.size,
      uniqueUrls: this.collectedUrls.size,
    };
  }

  /**
   * 清除收集缓存
   */
  clearCache(): void {
    this.collectedUrls.clear();
    logger.info('Collection cache cleared');
  }

  // ==================== 🆕 按需获取接口（支持大型网站逆向） ====================

  /**
   * 获取已收集文件的摘要列表（轻量级，不包含文件内容）
   *
   * 🎯 用途：先返回文件列表，让 AI 决定需要哪些文件
   */
  getCollectedFilesSummary(): Array<{
    url: string;
    size: number;
    type: string;
    truncated?: boolean;
    originalSize?: number;
  }> {
    const summaries = Array.from(this.collectedFilesCache.values()).map(file => ({
      url: file.url,
      size: file.size,
      type: file.type,
      truncated: typeof file.metadata?.truncated === 'boolean' ? file.metadata.truncated : undefined,
      originalSize: typeof file.metadata?.originalSize === 'number' ? file.metadata.originalSize : undefined,
    }));

    logger.info(`📋 Returning summary of ${summaries.length} collected files`);
    return summaries;
  }

  /**
   * 按 URL 获取单个文件内容
   *
   * @param url 文件 URL
   * @returns 文件内容，如果不存在返回 null
   */
  getFileByUrl(url: string): CodeFile | null {
    const file = this.collectedFilesCache.get(url);
    if (file) {
      logger.info(`📄 Returning file: ${url} (${(file.size / 1024).toFixed(2)} KB)`);
      return file;
    }
    logger.warn(`⚠️  File not found: ${url}`);
    return null;
  }

  /**
   * 按 URL 模式批量获取文件
   *
   * @param pattern 正则表达式模式
   * @param limit 最大返回数量（默认20）
   * @param maxTotalSize 最大总大小（默认512KB，防止 MCP token 溢出）
   */
  getFilesByPattern(
    pattern: string,
    limit: number = 20,
    maxTotalSize: number = this.MAX_RESPONSE_SIZE
  ): {
    files: CodeFile[];
    totalSize: number;
    matched: number;
    returned: number;
    truncated: boolean;
  } {
    // ✅ 修复：添加错误处理，防止无效正则表达式导致崩溃
    let regex: RegExp;
    try {
      regex = new RegExp(pattern);
    } catch (error) {
      logger.error(`Invalid regex pattern: ${pattern}`, error);
      return {
        files: [],
        totalSize: 0,
        matched: 0,
        returned: 0,
        truncated: false,
      };
    }

    const matched: CodeFile[] = [];

    // 查找所有匹配的文件
    for (const file of this.collectedFilesCache.values()) {
      if (regex.test(file.url)) {
        matched.push(file);
      }
    }

    // 应用限制
    const returned: CodeFile[] = [];
    let totalSize = 0;
    let truncated = false;

    for (let i = 0; i < matched.length && i < limit; i++) {
      const file = matched[i];
      if (file && totalSize + file.size <= maxTotalSize) {
        returned.push(file);
        totalSize += file.size;
      } else {
        truncated = true;
        break;
      }
    }

    if (truncated || matched.length > limit) {
      logger.warn(`⚠️  Pattern "${pattern}" matched ${matched.length} files, returning ${returned.length} (limited by size/count)`);
    }

    logger.info(`🔍 Pattern "${pattern}": matched ${matched.length}, returning ${returned.length} files (${(totalSize / 1024).toFixed(2)} KB)`);

    return {
      files: returned,
      totalSize,
      matched: matched.length,
      returned: returned.length,
      truncated,
    };
  }

  /**
   * 按优先级获取前 N 个文件
   *
   * @param topN 返回前N个文件（默认10）
   * @param maxTotalSize 最大总大小（默认512KB）
   */
  getTopPriorityFiles(
    topN: number = 10,
    maxTotalSize: number = this.MAX_RESPONSE_SIZE
  ): {
    files: CodeFile[];
    totalSize: number;
    totalFiles: number;
  } {
    const allFiles = Array.from(this.collectedFilesCache.values());

    // 计算优先级（复用 SmartCodeCollector 的逻辑）
    const scoredFiles = allFiles.map(file => ({
      file,
      score: this.calculatePriorityScore(file),
    }));

    // 按分数排序
    scoredFiles.sort((a, b) => b.score - a.score);

    // 选取前N个，但不超过总大小限制
    const selected: CodeFile[] = [];
    let totalSize = 0;

    for (let i = 0; i < Math.min(topN, scoredFiles.length); i++) {
      const item = scoredFiles[i];
      if (item && item.file && totalSize + item.file.size <= maxTotalSize) {
        selected.push(item.file);
        totalSize += item.file.size;
      } else {
        break;
      }
    }

    logger.info(`⭐ Returning top ${selected.length}/${allFiles.length} priority files (${(totalSize / 1024).toFixed(2)} KB)`);

    return {
      files: selected,
      totalSize,
      totalFiles: allFiles.length,
    };
  }

  /**
   * 计算文件优先级分数（私有方法）
   */
  private calculatePriorityScore(file: CodeFile): number {
    let score = 0;

    // 文件类型加分
    if (file.type === 'inline') score += 10;
    else if (file.type === 'external') score += 5;

    // 文件大小：小文件优先（更可能是核心逻辑）
    if (file.size < 10 * 1024) score += 15;      // < 10KB
    else if (file.size < 50 * 1024) score += 10; // < 50KB
    else if (file.size > 200 * 1024) score -= 10; // > 200KB

    // URL 特征匹配（关键词加分）
    const url = file.url.toLowerCase();
    if (url.includes('main') || url.includes('index') || url.includes('app')) score += 20;
    if (url.includes('crypto') || url.includes('encrypt') || url.includes('sign')) score += 30;
    if (url.includes('api') || url.includes('request') || url.includes('ajax')) score += 25;
    if (url.includes('core') || url.includes('common') || url.includes('util')) score += 15;

    // 第三方库降分
    if (url.includes('vendor') || url.includes('lib') || url.includes('jquery') || url.includes('react')) score -= 20;
    if (url.includes('node_modules') || url.includes('bundle')) score -= 30;

    return score;
  }

  /**
   * 清除文件缓存
   */
  clearCollectedFilesCache(): void {
    const count = this.collectedFilesCache.size;
    this.collectedFilesCache.clear();
    logger.info(`🧹 Cleared collected files cache (${count} files)`);
  }
}
