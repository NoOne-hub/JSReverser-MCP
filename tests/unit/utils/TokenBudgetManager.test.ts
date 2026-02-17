import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import { TokenBudgetManager } from '../../../src/utils/TokenBudgetManager.js';
import { DetailedDataManager } from '../../../src/utils/detailedDataManager.js';

describe('TokenBudgetManager', () => {
  beforeEach(() => {
    (TokenBudgetManager as any).instance = undefined;
  });

  it('records tool calls and reports stats', () => {
    const manager = TokenBudgetManager.getInstance();
    manager.recordToolCall('collect_code', { a: 1 }, { data: 'x'.repeat(100) });
    manager.recordToolCall('page_evaluate', { b: 2 }, { data: 'y'.repeat(80) });

    const stats = manager.getStats();
    assert.ok(stats.currentUsage > 0);
    assert.strictEqual(stats.toolCallCount, 2);
    assert.ok(stats.topTools.length >= 1);
    assert.ok(stats.recentCalls.length >= 1);
  });

  it('emits warning levels and triggers auto cleanup path', () => {
    const manager = TokenBudgetManager.getInstance() as any;
    const detailed = DetailedDataManager.getInstance() as any;
    let clearCount = 0;
    const originalClear = detailed.clear.bind(detailed);
    detailed.clear = () => {
      clearCount += 1;
      return originalClear();
    };

    manager.currentUsage = 190000;
    manager.toolCallHistory = [
      {
        toolName: 'collect_code',
        timestamp: Date.now() - 10 * 60 * 1000,
        requestSize: 100,
        responseSize: 100,
        estimatedTokens: 50000,
        cumulativeTokens: 50000,
      },
      {
        toolName: 'collect_code',
        timestamp: Date.now(),
        requestSize: 100,
        responseSize: 100,
        estimatedTokens: 30000,
        cumulativeTokens: 80000,
      },
    ];

    manager.checkWarnings();
    assert.ok(manager.warnings.size >= 1);
    assert.strictEqual(manager.shouldAutoCleanup(), true);

    manager.manualCleanup();
    assert.ok(clearCount >= 1);
    assert.ok(manager.currentUsage <= 80000);
  });

  it('generates actionable suggestions by usage level and top tool', () => {
    const manager = TokenBudgetManager.getInstance() as any;

    manager.currentUsage = 195000;
    const critical = manager.generateSuggestions([
      { tool: 'collect_code', tokens: 150000, percentage: 77 },
    ]);
    assert.ok(critical.some((s: string) => s.includes('CRITICAL')));
    assert.ok(critical.some((s: string) => s.includes('smartMode')));

    manager.currentUsage = 1000;
    const healthy = manager.generateSuggestions([{ tool: 'x', tokens: 100, percentage: 10 }]);
    assert.ok(healthy.some((s: string) => s.includes('healthy')));
  });

  it('resets state completely', () => {
    const manager = TokenBudgetManager.getInstance() as any;
    manager.recordToolCall('a', { p: 1 }, { q: 2 });
    manager.warnings.add(0.8);

    manager.reset();
    const stats = manager.getStats();
    assert.strictEqual(stats.currentUsage, 0);
    assert.strictEqual(stats.toolCallCount, 0);
    assert.strictEqual(stats.warnings.length, 0);
  });
});

