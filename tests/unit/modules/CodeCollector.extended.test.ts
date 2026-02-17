import { describe, it } from 'node:test';
import assert from 'node:assert';
import { CodeCollector } from '../../../src/modules/collector/CodeCollector.js';
import type { PuppeteerConfig } from '../../../src/types/index.js';

function makeCollector() {
  const cfg: PuppeteerConfig = { headless: true, timeout: 2000 } as any;
  const browserManager = {
    getBrowser: () => null,
    getCurrentPage: () => null,
    newPage: async () => ({}),
    launch: async () => ({ isConnected: () => true, on: () => {} }),
    close: async () => {},
  } as any;
  return new CodeCollector(cfg, browserManager) as any;
}

describe('CodeCollector extended helpers', () => {
  it('covers waitForDynamicScripts branches and URL cleanup cap', async () => {
    const c = makeCollector();

    await c.waitForDynamicScripts({}, 0);

    let idleCalled = 0;
    await c.waitForDynamicScripts(
      {
        waitForNetworkIdle: async () => {
          idleCalled += 1;
        },
      },
      100,
    );
    assert.strictEqual(idleCalled, 1);

    await c.waitForDynamicScripts(
      {
        waitForNetworkIdle: async () => {
          throw new Error('timeout');
        },
      },
      10,
    );

    c.MAX_COLLECTED_URLS = 4;
    c.collectedUrls = new Set(['1', '2', '3', '4', '5', '6']);
    c.cleanupCollectedUrls();
    assert.ok(c.collectedUrls.size <= 3);
  });

  it('covers inline/service-worker/web-worker collection branches', async () => {
    const c = makeCollector();
    c.MAX_FILES_PER_COLLECT = 2;

    const inlinePage = {
      evaluate: async () => [
        { url: 'inline-1', content: 'a', size: 1, type: 'inline', metadata: { truncated: false } },
        { url: 'inline-2', content: 'b', size: 1, type: 'inline', metadata: { truncated: true } },
        { url: 'inline-3', content: 'c', size: 1, type: 'inline', metadata: { truncated: false } },
      ],
    };
    const inline = await c.collectInlineScripts(inlinePage as any);
    assert.strictEqual(inline.length, 2);

    let evalCount = 0;
    const swPage = {
      evaluate: async (_fn: unknown, url?: string) => {
        evalCount += 1;
        if (!url) {
          return [{ url: 'https://a/sw.js', scope: '/', state: 'activated' }];
        }
        return 'console.log("sw")';
      },
    };
    const sw = await c.collectServiceWorkers(swPage as any);
    assert.strictEqual(sw.length, 1);
    assert.ok(evalCount >= 2);

    const wwPage = {
      url: () => 'https://example.com/p',
      evaluate: async (_fn: unknown, workerUrl?: string) => {
        if (typeof workerUrl === 'string') {
          return `worker:${workerUrl}`;
        }
        // first call injects, second returns worker URLs
        return ['w.js', '/x.js'];
      },
    };
    const ww = await c.collectWebWorkers(wwPage as any);
    assert.strictEqual(ww.length, 2);
    assert.ok(ww[0]?.url.includes('https://example.com'));
  });

  it('covers dependency extraction, pattern lookup and top-priority selection', () => {
    const c = makeCollector();

    const deps = c.extractDependencies(`
      import a from './a';
      const b = require("lib-b");
      const d = import('./dyn');
      import a2 from './a';
    `);
    assert.ok(deps.includes('./a'));
    assert.ok(deps.includes('lib-b'));
    assert.ok(deps.includes('./dyn'));

    const graph = c.analyzeDependencies([
      { url: 'https://x/a.js', content: `import z from './b'`, size: 1, type: 'external' },
      { url: 'https://x/b.js', content: '', size: 1, type: 'external' },
    ]);
    assert.strictEqual(graph.nodes.length, 2);

    c.collectedFilesCache.set('https://x/main-app.js', {
      url: 'https://x/main-app.js',
      content: 'x',
      size: 20,
      type: 'external',
    });
    c.collectedFilesCache.set('https://x/vendor.js', {
      url: 'https://x/vendor.js',
      content: 'x',
      size: 20,
      type: 'external',
    });

    const invalid = c.getFilesByPattern('[');
    assert.strictEqual(invalid.matched, 0);
    assert.strictEqual(invalid.files.length, 0);

    const matched = c.getFilesByPattern('main|vendor', 1, 10);
    assert.strictEqual(matched.returned <= 1, true);

    const top = c.getTopPriorityFiles(2, 1024);
    assert.strictEqual(top.files.length >= 1, true);

    const score = c.calculatePriorityScore({
      url: 'https://x/main-crypto-api.js',
      content: '',
      size: 1024,
      type: 'inline',
    });
    assert.ok(score > 0);
  });

  it('covers metadata/performance success and fallback branches plus file cache apis', async () => {
    const c = makeCollector();

    const perfOk = await c.getPerformanceMetrics({
      evaluate: async () => ({ totalTime: 1 }),
    } as any);
    assert.strictEqual((perfOk as any).totalTime, 1);

    const perfBad = await c.getPerformanceMetrics({
      evaluate: async () => {
        throw new Error('perf fail');
      },
    } as any);
    assert.deepStrictEqual(perfBad, {});

    const metaOk = await c.collectPageMetadata({
      evaluate: async () => ({ title: 't', url: 'u' }),
    } as any);
    assert.strictEqual((metaOk as any).title, 't');

    const metaBad = await c.collectPageMetadata({
      evaluate: async () => {
        throw new Error('meta fail');
      },
    } as any);
    assert.deepStrictEqual(metaBad, {});

    c.collectedUrls.add('https://x');
    c.collectedFilesCache.set('https://x/f.js', {
      url: 'https://x/f.js',
      content: '1',
      size: 1,
      type: 'external',
      metadata: { truncated: true, originalSize: 2 },
    });
    const summary = c.getCollectedFilesSummary();
    assert.strictEqual(summary.length, 1);
    assert.ok(c.getFileByUrl('https://x/f.js'));
    assert.strictEqual(c.getFileByUrl('https://none'), null);
    assert.strictEqual(c.getCollectionStats().totalCollected, 1);
    c.clearCollectedFilesCache();
    assert.strictEqual(c.getCollectedFilesSummary().length, 0);
    c.clearCache();
    assert.strictEqual(c.getCollectionStats().uniqueUrls, 0);
  });
});
