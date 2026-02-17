/**
 * Unit tests for AIService
 * Tests provider initialization, chat method, and error handling with retry mechanism
 * 
 * Requirements: 4.1, 12.2
 */

import { describe, it, mock, beforeEach } from 'node:test';
import assert from 'node:assert';
import { AIService, type AIProvider, type AIMessage, type AIResponse } from '../../../src/services/AIService.js';

describe('AIService', () => {
  describe('Constructor', () => {
    it('should initialize with a provider', () => {
      const mockProvider: AIProvider = {
        chat: async () => ({ content: 'test' }),
        analyzeImage: async () => 'test',
      };

      const service = new AIService(mockProvider);
      assert.ok(service);
    });

    it('should initialize with default retry configuration', () => {
      const mockProvider: AIProvider = {
        chat: async () => ({ content: 'test' }),
        analyzeImage: async () => 'test',
      };

      const service = new AIService(mockProvider);
      assert.ok(service);
    });

    it('should initialize with custom retry configuration', () => {
      const mockProvider: AIProvider = {
        chat: async () => ({ content: 'test' }),
        analyzeImage: async () => 'test',
      };

      const service = new AIService(mockProvider, {
        maxRetries: 5,
        initialDelay: 500,
        maxDelay: 5000,
        backoffMultiplier: 3,
      });

      assert.ok(service);
    });

    it('should accept partial retry configuration', () => {
      const mockProvider: AIProvider = {
        chat: async () => ({ content: 'test' }),
        analyzeImage: async () => 'test',
      };

      const service = new AIService(mockProvider, {
        maxRetries: 2,
      });

      assert.ok(service);
    });
  });

  describe('chat method', () => {
    it('should call provider chat method with messages', async () => {
      let calledWith: AIMessage[] | undefined;
      
      const mockProvider: AIProvider = {
        chat: async (messages: AIMessage[]) => {
          calledWith = messages;
          return { content: 'Hello!' };
        },
        analyzeImage: async () => 'test',
      };

      const service = new AIService(mockProvider);
      const messages: AIMessage[] = [
        { role: 'user', content: 'Hello' },
      ];

      const response = await service.chat(messages);

      assert.deepStrictEqual(calledWith, messages);
      assert.strictEqual(response.content, 'Hello!');
    });

    it('should pass chat options to provider', async () => {
      let calledOptions: any;
      
      const mockProvider: AIProvider = {
        chat: async (messages: AIMessage[], options?: any) => {
          calledOptions = options;
          return { content: 'test' };
        },
        analyzeImage: async () => 'test',
      };

      const service = new AIService(mockProvider);
      const options = {
        temperature: 0.7,
        maxTokens: 1000,
        model: 'gpt-4',
      };

      await service.chat([{ role: 'user', content: 'test' }], options);

      assert.deepStrictEqual(calledOptions, options);
    });

    it('should return response with usage information', async () => {
      const mockProvider: AIProvider = {
        chat: async () => ({
          content: 'Response',
          usage: {
            promptTokens: 10,
            completionTokens: 20,
            totalTokens: 30,
          },
        }),
        analyzeImage: async () => 'test',
      };

      const service = new AIService(mockProvider);
      const response = await service.chat([{ role: 'user', content: 'test' }]);

      assert.strictEqual(response.content, 'Response');
      assert.ok(response.usage);
      assert.strictEqual(response.usage.promptTokens, 10);
      assert.strictEqual(response.usage.completionTokens, 20);
      assert.strictEqual(response.usage.totalTokens, 30);
    });

    it('should handle response without usage information', async () => {
      const mockProvider: AIProvider = {
        chat: async () => ({
          content: 'Response',
        }),
        analyzeImage: async () => 'test',
      };

      const service = new AIService(mockProvider);
      const response = await service.chat([{ role: 'user', content: 'test' }]);

      assert.strictEqual(response.content, 'Response');
      assert.strictEqual(response.usage, undefined);
    });

    it('should handle multiple messages', async () => {
      const mockProvider: AIProvider = {
        chat: async (messages: AIMessage[]) => ({
          content: `Received ${messages.length} messages`,
        }),
        analyzeImage: async () => 'test',
      };

      const service = new AIService(mockProvider);
      const messages: AIMessage[] = [
        { role: 'system', content: 'You are helpful' },
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi!' },
        { role: 'user', content: 'How are you?' },
      ];

      const response = await service.chat(messages);

      assert.strictEqual(response.content, 'Received 4 messages');
    });
  });

  describe('analyzeImage method', () => {
    it('should call provider analyzeImage method', async () => {
      let calledWith: { imageInput: string; prompt: string; isFilePath?: boolean } | undefined;
      
      const mockProvider: AIProvider = {
        chat: async () => ({ content: 'test' }),
        analyzeImage: async (imageInput: string, prompt: string, isFilePath?: boolean) => {
          calledWith = { imageInput, prompt, isFilePath };
          return 'Image analysis result';
        },
      };

      const service = new AIService(mockProvider);
      const result = await service.analyzeImage('image.png', 'Describe this image', true);

      assert.ok(calledWith);
      assert.strictEqual(calledWith.imageInput, 'image.png');
      assert.strictEqual(calledWith.prompt, 'Describe this image');
      assert.strictEqual(calledWith.isFilePath, true);
      assert.strictEqual(result, 'Image analysis result');
    });

    it('should handle base64 image input', async () => {
      const mockProvider: AIProvider = {
        chat: async () => ({ content: 'test' }),
        analyzeImage: async (imageInput: string) => {
          return `Analyzed base64 image: ${imageInput.substring(0, 10)}...`;
        },
      };

      const service = new AIService(mockProvider);
      const base64Image = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
      const result = await service.analyzeImage(base64Image, 'What is this?', false);

      assert.ok(result.includes('Analyzed base64 image'));
    });
  });

  describe('Error handling and retry mechanism', () => {
    it('should retry on network errors (ECONNRESET)', async () => {
      let attempts = 0;
      
      const mockProvider: AIProvider = {
        chat: async () => {
          attempts++;
          if (attempts < 3) {
            const error: any = new Error('Connection reset');
            error.code = 'ECONNRESET';
            throw error;
          }
          return { content: 'Success after retries' };
        },
        analyzeImage: async () => 'test',
      };

      const service = new AIService(mockProvider, {
        maxRetries: 3,
        initialDelay: 10,
        maxDelay: 100,
        backoffMultiplier: 2,
      });

      const response = await service.chat([{ role: 'user', content: 'test' }]);

      assert.strictEqual(attempts, 3);
      assert.strictEqual(response.content, 'Success after retries');
    });

    it('should retry on network errors (ETIMEDOUT)', async () => {
      let attempts = 0;
      
      const mockProvider: AIProvider = {
        chat: async () => {
          attempts++;
          if (attempts < 2) {
            const error: any = new Error('Connection timed out');
            error.code = 'ETIMEDOUT';
            throw error;
          }
          return { content: 'Success' };
        },
        analyzeImage: async () => 'test',
      };

      const service = new AIService(mockProvider, {
        maxRetries: 3,
        initialDelay: 10,
      });

      const response = await service.chat([{ role: 'user', content: 'test' }]);

      assert.strictEqual(attempts, 2);
      assert.strictEqual(response.content, 'Success');
    });

    it('should retry on network errors (ENOTFOUND)', async () => {
      let attempts = 0;
      
      const mockProvider: AIProvider = {
        chat: async () => {
          attempts++;
          if (attempts < 2) {
            const error: any = new Error('Host not found');
            error.code = 'ENOTFOUND';
            throw error;
          }
          return { content: 'Success' };
        },
        analyzeImage: async () => 'test',
      };

      const service = new AIService(mockProvider, {
        maxRetries: 3,
        initialDelay: 10,
      });

      await service.chat([{ role: 'user', content: 'test' }]);

      assert.strictEqual(attempts, 2);
    });

    it('should retry on rate limit errors (429)', async () => {
      let attempts = 0;
      
      const mockProvider: AIProvider = {
        chat: async () => {
          attempts++;
          if (attempts < 2) {
            const error: any = new Error('Rate limit exceeded');
            error.status = 429;
            throw error;
          }
          return { content: 'Success' };
        },
        analyzeImage: async () => 'test',
      };

      const service = new AIService(mockProvider, {
        maxRetries: 3,
        initialDelay: 10,
      });

      await service.chat([{ role: 'user', content: 'test' }]);

      assert.strictEqual(attempts, 2);
    });

    it('should retry on server errors (500)', async () => {
      let attempts = 0;
      
      const mockProvider: AIProvider = {
        chat: async () => {
          attempts++;
          if (attempts < 2) {
            const error: any = new Error('Internal server error');
            error.status = 500;
            throw error;
          }
          return { content: 'Success' };
        },
        analyzeImage: async () => 'test',
      };

      const service = new AIService(mockProvider, {
        maxRetries: 3,
        initialDelay: 10,
      });

      await service.chat([{ role: 'user', content: 'test' }]);

      assert.strictEqual(attempts, 2);
    });

    it('should retry on server errors (503)', async () => {
      let attempts = 0;
      
      const mockProvider: AIProvider = {
        chat: async () => {
          attempts++;
          if (attempts < 2) {
            const error: any = new Error('Service unavailable');
            error.statusCode = 503;
            throw error;
          }
          return { content: 'Success' };
        },
        analyzeImage: async () => 'test',
      };

      const service = new AIService(mockProvider, {
        maxRetries: 3,
        initialDelay: 10,
      });

      await service.chat([{ role: 'user', content: 'test' }]);

      assert.strictEqual(attempts, 2);
    });

    it('should not retry on client errors (400)', async () => {
      let attempts = 0;
      
      const mockProvider: AIProvider = {
        chat: async () => {
          attempts++;
          const error: any = new Error('Bad request');
          error.status = 400;
          throw error;
        },
        analyzeImage: async () => 'test',
      };

      const service = new AIService(mockProvider, {
        maxRetries: 3,
        initialDelay: 10,
      });

      await assert.rejects(
        async () => {
          await service.chat([{ role: 'user', content: 'test' }]);
        },
        {
          message: /Bad request/,
        }
      );

      assert.strictEqual(attempts, 1);
    });

    it('should not retry on authentication errors (401)', async () => {
      let attempts = 0;
      
      const mockProvider: AIProvider = {
        chat: async () => {
          attempts++;
          const error: any = new Error('Unauthorized');
          error.status = 401;
          throw error;
        },
        analyzeImage: async () => 'test',
      };

      const service = new AIService(mockProvider, {
        maxRetries: 3,
        initialDelay: 10,
      });

      await assert.rejects(
        async () => {
          await service.chat([{ role: 'user', content: 'test' }]);
        },
        {
          message: /Unauthorized/,
        }
      );

      assert.strictEqual(attempts, 1);
    });

    it('should throw error after max retries exhausted', async () => {
      let attempts = 0;
      
      const mockProvider: AIProvider = {
        chat: async () => {
          attempts++;
          const error: any = new Error('Connection reset');
          error.code = 'ECONNRESET';
          throw error;
        },
        analyzeImage: async () => 'test',
      };

      const service = new AIService(mockProvider, {
        maxRetries: 2,
        initialDelay: 10,
      });

      await assert.rejects(
        async () => {
          await service.chat([{ role: 'user', content: 'test' }]);
        },
        {
          message: /AI service request failed after 2 retries/,
        }
      );

      // Should attempt initial + 2 retries = 3 total
      assert.strictEqual(attempts, 3);
    });

    it('should use exponential backoff for retries', async () => {
      const delays: number[] = [];
      let attempts = 0;
      let lastTime = Date.now();
      
      const mockProvider: AIProvider = {
        chat: async () => {
          attempts++;
          const currentTime = Date.now();
          if (attempts > 1) {
            delays.push(currentTime - lastTime);
          }
          lastTime = currentTime;
          
          if (attempts < 4) {
            const error: any = new Error('Connection reset');
            error.code = 'ECONNRESET';
            throw error;
          }
          return { content: 'Success' };
        },
        analyzeImage: async () => 'test',
      };

      const service = new AIService(mockProvider, {
        maxRetries: 3,
        initialDelay: 50,
        maxDelay: 500,
        backoffMultiplier: 2,
      });

      await service.chat([{ role: 'user', content: 'test' }]);

      // Verify exponential backoff: each delay should be roughly 2x the previous
      // Allow some tolerance for timing variations
      assert.ok(delays.length >= 2);
      assert.ok(delays[0] >= 40); // ~50ms
      assert.ok(delays[1] >= 90); // ~100ms (50 * 2)
    });

    it('should respect max delay in exponential backoff', async () => {
      const delays: number[] = [];
      let attempts = 0;
      let lastTime = Date.now();
      
      const mockProvider: AIProvider = {
        chat: async () => {
          attempts++;
          const currentTime = Date.now();
          if (attempts > 1) {
            delays.push(currentTime - lastTime);
          }
          lastTime = currentTime;
          
          if (attempts < 5) {
            const error: any = new Error('Connection reset');
            error.code = 'ECONNRESET';
            throw error;
          }
          return { content: 'Success' };
        },
        analyzeImage: async () => 'test',
      };

      const service = new AIService(mockProvider, {
        maxRetries: 4,
        initialDelay: 100,
        maxDelay: 150,
        backoffMultiplier: 2,
      });

      await service.chat([{ role: 'user', content: 'test' }]);

      // All delays should be capped at maxDelay (150ms)
      for (const delay of delays) {
        assert.ok(delay <= 200); // Allow some tolerance
      }
    });

    it('should retry analyzeImage on transient errors', async () => {
      let attempts = 0;
      
      const mockProvider: AIProvider = {
        chat: async () => ({ content: 'test' }),
        analyzeImage: async () => {
          attempts++;
          if (attempts < 2) {
            const error: any = new Error('Connection reset');
            error.code = 'ECONNRESET';
            throw error;
          }
          return 'Image analysis result';
        },
      };

      const service = new AIService(mockProvider, {
        maxRetries: 3,
        initialDelay: 10,
      });

      const result = await service.analyzeImage('image.png', 'Describe', true);

      assert.strictEqual(attempts, 2);
      assert.strictEqual(result, 'Image analysis result');
    });

    it('should handle non-retryable errors in analyzeImage', async () => {
      let attempts = 0;
      
      const mockProvider: AIProvider = {
        chat: async () => ({ content: 'test' }),
        analyzeImage: async () => {
          attempts++;
          const error: any = new Error('Invalid image format');
          error.status = 400;
          throw error;
        },
      };

      const service = new AIService(mockProvider, {
        maxRetries: 3,
        initialDelay: 10,
      });

      await assert.rejects(
        async () => {
          await service.analyzeImage('image.png', 'Describe', true);
        },
        {
          message: /Invalid image format/,
        }
      );

      assert.strictEqual(attempts, 1);
    });

    it('should not retry on non-Error objects', async () => {
      let attempts = 0;
      
      const mockProvider: AIProvider = {
        chat: async () => {
          attempts++;
          throw 'String error';
        },
        analyzeImage: async () => 'test',
      };

      const service = new AIService(mockProvider, {
        maxRetries: 2,
        initialDelay: 10,
      });

      await assert.rejects(
        async () => {
          await service.chat([{ role: 'user', content: 'test' }]);
        }
      );

      // Should not retry non-Error objects
      assert.strictEqual(attempts, 1);
    });

    it('should not retry on null errors', async () => {
      let attempts = 0;
      
      const mockProvider: AIProvider = {
        chat: async () => {
          attempts++;
          throw null;
        },
        analyzeImage: async () => 'test',
      };

      const service = new AIService(mockProvider, {
        maxRetries: 2,
        initialDelay: 10,
      });

      await assert.rejects(
        async () => {
          await service.chat([{ role: 'user', content: 'test' }]);
        }
      );

      // Should not retry null errors
      assert.strictEqual(attempts, 1);
    });
  });

  describe('Integration with different message types', () => {
    it('should handle system messages', async () => {
      const mockProvider: AIProvider = {
        chat: async (messages: AIMessage[]) => {
          const systemMsg = messages.find(m => m.role === 'system');
          return { content: systemMsg ? 'Has system message' : 'No system message' };
        },
        analyzeImage: async () => 'test',
      };

      const service = new AIService(mockProvider);
      const messages: AIMessage[] = [
        { role: 'system', content: 'You are helpful' },
        { role: 'user', content: 'Hello' },
      ];

      const response = await service.chat(messages);

      assert.strictEqual(response.content, 'Has system message');
    });

    it('should handle conversation history', async () => {
      const mockProvider: AIProvider = {
        chat: async (messages: AIMessage[]) => {
          return { content: `Conversation has ${messages.length} messages` };
        },
        analyzeImage: async () => 'test',
      };

      const service = new AIService(mockProvider);
      const messages: AIMessage[] = [
        { role: 'user', content: 'What is 2+2?' },
        { role: 'assistant', content: '4' },
        { role: 'user', content: 'What is 3+3?' },
      ];

      const response = await service.chat(messages);

      assert.strictEqual(response.content, 'Conversation has 3 messages');
    });

    it('should handle empty message content', async () => {
      const mockProvider: AIProvider = {
        chat: async () => ({ content: '' }),
        analyzeImage: async () => 'test',
      };

      const service = new AIService(mockProvider);
      const response = await service.chat([{ role: 'user', content: '' }]);

      assert.strictEqual(response.content, '');
    });
  });
});
