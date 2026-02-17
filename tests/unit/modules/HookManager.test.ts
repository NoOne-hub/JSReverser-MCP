import {describe, it} from 'node:test';
import assert from 'node:assert';
import {HookManager} from '../../../src/modules/hook/HookManager.js';

describe('HookManager', () => {
  it('creates/lists/removes hooks', () => {
    const manager = new HookManager();

    const created = manager.create({
      type: 'fetch',
      params: {},
      description: 'fetch hook',
    });

    assert.ok(created.hookId);
    assert.ok(created.script.includes('fetch'));
    assert.strictEqual(manager.getAllHooks().length, 1);

    const removed = manager.remove(created.hookId);
    assert.strictEqual(removed, true);
    assert.strictEqual(manager.getAllHooks().length, 0);
  });
});
