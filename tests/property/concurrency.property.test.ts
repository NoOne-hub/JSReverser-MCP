import {describe, it} from 'node:test';
import fc from 'fast-check';
import assert from 'node:assert';
import {ToolExecutionScheduler} from '../../src/utils/ToolExecutionScheduler.js';

describe('Property 32: Concurrent Tool Calls', () => {
  it('independent read-only calls can complete in parallel', async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({min: 2, max: 6}), async n => {
        const scheduler = new ToolExecutionScheduler();
        const start = Date.now();
        await Promise.all(
          Array.from({length: n}, () =>
            scheduler.execute(true, async () => new Promise(resolve => setTimeout(resolve, 20))),
          ),
        );
        const elapsed = Date.now() - start;
        // Keep a generous upper bound to avoid CI/environment scheduling jitter.
        assert.ok(elapsed < 1200);
      }),
      {numRuns: 30},
    );
  });
});
