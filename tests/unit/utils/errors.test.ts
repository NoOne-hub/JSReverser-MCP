import {describe, it} from 'node:test';
import assert from 'node:assert';
import {ErrorCodes, formatError} from '../../../src/utils/errors.js';

describe('error formatting', () => {
  it('formats Error instances', () => {
    const result = formatError(new Error('boom'), ErrorCodes.TOOL_EXECUTION_ERROR, {
      tool: 'x',
    });

    assert.strictEqual(result.code, ErrorCodes.TOOL_EXECUTION_ERROR);
    assert.strictEqual(result.type, 'Error');
    assert.strictEqual(result.message, 'boom');
    assert.deepStrictEqual(result.context, {tool: 'x'});
  });

  it('formats unknown values', () => {
    const result = formatError('bad');

    assert.strictEqual(result.type, 'UnknownError');
    assert.strictEqual(result.message, 'bad');
  });
});
