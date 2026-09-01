/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import assert from 'node:assert';
import {describe, it} from 'node:test';

import {CodeCollector} from '../../../src/modules/collector/CodeCollector.js';
import type {CodeFile, PuppeteerConfig} from '../../../src/types/index.js';

interface CacheHarness {
  get(url: string, options: unknown): Promise<unknown>;
  set(url: string, result: unknown, options: unknown): Promise<void>;
  clear(): Promise<void>;
  init(): Promise<void>;
  getStats(): Promise<Record<string, unknown>>;
}

interface CompressorHarness {
  shouldCompress?(content: string): boolean;
  compressBatch?(
    files: Array<{url: string; content: string}>,
  ): Promise<Array<Record<string, unknown>>>;
  getStats(): Record<string, unknown>;
  clearCache?(): void;
  resetStats?(): void;
  getCacheSize?(): number;
}

interface SmartCollectorHarness {
  smartCollect(page: unknown, files: CodeFile[]): Promise<CodeFile[]>;
}

interface BrowserHarness {
  isConnected(): boolean;
  on(event: string, handler: () => void): void;
  pages(): Promise<unknown[]>;
  version(): Promise<string>;
}

interface BrowserManagerHarness {
  getConnectedBrowser(): BrowserHarness | null;
  getCurrentPage(): unknown;
  newPage(): Promise<unknown>;
  ensureBrowser(): Promise<BrowserHarness>;
  close(): Promise<void>;
}

interface CDPHarness {
  send(command: string, params?: unknown): Promise<unknown>;
  on(event: string, handler: (params: unknown) => Promise<void>): void;
  off(event: string, handler: (params: unknown) => Promise<void>): void;
  detach(): Promise<void>;
}

interface CollectPageHarness {
  setDefaultTimeout(timeout: number): void;
  setUserAgent(userAgent: string): Promise<void>;
  createCDPSession(): Promise<CDPHarness>;
  goto(url: string, options?: unknown): Promise<void>;
  close(): Promise<void>;
  evaluate(...args: unknown[]): Promise<unknown>;
  url(): string;
  waitForNetworkIdle?(options?: {
    idleTime?: number;
    timeout?: number;
  }): Promise<void>;
  isClosed?(): boolean;
}

interface CodeCollectorHarness {
  cacheEnabled: boolean;
  cache: CacheHarness;
  smartCollector: SmartCollectorHarness;
  compressor: CompressorHarness;
  browser: BrowserHarness | null;
  browserManager: BrowserManagerHarness;
  collectedUrls: Set<string>;
  collectedFilesCache: Map<string, CodeFile>;
  collect(options: Record<string, unknown>): Promise<unknown>;
  clearFileCache(): Promise<void>;
  clearAllData(): Promise<void>;
  getAllStats(): Promise<Record<string, unknown>>;
  getStatus(): Promise<{
    running: boolean;
    pagesCount: number;
    version?: string;
  }>;
  getActivePage(): Promise<unknown>;
  init(): Promise<void>;
  close(): Promise<void>;
  createPage(url?: string): Promise<unknown>;
  navigateWithRetry(
    page: {goto(url: string, options?: unknown): Promise<void>},
    url: string,
    options: unknown,
    retries: number,
  ): Promise<void>;
  getPerformanceMetrics(page: {
    evaluate(...args: unknown[]): Promise<unknown>;
  }): Promise<Record<string, unknown>>;
  collectPageMetadata(page: {
    evaluate(...args: unknown[]): Promise<unknown>;
  }): Promise<Record<string, unknown>>;
  shouldCollectUrl(url: string, patterns?: string[]): boolean;
  setCacheEnabled(enabled: boolean): void;
  getBrowser(): BrowserHarness | null;
  getCollectionStats(): {totalCollected: number; uniqueUrls: number};
  clearCache(): void;
  getCollectedFilesSummary(): Array<{
    url: string;
    size: number;
    type: string;
    truncated?: boolean;
    originalSize?: number;
  }>;
  getFileByUrl(url: string): CodeFile | null;
  getFilesByPattern(
    pattern: string,
    limit?: number,
    maxTotalSize?: number,
  ): {
    files: CodeFile[];
    totalSize: number;
    matched: number;
    returned: number;
    truncated: boolean;
  };
  getTopPriorityFiles(
    topN?: number,
    maxTotalSize?: number,
  ): {
    files: CodeFile[];
    totalSize: number;
    totalFiles: number;
  };
  clearCollectedFilesCache(): void;
  collectServiceWorkers(page: {
    evaluate(...args: unknown[]): Promise<unknown>;
  }): Promise<CodeFile[]>;
  collectWebWorkers(page: {
    evaluate(...args: unknown[]): Promise<unknown>;
    url(): string;
  }): Promise<CodeFile[]>;
  waitForDynamicScripts(
    page: {
      waitForNetworkIdle?(options?: {
        idleTime?: number;
        timeout?: number;
      }): Promise<void>;
    },
    waitMs: number,
  ): Promise<void>;
  MAX_SINGLE_FILE_SIZE: number;
  cdpSession: unknown;
  cdpListeners: {responseReceived?: (...args: unknown[]) => void};
  RESPONSE_BODY_TIMEOUT_MS: number;
}

