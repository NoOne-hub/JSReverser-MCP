import { describe, it } from 'node:test';
import assert from 'node:assert';
import { Deobfuscator } from '../../../src/modules/deobfuscator/Deobfuscator.js';

describe('Deobfuscator extended', () => {
  it('detects multiple obfuscation signatures', () => {
    const d = new Deobfuscator() as any;
    const code = `
      var _0xabc=['a'];
      eval(atob("YWJj")); Function("return 1");
      while(!![]){switch(x){case 0:break;}}
      if(false){a()}
      \\x61 \\u0062 __webpack_require__ webpackJsonp
    `;
    const types = d.detectObfuscationType(code);
    assert.ok(types.includes('javascript-obfuscator'));
    assert.ok(types.includes('vm-protection'));
    assert.ok(types.includes('control-flow-flattening'));
    assert.ok(types.includes('dead-code-injection'));
    assert.ok(types.includes('hex-encoding'));
    assert.ok(types.includes('webpack'));
  });

  it('runs basic transform/decode/extract/decrypt/simplify/rename', async () => {
    const d = new Deobfuscator() as any;
    const ts: any[] = [];

    const basic = await d.basicTransform('if(true){a=1+2;} else {a=3;}', ts);
    assert.ok(basic.includes('3'));

    const decoded = await d.decodeStrings('const s="\\\\x61\\\\u0062";', ts);
    assert.ok(decoded.includes('ab'));

    await d.extractStringArrays('var _0x1=["hello","world"];', ts);
    const decrypted = await d.decryptArrays('console.log(_0x1[1]);', ts);
    assert.ok(decrypted.includes('"world"'));

    const simplified = await d.simplifyExpressions('const a=!!x;const b=void 0;const c=!0;', ts);
    assert.ok(simplified.includes('undefined'));
    assert.ok(simplified.includes('true'));

    const renamed = await d.renameVariables('var _0xabc=1;console.log(_0xabc);', ts);
    assert.ok(renamed.includes('var_0'));
  });

  it('unflattens simple switch/while control flow', async () => {
    const d = new Deobfuscator() as any;
    const ts: any[] = [];
    const code = `
      var order = "0|1".split("|"), i = 0;
      while(true){
        switch(order[i++]){
          case "0": foo(); continue;
          case "1": bar(); break;
        }
        break;
      }
    `;
    const out = await d.unflattenControlFlow(code, ts);
    assert.ok(out.includes('foo()') || out.includes('bar()'));
  });

  it('supports shouldRun / merge / scoring helpers', () => {
    const d = new Deobfuscator() as any;
    assert.strictEqual(d.shouldRun(true, false, [], []), true);
    assert.strictEqual(d.shouldRun(false, true, ['packer'], ['packer']), false);
    assert.strictEqual(d.shouldRun(undefined, true, ['packer'], ['packer']), true);

    const merged = d.mergeObfuscationTypes(['unknown'], [
      { type: 'unpack', description: 'Unpacked Packer obfuscation', success: true },
      { type: 'advanced', description: 'contains control-flow-flattening', success: true },
    ]);
    assert.ok(merged.includes('packer'));
    assert.ok(merged.includes('control-flow-flattening'));
    assert.ok(!merged.includes('unknown'));

    const confidence = d.calculateConfidence([{ success: true }, { success: false }], 50);
    assert.ok(confidence >= 0 && confidence <= 1);
    const readability = d.calculateReadabilityScore('const abc = 1;\n// comment');
    assert.ok(readability > 0);
  });

  it('handles LLM analysis success and failure', async () => {
    const llmOk = {
      generateDeobfuscationPrompt: (code: string) => [{ role: 'user', content: code }],
      chat: async () => ({ content: 'analysis ok' }),
    };
    const d1 = new Deobfuscator(llmOk as any) as any;
    const r1 = await d1.llmAnalysis('code');
    assert.strictEqual(r1, 'analysis ok');

    const llmFail = {
      generateDeobfuscationPrompt: () => [{ role: 'user', content: 'x' }],
      chat: async () => {
        throw new Error('llm down');
      },
    };
    const d2 = new Deobfuscator(llmFail as any) as any;
    const r2 = await d2.llmAnalysis('code');
    assert.strictEqual(r2, null);
  });

  it('handles runUnpack/runJSVMP/runAdvanced/runASTOptimizer branches', async () => {
    const d = new Deobfuscator() as any;
    const ts: any[] = [];
    const warnings: string[] = [];
    const unresolved: any[] = [];

    d.universalUnpacker = {
      deobfuscate: async () => ({ success: true, code: 'unpacked', type: 'packer' }),
    };
    const unpacked = await d.runUnpack('x', ts);
    assert.strictEqual(unpacked, 'unpacked');

    d.jsvmpDeobfuscator = {
      deobfuscate: async () => ({
        isJSVMP: true,
        confidence: 0.8,
        vmType: 'switch',
        warnings: ['w1'],
        unresolvedParts: [{ id: 1 }],
        deobfuscatedCode: 'jsvmp-out',
      }),
    };
    const jsvmp = await d.runJSVMP('x', {}, ts, warnings, unresolved);
    assert.strictEqual(jsvmp, 'jsvmp-out');
    assert.ok(warnings.length > 0);
    assert.ok(unresolved.length > 0);

    d.advancedDeobfuscator = {
      deobfuscate: async () => ({
        code: 'advanced-out',
        warnings: ['w2'],
        detectedTechniques: ['invisible-unicode'],
        confidence: 0.7,
      }),
    };
    const adv = await d.runAdvanced('x', {}, ts, warnings);
    assert.strictEqual(adv, 'advanced-out');

    d.astOptimizer = { optimize: (code: string) => `${code}//opt` };
    const opt = await d.runASTOptimizer('x', ts);
    assert.ok(opt.includes('//opt'));
  });

  it('builds cache key and evicts old entries', () => {
    const d = new Deobfuscator() as any;
    const k1 = d.generateCacheKey({ code: 'a', aggressive: false });
    const k2 = d.generateCacheKey({ code: 'b', aggressive: false });
    assert.notStrictEqual(k1, k2);

    d.maxCacheSize = 2;
    d.cacheResult('k1', { code: '1' });
    d.cacheResult('k2', { code: '2' });
    d.cacheResult('k3', { code: '3' });
    assert.strictEqual(d.resultCache.has('k1'), false);
    assert.strictEqual(d.resultCache.has('k3'), true);
    d.clearCache();
    assert.strictEqual(d.resultCache.size, 0);
    assert.strictEqual(d.stringArrays.size, 0);
  });

  it('runs full deobfuscate pipeline and returns cached result on second call', async () => {
    const d = new Deobfuscator() as any;
    d.detectObfuscationType = () => ['vm-protection', 'custom'];
    d.runUnpack = async (code: string, ts: any[]) => {
      ts.push({ type: 'unpack', success: true, description: 'u' });
      return `${code}//u`;
    };
    d.runJSVMP = async (code: string, _o: any, ts: any[], ws: string[], ur: any[]) => {
      ts.push({ type: 'jsvmp', success: true, description: 'j' });
      ws.push('w');
      ur.push({ location: 'x', reason: 'y', suggestion: 'z' });
      return `${code}//j`;
    };
    d.runAdvanced = async (code: string, _o: any, ts: any[], ws: string[]) => {
      ts.push({ type: 'advanced', success: true, description: 'a' });
      ws.push('aw');
      return `${code}//a`;
    };
    d.extractStringArrays = async (code: string) => code;
    d.basicTransform = async (code: string) => code;
    d.decodeStrings = async (code: string) => code;
    d.decryptArrays = async (code: string) => code;
    d.unflattenControlFlow = async (code: string) => code;
    d.simplifyExpressions = async (code: string) => code;
    d.runASTOptimizer = async (code: string, ts: any[]) => {
      ts.push({ type: 'ast-optimize', success: true, description: 'o' });
      return `${code}//o`;
    };
    d.renameVariables = async (code: string) => `${code}//r`;
    d.llm = { chat: async () => ({ content: 'analysis' }) };
    d.llmAnalysis = async () => 'analysis';

    const opts = {
      code: 'const x = 1;',
      auto: true,
      aggressive: true,
      astOptimize: true,
      renameVariables: true,
      llm: true,
    };

    const r1 = await d.deobfuscate(opts);
    assert.ok(r1.code.includes('//r'));
    assert.ok(r1.transformations.length >= 4);
    assert.ok(Array.isArray(r1.warnings));
    assert.ok(Array.isArray(r1.unresolvedParts));

    const r2 = await d.deobfuscate(opts);
    assert.strictEqual(r2, r1);
  });

  it('propagates deobfuscate pipeline fatal error', async () => {
    const d = new Deobfuscator() as any;
    d.detectObfuscationType = () => ['custom'];
    d.extractStringArrays = async () => {
      throw new Error('pipeline crash');
    };
    await assert.rejects(
      async () => {
        await d.deobfuscate({ code: 'x' });
      },
      /pipeline crash/,
    );
  });

  it('covers parser-failure catch branches in helper transforms', async () => {
    const d = new Deobfuscator() as any;
    const ts: any[] = [];
    const bad = 'const = ;';

    const a = await d.extractStringArrays(bad, ts);
    const b = await d.decodeStrings(bad, ts);
    const c = await d.decryptArrays(bad, ts);
    const e = await d.unflattenControlFlow(bad, ts);
    const f = await d.simplifyExpressions(bad, ts);
    const g = await d.renameVariables(bad, ts);

    assert.strictEqual(a, bad);
    assert.strictEqual(b, bad);
    assert.strictEqual(c, bad);
    assert.strictEqual(e, bad);
    assert.strictEqual(f, bad);
    assert.strictEqual(g, bad);
    assert.ok(ts.some((t) => t.success === false));
  });
});
