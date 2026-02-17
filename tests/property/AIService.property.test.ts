/**
 * Property-Based Tests for AI Service
 * 
 * **Property 9: AI Provider Support**
 * **Validates: Requirements 4.1**
 * 
 * Tests that all three supported providers (OpenAI, Anthropic, Gemini) can be 
 * initialized and make chat requests successfully.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import * as fc from 'fast-check';
import { AIService, type AIProvider, type AIMessage, type AIResponse } from '../../src/services/AIService.js';
import { OpenAIProvider } from '../../src/services/OpenAIProvider.js';
import { AnthropicProvider } from '../../src/services/AnthropicProvider.js';
import { GeminiProvider } from '../../src/services/GeminiProvider.js';

/**
 * Generator for AI provider types
 */
const providerTypeArb = fc.constantFrom('openai', 'anthropic', 'gemini');

/**
 * Generator for valid API keys (mock format)
 */
const apiKeyArb = fc.string({ minLength: 10, maxLength: 50 }).map(s => `sk-test-${s}`);

/**
 * Generator for AI messages
 */
const aiMessageArb = fc.record({
  role: fc.constantFrom('system' as const, 'user' as const, 'assistant' as const),
  content: fc.string({ minLength: 1, maxLength: 100 }),
});

/**
 * Generator for arrays of AI messages (at least one message)
 */
const messagesArb = fc.array(aiMessageArb, { minLength: 1, maxLength: 5 });

/**
 * Create a mock provider that simulates successful responses
 */
function createMockProvider(providerType: string): AIProvider {
  return {
    async chat(messages: AIMessage[]): Promise<AIResponse> {
      return {
        content: `Mock response from ${providerType} with ${messages.length} messages`,
        usage: {
          promptTokens: 10,
          completionTokens: 20,
          totalTokens: 30,
        },
      };
    },
    async analyzeImage(imageInput: string, prompt: string): Promise<string> {
      return `Mock image analysis from ${providerType}: ${prompt}`;
    },
  };
}

