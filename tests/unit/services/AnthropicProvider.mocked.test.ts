import { describe, it } from 'node:test';
import assert from 'node:assert';
import { writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import Anthropic from '@anthropic-ai/sdk';
import { AnthropicProvider } from '../../../src/services/AnthropicProvider.js';

describe('AnthropicProvider (mocked)', () => {
  it('throws when api key is missing', () => {
    assert.throws(
      () => new AnthropicProvider({ apiKey: '' }),
      /Anthropic API key is required/,
    );
  });

  it('maps response content and usage for chat', async () => {
    let payload: any = null;
    const provider = new AnthropicProvider({ apiKey: 'sk-ant-test-key' }) as any;
    provider.client = {
      messages: {
        create: async (input: any) => {
          payload = input;
          return {
            content: [
              { type: 'text', text: 'hello ' },
              { type: 'text', text: 'world' },
            ],
            usage: { input_tokens: 5, output_tokens: 7 },
          };
        },
      },
    };

    const result = await provider.chat([
      { role: 'system', content: 'rules' },
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'ok' },
    ]);

    assert.strictEqual(result.content, 'hello world');
    assert.deepStrictEqual(result.usage, {
      promptTokens: 5,
      completionTokens: 7,
      totalTokens: 12,
    });
    assert.strictEqual(payload.system, 'rules');
    assert.deepStrictEqual(payload.messages, [
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'ok' },
    ]);
  });

  it('throws when invalid data URL is passed to analyzeImage', async () => {
    const provider = new AnthropicProvider({ apiKey: 'sk-ant-test-key' });
    await assert.rejects(
      async () => provider.analyzeImage('data:invalid', 'prompt', false),
      /Invalid data URL format/,
    );
  });

  it('supports base64/data-url/file inputs in analyzeImage', async () => {
    const calls: any[] = [];
    const provider = new AnthropicProvider({ apiKey: 'sk-ant-test-key' }) as any;
    provider.client = {
      messages: {
        create: async (input: any) => {
          calls.push(input);
          return {
            content: [{ type: 'text', text: 'vision ok' }],
            usage: { input_tokens: 1, output_tokens: 1 },
          };
        },
      },
    };

    const out1 = await provider.analyzeImage('dGVzdA==', 'a', false);
    const out2 = await provider.analyzeImage('data:image/gif;base64,abcd', 'b', false);

    const tempPath = join(tmpdir(), `anthropic-provider-test-${Date.now()}.jpg`);
    writeFileSync(tempPath, Buffer.from([0xff, 0xd8, 0xff, 0xdb]));
    const out3 = await provider.analyzeImage(tempPath, 'c', true);
    rmSync(tempPath, { force: true });

    assert.strictEqual(out1, 'vision ok');
    assert.strictEqual(out2, 'vision ok');
    assert.strictEqual(out3, 'vision ok');

    const source0 = calls[0].messages[0].content[0].source;
    const source1 = calls[1].messages[0].content[0].source;
    const source2 = calls[2].messages[0].content[0].source;
    assert.strictEqual(source0.media_type, 'image/png');
    assert.strictEqual(source1.media_type, 'image/gif');
    assert.strictEqual(source2.media_type, 'image/jpeg');
  });

  it('falls back to png media type for unknown extensions', () => {
    const provider = new AnthropicProvider({ apiKey: 'sk-ant-test-key' }) as any;
    assert.strictEqual(provider.getMediaType('webp'), 'image/webp');
    assert.strictEqual(provider.getMediaType('unknown'), 'image/png');
  });

  it('covers Anthropic APIError and unknown error formatting paths', async () => {
    const provider = new AnthropicProvider({ apiKey: 'sk-ant-test-key' }) as any;

    const apiError = Object.assign(new Error('api down'), { status: 503 });
    Object.setPrototypeOf(apiError, Anthropic.APIError.prototype);

    provider.client = {
      messages: {
        create: async () => {
          throw apiError;
        },
      },
    };
    await assert.rejects(
      async () => provider.chat([{ role: 'user', content: 'hi' }]),
      (err: any) => err?.status === 503,
    );

    provider.client = {
      messages: {
        create: async () => {
          throw 12345;
        },
      },
    };
    await assert.rejects(
      async () => provider.chat([{ role: 'user', content: 'hi' }]),
      /Unknown error: 12345/,
    );
  });
});
