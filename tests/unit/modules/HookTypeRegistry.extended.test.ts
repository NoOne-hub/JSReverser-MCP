import { describe, it } from 'node:test';
import assert from 'node:assert';
import { HookCodeBuilder } from '../../../src/modules/hook/HookCodeBuilder.js';
import { HookTypeRegistry } from '../../../src/modules/hook/HookTypeRegistry.js';

describe('HookTypeRegistry extended', () => {
  it('contains built-in plugins and supports register/unregister', () => {
    const r = new HookTypeRegistry();
    const names = r.list().map((p) => p.name);
    assert.ok(names.includes('function'));
    assert.ok(names.includes('fetch'));
    assert.ok(names.includes('custom'));

    r.register({
      name: 'tmp',
      description: 'tmp',
      apply(builder) {
        return builder.intercept('window.tmp');
      },
    });
    assert.strictEqual(r.has('tmp'), true);
    assert.strictEqual(r.unregister('tmp'), true);
    assert.strictEqual(r.has('tmp'), false);
  });

  it('applies plugins and builds custom scripts for many builtins', () => {
    const r = new HookTypeRegistry();
    const cases: Array<{ name: string; params: Record<string, unknown> }> = [
      { name: 'function', params: { target: 'window.alert' } },
      { name: 'fetch', params: { urlPattern: '/api' } },
      { name: 'xhr', params: { urlPattern: '/api' } },
      { name: 'websocket', params: { urlPattern: 'ws' } },
      { name: 'property', params: { object: 'window', property: 'name' } },
      { name: 'event', params: { eventName: 'click' } },
      { name: 'timer', params: { timerType: 'both' } },
      { name: 'localstorage', params: { keyPattern: 'token' } },
      { name: 'cookie', params: {} },
      { name: 'eval', params: {} },
      { name: 'object-method', params: { object: 'window', method: 'fetch' } },
      { name: 'custom', params: { script: 'return 1;' } },
    ];

    for (const c of cases) {
      const plugin = r.get(c.name);
      assert.ok(plugin, `plugin ${c.name} should exist`);
      const builder = new HookCodeBuilder(`id-${c.name}`);
      plugin!.apply(builder, c.params);
      const built = plugin!.customBuild ? plugin!.customBuild(builder, c.params) : builder.build();
      const script = built || builder.build();
      assert.ok(typeof script === 'string' && script.length > 0);
    }
  });

  it('throws for missing required params in strict plugins', () => {
    const r = new HookTypeRegistry();
    const p1 = r.get('function')!;
    const p2 = r.get('property')!;
    const p3 = r.get('object-method')!;
    const p4 = r.get('custom')!;

    assert.throws(() => p1.apply(new HookCodeBuilder('a'), {}), /required/);
    assert.throws(() => p2.apply(new HookCodeBuilder('b'), {}), /required/);
    assert.throws(() => p3.apply(new HookCodeBuilder('c'), {}), /required/);
    // custom plugin validates required fields in customBuild path
    assert.throws(
      () => (p4.customBuild ? p4.customBuild(new HookCodeBuilder('d'), {}) : null),
      /required/,
    );
  });
});