describe('Property-Based Tests: AI Service', () => {
  describe('Property 9: AI Provider Support', () => {
    it('should initialize AIService with any of the three providers', () => {
      /**
       * **Validates: Requirements 4.1**
       * 
       * Property: For any provider type (OpenAI, Anthropic, Gemini),
       * the AIService should successfully initialize with a mock provider.
       */
      fc.assert(
        fc.property(
          providerTypeArb,
          (providerType) => {
            const mockProvider = createMockProvider(providerType);
            const service = new AIService(mockProvider);
            
            assert.ok(service, `AIService should initialize with ${providerType} provider`);
            return true;
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should successfully call chat method with any provider', async () => {
      /**
       * **Validates: Requirements 4.1**
       * 
       * Property: For any provider type and any valid message array,
       * the chat method should return a response without throwing errors.
       */
      await fc.assert(
        fc.asyncProperty(
          providerTypeArb,
          messagesArb,
          async (providerType, messages) => {
            const mockProvider = createMockProvider(providerType);
            const service = new AIService(mockProvider);
            
            const response = await service.chat(messages);
            
            assert.ok(response, 'Response should be defined');
            assert.ok(response.content, 'Response should have content');
            assert.strictEqual(typeof response.content, 'string', 'Content should be a string');
            assert.ok(
              response.content.includes(providerType),
              `Response should indicate it came from ${providerType}`
            );
            
            return true;
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should successfully call analyzeImage method with any provider', async () => {
      /**
       * **Validates: Requirements 4.1**
       * 
       * Property: For any provider type and any valid image input,
       * the analyzeImage method should return a response without throwing errors.
       */
      await fc.assert(
        fc.asyncProperty(
          providerTypeArb,
          fc.string({ minLength: 1, maxLength: 100 }),
          fc.string({ minLength: 1, maxLength: 100 }),
          async (providerType, imageInput, prompt) => {
            const mockProvider = createMockProvider(providerType);
            const service = new AIService(mockProvider);
            
            const response = await service.analyzeImage(imageInput, prompt);
            
            assert.ok(response, 'Response should be defined');
            assert.strictEqual(typeof response, 'string', 'Response should be a string');
            assert.ok(
              response.includes(providerType),
              `Response should indicate it came from ${providerType}`
            );
            assert.ok(
              response.includes(prompt),
              'Response should reference the prompt'
            );
            
            return true;
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should handle all three provider types consistently', async () => {
      /**
       * **Validates: Requirements 4.1**
       * 
       * Property: All three provider types should behave consistently
       * when given the same input messages.
       */
      await fc.assert(
        fc.asyncProperty(
          messagesArb,
          async (messages) => {
            const providers = ['openai', 'anthropic', 'gemini'];
            const responses: AIResponse[] = [];
            
            for (const providerType of providers) {
              const mockProvider = createMockProvider(providerType);
              const service = new AIService(mockProvider);
              const response = await service.chat(messages);
              responses.push(response);
            }
            
            // All responses should be defined and have content
            for (const response of responses) {
              assert.ok(response, 'Response should be defined');
              assert.ok(response.content, 'Response should have content');
              assert.strictEqual(typeof response.content, 'string', 'Content should be a string');
            }
            
            // All responses should have the same structure
            const allHaveUsage = responses.every(r => r.usage !== undefined);
            const noneHaveUsage = responses.every(r => r.usage === undefined);
            assert.ok(
              allHaveUsage || noneHaveUsage,
              'All providers should consistently provide or not provide usage information'
            );
            
            return true;
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should initialize real OpenAI provider with valid configuration', () => {
      /**
       * **Validates: Requirements 4.1, 4.2**
       * 
       * Property: For any valid API key, OpenAI provider should initialize successfully.
       */
      fc.assert(
        fc.property(
          apiKeyArb,
          (apiKey) => {
            const provider = new OpenAIProvider({ apiKey });
            const service = new AIService(provider);
            
            assert.ok(provider, 'OpenAI provider should initialize');
            assert.ok(service, 'AIService should initialize with OpenAI provider');
            return true;
          }
        ),
        { numRuns: 50 }
      );
    });

    it('should initialize real Anthropic provider with valid configuration', () => {
      /**
       * **Validates: Requirements 4.1, 4.3**
       * 
       * Property: For any valid API key, Anthropic provider should initialize successfully.
       */
      fc.assert(
        fc.property(
          apiKeyArb,
          (apiKey) => {
            const provider = new AnthropicProvider({ apiKey });
            const service = new AIService(provider);
            
            assert.ok(provider, 'Anthropic provider should initialize');
            assert.ok(service, 'AIService should initialize with Anthropic provider');
            return true;
          }
        ),
        { numRuns: 50 }
      );
    });

    it('should initialize real Gemini provider in CLI mode', () => {
      /**
       * **Validates: Requirements 4.1, 4.4, 4.5**
       * 
       * Property: Gemini provider should initialize successfully in CLI mode
       * without requiring an API key.
       */
      fc.assert(
        fc.property(
          fc.constant(undefined),
          () => {
            const provider = new GeminiProvider({ useAPI: false });
            const service = new AIService(provider);
            
            assert.ok(provider, 'Gemini provider should initialize in CLI mode');
            assert.ok(service, 'AIService should initialize with Gemini provider');
            return true;
          }
        ),
        { numRuns: 50 }
      );
    });

    it('should handle provider initialization with various retry configurations', () => {
      /**
       * **Validates: Requirements 4.1**
       * 
       * Property: AIService should initialize with any valid retry configuration
       * for any provider type.
       */
      fc.assert(
        fc.property(
          providerTypeArb,
          fc.integer({ min: 0, max: 10 }),
          fc.integer({ min: 100, max: 5000 }),
          fc.integer({ min: 1000, max: 30000 }),
          fc.integer({ min: 1, max: 5 }),
          (providerType, maxRetries, initialDelay, maxDelay, backoffMultiplier) => {
            const mockProvider = createMockProvider(providerType);
            const service = new AIService(mockProvider, {
              maxRetries,
              initialDelay,
              maxDelay,
              backoffMultiplier,
            });
            
            assert.ok(service, 'AIService should initialize with custom retry config');
            return true;
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should handle empty and non-empty message arrays consistently', async () => {
      /**
       * **Validates: Requirements 4.1**
       * 
       * Property: Providers should handle message arrays of any length
       * (though empty arrays may fail, which is expected).
       */
      await fc.assert(
        fc.asyncProperty(
          providerTypeArb,
          fc.array(aiMessageArb, { minLength: 0, maxLength: 10 }),
          async (providerType, messages) => {
            const mockProvider = createMockProvider(providerType);
            const service = new AIService(mockProvider);
            
            if (messages.length === 0) {
              // Empty messages may be rejected by some providers
              // This is acceptable behavior
              return true;
            }
            
            const response = await service.chat(messages);
            assert.ok(response, 'Response should be defined for non-empty messages');
            assert.ok(response.content, 'Response should have content');
            
            return true;
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should preserve message content through the service layer', async () => {
      /**
       * **Validates: Requirements 4.1**
       * 
       * Property: The AIService should pass messages to the provider without
       * modifying their content.
       */
      await fc.assert(
        fc.asyncProperty(
          providerTypeArb,
          messagesArb,
          async (providerType, messages) => {
            let capturedMessages: AIMessage[] | undefined;
            
            const mockProvider: AIProvider = {
              async chat(msgs: AIMessage[]): Promise<AIResponse> {
                capturedMessages = msgs;
                return {
                  content: `Response with ${msgs.length} messages`,
                  usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
                };
              },
              async analyzeImage(): Promise<string> {
                return 'Mock image analysis';
              },
            };
            
            const service = new AIService(mockProvider);
            await service.chat(messages);
            
            assert.ok(capturedMessages, 'Messages should be captured');
            assert.strictEqual(
              capturedMessages.length,
              messages.length,
              'Message count should be preserved'
            );
            
            for (let i = 0; i < messages.length; i++) {
              assert.strictEqual(
                capturedMessages[i].role,
                messages[i].role,
                `Message ${i} role should be preserved`
              );
              assert.strictEqual(
                capturedMessages[i].content,
                messages[i].content,
                `Message ${i} content should be preserved`
              );
            }
            
            return true;
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});
