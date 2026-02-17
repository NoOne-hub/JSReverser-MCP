import { describe, it } from 'node:test';
import assert from 'node:assert';
import { zod } from '../../../src/third_party/index.js';
import { CLOSE_PAGE_ERROR, defineTool, timeoutSchema } from '../../../src/tools/ToolDefinition.js';
import { ToolCategory } from '../../../src/tools/categories.js';

describe('ToolDefinition extended', () => {
  it('defines tool and transforms timeout values', () => {
    const tool = defineTool({
      name: 'tmp_tool',
      description: 'temporary',
      annotations: { category: ToolCategory.DEBUGGING, readOnlyHint: true },
      schema: {
        ...timeoutSchema,
      },
      handler: async () => {},
    });

    assert.strictEqual(tool.name, 'tmp_tool');
    assert.strictEqual(tool.annotations.readOnlyHint, true);

    const schema = zod.object(tool.schema);
    const positive = schema.parse({ timeout: 200 });
    const zero = schema.parse({ timeout: 0 });
    const negative = schema.parse({ timeout: -1 });

    assert.strictEqual(positive.timeout, 200);
    assert.strictEqual(zero.timeout, 0);
    assert.strictEqual(negative.timeout, undefined);
  });

  it('exports close-page error text', () => {
    assert.ok(CLOSE_PAGE_ERROR.includes('last open page'));
  });
});
