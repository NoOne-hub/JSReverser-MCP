import {describe, it} from 'node:test';
import assert from 'node:assert';
import {ToolExecutionScheduler} from '../../../src/utils/ToolExecutionScheduler.js';

describe('ToolExecutionScheduler', () => {
  it('serializes write operations', async () => {
    const scheduler = new ToolExecutionScheduler();
    const order: string[] = [];

    await Promise.all([
      scheduler.execute(false, async () => {
        await new Promise(resolve => setTimeout(resolve, 30));
        order.push('a');
        return 1;
      }),
      scheduler.execute(false, async () => {
        order.push('b');
        return 2;
      }),
    ]);

    assert.deepStrictEqual(order, ['a', 'b']);
  });

  it('allows read-only operations to run concurrently', async () => {
    const scheduler = new ToolExecutionScheduler();
    const start = Date.now();
    await Promise.all([
      scheduler.execute(true, async () => new Promise(resolve => setTimeout(resolve, 40))),
      scheduler.execute(true, async () => new Promise(resolve => setTimeout(resolve, 40))),
    ]);
    const elapsed = Date.now() - start;
    assert.ok(elapsed < 75);
  });
});
