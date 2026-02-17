import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  analyzeStrength,
  detectByAST,
  evaluateSecurity,
  mergeParameters,
} from '../../../src/modules/crypto/CryptoDetectorEnhanced.js';
import { CryptoRulesManager } from '../../../src/modules/crypto/CryptoRules.js';
import type { CryptoAlgorithm } from '../../../src/types/index.js';

describe('CryptoDetectorEnhanced', () => {
  it('detectByAST detects algorithms and extracts parameters in one pass', () => {
    const rules = new CryptoRulesManager();
    const sboxValues = Array.from({ length: 256 }, (_, i) => i).join(',');
    const code = `
      const sbox = [${sboxValues}];
      function doHash(v){ for(let i=0;i<4;i++){ v = (v << 1) ^ i; } return v; }
      bn.modPow(x, y);
      CryptoJS.AES.encrypt(data, key, { mode: "ECB", padding: "NoPadding", keySize: 64 });
      crypto.subtle.encrypt({ name: "AES-GCM", length: 256 }, key, data);
      const constants = [99,124,119,123,242,107,111,197];
    `;

    const result = detectByAST(code, rules);
    const names = result.algorithms.map((a) => a.name);
    assert.ok(names.includes('Custom Symmetric Cipher'));
    assert.ok(names.includes('Asymmetric Encryption'));
    assert.ok(names.includes('Custom Hash Function'));
    assert.ok(names.includes('AES S-box'));

    const aesParams = result.parameters.get('AES');
    assert.ok(aesParams);
    assert.strictEqual(aesParams?.mode, 'ECB');
    assert.strictEqual(aesParams?.padding, 'NoPadding');
    assert.strictEqual(aesParams?.keySize, 64);

    const webCryptoParams = result.parameters.get('AES-GCM');
    assert.ok(webCryptoParams);
    assert.strictEqual(webCryptoParams?.length, 256);
  });

  it('mergeParameters applies only matching algorithm params', () => {
    const algorithms: CryptoAlgorithm[] = [
      { name: 'AES', type: 'symmetric', confidence: 0.9, usage: '', location: { file: 't', line: 1, column: 1 } },
      { name: 'SHA256', type: 'hash', confidence: 0.8, usage: '', location: { file: 't', line: 1, column: 1 } },
    ];
    const params = new Map<string, Record<string, unknown>>();
    params.set('AES', { mode: 'CBC', keySize: 256 });

    mergeParameters(algorithms, params);
    assert.strictEqual(algorithms[0].parameters?.mode, 'CBC');
    assert.strictEqual((algorithms[0].parameters as any)?.keySize, 256);
    assert.strictEqual(algorithms[1].parameters, undefined);
  });

  it('evaluateSecurity emits issues from algorithm/mode/padding/keySize rules', () => {
    const rules = new CryptoRulesManager();
    const algorithms: CryptoAlgorithm[] = [
      { name: 'MD5', type: 'hash', confidence: 1, usage: '', location: { file: 't', line: 1, column: 1 } },
      {
        name: 'AES',
        type: 'symmetric',
        confidence: 1,
        usage: '',
        location: { file: 't', line: 1, column: 1 },
        parameters: { mode: 'ECB', padding: 'NoPadding', keySize: 64 } as any,
      },
      { name: 'RC4', type: 'symmetric', confidence: 1, usage: '', location: { file: 't', line: 1, column: 1 } },
    ];

    const issues = evaluateSecurity(algorithms, '', rules);
    assert.ok(issues.some((i) => i.issue.includes('MD5')));
    assert.ok(issues.some((i) => i.issue.includes('ECB mode')));
    assert.ok(issues.some((i) => i.issue.includes('no padding')));
    assert.ok(issues.some((i) => i.issue.includes('Key size is too short')));
    assert.ok(issues.some((i) => i.issue.includes('RC4')));
  });

  it('analyzeStrength classifies penalties into factors and overall levels', () => {
    const weak = analyzeStrength([], [
      { severity: 'critical', issue: 'DES is broken', recommendation: '' },
      { severity: 'high', issue: 'ECB mode detected', recommendation: '' },
      { severity: 'medium', issue: 'key size too short', recommendation: '' },
      { severity: 'low', issue: 'implementation detail', recommendation: '' },
    ]);
    assert.strictEqual(weak.overall, 'moderate');
    assert.ok(weak.factors.algorithm < 100);
    assert.ok(weak.factors.mode < 100);
    assert.ok(weak.factors.keySize < 100);
    assert.ok(weak.factors.implementation < 100);

    const strong = analyzeStrength([], []);
    assert.strictEqual(strong.overall, 'strong');
    assert.strictEqual(strong.score, 100);

    const moderate = analyzeStrength([], [
      { severity: 'high', issue: 'unknown implementation flaw', recommendation: '' },
      { severity: 'high', issue: 'unknown implementation flaw 2', recommendation: '' },
      { severity: 'high', issue: 'unknown implementation flaw 3', recommendation: '' },
      { severity: 'high', issue: 'unknown implementation flaw 4', recommendation: '' },
      { severity: 'high', issue: 'unknown implementation flaw 5', recommendation: '' },
    ]);
    assert.strictEqual(moderate.overall, 'moderate');

    const broken = analyzeStrength([], [
      { severity: 'critical', issue: 'DES broken', recommendation: '' },
      { severity: 'critical', issue: 'SHA1 broken', recommendation: '' },
      { severity: 'critical', issue: 'ECB mode', recommendation: '' },
      { severity: 'critical', issue: 'key size short', recommendation: '' },
      { severity: 'critical', issue: 'implementation fallback', recommendation: '' },
      { severity: 'critical', issue: 'implementation fallback 2', recommendation: '' },
      { severity: 'critical', issue: 'implementation fallback 3', recommendation: '' },
    ]);
    assert.strictEqual(broken.overall, 'broken');
    assert.ok(broken.score < 40);
  });
});