function makeConfig(overrides: Partial<PuppeteerConfig> = {}): PuppeteerConfig {
  return {
    headless: true,
    timeout: 2000,
    ...overrides,
  };
}

function makeCollector(
  browserManagerOverrides: Partial<BrowserManagerHarness> = {},
): CodeCollectorHarness {
  const browserManager: BrowserManagerHarness = {
    getConnectedBrowser: () => null,
    getCurrentPage: () => null,
    newPage: async () => ({}),
    ensureBrowser: async () => ({
      isConnected: () => true,
      on: () => undefined,
      pages: async () => [],
      version: async () => 'Chrome/131',
    }),
    close: async () => undefined,
    ...browserManagerOverrides,
  };

  return new CodeCollector(
    makeConfig(),
    browserManager as unknown as ConstructorParameters<typeof CodeCollector>[1],
  ) as unknown as CodeCollectorHarness;
}

describe('CodeCollector logic', () => {
  it('hydrates collected file cache when returning cached collect result', async () => {
    const collector = makeCollector();
    const cached = {
      files: [
        {url: 'https://a.js', content: 'x', size: 1, type: 'external' as const},
      ],
      dependencies: {nodes: [], edges: []},
      totalSize: 1,
      collectTime: 1,
    };
    collector.cacheEnabled = true;
    collector.cache = {
      get: async () => cached,
      set: async () => undefined,
      clear: async () => undefined,
      init: async () => undefined,
      getStats: async () => ({}),
    };

    const out = await collector.collect({url: 'https://example.com'});
    assert.strictEqual(out, cached);
    assert.strictEqual(collector.getFileByUrl('https://a.js')?.content, 'x');
    const matched = collector.getFilesByPattern('a\\.js');
    assert.strictEqual(matched.matched, 1);
    assert.strictEqual(matched.returned, 1);
  });

  it('collects external script via mocked CDP and cleans up session', async () => {
    let responseHandler:
      | ((params: {
          requestId: string;
          type: string;
          response: {url: string; mimeType?: string};
        }) => Promise<void>)
      | undefined;
    let detached = 0;
    let pageClosed = 0;
    const cdp = {
      send: async (cmd: string) => {
        if (cmd === 'Network.getResponseBody') {
          return {body: 'console.log(1)', base64Encoded: false};
        }
        return {};
      },
      on: (
        event: string,
        handler: (params: {
          requestId: string;
          type: string;
          response: {url: string; mimeType?: string};
        }) => Promise<void>,
      ) => {
        if (event === 'Network.responseReceived') {
          responseHandler = handler;
        }
      },
      off: () => undefined,
      detach: async () => {
        detached += 1;
      },
    } as CDPHarness;
    const page: CollectPageHarness = {
      setDefaultTimeout: () => undefined,
      setUserAgent: async () => undefined,
      createCDPSession: async () => cdp,
      goto: async () => {
        if (responseHandler) {
          await responseHandler({
            requestId: 'r1',
            type: 'Script',
            response: {
              url: 'https://cdn.site/app.js',
              mimeType: 'application/javascript',
            },
          });
        }
      },
      close: async () => {
        pageClosed += 1;
      },
      evaluate: async () => [],
      url: () => 'https://example.com',
    };

    const collector = makeCollector({
      newPage: async () => page,
    });
    collector.cache = {
      get: async () => null,
      set: async () => undefined,
      clear: async () => undefined,
      init: async () => undefined,
      getStats: async () => ({}),
    };
    collector.smartCollector = {
      smartCollect: async (_page: unknown, files: CodeFile[]) => files,
    };
    collector.compressor = {
      shouldCompress: () => false,
      compressBatch: async () => [],
      getStats: () => ({
        totalOriginalSize: 0,
        totalCompressedSize: 0,
        averageRatio: 0,
        cacheHits: 0,
        cacheMisses: 0,
      }),
    };

    const out = (await collector.collect({
      url: 'https://example.com',
      includeInline: false,
      includeServiceWorker: false,
      includeWebWorker: false,
      includeDynamic: false,
      compress: false,
    })) as {files: CodeFile[]};

    assert.strictEqual(out.files.length, 1);
    assert.strictEqual(out.files[0]?.url, 'https://cdn.site/app.js');
    assert.strictEqual(detached, 1);
    assert.strictEqual(pageClosed, 1);
  });

  it('times out stalled response body fetches and continues cleanup', async () => {
    let responseHandler:
      | ((params: {
          requestId: string;
          type: string;
          response: {url: string; mimeType?: string};
        }) => Promise<void>)
      | undefined;
    let detached = 0;
    let pageClosed = 0;
    const cdp = {
      send: async (cmd: string) => {
        if (cmd === 'Network.getResponseBody') {
          return await new Promise(() => undefined);
        }
        return {};
      },
      on: (
        event: string,
        handler: (params: {
          requestId: string;
          type: string;
          response: {url: string; mimeType?: string};
        }) => Promise<void>,
      ) => {
        if (event === 'Network.responseReceived') {
          responseHandler = handler;
        }
      },
      off: () => undefined,
      detach: async () => {
        detached += 1;
      },
    } as CDPHarness;
    const page: CollectPageHarness = {
      setDefaultTimeout: () => undefined,
      setUserAgent: async () => undefined,
      createCDPSession: async () => cdp,
      goto: async () => {
        await responseHandler?.({
          requestId: 'r-timeout',
          type: 'Script',
          response: {
            url: 'https://cdn.site/slow.js',
            mimeType: 'application/javascript',
          },
        });
      },
      close: async () => {
        pageClosed += 1;
      },
      evaluate: async () => [],
      url: () => 'https://example.com',
    };

    const collector = makeCollector({
      newPage: async () => page,
    });
    collector.RESPONSE_BODY_TIMEOUT_MS = 10;
    collector.cache = {
      get: async () => null,
      set: async () => undefined,
      clear: async () => undefined,
      init: async () => undefined,
      getStats: async () => ({}),
    };
    collector.smartCollector = {
      smartCollect: async (_page: unknown, files: CodeFile[]) => files,
    };
    collector.compressor = {
      shouldCompress: () => false,
      compressBatch: async () => [],
      getStats: () => ({
        totalOriginalSize: 0,
        totalCompressedSize: 0,
        averageRatio: 0,
        cacheHits: 0,
        cacheMisses: 0,
      }),
    };

    const out = (await collector.collect({
      url: 'https://example.com',
      includeInline: false,
      includeServiceWorker: false,
      includeWebWorker: false,
      includeDynamic: false,
      compress: false,
    })) as {files: CodeFile[]};

    assert.strictEqual(out.files.length, 0);
    assert.strictEqual(detached, 1);
    assert.strictEqual(pageClosed, 1);
  });

  it('cleans up page/CDP when collect throws', async () => {
    let detached = 0;
    let pageClosed = 0;
    const cdp = {
      send: async () => ({}),
      on: () => undefined,
      off: () => undefined,
      detach: async () => {
        detached += 1;
      },
    } as CDPHarness;
    const page: CollectPageHarness = {
      setDefaultTimeout: () => undefined,
      setUserAgent: async () => undefined,
      createCDPSession: async () => cdp,
      goto: async () => {
        throw new Error('nav failed');
      },
      close: async () => {
        pageClosed += 1;
      },
      evaluate: async () => [],
      url: () => 'https://example.com',
    };

    const collector = makeCollector({
      newPage: async () => page,
    });
    collector.cache = {
      get: async () => null,
      set: async () => undefined,
      clear: async () => undefined,
      init: async () => undefined,
      getStats: async () => ({}),
    };

    await assert.rejects(async () => {
      await collector.collect({
        url: 'https://example.com',
        includeInline: false,
        includeServiceWorker: false,
        includeWebWorker: false,
        includeDynamic: false,
      });
    }, /nav failed/);
    assert.strictEqual(detached, 1);
    assert.strictEqual(pageClosed, 1);
  });

  it('handles cache/compressor management APIs', async () => {
    const collector = makeCollector();
    let cacheCleared = 0;
    let compressorCleared = 0;
    let compressorReset = 0;

    collector.cache = {
      clear: async () => {
        cacheCleared += 1;
      },
      getStats: async () => ({memoryEntries: 1, diskEntries: 2}),
      get: async () => null,
      set: async () => undefined,
      init: async () => undefined,
    };
    collector.compressor = {
      clearCache: () => {
        compressorCleared += 1;
      },
      resetStats: () => {
        compressorReset += 1;
      },
      getStats: () => ({cacheHits: 0, cacheMisses: 0}),
      getCacheSize: () => 0,
    };

    collector.collectedUrls.add('https://a.js');
    collector.collectedFilesCache.set('https://a.js', {
      url: 'https://a.js',
      content: 'x',
      size: 1,
      type: 'external',
    });

    collector.setCacheEnabled(false);
    assert.strictEqual(collector.cacheEnabled, false);

    await collector.clearFileCache();
    await collector.clearAllData();
    const stats = (await collector.getAllStats()) as {
      collector: {collectedUrls: number};
    };

    assert.strictEqual(cacheCleared, 2);
    assert.strictEqual(compressorCleared, 1);
    assert.strictEqual(compressorReset, 1);
    assert.strictEqual(stats.collector.collectedUrls, 0);
  });

  it('supports getStatus fallback and disconnected branches', async () => {
    const collector = makeCollector();
    const managerBrowser = {
      isConnected: () => true,
      on: () => undefined,
      pages: async () => [{}, {}],
      version: async () => 'Chrome/131',
    };
    collector.browserManager.getConnectedBrowser = () =>
      managerBrowser as BrowserHarness;

    const running = await collector.getStatus();
    assert.deepStrictEqual(running, {
      running: true,
      pagesCount: 2,
      version: 'Chrome/131',
    });

    collector.browser = {
      isConnected: () => true,
      on: () => undefined,
      pages: async () => {
        throw new Error('closed');
      },
      version: async () => 'Chrome/131',
    };
    const notRunning = await collector.getStatus();
    assert.strictEqual(notRunning.running, false);
    assert.strictEqual(notRunning.pagesCount, 0);
  });

  it('collects active page from manager, browser pages, or new page', async () => {
    const activePage = {isClosed: () => false};
    const fallbackPage = {isClosed: () => false};
    const createdPage = {created: true};
    const collector = makeCollector({
      getCurrentPage: () => activePage,
      newPage: async () => createdPage,
    });

    collector.browser = {
      isConnected: () => true,
      on: () => undefined,
      pages: async () => [fallbackPage],
      version: async () => 'Chrome/131',
    };

    const pageFromManager = await collector.getActivePage();
    assert.strictEqual(pageFromManager, activePage);

    collector.browserManager.getCurrentPage = () => null;
    const pageFromBrowser = await collector.getActivePage();
    assert.strictEqual(pageFromBrowser, fallbackPage);

    collector.browser = {
      isConnected: () => true,
      on: () => undefined,
      pages: async () => [],
      version: async () => 'Chrome/131',
    };
    const pageFromNew = await collector.getActivePage();
    assert.strictEqual(pageFromNew, createdPage);
  });

  it('prefers externally selected page context over manager state', async () => {
    const selectedPage = {selected: true, isClosed: () => false};
    const managerPage = {manager: true, isClosed: () => false};
    const collector = makeCollector({
      getCurrentPage: () => managerPage,
    });

    (
      collector as unknown as {
        setPageResolver?: (resolver?: () => unknown | null) => void;
      }
    ).setPageResolver?.(() => selectedPage);

    const page = await collector.getActivePage();
    assert.strictEqual(page, selectedPage);
  });

  it('applies URL rule matching and navigation retries', async () => {
    const collector = makeCollector();

    assert.strictEqual(
      collector.shouldCollectUrl('https://a.com/main.js'),
      true,
    );
    assert.strictEqual(
      collector.shouldCollectUrl('https://cdn.a.com/main.js', ['*main.js']),
      true,
    );
    assert.strictEqual(
      collector.shouldCollectUrl('https://cdn.a.com/other.css', ['*main.js']),
      false,
    );

    let attempts = 0;
    const page = {
      goto: async () => {
        attempts += 1;
        if (attempts < 3) {
          throw new Error('retry');
        }
      },
    };
    await collector.navigateWithRetry(page, 'https://example.com', {}, 3);
    assert.strictEqual(attempts, 3);

    await assert.rejects(async () => {
      await collector.navigateWithRetry(
        {
          goto: async () => {
            throw new Error('always fail');
          },
        },
        'https://example.com',
        {},
        2,
      );
    }, /always fail/);
  });

  it('handles perf/metadata success and failure paths', async () => {
    const collector = makeCollector();
    const metrics = await collector.getPerformanceMetrics({
      evaluate: async () => ({domContentLoaded: 1, loadComplete: 2}),
    });
    assert.deepStrictEqual(metrics, {domContentLoaded: 1, loadComplete: 2});

    const metadata = await collector.collectPageMetadata({
      evaluate: async () => ({title: 'x', url: 'https://a.com'}),
    });
    assert.strictEqual(metadata.title, 'x');

    const emptyMetrics = await collector.getPerformanceMetrics({
      evaluate: async () => {
        throw new Error('boom');
      },
    });
    assert.deepStrictEqual(emptyMetrics, {});

    const emptyMetadata = await collector.collectPageMetadata({
      evaluate: async () => {
        throw new Error('boom');
      },
    });
    assert.deepStrictEqual(emptyMetadata, {});
  });

  it('returns summaries, files by pattern and priority ordering', () => {
    const collector = makeCollector();
    const files: CodeFile[] = [
      {
        url: 'https://site.com/main-app.js',
        content: 'import x from "./crypto-core";',
        size: 1200,
        type: 'external',
      },
      {
        url: 'https://site.com/vendor-react.js',
        content: 'export default 1;',
        size: 1800,
        type: 'external',
      },
      {
        url: 'https://site.com/inline-1',
        content: 'require("api-client")',
        size: 300,
        type: 'inline',
        metadata: {truncated: true, originalSize: 9999},
      },
    ];

    for (const file of files) {
      collector.collectedFilesCache.set(file.url, file);
    }

    const summary = collector.getCollectedFilesSummary();
    assert.strictEqual(summary.length, 3);
    assert.strictEqual(summary[2]?.truncated, true);

    const invalidPattern = collector.getFilesByPattern('[');
    assert.strictEqual(invalidPattern.returned, 0);

    const pattern = collector.getFilesByPattern('site\\.com', 2, 10_000);
    assert.strictEqual(pattern.matched, 3);
    assert.strictEqual(pattern.returned, 2);

    const contentPattern = collector.getFilesByPattern(
      'crypto-core',
      2,
      10_000,
    );
    assert.strictEqual(contentPattern.matched, 1);
    assert.strictEqual(
      contentPattern.files[0]?.url,
      'https://site.com/main-app.js',
    );

    const top = collector.getTopPriorityFiles(2, 10_000);
    assert.strictEqual(top.totalFiles, 3);
    assert.strictEqual(top.files.length, 2);
    assert.ok(top.files[0]?.url.includes('main-app'));

    const found = collector.getFileByUrl('https://site.com/main-app.js');
    assert.strictEqual(found?.url, 'https://site.com/main-app.js');
    assert.strictEqual(collector.getFileByUrl('https://none.com/a.js'), null);

    collector.clearCollectedFilesCache();
    assert.strictEqual(collector.getCollectedFilesSummary().length, 0);
  });

  it('clears collection counters and exposes browser reference', () => {
    const collector = makeCollector();
    collector.collectedUrls.add('https://a.js');
    collector.browser = {
      isConnected: () => true,
      on: () => undefined,
      pages: async () => [],
      version: async () => 'Chrome/131',
    };

    const before = collector.getCollectionStats();
    assert.strictEqual(before.totalCollected, 1);
    assert.ok(collector.getBrowser());

    collector.clearCache();
    const after = collector.getCollectionStats();
    assert.strictEqual(after.totalCollected, 0);
  });

  it('waits dynamic scripts via network-idle or fallback sleep', async () => {
    const collector = makeCollector();

    let waited = 0;
    await collector.waitForDynamicScripts(
      {
        waitForNetworkIdle: async () => {
          waited += 1;
        },
      },
      20,
    );
    assert.strictEqual(waited, 1);

    const start = Date.now();
    await collector.waitForDynamicScripts(
      {
        waitForNetworkIdle: async () => {
          throw new Error('idle not available');
        },
      },
      10,
    );
    assert.ok(Date.now() - start >= 8);

    await collector.waitForDynamicScripts({}, 0);
  });

  it('handles init/createPage/close and disconnected cleanup callback', async () => {
    let disconnectedHandler: (() => void) | undefined;
    let closeCalls = 0;
    const browser = {
      isConnected: () => true,
      on: (_evt: string, cb: () => void) => {
        disconnectedHandler = cb;
      },
      pages: async () => [],
      version: async () => 'Chrome/131',
    };
    const page = {
      setUserAgent: async () => undefined,
      goto: async () => undefined,
    };
    const collector = makeCollector({
      ensureBrowser: async () => browser,
      close: async () => {
        closeCalls += 1;
      },
      newPage: async () => page,
    });

    collector.cache = {
      init: async () => undefined,
      clear: async () => undefined,
      get: async () => null,
      set: async () => undefined,
      getStats: async () => ({}),
    };
    collector.compressor = {
      clearCache: () => undefined,
      resetStats: () => undefined,
      getStats: () => ({}),
      getCacheSize: () => 0,
    };

    await collector.init();
    await collector.createPage('https://example.com');
    await collector.createPage();

    collector.cdpSession = {id: 'x'};
    collector.cdpListeners = {responseReceived: () => undefined};
    disconnectedHandler?.();
    assert.strictEqual(collector.browser, null);
    assert.deepStrictEqual(collector.cdpListeners, {});

    collector.browser = browser;
    await collector.close();
    // 双栈合并（2026-09-02）：CodeCollector.close 只清采集侧状态，不再关闭主浏览器
    // （生命周期归主栈 BrowserManager）——browserManager.close 不应被调用
    assert.strictEqual(closeCalls, 0);
    assert.strictEqual(collector.browser, null);
  });

  it('collect supports smart summary and compression metadata branches', async () => {
    let responseHandler:
      | ((params: {
          requestId: string;
          type: string;
          response: {url: string; mimeType?: string};
        }) => Promise<void>)
      | undefined;
    let navCount = 0;
    const cdp = {
      send: async (cmd: string) => {
        if (cmd === 'Network.getResponseBody') {
          return {
            body: Buffer.from('abcdefghij').toString('base64'),
            base64Encoded: true,
          };
        }
        return {};
      },
      on: (
        _event: string,
        handler: (params: {
          requestId: string;
          type: string;
          response: {url: string; mimeType?: string};
        }) => Promise<void>,
      ) => {
        responseHandler = handler;
      },
      off: () => undefined,
      detach: async () => undefined,
    } as CDPHarness;
    const page: CollectPageHarness = {
      setDefaultTimeout: () => undefined,
      setUserAgent: async () => undefined,
      createCDPSession: async () => cdp,
      goto: async () => {
        navCount += 1;
        await responseHandler?.({
          requestId: 'r1',
          type: 'Script',
          response: {
            url:
              navCount === 1
                ? 'https://cdn.site/app-main.js'
                : 'https://cdn.site/app-main-2.js',
            mimeType: 'application/javascript',
          },
        });
      },
      close: async () => undefined,
      evaluate: async () => [],
      url: () => 'https://example.com',
      waitForNetworkIdle: async () => undefined,
    };
    const collector = makeCollector({
      newPage: async () => page,
    });
    collector.MAX_SINGLE_FILE_SIZE = 5;
    collector.cache = {
      get: async () => null,
      set: async () => undefined,
      clear: async () => undefined,
      init: async () => undefined,
      getStats: async () => ({}),
    };

    collector.smartCollector = {
      smartCollect: async () => [{hasEncryption: true, keyPatterns: []}],
    } as unknown as SmartCollectorHarness;
    const summary = (await collector.collect({
      url: 'https://example.com',
      includeInline: false,
      includeServiceWorker: false,
      includeWebWorker: false,
      includeDynamic: true,
      smartMode: 'summary',
      compress: false,
      dynamicWaitMs: 10,
    })) as {summaries?: unknown[]};
    assert.ok('summaries' in summary);

    collector.smartCollector = {
      smartCollect: async (_page: unknown, files: CodeFile[]) => files,
    };
    collector.compressor = {
      shouldCompress: () => true,
      compressBatch: async (items: Array<{url: string; content: string}>) => {
        return items.map(item => ({
          url: item.url,
          originalSize: 10,
          compressedSize: 5,
          compressionRatio: 50,
        }));
      },
      getStats: () => ({
        totalOriginalSize: 10,
        totalCompressedSize: 5,
        averageRatio: 50,
        cacheHits: 1,
        cacheMisses: 1,
      }),
    };
    const compressed = await collector.collect({
      url: 'https://example.com/2',
      includeInline: false,
      includeServiceWorker: false,
      includeWebWorker: false,
      includeDynamic: false,
      compress: true,
      smartMode: 'priority',
    });
    assert.strictEqual(
      (compressed as {files: CodeFile[]}).files[0]?.metadata?.compressed,
      true,
    );
  });

  it('covers service worker, web worker, performance and metadata helper branches', async () => {
    const collector = makeCollector();

    let evalIndex = 0;
    const swPage = {
      evaluate: async (_fn: unknown, url?: string) => {
        evalIndex += 1;
        if (evalIndex === 1) {
          return [
            {url: 'https://example.com/sw.js', scope: '/', state: 'activated'},
          ];
        }
        if (url) {
          return 'self.onfetch = null;';
        }
        return [];
      },
    };
    const swFiles = await collector.collectServiceWorkers(swPage);
    assert.strictEqual(swFiles.length, 1);
    assert.strictEqual(swFiles[0]?.type, 'service-worker');

    const swFail = await collector.collectServiceWorkers({
      evaluate: async () => {
        throw new Error('sw fail');
      },
    });
    assert.deepStrictEqual(swFail, []);

    let wwEval = 0;
    const wwPage = {
      url: () => 'https://example.com/path/',
      evaluate: async (_fn: unknown, arg?: string) => {
        wwEval += 1;
        if (wwEval === 1) return undefined;
        if (wwEval === 2) return ['worker.js'];
        if (arg) return 'postMessage(1);';
        return [];
      },
    };
    const wwFiles = await collector.collectWebWorkers(wwPage);
    assert.strictEqual(wwFiles[0]?.url, 'https://example.com/path/worker.js');

    const wwFail = await collector.collectWebWorkers({
      evaluate: async () => {
        throw new Error('ww fail');
      },
      url: () => 'https://example.com',
    });
    assert.deepStrictEqual(wwFail, []);

    const perf = await collector.getPerformanceMetrics({
      evaluate: async () => ({
        domContentLoaded: 1,
        loadComplete: 2,
        domInteractive: 3,
        totalTime: 4,
      }),
    });
    assert.strictEqual(perf.totalTime, 4);
    const perfFail = await collector.getPerformanceMetrics({
      evaluate: async () => {
        throw new Error('perf fail');
      },
    });
    assert.deepStrictEqual(perfFail, {});

    const meta = await collector.collectPageMetadata({
      evaluate: async () => ({title: 't', url: 'u'}),
    });
    assert.strictEqual(meta.title, 't');
    const metaFail = await collector.collectPageMetadata({
      evaluate: async () => {
        throw new Error('meta fail');
      },
    });
    assert.deepStrictEqual(metaFail, {});
  });
});
