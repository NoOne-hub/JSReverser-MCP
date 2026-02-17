import { describe, it } from 'node:test';
import assert from 'node:assert';
import * as parser from '@babel/parser';
import { JSVMPDeobfuscator } from '../../../src/modules/deobfuscator/JSVMPDeobfuscator.js';

describe('JSVMPDeobfuscator', () => {
  it('detectJSVMP via AST and deobfuscate success path with extracted instructions', async () => {
    const d = new JSVMPDeobfuscator() as any;
    const vmCode = `
      const bc = new Array(60).fill(1);
      let pc = 0;
      while (true) {
        parseInt("" + bc[pc] + bc[pc + 1], 16);
        fn.apply(ctx, args);
        switch(pc){
          case 0: break; case 1: break; case 2: break; case 3: break; case 4: break;
          case 5: break; case 6: break; case 7: break; case 8: break; case 9: break;
          case 10: break; case 11: break;
        }
        pc++;
      }
    `;
    const features = d.detectJSVMP(vmCode);
    assert.ok(features);
    assert.strictEqual(features.hasSwitch, true);
    assert.ok(features.instructionCount >= 11);

    d.detectJSVMP = () => ({
      instructionCount: 2,
      interpreterLocation: 'L1',
      complexity: 'low',
      hasSwitch: true,
      hasInstructionArray: true,
      hasProgramCounter: true,
    });
    d.identifyVMType = () => 'custom';
    d.extractInstructions = () => [{ opcode: 1, name: 'INST_1', type: 'call', description: 'd' }];
    d.restoreCode = async () => ({
      code: 'restored',
      confidence: 0.88,
      warnings: ['ok'],
      unresolvedParts: [{ location: 'x', reason: 'r', suggestion: 's' }],
    });

    const res = await d.deobfuscate({ code: 'obf', extractInstructions: true });
    assert.strictEqual(res.isJSVMP, true);
    assert.strictEqual(res.vmType, 'custom');
    assert.strictEqual(res.instructions?.length, 1);
    assert.strictEqual(res.deobfuscatedCode, 'restored');
    assert.ok((res.stats?.processingTime ?? 0) >= 0);
  });

  it('detects regex features and identifies VM type', () => {
    const d = new JSVMPDeobfuscator() as any;
    const regexDetect = d.detectJSVMPWithRegex(
      'while(true){switch(x){case 1:break;} parseInt("" + b[i],16); fn.apply(a,b);}',
    );
    assert.ok(regexDetect);

    assert.strictEqual(d.identifyVMType('_0xabc; function(_0x1){}', {}), 'obfuscator.io');
    assert.strictEqual(d.identifyVMType('[][(+[])]', {}), 'jsfuck');
    assert.strictEqual(d.identifyVMType('$=~[]; $$$$=1;', {}), 'jjencode');
    assert.strictEqual(d.identifyVMType('const x=1;', {}), 'custom');
  });

  it('extracts instructions and infers instruction types', () => {
    const d = new JSVMPDeobfuscator() as any;
    const code = `
      function vm(op){
        switch(op){
          case 0: arr.push(v[0]); break;
          case 1: x = 1; break;
          case 2: a = 1 + 2; break;
          case 3: fn(); break;
          case 4: if (x) { break; } break;
        }
      }
    `;
    const instructions = d.extractInstructions(code, { instructionCount: 5 });
    assert.strictEqual(instructions.length, 5);

    const ast = parser.parse('switch(x){case 1: x=1; break;}', { sourceType: 'script' }) as any;
    const switchCase = ast.program.body[0].cases[0];
    const tpe = d.inferInstructionType(switchCase);
    assert.strictEqual(typeof tpe, 'string');
  });

  it('covers JSFuck/JJEncode decode fallback and LLM decode success', async () => {
    const noLlm = new JSVMPDeobfuscator() as any;

    const jsfuckOk = await noLlm.restoreJSFuck('"decoded"', []);
    assert.strictEqual(jsfuckOk.code, 'decoded');
    assert.ok(jsfuckOk.confidence >= 0.5);

    const tooLong = await noLlm.restoreJSFuck('x'.repeat(100001), []);
    assert.strictEqual(typeof tooLong.code, 'string');

    const jj = await noLlm.restoreJJEncode('invalid $$$$', []);
    assert.strictEqual(typeof jj.code, 'string');

    const llm = {
      chat: async () => ({
        content: '{"decoded":"const ok = 1;","confidence":0.7,"mechanism":"m","keyFindings":["k"]}',
      }),
    };
    const withLlm = new JSVMPDeobfuscator(llm as any) as any;
    const decoded = await withLlm.llmDecodeEncoding('code', 'JSFuck', []);
    assert.strictEqual(decoded.code, 'const ok = 1;');
    assert.ok(decoded.confidence > 0.2);
  });

  it('covers custom VM basic/llm and restore dispatch', async () => {
    const noLlm = new JSVMPDeobfuscator() as any;
    const basic = await noLlm.restoreCustomVMBasic(
      'if(a){}; debugger; var x = !!(1); "" + y;',
      true,
      [],
      [],
    );
    assert.ok(!basic.code.includes('debugger'));
    assert.ok(basic.warnings.length > 0);

    const llm = {
      chat: async () => ({
        content:
          '{"vmStructure":{"interpreterLoop":"L1","bytecodeVar":"b","pcVar":"p","stackVar":"s"},"instructionMap":{"1":"LOAD"},"restorationApproach":"step-by-step","simplifiedLogic":"does x"}',
      }),
    };
    const withLlm = new JSVMPDeobfuscator(llm as any) as any;
    const custom = await withLlm.restoreCustomVMBasic('code', false, [], []);
    assert.ok(custom.confidence >= 0.3);
    assert.ok(custom.warnings.some((w: string) => w.includes('AI结构分析完成')));

    withLlm.restoreObfuscatorIO = async () => ({ code: 'o', confidence: 0.8, warnings: [] });
    withLlm.restoreJSFuck = async () => ({ code: 'j', confidence: 0.7, warnings: [] });
    withLlm.restoreJJEncode = async () => ({ code: 'jj', confidence: 0.7, warnings: [] });
    withLlm.restoreCustomVM = async () => ({ code: 'c', confidence: 0.6, warnings: [] });

    assert.strictEqual((await withLlm.restoreCode('x', {}, 'obfuscator.io', false, 0, 0)).code, 'o');
    assert.strictEqual((await withLlm.restoreCode('x', {}, 'jsfuck', false, 0, 0)).code, 'j');
    assert.strictEqual((await withLlm.restoreCode('x', {}, 'jjencode', false, 0, 0)).code, 'jj');
    assert.strictEqual((await withLlm.restoreCode('x', {}, 'custom', false, 0, 0)).code, 'c');
  });

  it('covers public deobfuscate no-detect and error branches', async () => {
    const d = new JSVMPDeobfuscator() as any;
    const notVm = await d.deobfuscate({ code: 'const x=1;' });
    assert.strictEqual(notVm.isJSVMP, false);

    d.detectJSVMP = () => {
      throw new Error('boom');
    };
    const failed = await d.deobfuscate({ code: 'const y=1;' });
    assert.strictEqual(failed.isJSVMP, false);
    assert.ok(failed.warnings?.some((w: string) => w.includes('反混淆失败')));
  });

  it('covers additional llm decode branches and custom VM fallback paths', async () => {
    const codeBlockLlm = {
      chat: async () => ({ content: '{bad-json}\n```js\nconst fromBlock = 1;\n```' }),
    };
    const d1 = new JSVMPDeobfuscator(codeBlockLlm as any) as any;
    const byBlock = await d1.llmDecodeEncoding('bad', 'JSFuck', []);
    assert.strictEqual(byBlock.code.includes('fromBlock'), true);
    assert.strictEqual(byBlock.confidence, 0.4);

    const analysisOnlyLlm = {
      chat: async () => ({
        content: '{"mechanism":"ops","keyFindings":["k1"],"manualSteps":["m1"]}',
      }),
    };
    const d2 = new JSVMPDeobfuscator(analysisOnlyLlm as any) as any;
    const analysisOnly = await d2.llmDecodeEncoding('orig', 'JJEncode', []);
    assert.strictEqual(analysisOnly.code, 'orig');
    assert.ok(analysisOnly.warnings.some((w: string) => w.includes('未能完全解码')));

    const throwingLlm = {
      chat: async () => {
        throw new Error('llm down');
      },
    };
    const d3 = new JSVMPDeobfuscator(throwingLlm as any) as any;
    const llmFailed = await d3.llmDecodeEncoding('orig', 'JSFuck', []);
    assert.strictEqual(llmFailed.code, 'orig');
    assert.ok(llmFailed.warnings.some((w: string) => w.includes('AI辅助分析失败')));

    const badJsonLlm = { chat: async () => ({ content: '{not-json' }) };
    const d4 = new JSVMPDeobfuscator(badJsonLlm as any) as any;
    const customFallback = await d4.restoreCustomVM('if(x){}; debugger;', true, [], []);
    assert.ok(customFallback.code.includes('debugger') === false);
    assert.ok(Array.isArray(customFallback.warnings));
  });

  it('covers restoreObfuscatorIO success path with string array replacement', async () => {
    const d = new JSVMPDeobfuscator() as any;
    const warnings: string[] = [];
    const unresolved: any[] = [];
    const code = `
      var _0xabc=["hello","world"];
      console.log(_0xabc[1]);
      (function(_0xabc,_0xdef){ while(true){ try { break; } catch(e){ _0xabc.push(_0xabc.shift()); } } }(_0xabc,0x1));
      var n = 0x10;;
    `;

    const out = await d.restoreObfuscatorIO(code, true, warnings, unresolved);
    assert.ok(out.code.includes('"world"'));
    assert.ok(out.code.includes('16'));
    assert.ok(out.confidence >= 0.6);
  });

  it('covers restoreObfuscatorIO parse-fail branch with llm array extraction', async () => {
    const llm = {
      chat: async () => ({ content: '["A","B","C"]' }),
    };
    const d = new JSVMPDeobfuscator(llm as any) as any;
    const warnings: string[] = [];
    const unresolved: any[] = [];
    const code = `
      var _0xabc=[not_valid_here];
      console.log(_0xabc[2]);
    `;
    const out = await d.restoreObfuscatorIO(code, false, warnings, unresolved);
    assert.ok(out.code.includes('"C"') || out.code.includes('_0xabc[2]'));
    assert.ok(out.warnings.some((w: string) => w.includes('字符串数组')));
    assert.ok(Array.isArray(out.unresolvedParts));
  });

  it('covers restoreCustomVM llm-analysis success branch', async () => {
    const llm = {
      chat: async () => ({
        content: `{
          "vmType":"custom",
          "restorationSteps":["s1","s2"],
          "warnings":["w1"]
        }`,
      }),
    };
    const d = new JSVMPDeobfuscator(llm as any) as any;
    const warnings: string[] = [];
    const unresolved: any[] = [];
    const out = await d.restoreCustomVM('while(true){switch(x){case 1:break;}}', false, warnings, unresolved);
    assert.strictEqual(out.confidence >= 0.5, true);
    assert.ok((out.warnings ?? []).some((w: string) => w.includes('VM类型')));
    assert.ok(Array.isArray(out.unresolvedParts));
  });
});
