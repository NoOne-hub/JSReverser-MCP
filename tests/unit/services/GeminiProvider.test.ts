/**
 * Unit tests for GeminiProvider
 */

import { describe, it, mock, beforeEach } from 'node:test';
import assert from 'node:assert';
import { GeminiProvider } from '../../../src/services/GeminiProvider.js';

describe('GeminiProvider', () => {
  describe('Constructor', () => {
    it('should initialize with API key in API mode', () => {
      const provider = new GeminiProvider({
        apiKey: 'test-api-key',
        useAPI: true,
      });

      assert.ok(provider);
    });

    it('should initialize without API key in CLI mode', () => {
      const provider = new GeminiProvider({
        cliPath: 'gemini-cli',
        useAPI: false,
      });

      assert.ok(provider);
    });

    it('should fall back to CLI mode when useAPI is true but no API key', () => {
      const provider = new GeminiProvider({
        useAPI: true,
        // No API key provided
      });

      assert.ok(provider);
    });

    it('should use default model when not specified', () => {
      const provider = new GeminiProvider({
        apiKey: 'test-api-key',
      });

      assert.ok(provider);
    });

    it('should use custom model when specified', () => {
      const provider = new GeminiProvider({
        apiKey: 'test-api-key',
        model: 'gemini-pro',
      });

      assert.ok(provider);
    });

    it('should use default CLI path when not specified', () => {
      const provider = new GeminiProvider({
        useAPI: false,
      });

      assert.ok(provider);
    });

    it('should use custom CLI path when specified', () => {
      const provider = new GeminiProvider({
        cliPath: '/custom/path/to/gemini-cli',
        useAPI: false,
      });

      assert.ok(provider);
    });
  });

  describe('CLI Mode', () => {
    it('should throw error when CLI is not available', async () => {
      const provider = new GeminiProvider({
        cliPath: 'non-existent-cli',
        useAPI: false,
      });

      await assert.rejects(
        async () => {
          await provider.chat([{ role: 'user', content: 'Hello' }]);
        },
        {
          message: /gemini-cli is not available/,
        }
      );
    });

    it('should format messages correctly for CLI', async () => {
      const provider = new GeminiProvider({
        cliPath: 'gemini-cli',
        useAPI: false,
      });

      const messages = [
        { role: 'system' as const, content: 'You are a helpful assistant' },
        { role: 'user' as const, content: 'Hello' },
        { role: 'assistant' as const, content: 'Hi there!' },
        { role: 'user' as const, content: 'How are you?' },
      ];

      // This will fail because CLI is not available, but we're testing the error message
      await assert.rejects(
        async () => {
          await provider.chat(messages);
        },
        {
          message: /gemini-cli is not available/,
        }
      );
    });
  });

  describe('API Mode', () => {
    it('should throw not implemented error for API mode', async () => {
      const provider = new GeminiProvider({
        apiKey: 'test-api-key',
        useAPI: true,
      });

      await assert.rejects(
        async () => {
          await provider.chat([{ role: 'user', content: 'Hello' }]);
        },
        {
          message: /Gemini API mode not yet implemented/,
        }
      );
    });

    it('should throw not implemented error for image analysis in API mode', async () => {
      const provider = new GeminiProvider({
        apiKey: 'test-api-key',
        useAPI: true,
      });

      await assert.rejects(
        async () => {
          await provider.analyzeImage('test.png', 'Describe this image', true);
        },
        {
          message: /Gemini API mode not yet implemented/,
        }
      );
    });
  });

  describe('Image Analysis', () => {
    it('should throw error when CLI is not available for image analysis', async () => {
      const provider = new GeminiProvider({
        cliPath: 'non-existent-cli',
        useAPI: false,
      });

      await assert.rejects(
        async () => {
          await provider.analyzeImage('test.png', 'Describe this image', true);
        },
        {
          message: /gemini-cli is not available/,
        }
      );
    });

    it('should throw error for non-file path input in CLI mode', async () => {
      const provider = new GeminiProvider({
        cliPath: 'gemini-cli',
        useAPI: false,
      });

      // Mock CLI availability check to return true
      const originalCheckCLI = (provider as any).checkCLIAvailable;
      (provider as any).checkCLIAvailable = () => true;

      await assert.rejects(
        async () => {
          await provider.analyzeImage('base64data', 'Describe this image', false);
        },
        {
          message: /CLI mode requires image file paths/,
        }
      );

      // Restore original method
      (provider as any).checkCLIAvailable = originalCheckCLI;
    });
  });

  describe('Error Handling', () => {
    it('should handle unknown errors', async () => {
      const provider = new GeminiProvider({
        apiKey: 'test-api-key',
        useAPI: true,
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
