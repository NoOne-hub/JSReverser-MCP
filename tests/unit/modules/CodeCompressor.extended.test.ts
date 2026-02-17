import { describe, it } from 'node:test';
import assert from 'node:assert';
import { CodeCompressor } from '../../../src/modules/collector/CodeCompressor.js';

describe('CodeCompressor extended', () => {
  it('compress/decompress, cache hit, stats and reset', async () => {
    const c = new CodeCompressor();
    const src = 'function x(){return "hello".repeat(120);}';

    const first = await c.compress(src, { level: 6 });
    const second = await c.compress(src, { level: 6 });
    const restored = await c.decompress(first.compressed);

    assert.strictEqual(restored, src);
    assert.strictEqual(second.originalSize, first.originalSize);

    const stats = c.getStats();
    assert.ok(stats.totalCompressed >= 1);
    assert.ok(stats.cacheHits >= 1);

    c.resetStats();
    const reset = c.getStats();
    assert.strictEqual(reset.totalCompressed, 0);
    assert.strictEqual(reset.cacheHits, 0);
  });

  it('handles cache expiry and clearCache/getCacheSize', async () => {
    const c = new CodeCompressor() as any;
    const src = 'const longText = "' + 'a'.repeat(3000) + '";';

    await c.compress(src, { level: 6 });
    const key = c.generateCacheKey(src, 6);
    const entry = c.cache.get(key);
    assert.ok(entry);

    entry.timestamp = Date.now() - c.CACHE_TTL - 1;
    await c.compress(src, { level: 6 });

    assert.ok(c.getCacheSize() >= 1);
    c.clearCache();
    assert.strictEqual(c.getCacheSize(), 0);
  });

  it('covers compression/decompression retries and errors', async () => {
    const c = new CodeCompressor();
    const src = 'const a = 1;';

    await assert.rejects(async () => {
      await c.compress(src, { level: 99, maxRetries: 1, useCache: false });
    });

    await assert.rejects(async () => {
      await c.decompress('%%%bad-base64%%%', 1);
    });
  });

  it('covers batch compression success and fallback', async () => {
    const c = new CodeCompressor();
    const files = [
      { url: 'a.js', content: 'let a = 1;' },
      { url: 'b.js', content: 'let b = 2;' },
      { url: 'c.js', content: 'let c = 3;' },
    ];

    let overallProgress = 0;
    const fileProgress: string[] = [];

    const ok = await c.compressBatch(files, {
      concurrency: 2,
      onProgress: (p) => {
        overallProgress = p;
      },
      onFileProgress: (f, p) => {
        if (p === 100) fileProgress.push(f);
      },
    });

    assert.strictEqual(ok.length, 3);
    assert.ok(overallProgress > 0);
    assert.strictEqual(fileProgress.length, 3);

    const fallback = await c.compressBatch(files, {
      maxRetries: 1,
      level: 99,
    });

    assert.strictEqual(fallback.length, 3);
    fallback.forEach((item) => {
      assert.strictEqual(item.compressionRatio, 0);
      assert.strictEqual(item.compressedSize, item.originalSize);
    });
  });

  it('covers shouldCompress/selectCompressionLevel/compressStream and LRU cache eviction', async () => {
    const c = new CodeCompressor() as any;

    assert.strictEqual(c.shouldCompress('x'.repeat(500), 1024), false);
    assert.strictEqual(c.shouldCompress('x'.repeat(2000), 1024), true);

    assert.strictEqual(c.selectCompressionLevel(5 * 1024), 1);
    assert.strictEqual(c.selectCompressionLevel(50 * 1024), 6);
    assert.strictEqual(c.selectCompressionLevel(200 * 1024), 9);
    assert.strictEqual(c.selectCompressionLevel(2 * 1024 * 1024), 6);

    const small = await c.compressStream('short', { chunkSize: 100 });
    assert.ok(typeof small.compressed === 'string');

    const bigSource = 'x'.repeat(4096);
    const progress: number[] = [];
    const streamed = await c.compressStream(bigSource, {
      chunkSize: 256,
      onProgress: (p: number) => progress.push(p),
    });
    assert.ok((streamed.chunks ?? 0) > 1);
    assert.ok(progress.length > 0);
    assert.ok((streamed.metadata?.compressionTime ?? 0) >= 0);

    for (let i = 0; i < 130; i++) {
      await c.compress(`let x${i} = ${i};`, { level: 1 });
    }
    assert.ok(c.getCacheSize() <= 100);
  });
});
