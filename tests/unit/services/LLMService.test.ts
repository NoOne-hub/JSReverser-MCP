import { describe, it } from 'node:test';
import assert from 'node:assert';
import { LLMService } from '../../../src/services/LLMService.js';

describe('LLMService prompt generation', () => {
  it('calls configured chat service with mapped options', async () => {
    let captured: any = null;
    const service = new LLMService(
      () =>
        ({
          chat: async (messages: any, options: any) => {
            captured = { messages, options };
            return { content: 'ok', usage: undefined };
          },
        }) as any,
    );

    const result = await service.chat(
      [{ role: 'user', content: 'hello' }],
      { temperature: 0.2, maxTokens: 123 },
    );

    assert.strictEqual(result.content, 'ok');
    assert.deepStrictEqual(captured.options, { temperature: 0.2, maxTokens: 123 });
  });

  it('throws when no chat service is available', async () => {
    const service = new LLMService(() => undefined);
    await assert.rejects(
      async () => service.chat([{ role: 'user', content: 'x' }]),
      /No AI provider configured/,
    );
  });

  it('generates code analysis prompt with focus and code', () => {
    const service = new LLMService();
    const messages = service.generateCodeAnalysisPrompt('const a = 1;', 'security');

    assert.strictEqual(messages.length, 2);
    assert.strictEqual(messages[0].role, 'system');
    assert.ok(messages[1].content.includes('Focus: security'));
    assert.ok(messages[1].content.includes('const a = 1;'));
  });

  it('generates crypto detection prompt', () => {
    const service = new LLMService();
    const messages = service.generateCryptoDetectionPrompt('md5(x)');

    assert.strictEqual(messages.length, 2);
    assert.strictEqual(messages[0].role, 'system');
    assert.ok(messages[1].content.includes('algorithms[]'));
    assert.ok(messages[1].content.includes('md5(x)'));
  });

  it('generates deobfuscation prompt', () => {
    const service = new LLMService();
    const messages = service.generateDeobfuscationPrompt('eval(atob("..."))');

    assert.strictEqual(messages.length, 2);
    assert.ok(messages[1].content.includes('eval(atob'));
  });

  it('generates taint-analysis prompt with sources and sinks', () => {
    const service = new LLMService();
    const messages = service.generateTaintAnalysisPrompt(
      'sink(source())',
      ['location.hash', 'document.cookie'],
      ['eval', 'innerHTML'],
    );

    assert.strictEqual(messages.length, 2);
    assert.ok(messages[1].content.includes('location.hash'));
    assert.ok(messages[1].content.includes('innerHTML'));
    assert.ok(messages[1].content.includes('sink(source())'));
  });

  it('supports empty source/sink lists in taint prompt', () => {
    const service = new LLMService();
    const messages = service.generateTaintAnalysisPrompt('code', [], []);
    assert.ok(messages[1].content.includes('Sources: none'));
    assert.ok(messages[1].content.includes('Sinks: none'));
  });
});
