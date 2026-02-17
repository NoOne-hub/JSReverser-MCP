import { describe, it } from 'node:test';
import assert from 'node:assert';
import { safeParse, safeStringify } from '../../../src/utils/safeJson.js';

describe('safeJson', () => {
  it('serializes primitive and special values safely', () => {
    const input = {
      a: undefined,
      b: BigInt(42),
      c: function hello() {},
      d: Symbol('tag'),
    };

    const text = safeStringify(input);
    assert.ok(text.includes('[undefined]'));
    assert.ok(text.includes('[BigInt: 42]'));
    assert.ok(text.includes('[Function: hello]'));
    assert.ok(text.includes('[Symbol: Symbol(tag)]'));
  });

  it('serializes Error and RegExp objects, keeps Date as ISO string', () => {
    const input = {
      err: new Error('boom'),
      re: /abc/gi,
      dt: new Date('2024-01-02T03:04:05.000Z'),
    };

    const text = safeStringify(input);
    const parsed = JSON.parse(text);

    assert.strictEqual(parsed.err.__type, 'Error');
    assert.strictEqual(parsed.err.message, 'boom');
    assert.strictEqual(parsed.re.__type, 'RegExp');
    assert.strictEqual(parsed.re.source, 'abc');
    assert.strictEqual(parsed.re.flags, 'gi');
    assert.strictEqual(parsed.dt, '2024-01-02T03:04:05.000Z');
  });

  it('handles circular references', () => {
    const obj: Record<string, unknown> = { name: 'root' };
    obj.self = obj;

    const text = safeStringify(obj);
    assert.ok(text.includes('[Circular Reference]'));
  });

  it('supports custom maxDepth argument without throwing', () => {
    const deep = { a: { b: { c: { d: { e: 1 } } } } };
    const text = safeStringify(deep, 0, 2);
    assert.ok(text.includes('"e":1'));
  });

  it('returns serialization error string when stringify throws', () => {
    const broken = {
      toJSON() {
        throw new Error('toJSON failed');
      },
    };

    const text = safeStringify(broken);
    assert.ok(text.startsWith('[Serialization Error:'));
  });

  it('parses valid JSON and returns null for invalid JSON', () => {
    assert.deepStrictEqual(safeParse('{"ok":true}'), { ok: true });
    assert.strictEqual(safeParse('{"bad":'), null);
  });
});
