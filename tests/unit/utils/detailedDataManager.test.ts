import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import { DetailedDataManager } from '../../../src/utils/detailedDataManager.js';

describe('DetailedDataManager', () => {
  beforeEach(() => {
    (DetailedDataManager as any).instance = undefined;
  });

  it('returns original data for small payload in smartHandle', () => {
    const manager = DetailedDataManager.getInstance();
    const data = { small: true };
    const result = manager.smartHandle(data, 1024);
    assert.deepStrictEqual(result, data);
  });

  it('returns summary response for large payload in smartHandle', () => {
    const manager = DetailedDataManager.getInstance();
    const data = { text: 'x'.repeat(3000), fn: () => 'ok' };
    const result = manager.smartHandle(data, 10) as any;

    assert.ok(result.detailId.startsWith('detail_'));
    assert.strictEqual(result.summary.type, 'object');
    assert.ok(result.summary.preview.length > 0);
    assert.ok(typeof result.expiresAt === 'number');
  });

  it('stores and retrieves full data and path values', () => {
    const manager = DetailedDataManager.getInstance();
    const data = { a: { b: 42 } };
    const id = manager.store(data);

    assert.deepStrictEqual(manager.retrieve(id), data);
    assert.strictEqual(manager.retrieve(id, 'a.b'), 42);
  });

  it('throws for missing, expired, and invalid path retrieval', async () => {
    const manager = DetailedDataManager.getInstance();

    assert.throws(() => manager.retrieve('missing-id'), /not found or expired/);

    const expiredId = manager.store({ x: 1 }, 1);
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.throws(() => manager.retrieve(expiredId), /expired/);

    const id = manager.store({ a: null });
    assert.throws(() => manager.retrieve(id, 'a.b.c'), /Path not found/);
  });

  it('auto-extends expiring entries on access and supports manual extend', () => {
    const manager = DetailedDataManager.getInstance();
    const id = manager.store({ x: 1 }, 10);
    const statsBefore = manager.getDetailedStats().find((x) => x.detailId === id);
    assert.ok(statsBefore);

    manager.retrieve(id);
    const statsAfterAccess = manager.getDetailedStats().find((x) => x.detailId === id);
    assert.ok(statsAfterAccess);
    assert.ok(statsAfterAccess!.remainingSeconds >= statsBefore!.remainingSeconds);

    manager.extend(id, 1000);
    const statsAfterExtend = manager.getDetailedStats().find((x) => x.detailId === id);
    assert.ok(statsAfterExtend);
    assert.ok(statsAfterExtend!.remainingSeconds >= statsAfterAccess!.remainingSeconds);
  });

  it('evicts least recently used entry when cache is full', () => {
    const manager = DetailedDataManager.getInstance() as any;
    const ids: string[] = [];

    for (let i = 0; i < 100; i++) {
      ids.push(manager.store({ i }));
    }

    manager.retrieve(ids[99]);
    manager.store({ extra: true });

    assert.strictEqual(manager.getStats().cacheSize, 100);
    assert.throws(() => manager.retrieve(ids[0]), /not found or expired/);
    assert.deepStrictEqual(manager.retrieve(ids[99]), { i: 99 });
  });

  it('provides stats and clear functionality', () => {
    const manager = DetailedDataManager.getInstance();
    const id = manager.store({ foo: 'bar' });
    manager.retrieve(id);

    const stats = manager.getStats();
    assert.ok(stats.cacheSize >= 1);
    assert.ok(Number(stats.totalSizeKB) >= 0);
    assert.ok(Number(stats.avgAccessCount) >= 0);
    assert.strictEqual(stats.autoExtendEnabled, true);

    const details = manager.getDetailedStats();
    assert.ok(details.length >= 1);
    assert.ok(details[0].detailId.startsWith('detail_'));

    manager.clear();
    assert.strictEqual(manager.getStats().cacheSize, 0);
  });
});

