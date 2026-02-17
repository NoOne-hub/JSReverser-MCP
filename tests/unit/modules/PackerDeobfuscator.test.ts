import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  AAEncodeDeobfuscator,
  PackerDeobfuscator,
  URLEncodeDeobfuscator,
  UniversalUnpacker,
} from '../../../src/modules/deobfuscator/PackerDeobfuscator.js';

describe('PackerDeobfuscator family', () => {
  it('detects packer signatures', () => {
    assert.strictEqual(
      PackerDeobfuscator.detect('eval(function(p,a,c,k,e,d){return p;}(...))'),
      true,
    );
    assert.strictEqual(PackerDeobfuscator.detect('const x = 1;'), false);
  });

  it('deobfuscates with no-detect and warning branches', async () => {
    const p = new PackerDeobfuscator();

    const plain = await p.deobfuscate({ code: 'const x = 1;' });
    assert.strictEqual(plain.success, true);
    assert.strictEqual(plain.iterations, 0);
    assert.strictEqual(plain.code, 'const x = 1;');

    (p as any).unpack = () => 'eval(function(p,a,c,k,e,d){return p;}(...))';
    const warned = await p.deobfuscate({
      code: 'eval(function(p,a,c,k,e,d){return p;}(...))',
      maxIterations: 2,
    });
    assert.strictEqual(warned.success, true);
    assert.strictEqual(warned.iterations, 0);
    assert.ok(warned.warnings.some((w: string) => w.includes('解包失败')));
  });

  it('covers unpack/parse/execute/base/beautify private flows', () => {
    const p = new PackerDeobfuscator() as any;

    const code = "eval(function(p,a,c,k,e,d){return p;}('0 1',62,2,'hello|world',0,{}))";
    const unpacked = p.unpack(code);
    assert.strictEqual(unpacked, 'hello world');

    const noMatch = p.unpack('not packer');
    assert.strictEqual(noMatch, 'not packer');

    assert.strictEqual(p.parsePackerParams('1,2,3'), null);
    assert.strictEqual(p.parsePackerParams('a('), null);

    const parsed = p.parsePackerParams("'0',10,1,'x',0,{}");
    assert.ok(parsed);
    assert.strictEqual(parsed.p, '0');
    assert.strictEqual(parsed.a, 10);

    const executed = p.executeUnpacker({
      p: '0 1',
      a: 62,
      c: 2,
      k: ['alpha', 'beta'],
      e: () => null,
      d: () => '',
    });
    assert.strictEqual(executed, 'alpha beta');

    assert.strictEqual(p.base(0, 62), '0');
    assert.strictEqual(p.base(61, 62), 'Z');

    const pretty = p.beautify('if(true){a();}b();');
    assert.ok(pretty.includes('\n'));
    assert.ok(pretty.includes('a();'));
  });

  it('handles packer deobfuscate exception branch', async () => {
    const p = new PackerDeobfuscator() as any;
    p.unpack = () => {
      throw new Error('boom');
    };

    const result = await p.deobfuscate({
      code: 'eval(function(p,a,c,k,e,d){return p;}(...))',
      maxIterations: 1,
    });

    assert.strictEqual(result.success, false);
    assert.ok(result.warnings.some((w: string) => w.includes('boom')));
  });

  it('covers AAEncode and URLEncode detectors + decode fallback', async () => {
    const aa = new AAEncodeDeobfuscator();
    assert.strictEqual(AAEncodeDeobfuscator.detect('゜-゜'), true);
    assert.strictEqual(AAEncodeDeobfuscator.detect('plain'), false);
    assert.strictEqual(await aa.deobfuscate("'decoded'"), 'decoded');
    assert.strictEqual(await aa.deobfuscate('('), '(');

    const url = new URLEncodeDeobfuscator();
    assert.strictEqual(URLEncodeDeobfuscator.detect('%61%62%63%64%65%66%67%68%69%6A%6B'), true);
    assert.strictEqual(URLEncodeDeobfuscator.detect('%61%62'), false);
    assert.strictEqual(await url.deobfuscate('%66%6f%6f'), 'foo');
    assert.strictEqual(await url.deobfuscate('%E0%A4%A'), '%E0%A4%A');
  });

  it('covers UniversalUnpacker for each type and unknown', async () => {
    const u = new UniversalUnpacker();

    const packer = await u.deobfuscate("eval(function(p,a,c,k,e,d){return p;}('0',10,1,'ok',0,{}))");
    assert.strictEqual(packer.type, 'Packer');
    assert.strictEqual(packer.success, true);
    assert.strictEqual(packer.code, 'ok');

    const aa = await u.deobfuscate('゜-゜');
    assert.strictEqual(aa.type, 'AAEncode');

    const url = await u.deobfuscate('%66%6f%6f%62%61%72%31%32%33%34%35');
    assert.strictEqual(url.type, 'URLEncode');

    const unknown = await u.deobfuscate('const x = 1;');
    assert.strictEqual(unknown.type, 'Unknown');
    assert.strictEqual(unknown.success, false);
  });
});
