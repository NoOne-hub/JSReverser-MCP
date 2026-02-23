import {describe, it} from 'node:test';
import assert from 'node:assert';
import {performance} from 'node:perf_hooks';
import {CodeCompressor} from '../../src/modules/collector/CodeCompressor.js';
import {ToolExecutionScheduler} from '../../src/utils/ToolExecutionScheduler.js';

const runPerf = process.env.RUN_PERF_TESTS === 'true';

function percentile(values: number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}

describe('Performance Baseline', {skip: !runPerf}, () => {
  it('keeps compressor p95 under baseline threshold', async () => {
    const compressor = new CodeCompressor();
    const source = 'function x(){return "token";}\n'.repeat(12_000);
    const timings: number[] = [];

    for (let i = 0; i < 8; i += 1) {
      const start = performance.now();
      const result = await compressor.compress(source);
      timings.push(performance.now() - start);
      assert.ok(result.compressedSize > 0);
    }

    assert.ok(percentile(timings, 95) < 2500);
  });

  it('keeps read-only scheduler batch within baseline', async () => {
    const scheduler = new ToolExecutionScheduler();
    const start = performance.now();
    await Promise.all(
      Array.from({length: 20}, () =>
        scheduler.execute(true, async () => {
          let sum = 0;
          for (let i = 0; i < 1_000; i += 1) {
            sum += i;
          }
          return sum;
        }),
      ),
    );
    const elapsed = performance.now() - start;
    assert.ok(elapsed < 1200);
  });
});
