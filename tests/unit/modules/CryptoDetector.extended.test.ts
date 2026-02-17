import { describe, it } from 'node:test';
import assert from 'node:assert';
import { CryptoDetector } from '../../../src/modules/crypto/CryptoDetector.js';

describe('CryptoDetector extended', () => {
  it('covers load/export rules and keyword/library detection paths', async () => {
    const llm: any = {
      generateCryptoDetectionPrompt: () => [{ role: 'user', content: 'crypto' }],
      chat: async () => ({ content: '{"algorithms":[]}' }),
    };
    const detector = new CryptoDetector(llm);

    const exported = detector.exportRules();
    assert.strictEqual(typeof exported, 'string');

    detector.loadCustomRules(exported);
    const reExported = detector.exportRules();
    assert.strictEqual(typeof reExported, 'string');

    const libs = (detector as any).detectLibraries('CryptoJS.version="4.1.1"; forge.random.getBytesSync(16);');
    assert.ok(libs.length >= 1);

    const kws = (detector as any).detectByKeywords('AES.encrypt(x); CBC; PKCS7;');
    // mode/padding 关键词会被跳过，算法关键词应仍可命中
    assert.ok(Array.isArray(kws));
  });

  it('covers detect useAI true/false and merge ordering', async () => {
    const llm: any = {
      generateCryptoDetectionPrompt: () => [{ role: 'user', content: 'crypto' }],
      chat: async () => ({
        content: '{"algorithms":[{"name":"CustomAES","type":"symmetric","confidence":0.9,"usage":"x"}]}',
      }),
    };
    const detector = new CryptoDetector(llm) as any;

    const noAI = await detector.detect({
      code: 'const h = md5(x); const x = CryptoJS.AES.encrypt(a,b);',
      useAI: false,
    });
    assert.ok(noAI.algorithms.length >= 1);

    const withAI = await detector.detect({
      code: 'const h = md5(x); const x = CryptoJS.AES.encrypt(a,b);',
      useAI: true,
    });
    assert.ok(withAI.algorithms.some((a: any) => a.name === 'CustomAES'));

    const merged = detector.mergeResults([
      { name: 'A', type: 'hash', confidence: 0.5, location: { file: 'current', line: 1 }, usage: '' },
      { name: 'A', type: 'hash', confidence: 0.9, location: { file: 'current', line: 2 }, usage: '' },
      { name: 'B', type: 'hash', confidence: 0.6, location: { file: 'current', line: 3 }, usage: '' },
    ]);
    assert.strictEqual(merged[0]?.confidence, 0.9);
  });

  it('covers AI parser fallback branches and helper methods', async () => {
    const llmNoJson: any = {
      generateCryptoDetectionPrompt: () => [],
      chat: async () => ({ content: 'no-json-content' }),
    };
    const detector1 = new CryptoDetector(llmNoJson) as any;
    assert.deepStrictEqual(await detector1.detectByAI('const x=1'), []);

    const llmBadShape: any = {
      generateCryptoDetectionPrompt: () => [],
      chat: async () => ({ content: '{"algorithms":{}}' }),
    };
    const detector2 = new CryptoDetector(llmBadShape) as any;
    assert.deepStrictEqual(await detector2.detectByAI('const x=1'), []);

    const llmThrow: any = {
      generateCryptoDetectionPrompt: () => [],
      chat: async () => {
        throw new Error('ai fail');
      },
    };
    const detector3 = new CryptoDetector(llmThrow) as any;
    assert.deepStrictEqual(await detector3.detectByAI('const x=1'), []);

    assert.strictEqual(detector3.escapeRegex('a+b*c?'), 'a\\+b\\*c\\?');
    assert.strictEqual(detector3.findLineNumber('a\nb\nc', 'x'), 0);
    assert.strictEqual(detector3.findLineNumber('a\nfind-me\nc', 'find-me'), 2);
  });

  it('covers detect catch path when rule manager throws', async () => {
    const llm: any = {
      generateCryptoDetectionPrompt: () => [],
      chat: async () => ({ content: '{"algorithms":[]}' }),
    };
    const detector = new CryptoDetector(llm) as any;
    detector.rulesManager = {
      getKeywordRules: () => {
        throw new Error('rules boom');
      },
      getLibraryRules: () => [],
    };

    await assert.rejects(
      async () => {
        await detector.detect({ code: 'const x=1', useAI: false });
      },
      /rules boom/,
    );
  });
});
