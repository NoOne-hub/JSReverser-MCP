import { describe, it } from 'node:test';
import assert from 'node:assert';
import { ASTOptimizer } from '../../../src/modules/deobfuscator/ASTOptimizer.js';

describe('ASTOptimizer', () => {
  it('optimizes constants, dead code, inlining, and object/computed properties', () => {
    const optimizer = new ASTOptimizer();
    const code = `
      const a = 1 + 2;
      const b = "x" + "y";
      const c = -5;
      const d = !0;
      const e = !false;
      if (true) { var keep = 1; } else { var drop = 2; }
      const t = true ? 1 : 2;
      const f = false || 9;
      const g = true && 10;
      const h = x + 0;
      const i = y * 1;
      const j = z * 0;
      const k = !!n;
      const v = 7; console.log(v);
      const obj = {"k": 1, ['validName']: 2};
      console.log(obj['k'], obj['validName']);
      (foo(), bar());
    `;

    const out = optimizer.optimize(code);
    assert.ok(out.includes('const a = 3;'));
    assert.ok(out.includes('const b = "xy";'));
    assert.ok(out.includes('const c = -5;'));
    assert.ok(out.includes('const t = 1;'));
    assert.ok(out.includes('const f = 9;'));
    assert.ok(out.includes('const g = 10;'));
    assert.ok(out.includes('const j = 0;'));
    assert.ok(out.includes('Boolean(n)'));
    assert.ok(out.includes('obj.k'));
    assert.ok(out.includes('obj.validName'));
    assert.ok(out.includes('foo();'));
    assert.ok(out.includes('bar();'));
  });

  it('returns original code when parse fails', () => {
    const optimizer = new ASTOptimizer();
    const broken = 'const a = ;';
    const out = optimizer.optimize(broken);
    assert.strictEqual(out, broken);
  });
});
