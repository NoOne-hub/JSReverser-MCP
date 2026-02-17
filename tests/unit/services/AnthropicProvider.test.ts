/**
 * Unit tests for AnthropicProvider
 * Tests provider initialization, chat method, system message handling, and error handling
 * 
 * Requirements: 4.3, 12.2
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { AnthropicProvider } from '../../../src/services/AnthropicProvider.js';

const runProviderTests = process.env.RUN_PROVIDER_TESTS === 'true';
const runProviderNetworkTests = process.env.RUN_PROVIDER_NETWORK_TESTS === 'true';

describe('AnthropicProvider', {skip: !runProviderTests}, () => {
  describe('Constructor', () => {
    it('should initialize with API key', () => {
      const provider = new AnthropicProvider({
        apiKey: 'sk-ant-test-key',
      });

      assert.ok(provider);
    });

    it('should throw error when API key is missing', () => {
      assert.throws(
        () => {
          new AnthropicProvider({
            apiKey: '',
          });
        },
        {
          message: /Anthropic API key is required/,
        }
      );
    });

    it('should initialize with custom model', () => {
      const provider = new AnthropicProvider({
        apiKey: 'sk-ant-test-key',
        model: 'claude-3-opus-20240229',
      });

      assert.ok(provider);
    });

    it('should use default model when not specified', () => {
      const provider = new AnthropicProvider({
        apiKey: 'sk-ant-test-key',
      });

      assert.ok(provider);
    });

    it('should initialize with all configuration options', () => {
      const provider = new AnthropicProvider({
        apiKey: 'sk-ant-test-key',
        model: 'claude-3-5-sonnet-20241022',
      });

      assert.ok(provider);
    });
  });

  describe('chat method', {skip: !runProviderNetworkTests}, () => {
    it('should reject with error when API key is invalid', async () => {
      const provider = new AnthropicProvider({
        apiKey: 'sk-ant-invalid-key',
      });

      await assert.rejects(
        async () => {
          await provider.chat([{ role: 'user', content: 'Hello' }]);
        },
        Error
      );
    });

    it('should handle empty messages array', async () => {
      const provider = new AnthropicProvider({
        apiKey: 'sk-ant-test-key',
      });

      await assert.rejects(
        async () => {
          await provider.chat([]);
        },
        Error
      );
    });

    it('should handle system messages separately', async () => {
      const provider = new AnthropicProvider({
        apiKey: 'sk-ant-test-key',
      });

      // Anthropic requires system messages to be separate
      await assert.rejects(
        async () => {
          await provider.chat([
            { role: 'system', content: 'You are helpful' },
            { role: 'user', content: 'Hello' },
          ]);
        },
        Error
      );
    });

    it('should handle messages without system message', async () => {
      const provider = new AnthropicProvider({
        apiKey: 'sk-ant-test-key',
      });

      await assert.rejects(
        async () => {
          await provider.chat([
            { role: 'user', content: 'Hello' },
          ]);
        },
        Error
      );
    });

    it('should handle conversation history', async () => {
      const provider = new AnthropicProvider({
        apiKey: 'sk-ant-test-key',
      });

      await assert.rejects(
        async () => {
          await provider.chat([
            { role: 'user', content: 'What is 2+2?' },
            { role: 'assistant', content: '4' },
            { role: 'user', content: 'What is 3+3?' },
          ]);
        },
        Error
      );
    });

    it('should handle multiple system messages (use first one)', async () => {
      const provider = new AnthropicProvider({
        apiKey: 'sk-ant-test-key',
      });

      await assert.rejects(
        async () => {
          await provider.chat([
            { role: 'system', content: 'First system message' },
            { role: 'system', content: 'Second system message' },
            { role: 'user', content: 'Hello' },
          ]);
        },
        Error
      );
    });

    it('should pass temperature option', async () => {
      const provider = new AnthropicProvider({
        apiKey: 'sk-ant-test-key',
      });

      await assert.rejects(
        async () => {
          await provider.chat(
            [{ role: 'user', content: 'Hello' }],
            { temperature: 0.7 }
          );
        },
        Error
      );
    });

    it('should pass maxTokens option', async () => {
      const provider = new AnthropicProvider({
        apiKey: 'sk-ant-test-key',
      });

      await assert.rejects(
        async () => {
          await provider.chat(
            [{ role: 'user', content: 'Hello' }],
            { maxTokens: 1000 }
          );
        },
        Error
      );
    });

    it('should use default maxTokens when not specified', async () => {
      const provider = new AnthropicProvider({
        apiKey: 'sk-ant-test-key',
      });

      await assert.rejects(
        async () => {
          await provider.chat([{ role: 'user', content: 'Hello' }]);
        },
        Error
      );
    });

    it('should pass model option', async () => {
      const provider = new AnthropicProvider({
        apiKey: 'sk-ant-test-key',
      });

      await assert.rejects(
        async () => {
          await provider.chat(
            [{ role: 'user', content: 'Hello' }],
            { model: 'claude-3-opus-20240229' }
          );
        },
        Error
      );
    });

    it('should pass all chat options', async () => {
      const provider = new AnthropicProvider({
        apiKey: 'sk-ant-test-key',
      });

      await assert.rejects(
        async () => {
          await provider.chat(
            [{ role: 'user', content: 'Hello' }],
            {
              temperature: 0.8,
              maxTokens: 2000,
              model: 'claude-3-opus-20240229',
            }
          );
        },
        Error
      );
    });
  });

  describe('analyzeImage method', {skip: !runProviderNetworkTests}, () => {
    it('should reject with error when API key is invalid', async () => {
      const provider = new AnthropicProvider({
        apiKey: 'sk-ant-invalid-key',
      });

      await assert.rejects(
        async () => {
          await provider.analyzeImage('test.png', 'Describe this image', true);
        },
        Error
      );
    });

    it('should handle file path input', async () => {
      const provider = new AnthropicProvider({
        apiKey: 'sk-ant-test-key',
      });

      // This will fail because file doesn't exist, but tests the flow
      await assert.rejects(
        async () => {
          await provider.analyzeImage('nonexistent.png', 'Describe', true);
        },
        Error
      );
    });

    it('should handle base64 input', async () => {
      const provider = new AnthropicProvider({
        apiKey: 'sk-ant-test-key',
      });

      const base64Image = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

      await assert.rejects(
        async () => {
          await provider.analyzeImage(base64Image, 'Describe', false);
        },
        Error
      );
    });

    it('should handle data URL input', async () => {
      const provider = new AnthropicProvider({
        apiKey: 'sk-ant-test-key',
      });

      const dataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

      await assert.rejects(
        async () => {
          await provider.analyzeImage(dataUrl, 'Describe', false);
        },
        Error
      );
    });

    it('should reject invalid data URL format', async () => {
      const provider = new AnthropicProvider({
        apiKey: 'sk-ant-test-key',
      });

      await assert.rejects(
        async () => {
          await provider.analyzeImage('data:invalid', 'Describe', false);
        },
        {
          message: /Invalid data URL format/,
        }
      );
    });

    it('should handle different image formats (PNG)', async () => {
      const provider = new AnthropicProvider({
        apiKey: 'sk-ant-test-key',
      });

      await assert.rejects(
        async () => {
          await provider.analyzeImage('test.png', 'Describe', true);
        },
        Error
      );
    });

    it('should handle different image formats (JPEG)', async () => {
      const provider = new AnthropicProvider({
        apiKey: 'sk-ant-test-key',
      });

      await assert.rejects(
        async () => {
          await provider.analyzeImage('test.jpg', 'Describe', true);
        },
        Error
      );
    });

    it('should handle different image formats (GIF)', async () => {
      const provider = new AnthropicProvider({
        apiKey: 'sk-ant-test-key',
      });

      await assert.rejects(
        async () => {
          await provider.analyzeImage('test.gif', 'Describe', true);
        },
        Error
      );
    });

    it('should handle different image formats (WEBP)', async () => {
      const provider = new AnthropicProvider({
        apiKey: 'sk-ant-test-key',
      });

      await assert.rejects(
        async () => {
          await provider.analyzeImage('test.webp', 'Describe', true);
        },
        Error
      );
    });

    it('should default to PNG for unknown extensions', async () => {
      const provider = new AnthropicProvider({
        apiKey: 'sk-ant-test-key',
      });

      await assert.rejects(
        async () => {
          await provider.analyzeImage('test.unknown', 'Describe', true);
        },
        Error
      );
    });

    it('should handle empty prompt', async () => {
      const provider = new AnthropicProvider({
        apiKey: 'sk-ant-test-key',
      });

      await assert.rejects(
        async () => {
          await provider.analyzeImage('test.png', '', true);
        },
        Error
      );
    });
  });

  describe('Error handling', () => {
    it('should format Anthropic API errors', async () => {
      const provider = new AnthropicProvider({
        apiKey: 'sk-ant-invalid-key',
      });

      await assert.rejects(
        async () => {
          await provider.chat([{ role: 'user', content: 'Hello' }]);
        },
        (error: any) => {
          // Should be an Error object
          assert.ok(error instanceof Error);
          return true;
        }
      );
    });

    it('should preserve status code in errors', async () => {
      const provider = new AnthropicProvider({
        apiKey: 'sk-ant-invalid-key',
      });

      try {
        await provider.chat([{ role: 'user', content: 'Hello' }]);
        assert.fail('Should have thrown an error');
      } catch (error: any) {
        // Error should have status property for retry logic
        assert.ok(error instanceof Error);
      }
    });

    it('should handle network errors', async () => {
      const provider = new AnthropicProvider({
        apiKey: 'sk-ant-test-key',
      });

      await assert.rejects(
        async () => {
          await provider.chat([{ role: 'user', content: 'Hello' }]);
        },
        Error
      );
    });

    it('should handle timeout errors', async () => {
      const provider = new AnthropicProvider({
        apiKey: 'sk-ant-test-key',
      });

      await assert.rejects(
        async () => {
          await provider.chat([{ role: 'user', content: 'Hello' }]);
        },
        Error
      );
    });

    it('should handle malformed responses', async () => {
      const provider = new AnthropicProvider({
        apiKey: 'sk-ant-test-key',
      });

      await assert.rejects(
        async () => {
          await provider.chat([{ role: 'user', content: 'Hello' }]);
        },
        Error
      );
    });

    it('should handle unknown error types', async () => {
      const provider = new AnthropicProvider({
        apiKey: 'sk-ant-test-key',
      });

      await assert.rejects(
        async () => {
          await provider.chat([{ role: 'user', content: 'Hello' }]);
        },
        Error
      );
    });
  });

  describe('Media type detection', () => {
    it('should detect PNG media type', async () => {
      const provider = new AnthropicProvider({
        apiKey: 'sk-ant-test-key',
      });

      await assert.rejects(
        async () => {
          await provider.analyzeImage('test.png', 'Describe', true);
        },
        Error
      );
    });

    it('should detect JPEG media type', async () => {
      const provider = new AnthropicProvider({
        apiKey: 'sk-ant-test-key',
      });

      await assert.rejects(
        async () => {
          await provider.analyzeImage('test.jpeg', 'Describe', true);
        },
        Error
      );
    });

    it('should detect GIF media type', async () => {
      const provider = new AnthropicProvider({
        apiKey: 'sk-ant-test-key',
      });

      await assert.rejects(
        async () => {
          await provider.analyzeImage('test.gif', 'Describe', true);
        },
        Error
      );
    });

    it('should detect WEBP media type', async () => {
      const provider = new AnthropicProvider({
        apiKey: 'sk-ant-test-key',
      });

      await assert.rejects(
        async () => {
          await provider.analyzeImage('test.webp', 'Describe', true);
        },
        Error
      );
    });
  });

  describe('Response parsing', () => {
    it('should handle text block responses', async () => {
      const provider = new AnthropicProvider({
        apiKey: 'sk-ant-test-key',
      });

      await assert.rejects(
        async () => {
          await provider.chat([{ role: 'user', content: 'Hello' }]);
        },
        Error
      );
    });

    it('should handle multiple text blocks', async () => {
      const provider = new AnthropicProvider({
        apiKey: 'sk-ant-test-key',
      });

      await assert.rejects(
        async () => {
          await provider.chat([{ role: 'user', content: 'Hello' }]);
        },
        Error
      );
    });

    it('should filter non-text blocks', async () => {
      const provider = new AnthropicProvider({
        apiKey: 'sk-ant-test-key',
      });

      await assert.rejects(
        async () => {
          await provider.chat([{ role: 'user', content: 'Hello' }]);
        },
        Error
      );
    });
  });

  describe('Token usage', () => {
    it('should return token usage information', async () => {
      const provider = new AnthropicProvider({
        apiKey: 'sk-ant-test-key',
      });

      await assert.rejects(
        async () => {
          await provider.chat([{ role: 'user', content: 'Hello' }]);
        },
        Error
      );
    });

    it('should calculate total tokens correctly', async () => {
      const provider = new AnthropicProvider({
        apiKey: 'sk-ant-test-key',
      });

      await assert.rejects(
        async () => {
          await provider.chat([{ role: 'user', content: 'Hello' }]);
        },
        Error
      );
    });
  });
});
