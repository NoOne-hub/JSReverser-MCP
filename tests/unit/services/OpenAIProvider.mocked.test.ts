import { describe, it } from 'node:test';
import assert from 'node:assert';
import { writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import OpenAI from 'openai';
import { OpenAIProvider } from '../../../src/services/OpenAIProvider.js';

describe('OpenAIProvider (mocked)', () => {
  it('throws when api key is missing', () => {
    assert.throws(
      () => new OpenAIProvider({ apiKey: '' }),
      /OpenAI API key is required/,
    );
  });

  it('maps chat response into internal response shape', async () => {
    const provider = new OpenAIProvider({ apiKey: 'sk-test-key' }) as any;
    provider.client = {
      chat: {
        completions: {
          create: async () => ({
            choices: [{ message: { content: 'ok' } }],
            usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 },
          }),
        },
      },
    };

    const out = await provider.chat([{ role: 'user', content: 'hello' }]);
    assert.strictEqual(out.content, 'ok');
    assert.deepStrictEqual(out.usage, {
      promptTokens: 1,
      completionTokens: 2,
      totalTokens: 3,
    });
  });

  it('throws when chat has no choice message', async () => {
    const provider = new OpenAIProvider({ apiKey: 'sk-test-key' }) as any;
    provider.client = {
      chat: {
        completions: {
          create: async () => ({ choices: [] }),
        },
      },
    };

    await assert.rejects(
      async () => provider.chat([{ role: 'user', content: 'hello' }]),
      /No response from OpenAI/,
    );
  });

  it('passes through generic errors from chat', async () => {
    const provider = new OpenAIProvider({ apiKey: 'sk-test-key' }) as any;
    provider.client = {
      chat: {
        completions: {
          create: async () => {
            throw new Error('network down');
          },
        },
      },
    };

    await assert.rejects(
      async () => provider.chat([{ role: 'user', content: 'hello' }]),
      /network down/,
    );
  });

  it('handles base64/http/data-url and file-path image inputs', async () => {
    const calls: any[] = [];
    const provider = new OpenAIProvider({ apiKey: 'sk-test-key' }) as any;
    provider.client = {
      chat: {
        completions: {
          create: async (payload: any) => {
            calls.push(payload);
            return { choices: [{ message: { content: 'vision-ok' } }] };
          },
        },
      },
    };

    const out1 = await provider.analyzeImage('dGVzdA==', 'p1', false);
    const out2 = await provider.analyzeImage('https://example.com/i.png', 'p2', false);
    const out3 = await provider.analyzeImage('data:image/png;base64,abcd', 'p3', false);

    const tempPath = join(tmpdir(), `openai-provider-test-${Date.now()}.png`);
    writeFileSync(tempPath, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    const out4 = await provider.analyzeImage(tempPath, 'p4', true);
    rmSync(tempPath, { force: true });

    assert.strictEqual(out1, 'vision-ok');
    assert.strictEqual(out2, 'vision-ok');
    assert.strictEqual(out3, 'vision-ok');
    assert.strictEqual(out4, 'vision-ok');

    const urls = calls.map((c) => c.messages[0].content[1].image_url.url);
    assert.ok(urls[0].startsWith('data:image/png;base64,'));
    assert.strictEqual(urls[1], 'https://example.com/i.png');
    assert.strictEqual(urls[2], 'data:image/png;base64,abcd');
    assert.ok(urls[3].startsWith('data:image/png;base64,'));
  });

  it('falls back to png mime type for unknown extensions', () => {
    const provider = new OpenAIProvider({ apiKey: 'sk-test-key' }) as any;
    assert.strictEqual(provider.getMimeType('jpg'), 'image/jpeg');
    assert.strictEqual(provider.getMimeType('unknown'), 'image/png');
  });

  it('covers OpenAI APIError and unknown error formatting paths', async () => {
    const provider = new OpenAIProvider({ apiKey: 'sk-test-key' }) as any;

    const apiError = Object.assign(new Error('rate limited'), {
      status: 429,
      code: 'rate_limit',
    });
    Object.setPrototypeOf(apiError, OpenAI.APIError.prototype);

    provider.client = {
      chat: {
        completions: {
          create: async () => {
            throw apiError;
          },
        },
      },
    };
    await assert.rejects(
      async () => provider.chat([{ role: 'user', content: 'hello' }]),
      (err: any) => err?.status === 429 && err?.code === 'rate_limit',
    );

    provider.client = {
      chat: {
        completions: {
          create: async () => {
            throw 'non-error';
          },
        },
      },
    };
    await assert.rejects(
      async () => provider.chat([{ role: 'user', content: 'hello' }]),
      /Unknown error: non-error/,
    );
  });

  it('throws when analyzeImage receives empty choice payload', async () => {
    const provider = new OpenAIProvider({ apiKey: 'sk-test-key' }) as any;
    provider.client = {
      chat: {
        completions: {
          create: async () => ({ choices: [] }),
        },
      },
    };

    await assert.rejects(
      async () => provider.analyzeImage('dGVzdA==', 'p', false),
      /No response from OpenAI/,
    );
  });

  it('covers empty content and no-usage response branches', async () => {
    let payload: any = null;
    const provider = new OpenAIProvider({ apiKey: 'sk-test-key' }) as any;
    provider.client = {
      chat: {
        completions: {
          create: async (input: any) => {
            payload = input;
            return { choices: [{ message: { content: null } }] };
          },
        },
      },
    };

    const out = await provider.chat([{ role: 'assistant', content: 'x' }], {
      model: 'gpt-test',
      temperature: 0.3,
      maxTokens: 99,
    });
    assert.strictEqual(out.content, '');
    assert.strictEqual(out.usage, undefined);
    assert.strictEqual(payload.model, 'gpt-test');
    assert.strictEqual(payload.temperature, 0.3);
    assert.strictEqual(payload.max_tokens, 99);
  });

  it('covers analyzeImage file path without extension branch', async () => {
    const provider = new OpenAIProvider({ apiKey: 'sk-test-key' }) as any;
    provider.client = {
      chat: {
        completions: {
          create: async () => ({ choices: [{ message: { content: null } }] }),
        },
      },
    };

    const tempPath = join(tmpdir(), `openai-provider-test-${Date.now()}`);
    writeFileSync(tempPath, Buffer.from([0x00]));
    const out = await provider.analyzeImage(tempPath, 'p', true);
    rmSync(tempPath, { force: true });
    assert.strictEqual(out, '');
  });
});
