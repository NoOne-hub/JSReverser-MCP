import {describe, it} from 'node:test';
import assert from 'node:assert';
import {CryptoDetector} from '../../../src/modules/crypto/CryptoDetector.js';

const llmStub: any = {
  generateCryptoDetectionPrompt: () => [],
  chat: async () => ({content: '{"algorithms": []}'}),
};

describe('CryptoDetector', () => {
  it('detects algorithm keywords', async () => {
    const detector = new CryptoDetector(llmStub);
    const result = await detector.detect({
      code: 'const hash = md5(input); const x = sha256(y);',
      useAI: false,
    } as any);

    assert.ok(result.algorithms.length >= 1);
  });
});
