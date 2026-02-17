import {describe, it} from 'node:test';
import assert from 'node:assert';
import fc from 'fast-check';
import {ToolRegistry} from '../../src/tools/ToolRegistry.js';
import {ToolCategory} from '../../src/tools/categories.js';

describe('Property 1: Tool Name Uniqueness', () => {
  it('rejects duplicate names for any generated tool set', () => {
    fc.assert(
      fc.property(
        fc.array(fc.string({minLength: 1, maxLength: 12}), {
          minLength: 1,
          maxLength: 20,
        }),
        names => {
          const registry = new ToolRegistry();

          for (const name of names) {
            const safeName = name.replace(/\s+/g, '_');
            if (!registry.validateName(safeName)) {
              assert.throws(() => {
                registry.register({
                  name: safeName,
                  description: 'x',
                  annotations: {category: ToolCategory.DEBUGGING, readOnlyHint: true},
                  schema: {},
                  handler: async () => {},
                });
              });
              continue;
            }

            registry.register({
              name: safeName,
              description: 'x',
              annotations: {category: ToolCategory.DEBUGGING, readOnlyHint: true},
              schema: {},
              handler: async () => {},
            });
          }
        },
      ),
    );
  });
});
