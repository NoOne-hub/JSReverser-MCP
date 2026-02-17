import {describe, it} from 'node:test';
import assert from 'node:assert';
import {UnifiedCacheManager} from '../../../src/utils/UnifiedCacheManager.js';

describe('UnifiedCacheManager', () => {
  it('registers caches and returns global stats', async () => {
    const manager = UnifiedCacheManager.getInstance();
    manager.registerCache({
      name: 'mock-cache',
      getStats: () => ({entries: 2, size: 1024, hits: 1, misses: 1, hitRate: 0.5}),
      clear: () => {},
    });

    const stats = await manager.getGlobalStats();
    assert.ok(stats.totalEntries >= 2);
    assert.ok(stats.totalSize >= 1024);

    manager.unregisterCache('mock-cache');
  });
});
