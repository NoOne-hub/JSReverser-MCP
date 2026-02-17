import { describe, it } from 'node:test';
import assert from 'node:assert';
import { HookManager } from '../../../src/modules/hook/HookManager.js';

describe('HookManager extended', () => {
  it('creates hooks from options/builder/config and manages lifecycle', () => {
    const m = new HookManager(2);

    const created = m.create({
      type: 'function',
      params: { target: 'window.fetch' },
      description: 'fetch monitor',
      action: 'log',
      capture: { args: true, returnValue: true, stack: 3, timing: true, thisContext: true },
      condition: { expression: 'args.length>0', maxCalls: 2, minInterval: 10, urlPattern: '/api' },
      lifecycle: { before: 'a=1;', after: 'b=2;', onError: 'c=3;', onFinally: 'd=4;' },
      store: { globalKey: '__s', maxRecords: 2, console: true, consoleFormat: 'compact' },
      asyncAware: true,
    });
    assert.ok(created.script.includes('window.fetch'));

    const created2 = m.createWithBuilder(
      (b) => b.id('custom-1').intercept('window.alert').captureArgs(),
      { type: 'custom', description: 'custom hook' },
    );
    assert.strictEqual(created2.hookId, 'custom-1');

    const created3 = m.createFromConfig({
      target: { expression: 'window.setTimeout', label: 'setTimeout' },
      capture: {},
      condition: {},
      store: { globalKey: '__hookStore', maxRecords: 10, console: true, consoleFormat: 'compact' },
      lifecycle: {},
      action: 'log',
      hookId: 'restored-1',
      asyncAware: false,
      description: 'restored',
    });
    assert.strictEqual(created3.hookId, 'restored-1');

    assert.ok(m.getHook(created.hookId));
    assert.ok(m.getAllHooks().length >= 3);
    assert.strictEqual(m.disable(created.hookId), true);
    assert.strictEqual(m.enable(created.hookId), true);
    assert.strictEqual(m.remove('not-exists'), false);
    assert.strictEqual(m.remove(created2.hookId), true);
  });

  it('records/exports data and reports stats', () => {
    const m = new HookManager(2);
    const { hookId } = m.create({ type: 'function', params: { target: 'window.fetch' } });

    m.addRecord(hookId, { hookId, timestamp: 1, target: 'window.fetch', a: 1 });
    m.addRecord(hookId, { hookId, timestamp: 2, target: 'window.fetch', a: 2 });
    m.addRecord(hookId, { hookId, timestamp: 3, target: 'window.fetch', a: 3 });
    const records = m.getRecords(hookId);
    assert.strictEqual(records.length, 2);

    const json = m.exportData('json');
    assert.ok(json.includes(hookId));
    const csv = m.exportData('csv');
    assert.ok(csv.includes('hookId,type,timestamp,target,data'));

    const stats = m.getStats();
    assert.ok(stats.totalHooks >= 1);
    assert.ok(stats.registeredTypes.length > 0);

    m.clearRecords(hookId);
    assert.strictEqual(m.getRecords(hookId).length, 0);
    m.clearAll();
    assert.strictEqual(m.getAllHooks().length, 0);
  });

  it('generates utility scripts and errors on unknown type', () => {
    const m = new HookManager();
    const anti = m.generateAntiDebugBypass();
    const collector = m.generateDataCollectorScript('__s');
    assert.ok(anti.includes('Anti-debug bypass'));
    assert.ok(collector.includes('__getHookData'));

    assert.throws(
      () => m.create({ type: 'unknown-type' }),
      /Unknown hook type/,
    );
  });
});

