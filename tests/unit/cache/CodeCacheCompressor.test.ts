import {describe, it} from 'node:test';
import assert from 'node:assert';
import {CodeCache} from '../../../src/modules/collector/CodeCache.js';
import {CodeCompressor} from '../../../src/modules/collector/CodeCompressor.js';

describe('Code cache and compressor', () => {
  it('stores and retrieves cache entries', async () => {
    const cache = new CodeCache({cacheDir: '/tmp/js-reverse-mcp-cache-test'});
    await cache.init();

    await cache.set('https://example.com', {
      files: [{url: 'a.js', content: 'const a=1;', size: 10, type: 'external'}],
      dependencies: {nodes: [], edges: []},
      totalSize: 10,
      collectTime: 1,
    });

    const got = await cache.get('https://example.com');
    assert.ok(got);
    assert.strictEqual(got?.files.length, 1);

    await cache.clear();
  });

  it('compresses and decompresses code', async () => {
    const compressor = new CodeCompressor();
    const source = 'function x(){return "hello".repeat(100);}';
    const compressed = await compressor.compress(source);
    const restored = await compressor.decompress(compressed.compressed);

    assert.strictEqual(restored, source);
    assert.ok(Number.isFinite(compressed.compressionRatio));
  });

  it('covers memory eviction, expiration, stats and warmup/cleanup branches', async () => {
    const dir = `/tmp/js-reverse-mcp-cache-test-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const cache = new CodeCache({
      cacheDir: dir,
      maxAge: 1,
      maxSize: 1024,
    });
    await cache.init();

    (cache as any).MAX_MEMORY_CACHE_SIZE = 1;
    await cache.set(
      'https://example.com/a',
      { files: [{url: 'a.js', content: 'a'.repeat(20), size: 20, type: 'external'}], dependencies: {nodes: [], edges: []}, totalSize: 20, collectTime: 1 },
      { mode: 'x' },
    );
    await cache.set(
      'https://example.com/b',
      { files: [{url: 'b.js', content: 'b'.repeat(20), size: 20, type: 'external'}], dependencies: {nodes: [], edges: []}, totalSize: 20, collectTime: 1 },
      { mode: 'x' },
    );
    assert.strictEqual((cache as any).memoryCache.size, 1);

    const key = (cache as any).generateKey('https://example.com/mem', undefined);
    (cache as any).memoryCache.set(key, {
      files: [{url: 'm.js', content: 'm', size: 1, type: 'external'}],
      totalSize: 1,
      collectTime: 1,
      timestamp: Date.now(),
    });
    const fromMemory = await cache.get('https://example.com/mem');
    assert.strictEqual(fromMemory?.files[0]?.url, 'm.js');

    (cache as any).memoryCache.set(key, {
      files: [{url: 'm2.js', content: 'm2', size: 2, type: 'external'}],
      totalSize: 2,
      collectTime: 1,
      timestamp: 0,
    });
    const expiredMemory = await cache.get('https://example.com/mem');
    assert.strictEqual(expiredMemory, null);

    await cache.set(
      'https://example.com/disk',
      { files: [{url: 'd.js', content: 'd'.repeat(3000), size: 3000, type: 'external'}], dependencies: {nodes: [], edges: []}, totalSize: 3000, collectTime: 1 },
      { mode: 'x' },
    );
    await new Promise((r) => setTimeout(r, 3));
    const diskExpired = await cache.get('https://example.com/disk', { mode: 'x' });
    assert.strictEqual(diskExpired, null);

    const stats = await cache.getStats();
    assert.strictEqual(typeof stats.totalSize, 'number');
    await cache.warmup(['https://example.com/none']);
    await cache.cleanup();
    await cache.clear();

    const bad = new CodeCache({ cacheDir: `${dir}-missing` });
    const badStats = await bad.getStats();
    assert.strictEqual(badStats.diskEntries, 0);
    await bad.clear();
  });
});
