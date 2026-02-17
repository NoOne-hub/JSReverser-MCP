/**
 * Anthropic Provider Implementation
 * 
 * Implements the AIProvider interface for Anthropic's Claude API
 */

import Anthropic from '@anthropic-ai/sdk';
import { readFileSync } from 'fs';
import type { AIProvider, AIMessage, AIResponse, ChatOptions } from './AIService.js';

/**
 * Anthropic provider configuration
 */
export interface AnthropicConfig {
  apiKey: string;
  model?: string;
}

/**
 * Anthropic provider implementation
 */
export class AnthropicProvider implements AIProvider {
  private client: Anthropic;
  private defaultModel: string;

  /**
   * Create a new Anthropic provider
   * @param config - Anthropic configuration
   */
  constructor(config: AnthropicConfig) {
    if (!config.apiKey) {
      throw new Error('Anthropic API key is required');
    }

    this.client = new Anthropic({
      apiKey: config.apiKey,
    });

    this.defaultModel = config.model || 'claude-3-5-sonnet-20241022';
  }

  /**
   * Send a chat request to Anthropic
   * @param messages - Array of messages in the conversation
   * @param options - Optional chat configuration
   * @returns AI response with content and usage information
   */
  async chat(messages: AIMessage[], options?: ChatOptions): Promise<AIResponse> {
    try {
      // Anthropic requires system messages to be separate from the messages array
      const systemMessage = messages.find((msg) => msg.role === 'system');
      const conversationMessages = messages.filter((msg) => msg.role !== 'system');

      const response = await this.client.messages.create({
        model: options?.model || this.defaultModel,
        max_tokens: options?.maxTokens || 4096,
        temperature: options?.temperature,
        system: systemMessage?.content,
        messages: conversationMessages.map((msg) => ({
          role: msg.role as 'user' | 'assistant',
          content: msg.content,
        })),
      });

      // Extract text content from the response
      const textContent = response.content
        .filter((block) => block.type === 'text')
        .map((block) => (block as Anthropic.TextBlock).text)
        .join('');

      return {
        content: textContent,
        usage: {
          promptTokens: response.usage.input_tokens,
          completionTokens: response.usage.output_tokens,
          totalTokens: response.usage.input_tokens + response.usage.output_tokens,
        },
      };
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Analyze an image with Anthropic's vision capabilities
   * @param imageInput - Image data (base64 string or file path)
   * @param prompt - Text prompt describing what to analyze
   * @param isFilePath - Whether imageInput is a file path (default: false)
   * @returns Analysis result as text
   */
  async analyzeImage(imageInput: string, prompt: string, isFilePath = false): Promise<string> {
    try {
      let imageData: string;
      let mediaType: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';

      if (isFilePath) {
        // Read file and convert to base64
        const imageBuffer = readFileSync(imageInput);
        imageData = imageBuffer.toString('base64');
        
        // Detect image type from file extension
        const ext = imageInput.toLowerCase().split('.').pop();
        mediaType = this.getMediaType(ext || '');
      } else {
        // Handle different input formats
        if (imageInput.startsWith('data:')) {
          // Extract base64 data from data URL
          const matches = imageInput.match(/^data:([^;]+);base64,(.+)$/);
          if (!matches) {
            throw new Error('Invalid data URL format');
          }
          mediaType = matches[1] as typeof mediaType;
          imageData = matches[2];
        } else {
          // Assume it's raw base64
          imageData = imageInput;
          mediaType = 'image/png'; // Default to PNG
        }
      }

      const response = await this.client.messages.create({
        model: this.defaultModel,
        max_tokens: 4096,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'image',
                source: {
                  type: 'base64',
                  media_type: mediaType,
                  data: imageData,
                },
              },
              {
                type: 'text',
                text: prompt,
              },
            ],
          },
        ],
      });

      // Extract text content from the response
      const textContent = response.content
        .filter((block) => block.type === 'text')
        .map((block) => (block as Anthropic.TextBlock).text)
        .join('');

      return textContent;
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Get media type from file extension
   * @param ext - File extension
   * @returns Media type
   */
  private getMediaType(ext: string): 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp' {
    const mediaTypes: Record<string, 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp'> = {
      png: 'image/png',
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      gif: 'image/gif',
      webp: 'image/webp',
    };

    return mediaTypes[ext] || 'image/png';
  }

  /**
   * Handle and format errors from Anthropic API
   * @param error - The error to handle
   * @returns Formatted error
   */
  private handleError(error: unknown): Error {
    /* c8 ignore next */
    if (error instanceof Anthropic.APIError) {
      const message = `Anthropic API error (${error.status}): ${error.message}`;
      const formattedError = new Error(message);
      
      // Preserve status code for retry logic
      (formattedError as any).status = error.status;
      
      return formattedError;
    }

    if (error instanceof Error) {
      return error;
    }

    return new Error(`Unknown error: ${String(error)}`);
  }
}
