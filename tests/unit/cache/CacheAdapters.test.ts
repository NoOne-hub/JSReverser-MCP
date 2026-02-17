import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  CodeCompressorAdapter,
  CodeCacheAdapter,
  DetailedDataManagerAdapter,
  createCacheAdapters,
} from '../../../src/utils/CacheAdapters.js';

describe('CacheAdapters', () => {
  it('adapts DetailedDataManager stats and clear', () => {
    let cleared = 0;
    const manager = {
      getStats: () => ({
        cacheSize: 3,
        defaultTTLSeconds: 1800,
        maxCacheSize: 100,
      }),
      clear: () => {
        cleared += 1;
      },
    } as any;

    const adapter = new DetailedDataManagerAdapter(manager);
    const stats = adapter.getStats();

    assert.strictEqual(stats.entries, 3);
    assert.strictEqual(stats.ttl, 1800 * 1000);
    assert.strictEqual(stats.maxSize, 100);
    assert.ok((stats.size || 0) > 0);

    adapter.clear();
    assert.strictEqual(cleared, 1);
  });

  it('adapts CodeCache async stats/cleanup/clear', async () => {
    let cleanupCount = 0;
    let clearCount = 0;
    const cache = {
      getStats: async () => ({
        memoryEntries: 2,
        diskEntries: 5,
        totalSize: 2048,
      }),
      cleanup: async () => {
        cleanupCount += 1;
      },
      clear: async () => {
        clearCount += 1;
      },
    } as any;

    const adapter = new CodeCacheAdapter(cache);
    const stats = await adapter.getStats();
    assert.strictEqual(stats.entries, 7);
    assert.strictEqual(stats.size, 2048);

    await adapter.cleanup();
    await adapter.clear();
    assert.strictEqual(cleanupCount, 1);
    assert.strictEqual(clearCount, 1);
  });

  it('adapts CodeCompressor stats and computes hitRate/size', () => {
    let cleared = 0;
    const compressor = {
      getStats: () => ({
        cacheHits: 6,
        cacheMisses: 4,
        totalCompressedSize: 1000,
      }),
      getCacheSize: () => 2,
      clearCache: () => {
        cleared += 1;
      },
    } as any;

    const adapter = new CodeCompressorAdapter(compressor);
    const stats = adapter.getStats();

    assert.strictEqual(stats.entries, 2);
    assert.strictEqual(stats.hits, 6);
    assert.strictEqual(stats.misses, 4);
    assert.strictEqual(stats.hitRate, 0.6);
    assert.ok((stats.size || 0) > 0);

    adapter.clear();
    assert.strictEqual(cleared, 1);
  });

  it('creates all adapters from factory', () => {
    const adapters = createCacheAdapters(
      { getStats: () => ({ cacheSize: 1, defaultTTLSeconds: 10, maxCacheSize: 20 }), clear: () => {} } as any,
      { getStats: async () => ({ memoryEntries: 0, diskEntries: 0, totalSize: 0 }), cleanup: async () => {}, clear: async () => {} } as any,
      { getStats: () => ({ cacheHits: 0, cacheMisses: 0, totalCompressedSize: 0 }), getCacheSize: () => 0, clearCache: () => {} } as any,
    );

    assert.strictEqual(adapters.length, 3);
    assert.deepStrictEqual(
      adapters.map((a) => a.name),
      ['DetailedDataManager', 'CodeCache', 'CodeCompressor'],
    );
  });
});
