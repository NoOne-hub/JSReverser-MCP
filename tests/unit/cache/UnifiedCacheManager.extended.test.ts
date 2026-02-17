import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import { UnifiedCacheManager } from '../../../src/utils/UnifiedCacheManager.js';

describe('UnifiedCacheManager extended', () => {
  beforeEach(() => {
    (UnifiedCacheManager as any).instance = undefined;
  });

  it('continues when a cache getStats throws', async () => {
    const manager = UnifiedCacheManager.getInstance();
    manager.registerCache({
      name: 'ok',
      getStats: () => ({ entries: 1, size: 1024, hits: 1, misses: 1, hitRate: 0.5 }),
    });
    manager.registerCache({
      name: 'bad',
      getStats: () => {
        throw new Error('boom');
      },
    });

    const stats = await manager.getGlobalStats();
    assert.strictEqual(stats.totalEntries, 1);
    assert.strictEqual(stats.caches.length, 1);
    manager.unregisterCache('ok');
    manager.unregisterCache('bad');
  });

  it('smartCleanup returns early when usage is below target', async () => {
    const manager = UnifiedCacheManager.getInstance();
    manager.registerCache({
      name: 'small',
      getStats: () => ({ entries: 1, size: 1000, hits: 1, misses: 0, hitRate: 1 }),
      cleanup: () => {},
      clear: () => {},
    });

    const result = await manager.smartCleanup(2000);
    assert.strictEqual(result.freed, 0);
    manager.unregisterCache('small');
  });

  it('clears low hit rate caches and large caches in private cleanup paths', async () => {
    const manager = UnifiedCacheManager.getInstance();
    let lowCleared = 0;
    let highCleared = 0;

    manager.registerCache({
      name: 'low-hit',
      getStats: () => ({ entries: 10, size: 4000, hits: 1, misses: 99, hitRate: 0.01 }),
      clear: () => {
        lowCleared += 1;
      },
    });

    manager.registerCache({
      name: 'large-hit',
      getStats: () => ({ entries: 20, size: 8000, hits: 90, misses: 10, hitRate: 0.9 }),
      clear: () => {
        highCleared += 1;
      },
    });

    await (manager as any).cleanupLowHitRate();
    assert.ok(lowCleared >= 1);

    await (manager as any).cleanupLargeItems();
    assert.ok(lowCleared + highCleared >= 1);

    manager.unregisterCache('low-hit');
    manager.unregisterCache('large-hit');
  });

  it('runs cleanupExpired, clearAll and preheat without errors', async () => {
    const manager = UnifiedCacheManager.getInstance();
    let cleanupCount = 0;
    let clearCount = 0;
    manager.registerCache({
      name: 'x',
      getStats: () => ({ entries: 0, size: 0 }),
      cleanup: () => {
        cleanupCount += 1;
      },
      clear: () => {
        clearCount += 1;
      },
    });

    await (manager as any).cleanupExpired();
    await manager.clearAll();
    await manager.preheat(['https://a.example', 'https://b.example']);

    assert.ok(cleanupCount >= 1);
    assert.ok(clearCount >= 1);
    manager.unregisterCache('x');
  });

  it('generates recommendations for critical size and cache-specific issues', async () => {
    const manager = UnifiedCacheManager.getInstance() as any;
    manager.GLOBAL_MAX_SIZE = 1000;

    manager.registerCache({
      name: 'big-low-hit',
      getStats: () => ({ entries: 10, size: 950, hits: 1, misses: 99, hitRate: 0.01 }),
      clear: () => {},
    });

    manager.registerCache({
      name: 'small-good-hit',
      getStats: () => ({ entries: 1, size: 10, hits: 9, misses: 1, hitRate: 0.9 }),
      clear: () => {},
    });

    const stats = await manager.getGlobalStats();
    const joined = stats.recommendations.join('\n');
    assert.ok(joined.includes('CRITICAL'));
    assert.ok(joined.includes('Low cache hit rate') || joined.includes('low hit rate'));
    assert.ok(joined.includes('big-low-hit'));

    manager.unregisterCache('big-low-hit');
    manager.unregisterCache('small-good-hit');
  });

  it('generates good-health recommendation when usage is low and hit rate is high', async () => {
    const manager = UnifiedCacheManager.getInstance() as any;
    manager.GLOBAL_MAX_SIZE = 1000;
    manager.registerCache({
      name: 'healthy',
      getStats: () => ({ entries: 1, size: 50, hits: 8, misses: 2, hitRate: 0.8 }),
      clear: () => {},
    });

    const stats = await manager.getGlobalStats();
    assert.ok(
      stats.recommendations.some(
        (r: string) => r.includes('Good cache hit rate') || r.includes('health is good'),
      ),
    );

    manager.unregisterCache('healthy');
  });
});
