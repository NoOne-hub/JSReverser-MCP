import {describe, it} from 'node:test';
import assert from 'node:assert';
import fc from 'fast-check';
import {parseArguments} from '../../src/cli.js';
import * as scriptTools from '../../src/tools/script.js';

describe('Property 3/27/28: Backward compatibility', () => {
  it('Property 3/27: original tools preserved', () => {
    const names = Object.values(scriptTools).map((t: any) => t.name);
    assert.ok(names.includes('evaluate_script'));
  });

  it('Property 28: CLI parameter compatibility', () => {
    fc.assert(
      fc.property(fc.boolean(), fc.boolean(), (headless, isolated) => {
        const argv = ['node', 'mcp'];
        if (headless) argv.push('--headless');
        if (isolated) argv.push('--isolated');
        const parsed = parseArguments('1.0.0', argv);
        assert.strictEqual(typeof parsed.headless, 'boolean');
        assert.strictEqual(typeof parsed.isolated, 'boolean');
      }),
      {numRuns: 100},
    );
  });
});
