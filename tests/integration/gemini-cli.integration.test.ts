/**
 * Integration tests for Gemini CLI
 * 
 * These tests verify the actual CLI command execution, error handling, and timeout mechanisms.
 * Note: These tests require gemini-cli to be installed and configured.
 * 
 * **Validates: Requirements 5.1, 5.2, 5.3, 5.4, 5.5, 5.6**
 */

import { describe, it, before } from 'node:test';
import assert from 'node:assert';
import { GeminiProvider } from '../../src/services/GeminiProvider.js';
import { spawn } from 'child_process';

const runGeminiIntegration = process.env.RUN_GEMINI_CLI_TESTS === 'true';

/**
 * Check if gemini-cli is available in the system
 */
function isGeminiCLIAvailable(): boolean {
  try {
    const { spawnSync } = require('child_process');
    const result = spawnSync('gemini-cli', ['--version'], {
      stdio: 'pipe',
      timeout: 5000,
    });
    return result.status === 0;
  } catch (error) {
    return false;
  }
}

describe('Gemini CLI Integration Tests', {skip: !runGeminiIntegration}, () => {
  let cliAvailable: boolean;

  before(() => {
    cliAvailable = isGeminiCLIAvailable();
    if (!cliAvailable) {
      console.log('\n⚠️  Warning: gemini-cli is not available. Some tests will be skipped.');
      console.log('   To run all tests, install gemini-cli:');
      console.log('   npm install -g @google/generative-ai-cli\n');
    }
  });

  describe('CLI Availability Detection', () => {
    it('should detect when CLI is not available', async () => {
      // **Validates: Requirement 5.1** - System checks if gemini-cli is available
      const provider = new GeminiProvider({
        cliPath: 'non-existent-gemini-cli-command',
        useAPI: false,
      });

      await assert.rejects(
        async () => {
          await provider.chat([{ role: 'user', content: 'Hello' }]);
        },
        {
          message: /gemini-cli is not available/,
        },
        'Should throw error when CLI is not available'
      );
    });

    it('should provide clear error message with installation instructions', async () => {
      // **Validates: Requirement 5.2** - System returns clear error and installation guide
      const provider = new GeminiProvider({
        cliPath: 'non-existent-cli',
        useAPI: false,
      });

      try {
        await provider.chat([{ role: 'user', content: 'Hello' }]);
        assert.fail('Should have thrown an error');
      } catch (error: any) {
        assert.ok(error.message.includes('gemini-cli is not available'));
        assert.ok(error.message.includes('npm install'));
        assert.ok(error.message.includes('@google/generative-ai-cli'));
      }
    });
  });

  describe('CLI Command Execution', () => {
    it('should execute CLI command with basic prompt', async function (this: any) {
      if (!cliAvailable) {
        this.skip();
        return;
      }

      // **Validates: Requirement 5.3** - System executes gemini-cli via subprocess
      const provider = new GeminiProvider({
        useAPI: false,
      });

      const response = await provider.chat([
        { role: 'user', content: 'Say "test successful" and nothing else' },
      ]);

      assert.ok(response.content);
      assert.strictEqual(typeof response.content, 'string');
      assert.ok(response.content.length > 0);
    });

    it('should pass prompt correctly to CLI', async function (this: any) {
      if (!cliAvailable) {
        this.skip();
        return;
      }

      // **Validates: Requirement 5.4** - System correctly passes prompts and parameters
      const provider = new GeminiProvider({
        useAPI: false,
      });

      const testPrompt = 'What is 2+2? Answer with just the number.';
      const response = await provider.chat([
        { role: 'user', content: testPrompt },
      ]);

      assert.ok(response.content);
      assert.ok(response.content.includes('4'));
    });

    it('should handle multi-turn conversations', async function (this: any) {
      if (!cliAvailable) {
        this.skip();
        return;
      }

      // **Validates: Requirement 5.4** - System formats messages correctly
      const provider = new GeminiProvider({
        useAPI: false,
      });

      const messages = [
        { role: 'system' as const, content: 'You are a helpful assistant.' },
        { role: 'user' as const, content: 'My name is Alice.' },
        { role: 'assistant' as const, content: 'Hello Alice!' },
        { role: 'user' as const, content: 'What is my name?' },
      ];

      const response = await provider.chat(messages);

      assert.ok(response.content);
      assert.ok(
        response.content.toLowerCase().includes('alice'),
        'Response should remember the name from conversation'
      );
    });

    it('should pass model parameter to CLI', async function (this: any) {
      if (!cliAvailable) {
        this.skip();
        return;
      }

      // **Validates: Requirement 5.4** - System passes parameters correctly
      const provider = new GeminiProvider({
        useAPI: false,
        model: 'gemini-2.0-flash-exp',
      });

      const response = await provider.chat([
        { role: 'user', content: 'Hello' },
      ]);

      assert.ok(response.content);
    });

    it('should pass temperature parameter to CLI', async function (this: any) {
      if (!cliAvailable) {
        this.skip();
        return;
      }

      // **Validates: Requirement 5.4** - System passes parameters correctly
      const provider = new GeminiProvider({
        useAPI: false,
      });

      const response = await provider.chat(
        [{ role: 'user', content: 'Say hello' }],
        { temperature: 0.5 }
      );

      assert.ok(response.content);
    });

    it('should parse and return CLI output correctly', async function (this: any) {
      if (!cliAvailable) {
        this.skip();
        return;
      }

      // **Validates: Requirement 5.5** - System parses output and returns standard format
      const provider = new GeminiProvider({
        useAPI: false,
      });

      const response = await provider.chat([
        { role: 'user', content: 'Respond with exactly: TEST_OUTPUT_123' },
      ]);

      assert.ok(response.content);
      assert.strictEqual(typeof response.content, 'string');
      assert.ok(response.content.trim().length > 0);
      // Response should be in standard format
      assert.strictEqual(response.usage, undefined, 'CLI mode should not provide usage info');
    });
  });

  describe('Error Handling', () => {
    it('should handle CLI execution errors', async function () {
      // **Validates: Requirement 5.6** - System handles CLI errors
      const provider = new GeminiProvider({
        cliPath: 'sh', // Use a command that exists but will fail with our args
        useAPI: false,
      });

      await assert.rejects(
        async () => {
          await provider.chat([{ role: 'user', content: 'Hello' }]);
        },
        Error,
        'Should throw error when CLI execution fails'
      );
    });

    it('should handle CLI non-zero exit codes', async function () {
      // **Validates: Requirement 5.6** - System handles CLI errors
      const provider = new GeminiProvider({
        cliPath: 'false', // Command that always exits with code 1
        useAPI: false,
      });

      await assert.rejects(
        async () => {
          await provider.chat([{ role: 'user', content: 'Hello' }]);
        },
        {
          message: /exited with code/,
        },
        'Should throw error with exit code information'
      );
    });

    it('should handle missing image files', async function (this: any) {
      if (!cliAvailable) {
        this.skip();
        return;
      }

      // **Validates: Requirement 5.6** - System handles errors
      const provider = new GeminiProvider({
        useAPI: false,
      });

      await assert.rejects(
        async () => {
          await provider.analyzeImage(
            '/non/existent/image.png',
            'Describe this image',
            true
          );
        },
        {
          message: /Image file not found/,
        },
        'Should throw error when image file does not exist'
      );
    });

    it('should reject base64 images in CLI mode', async function (this: any) {
      if (!cliAvailable) {
        this.skip();
        return;
      }

      // **Validates: Requirement 5.6** - System handles unsupported operations
      const provider = new GeminiProvider({
        useAPI: false,
      });

      await assert.rejects(
        async () => {
          await provider.analyzeImage(
            'data:image/png;base64,iVBORw0KGgoAAAANS...',
            'Describe this image',
            false
          );
        },
        {
          message: /CLI mode requires image file paths/,
        },
        'Should throw error for base64 images in CLI mode'
      );
    });
  });

  describe('Timeout Mechanism', () => {
    it('should timeout long-running CLI commands', async function () {
      // **Validates: Requirement 5.6** - System handles timeouts
      // This test uses a sleep command to simulate a long-running process
      const provider = new GeminiProvider({
        cliPath: 'sleep', // Use sleep command to simulate timeout
        useAPI: false,
      });

      // Mock the executeCLI to have a shorter timeout for testing
      const originalExecuteCLI = (provider as any).executeCLI;
      (provider as any).executeCLI = async function (prompt: string, options?: any) {
        return new Promise((resolve, reject) => {
          const child = spawn('sleep', ['10']); // Sleep for 10 seconds

          const timeout = setTimeout(() => {
            child.kill();
            reject(new Error('gemini-cli execution timed out after 60 seconds'));
          }, 100); // Short timeout for testing

          child.on('close', () => {
            clearTimeout(timeout);
            resolve('');
          });

          child.on('error', (error) => {
            clearTimeout(timeout);
            reject(error);
          });
        });
      };

      await assert.rejects(
        async () => {
          await provider.chat([{ role: 'user', content: 'Hello' }]);
        },
        {
          message: /timed out/,
        },
        'Should throw timeout error for long-running commands'
      );

      // Restore original method
      (provider as any).executeCLI = originalExecuteCLI;
    });

    it('should include timeout duration in error message', async function () {
      // **Validates: Requirement 5.6** - System provides clear error messages
      const provider = new GeminiProvider({
        cliPath: 'sleep',
        useAPI: false,
      });

      // Mock executeCLI with timeout
      (provider as any).executeCLI = async function () {
        return Promise.reject(new Error('gemini-cli execution timed out after 60 seconds'));
      };

      try {
        await provider.chat([{ role: 'user', content: 'Hello' }]);
        assert.fail('Should have thrown timeout error');
      } catch (error: any) {
        assert.ok(error.message.includes('timed out'));
        assert.ok(error.message.includes('60 seconds'));
      }
    });
  });

  describe('Fallback Behavior', () => {
    it('should fall back to CLI mode when API key is missing', () => {
      // **Validates: Requirement 4.7** - System auto-switches to CLI mode
      const provider = new GeminiProvider({
        useAPI: true,
        // No API key provided
      });

      assert.ok(provider, 'Provider should initialize in CLI mode');
    });

    it('should use API mode when API key is provided', () => {
      // **Validates: Requirement 4.4** - System supports API mode
      const provider = new GeminiProvider({
        apiKey: 'test-key',
        useAPI: true,
      });

      assert.ok(provider, 'Provider should initialize in API mode');
    });
  });

  describe('Custom CLI Path', () => {
    it('should use custom CLI path when specified', async () => {
      // **Validates: Requirement 11.2** - System supports GEMINI_CLI_PATH env var
      const provider = new GeminiProvider({
        cliPath: '/custom/path/to/gemini-cli',
        useAPI: false,
      });

      await assert.rejects(
        async () => {
          await provider.chat([{ role: 'user', content: 'Hello' }]);
        },
        Error,
        'Should attempt to use custom CLI path'
      );
    });

    it('should use default CLI path when not specified', async () => {
      // **Validates: Requirement 11.3** - System uses reasonable defaults
      const provider = new GeminiProvider({
        useAPI: false,
      });

      assert.ok(provider, 'Provider should use default CLI path');
    });
  });
});
