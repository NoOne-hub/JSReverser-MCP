import {describe, it} from 'node:test';
import assert from 'node:assert';
import {CodeCompressor} from '../../src/modules/collector/CodeCompressor.js';
import {ToolExecutionScheduler} from '../../src/utils/ToolExecutionScheduler.js';

const runPerf = process.env.RUN_PERF_TESTS === 'true';

describe('Performance Tests', {skip: !runPerf}, () => {
  it('collector/compressor handles large payload efficiently', async () => {
    const compressor = new CodeCompressor();
    const payload = 'const a=1;'.repeat(30000);
    const start = Date.now();
    const compressed = await compressor.compress(payload);
    const elapsed = Date.now() - start;
    assert.ok(compressed.compressedSize > 0);
    assert.ok(elapsed < 4000);
  });

  it('concurrency scheduler scales read-only calls', async () => {
    const scheduler = new ToolExecutionScheduler();
    const start = Date.now();
    await Promise.all(Array.from({length: 8}, () => scheduler.execute(true, async () => 1)));
    const elapsed = Date.now() - start;
    assert.ok(elapsed < 500);
  });
});
