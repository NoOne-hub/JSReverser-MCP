import {describe, it} from 'node:test';
import assert from 'node:assert';
import {Deobfuscator} from '../../../src/modules/deobfuscator/Deobfuscator.js';

describe('Deobfuscator', () => {
  it('deobfuscates basic source and returns structured result', async () => {
    const deobfuscator = new Deobfuscator();
    const result = await deobfuscator.deobfuscate({
      code: 'function a(){return 1+2;} a();',
      aggressive: false,
      renameVariables: false,
      auto: false,
      unpack: false,
      advanced: false,
      jsvmp: false,
      astOptimize: false,
    });

    assert.ok(typeof result.code === 'string');
    assert.ok(Array.isArray(result.transformations));
    assert.ok(Array.isArray(result.obfuscationType));
  });
});
