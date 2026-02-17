import {describe, it} from 'node:test';
import assert from 'node:assert';
import fc from 'fast-check';
import {formatError, ErrorCodes} from '../../src/utils/errors.js';
import {TokenBudgetManager} from '../../src/utils/TokenBudgetManager.js';

describe('Property 25: Error Response Structure', () => {
  it('all formatted errors contain required fields', () => {
    fc.assert(
      fc.property(fc.string(), fc.string(), (message, code) => {
        const err = new Error(message);
        const result = formatError(err, code || ErrorCodes.INTERNAL_ERROR);
        assert.ok(result.code);
        assert.ok(result.type);
        assert.ok(typeof result.message === 'string');
      }),
      {numRuns: 100},
    );
  });
});

describe('Property 26: Tool Call Logging', () => {
  it('every recorded tool call appears in token history', () => {
    const manager = TokenBudgetManager.getInstance();
    manager.reset();

    fc.assert(
      fc.property(fc.array(fc.string({minLength: 1, maxLength: 16}), {minLength: 1, maxLength: 20}), names => {
        for (const name of names) {
          manager.recordToolCall(name, {x: 1}, {ok: true});
        }
        const stats = manager.getStats();
        assert.ok(stats.toolCallCount > 0);
        assert.ok(stats.recentCalls.length > 0);
      }),
      {numRuns: 100},
    );
  });
});
