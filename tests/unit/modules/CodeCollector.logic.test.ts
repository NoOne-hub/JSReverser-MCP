import { describe, it } from 'node:test';
import assert from 'node:assert';
import { CodeCollector } from '../../../src/modules/collector/CodeCollector.js';
import type { CodeFile, PuppeteerConfig } from '../../../src/types/index.js';

function makeConfig(overrides: Partial<PuppeteerConfig> = {}): PuppeteerConfig {
  return {
    headless: true,
    timeout: 2000,
    ...overrides,
  };
}

function makeCollector(browserManagerOverrides: Record<string, unknown> = {}) {
  const browserManager = {
    getBrowser: () => null,
    getCurrentPage: () => null,
    newPage: async () => ({}),
    launch: async () => ({
      isConnected: () => true,
      on: () => {},
      pages: async () => [],
      version: async () => 'Chrome/131',
    }),
    close: async () => {},
    ...browserManagerOverrides,
  } as any;

  return new CodeCollector(makeConfig(), browserManager);
}

describe('CodeCollector logic', () => {
  it('returns cached collect result immediately when cache hit', async () => {
    const collector = makeCollector();
    const cached = {
      files: [{ url: 'https://a.js', content: 'x', size: 1, type: 'external' }],
      dependencies: { nodes: [], edges: [] },
      totalSize: 1,
      collectTime: 1,
    };
    (collector as any).cacheEnabled = true;
    (collector as any).cache = {
      get: async () => cached,
      set: async () => {},
      clear: async () => {},
      init: async () => {},
      getStats: async () => ({}),
    };

    const out = await collector.collect({ url: 'https://example.com' } as any);
    assert.strictEqual(out, cached as any);
  });

  it('collects external script via mocked CDP and cleans up session', async () => {
    let responseHandler: ((params: any) => Promise<void>) | undefined;
    let detached = 0;
    let pageClosed = 0;
    const cdp = {
      send: async (cmd: string) => {
        if (cmd === 'Network.getResponseBody') {
          return { body: 'console.log(1)', base64Encoded: false };
        }
        return {};
      },
      on: (event: string, handler: (params: any) => Promise<void>) => {
        if (event === 'Network.responseReceived') {
          responseHandler = handler;
        }
      },
      off: () => {},
      detach: async () => {
        detached += 1;
      },
    };
    const page = {
      setDefaultTimeout: () => {},
      setUserAgent: async () => {},
      createCDPSession: async () => cdp,
      goto: async () => {
        if (responseHandler) {
          await responseHandler({
            requestId: 'r1',
            type: 'Script',
            response: { url: 'https://cdn.site/app.js', mimeType: 'application/javascript' },
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
    (collector as any).cache = {
      get: async () => null,
      set: async () => {},
      clear: async () => {},
      init: async () => {},
      getStats: async () => ({}),
    };
    (collector as any).smartCollector = { smartCollect: async (_p: any, files: any[]) => files };
    (collector as any).compressor = {
      shouldCompress: () => false,
      compressBatch: async () => [],
      getStats: () => ({ totalOriginalSize: 0, totalCompressedSize: 0, averageRatio: 0, cacheHits: 0, cacheMisses: 0 }),
    };

    const out = await collector.collect({
      url: 'https://example.com',
      includeInline: false,
      includeServiceWorker: false,
      includeWebWorker: false,
      includeDynamic: false,
      compress: false,
    } as any);

    assert.strictEqual(out.files.length, 1);
    assert.strictEqual(out.files[0]?.url, 'https://cdn.site/app.js');
    assert.strictEqual(detached, 1);
    assert.strictEqual(pageClosed, 1);
  });

  it('cleans up page/CDP when collect throws', async () => {
    let detached = 0;
    let pageClosed = 0;
    const cdp = {
      send: async () => ({}),
      on: () => {},
      off: () => {},
      detach: async () => {
        detached += 1;
      },
    };
    const page = {
      setDefaultTimeout: () => {},
      setUserAgent: async () => {},
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
    (collector as any).cache = {
      get: async () => null,
      set: async () => {},
      clear: async () => {},
      init: async () => {},
      getStats: async () => ({}),
    };

    await assert.rejects(
      async () => {
        await collector.collect({
          url: 'https://example.com',
          includeInline: false,
          includeServiceWorker: false,
          includeWebWorker: false,
          includeDynamic: false,
        } as any);
      },
      /nav failed/,
    );
    assert.strictEqual(detached, 1);
    assert.strictEqual(pageClosed, 1);
  });

  it('handles cache/compressor management APIs', async () => {
    const collector = makeCollector();
    let cacheCleared = 0;
    let compressorCleared = 0;
    let compressorReset = 0;

    (collector as any).cache = {
      clear: async () => {
        cacheCleared += 1;
      },
      getStats: async () => ({ memoryEntries: 1, diskEntries: 2 }),
    };
    (collector as any).compressor = {
      clearCache: () => {
        compressorCleared += 1;
      },
      resetStats: () => {
        compressorReset += 1;
      },
      getStats: () => ({ cacheHits: 0, cacheMisses: 0 }),
      getCacheSize: () => 0,
    };

    (collector as any).collectedUrls.add('https://a.js');
    (collector as any).collectedFilesCache.set('https://a.js', {
      url: 'https://a.js',
      content: 'x',
      size: 1,
      type: 'external',
    });

    collector.setCacheEnabled(false);
    assert.strictEqual((collector as any).cacheEnabled, false);

    await collector.clearFileCache();
    await collector.clearAllData();
    const stats = await collector.getAllStats();

    assert.strictEqual(cacheCleared, 2);
    assert.strictEqual(compressorCleared, 1);
    assert.strictEqual(compressorReset, 1);
    assert.strictEqual(stats.collector.collectedUrls, 0);
  });

  it('supports getStatus fallback and disconnected branches', async () => {
    const collector = makeCollector();
    const managerBrowser = {
      isConnected: () => true,
      pages: async () => [{}, {}],
      version: async () => 'Chrome/131',
    };
    (collector as any).browserManager.getBrowser = () => managerBrowser;

    const running = await collector.getStatus();
    assert.deepStrictEqual(running, {
      running: true,
      pagesCount: 2,
      version: 'Chrome/131',
    });

    (collector as any).browser = {
      isConnected: () => true,
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
    const activePage = { isClosed: () => false };
    const fallbackPage = { isClosed: () => false };
    const createdPage = { created: true };
    const collector = makeCollector({
      getCurrentPage: () => activePage,
      newPage: async () => createdPage,
    });

    (collector as any).browser = {
      isConnected: () => true,
      pages: async () => [fallbackPage],
    };

    const pageFromManager = await collector.getActivePage();
    assert.strictEqual(pageFromManager, activePage as any);

    (collector as any).browserManager.getCurrentPage = () => null;
    const pageFromBrowser = await collector.getActivePage();
    assert.strictEqual(pageFromBrowser, fallbackPage as any);

    (collector as any).browser = {
      isConnected: () => true,
      pages: async () => [],
    };
    const pageFromNew = await collector.getActivePage();
    assert.strictEqual(pageFromNew, createdPage as any);
  });

  it('applies URL rule matching and navigation retries', async () => {
    const collector = makeCollector();

    assert.strictEqual(collector.shouldCollectUrl('https://a.com/main.js'), true);
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
    await collector.navigateWithRetry(page as any, 'https://example.com', {}, 3);
    assert.strictEqual(attempts, 3);

    await assert.rejects(
      async () => {
        await collector.navigateWithRetry(
          {
            goto: async () => {
              throw new Error('always fail');
            },
          } as any,
          'https://example.com',
          {},
          2,
        );
      },
      /always fail/,
    );
  });

  it('handles perf/metadata success and failure paths', async () => {
    const collector = makeCollector();
    const metrics = await collector.getPerformanceMetrics({
      evaluate: async () => ({ domContentLoaded: 1, loadComplete: 2 }),
    } as any);
    assert.deepStrictEqual(metrics, { domContentLoaded: 1, loadComplete: 2 });

    const metadata = await collector.collectPageMetadata({
      evaluate: async () => ({ title: 'x', url: 'https://a.com' }),
    } as any);
    assert.strictEqual(metadata.title, 'x');

    const emptyMetrics = await collector.getPerformanceMetrics({
      evaluate: async () => {
        throw new Error('boom');
      },
    } as any);
    assert.deepStrictEqual(emptyMetrics, {});

    const emptyMetadata = await collector.collectPageMetadata({
      evaluate: async () => {
        throw new Error('boom');
      },
    } as any);
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
        metadata: { truncated: true, originalSize: 9999 },
      },
    ];

    for (const file of files) {
      (collector as any).collectedFilesCache.set(file.url, file);
    }

    const summary = collector.getCollectedFilesSummary();
    assert.strictEqual(summary.length, 3);
    assert.strictEqual(summary[2]?.truncated, true);

    const invalidPattern = collector.getFilesByPattern('[');
    assert.strictEqual(invalidPattern.returned, 0);

    const pattern = collector.getFilesByPattern('site\\.com', 2, 10_000);
    assert.strictEqual(pattern.matched, 3);
    assert.strictEqual(pattern.returned, 2);

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
    (collector as any).collectedUrls.add('https://a.js');
    (collector as any).browser = { connected: true };

    const before = collector.getCollectionStats();
    assert.strictEqual(before.totalCollected, 1);
    assert.ok(collector.getBrowser());

    collector.clearCache();
    const after = collector.getCollectionStats();
    assert.strictEqual(after.totalCollected, 0);
  });

  it('waits dynamic scripts via network-idle or fallback sleep', async () => {
    const collector = makeCollector() as any;

    let waited = 0;
    await collector.waitForDynamicScripts({
      waitForNetworkIdle: async () => {
        waited += 1;
      },
    }, 20);
    assert.strictEqual(waited, 1);

    const start = Date.now();
    await collector.waitForDynamicScripts({
      waitForNetworkIdle: async () => {
        throw new Error('idle not available');
      },
    }, 10);
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
      setUserAgent: async () => {},
      goto: async () => {},
    };
    const collector = makeCollector({
      launch: async () => browser,
      close: async () => {
        closeCalls += 1;
      },
      newPage: async () => page,
    });

    (collector as any).cache = {
      init: async () => {},
      clear: async () => {},
      getStats: async () => ({}),
    };
    (collector as any).compressor = {
      clearCache: () => {},
      resetStats: () => {},
      getStats: () => ({}),
      getCacheSize: () => 0,
    };

    await collector.init();
    await collector.createPage('https://example.com');
    await collector.createPage();

    (collector as any).cdpSession = { id: 'x' };
    (collector as any).cdpListeners = { responseReceived: () => {} };
    disconnectedHandler?.();
    assert.strictEqual((collector as any).browser, null);
    assert.deepStrictEqual((collector as any).cdpListeners, {});

    (collector as any).browser = browser;
    await collector.close();
    assert.strictEqual(closeCalls, 1);
  });

  it('collect supports smart summary and compression metadata branches', async () => {
    let responseHandler: ((params: any) => Promise<void>) | undefined;
    let navCount = 0;
    const cdp = {
      send: async (cmd: string) => {
        if (cmd === 'Network.getResponseBody') {
          return { body: Buffer.from('abcdefghij').toString('base64'), base64Encoded: true };
        }
        return {};
      },
      on: (_event: string, handler: (params: any) => Promise<void>) => {
        responseHandler = handler;
      },
      off: () => {},
      detach: async () => {},
    };
    const page = {
      setDefaultTimeout: () => {},
      setUserAgent: async () => {},
      createCDPSession: async () => cdp,
      goto: async () => {
        navCount += 1;
        await responseHandler?.({
          requestId: 'r1',
          type: 'Script',
          response: {
            url: navCount === 1 ? 'https://cdn.site/app-main.js' : 'https://cdn.site/app-main-2.js',
            mimeType: 'application/javascript',
          },
        });
      },
      close: async () => {},
      evaluate: async () => [],
      url: () => 'https://example.com',
      waitForNetworkIdle: async () => {},
    };
    const collector = makeCollector({
      newPage: async () => page,
    });
    (collector as any).MAX_SINGLE_FILE_SIZE = 5;
    (collector as any).cache = {
      get: async () => null,
      set: async () => {},
      clear: async () => {},
      init: async () => {},
      getStats: async () => ({}),
    };

    (collector as any).smartCollector = {
      smartCollect: async () => [{ hasEncryption: true, keyPatterns: [] }],
    };
    const summary = await collector.collect({
      url: 'https://example.com',
      includeInline: false,
      includeServiceWorker: false,
      includeWebWorker: false,
      includeDynamic: true,
      smartMode: 'summary',
      compress: false,
      dynamicWaitMs: 10,
    } as any);
    assert.ok('summaries' in summary);

    (collector as any).smartCollector = {
      smartCollect: async (_page: any, files: any[]) => files,
    };
    (collector as any).compressor = {
      shouldCompress: () => true,
      compressBatch: async (items: any[], opts: any) => {
        opts.onProgress?.(25);
        opts.onProgress?.(100);
        return items.map((item: any) => ({
          url: item.url,
          originalSize: 10,
          compressedSize: 5,
          compressionRatio: 50,
        }));
      },
      getStats: () => ({ totalOriginalSize: 10, totalCompressedSize: 5, averageRatio: 50, cacheHits: 1, cacheMisses: 1 }),
    };
    const compressed = await collector.collect({
      url: 'https://example.com/2',
      includeInline: false,
      includeServiceWorker: false,
      includeWebWorker: false,
      includeDynamic: false,
      compress: true,
      smartMode: 'priority',
    } as any);
    assert.strictEqual(compressed.files[0]?.metadata?.compressed, true);
  });

  it('covers service worker, web worker, performance and metadata helper branches', async () => {
    const collector = makeCollector();

    let evalIndex = 0;
    const swPage = {
      evaluate: async (_fn: any, url?: string) => {
        evalIndex += 1;
        if (evalIndex === 1) {
          return [{ url: 'https://example.com/sw.js', scope: '/', state: 'activated' }];
        }
        if (url) {
          return 'self.onfetch = null;';
        }
        return [];
      },
    };
    const swFiles = await (collector as any).collectServiceWorkers(swPage as any);
    assert.strictEqual(swFiles.length, 1);
    assert.strictEqual(swFiles[0]?.type, 'service-worker');

    const swFail = await (collector as any).collectServiceWorkers({
      evaluate: async () => {
        throw new Error('sw fail');
      },
    } as any);
    assert.deepStrictEqual(swFail, []);

    let wwEval = 0;
    const wwPage = {
      url: () => 'https://example.com/path/',
      evaluate: async (_fn: any, arg?: string) => {
        wwEval += 1;
        if (wwEval === 1) return undefined;
        if (wwEval === 2) return ['worker.js'];
        if (arg) return 'postMessage(1);';
        return [];
      },
    };
    const wwFiles = await (collector as any).collectWebWorkers(wwPage as any);
    assert.strictEqual(wwFiles[0]?.url, 'https://example.com/path/worker.js');

    const wwFail = await (collector as any).collectWebWorkers({
      evaluate: async () => {
        throw new Error('ww fail');
      },
      url: () => 'https://example.com',
    } as any);
    assert.deepStrictEqual(wwFail, []);

    const perf = await collector.getPerformanceMetrics({
      evaluate: async () => ({ domContentLoaded: 1, loadComplete: 2, domInteractive: 3, totalTime: 4 }),
    } as any);
    assert.strictEqual((perf as any).totalTime, 4);
    const perfFail = await collector.getPerformanceMetrics({
      evaluate: async () => {
        throw new Error('perf fail');
      },
    } as any);
    assert.deepStrictEqual(perfFail, {});

    const meta = await collector.collectPageMetadata({
      evaluate: async () => ({ title: 't', url: 'u' }),
    } as any);
    assert.strictEqual((meta as any).title, 't');
    const metaFail = await collector.collectPageMetadata({
      evaluate: async () => {
        throw new Error('meta fail');
      },
    } as any);
    assert.deepStrictEqual(metaFail, {});
  });
});
