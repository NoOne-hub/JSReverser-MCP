import {describe, it} from 'node:test';
import assert from 'node:assert';
import fc from 'fast-check';
import {SmartCodeCollector} from '../../src/modules/collector/SmartCodeCollector.js';
import {CodeCompressor} from '../../src/modules/collector/CodeCompressor.js';
import {CodeCache} from '../../src/modules/collector/CodeCache.js';

describe('Property 5/8/29/30/31: Cache and performance', () => {
  it('Property 5: summary mode compression', async () => {
    const collector = new SmartCodeCollector();
    const files = [{url: 'a.js', content: 'function a(){return 1;}', size: 24, type: 'external'}] as any;
    const result = await collector.smartCollect({} as any, files, {mode: 'summary'} as any);
    assert.ok(Array.isArray(result));
    assert.ok('preview' in result[0]);
  });

  it('Property 8: size limit enforcement', async () => {
    const collector = new SmartCodeCollector();
    const content = 'x'.repeat(10000);
    const files = [{url: 'a.js', content, size: content.length, type: 'external'}] as any;
    const result = (await collector.smartCollect({} as any, files, {mode: 'full', maxFileSize: 100, maxTotalSize: 100} as any)) as any[];
    assert.ok(result[0].size <= 100);
  });

  it('Property 29: code compression', async () => {
    await fc.assert(
      fc.asyncProperty(fc.string({minLength: 1, maxLength: 5000}), async s => {
        const compressor = new CodeCompressor();
        const c = await compressor.compress(s);
        const d = await compressor.decompress(c.compressed);
        assert.strictEqual(d, s);
      }),
      {numRuns: 30},
    );
  });

  it('Property 30: incremental collection', async () => {
    const collector = new SmartCodeCollector();
    const files = [
      {url: 'https://x/a.js', content: 'a', size: 1, type: 'external'},
      {url: 'https://x/b.js', content: 'b', size: 1, type: 'external'},
    ] as any;
    const result = (await collector.smartCollect({} as any, files, {mode: 'incremental', includePatterns: ['a\\.js']} as any)) as any[];
    assert.strictEqual(result.length, 1);
  });

  it('Property 31: script caching', async () => {
    const cache = new CodeCache({cacheDir: '/tmp/js-reverse-mcp-cache-prop'});
    await cache.init();
    await fc.assert(
      fc.asyncProperty(fc.string({minLength: 1, maxLength: 50}), async key => {
        const url = `https://example.com/${key}.js`;
        await cache.set(url, {
          files: [{url, content: key, size: key.length, type: 'external'}],
          dependencies: {nodes: [], edges: []},
          totalSize: key.length,
          collectTime: 1,
        });
        const got = await cache.get(url);
        assert.ok(got);
      }),
      {numRuns: 20},
    );
    await cache.clear();
  });
});
