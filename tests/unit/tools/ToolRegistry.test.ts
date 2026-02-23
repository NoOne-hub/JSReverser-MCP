import {describe, it} from 'node:test';
import assert from 'node:assert';
import {ToolRegistry} from '../../../src/tools/ToolRegistry.js';
import {ToolCategory} from '../../../src/tools/categories.js';
import {zod} from '../../../src/third_party/index.js';

describe('ToolRegistry', () => {
  it('registers and retrieves tools', () => {
    const registry = new ToolRegistry();
    const tool = {
      name: 'sample_tool',
      description: 'sample',
      annotations: {category: ToolCategory.DEBUGGING, readOnlyHint: true},
      schema: {input: zod.string()},
      handler: async () => {},
    };

    registry.register(tool);

    assert.ok(registry.get('sample_tool'));
    assert.strictEqual(registry.getByCategory(ToolCategory.DEBUGGING).length, 1);
  });

  it('rejects duplicated tool names', () => {
    const registry = new ToolRegistry();
    const tool = {
      name: 'dup_tool',
      description: 'sample',
      annotations: {category: ToolCategory.DEBUGGING, readOnlyHint: true},
      schema: {},
      handler: async () => {},
    };

    registry.register(tool);

    assert.throws(() => registry.register(tool), /Tool name conflict: dup_tool/);
  });

  it('covers registerMany/values/validateName/get-miss', () => {
    const registry = new ToolRegistry();
    const tools = [
      {
        name: 'tool_a',
        description: 'a',
        annotations: {category: ToolCategory.NAVIGATION, readOnlyHint: true},
        schema: {},
        handler: async () => {},
      },
      {
        name: 'tool_b',
        description: 'b',
        annotations: {category: ToolCategory.DEBUGGING, readOnlyHint: false},
        schema: {},
        handler: async () => {},
      },
    ];

    registry.registerMany(tools);

    assert.strictEqual(registry.values().length, 2);
    assert.strictEqual(registry.validateName('tool_a'), false);
    assert.strictEqual(registry.validateName('tool_new'), true);
    assert.strictEqual(registry.get('missing_tool'), undefined);
    assert.strictEqual(registry.getByCategory(ToolCategory.NAVIGATION).length, 1);
  });

  it('supports aliases and validates alias conflicts', () => {
    const registry = new ToolRegistry();
    const tool = {
      name: 'canonical_tool',
      aliases: ['legacy_tool', 'compat_tool'],
      description: 'sample',
      annotations: {category: ToolCategory.DEBUGGING, readOnlyHint: true},
      schema: {},
      handler: async () => {},
    };

    registry.register(tool);

    assert.ok(registry.get('canonical_tool'));
    assert.ok(registry.get('legacy_tool'));
    assert.strictEqual(registry.get('legacy_tool')?.name, 'canonical_tool');
    assert.strictEqual(registry.validateName('legacy_tool'), false);
    assert.deepStrictEqual(registry.aliasesFor('canonical_tool').sort(), ['compat_tool', 'legacy_tool']);
    assert.ok(registry.aliasEntries().some((entry) => entry.alias === 'legacy_tool' && entry.canonical === 'canonical_tool'));

    assert.throws(() => {
      registry.register({
        name: 'legacy_tool',
        description: 'conflict',
        annotations: {category: ToolCategory.DEBUGGING, readOnlyHint: true},
        schema: {},
        handler: async () => {},
      });
    }, /Tool name conflicts with alias/);

    assert.throws(() => {
      registry.register({
        name: 'other_tool',
        aliases: ['compat_tool'],
        description: 'conflict',
        annotations: {category: ToolCategory.DEBUGGING, readOnlyHint: true},
        schema: {},
        handler: async () => {},
      });
    }, /Tool alias conflict/);
  });
});
