/**
 * OpenAI Provider Implementation
 * 
 * Implements the AIProvider interface for OpenAI's API
 */

import OpenAI from 'openai';
import { readFileSync } from 'fs';
import type { AIProvider, AIMessage, AIResponse, ChatOptions } from './AIService.js';

/**
 * OpenAI provider configuration
 */
export interface OpenAIConfig {
  apiKey: string;
  baseURL?: string;
  model?: string;
}

/**
 * OpenAI provider implementation
 */
export class OpenAIProvider implements AIProvider {
  private client: OpenAI;
  private defaultModel: string;

  /**
   * Create a new OpenAI provider
   * @param config - OpenAI configuration
   */
  constructor(config: OpenAIConfig) {
    if (!config.apiKey) {
      throw new Error('OpenAI API key is required');
    }

    this.client = new OpenAI({
      apiKey: config.apiKey,
      baseURL: config.baseURL,
    });

    this.defaultModel = config.model || 'gpt-4o';
  }

  /**
   * Send a chat request to OpenAI
   * @param messages - Array of messages in the conversation
   * @param options - Optional chat configuration
   * @returns AI response with content and usage information
   */
  async chat(messages: AIMessage[], options?: ChatOptions): Promise<AIResponse> {
    try {
      const response = await this.client.chat.completions.create({
        model: options?.model || this.defaultModel,
        messages: messages.map((msg) => ({
          role: msg.role,
          content: msg.content,
        })),
        temperature: options?.temperature,
        max_tokens: options?.maxTokens,
      });

      const choice = response.choices[0];
      if (!choice || !choice.message) {
        throw new Error('No response from OpenAI');
      }

      return {
        content: choice.message.content || '',
        usage: response.usage
          ? {
              promptTokens: response.usage.prompt_tokens,
              completionTokens: response.usage.completion_tokens,
              totalTokens: response.usage.total_tokens,
            }
          : undefined,
      };
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Analyze an image with OpenAI's vision capabilities
   * @param imageInput - Image data (base64 string or file path)
   * @param prompt - Text prompt describing what to analyze
   * @param isFilePath - Whether imageInput is a file path (default: false)
   * @returns Analysis result as text
   */
  async analyzeImage(imageInput: string, prompt: string, isFilePath = false): Promise<string> {
    try {
      let imageUrl: string;

      if (isFilePath) {
        // Read file and convert to base64
        const imageBuffer = readFileSync(imageInput);
        const base64Image = imageBuffer.toString('base64');
        
        // Detect image type from file extension
        const ext = imageInput.toLowerCase().split('.').pop();
        const mimeType = this.getMimeType(ext || '');
        
        imageUrl = `data:${mimeType};base64,${base64Image}`;
      } else {
        // Assume it's already base64 or a URL
        if (imageInput.startsWith('http://') || imageInput.startsWith('https://')) {
          imageUrl = imageInput;
        } else if (imageInput.startsWith('data:')) {
          imageUrl = imageInput;
        } else {
          // Assume it's raw base64, add data URL prefix
          imageUrl = `data:image/png;base64,${imageInput}`;
        }
      }

      const response = await this.client.chat.completions.create({
        model: 'gpt-4o',
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: prompt,
              },
              {
                type: 'image_url',
                image_url: {
                  url: imageUrl,
                },
              },
            ],
          },
        ],
      });

      const choice = response.choices[0];
      if (!choice || !choice.message) {
        throw new Error('No response from OpenAI');
      }

      return choice.message.content || '';
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Get MIME type from file extension
   * @param ext - File extension
   * @returns MIME type
   */
  private getMimeType(ext: string): string {
    const mimeTypes: Record<string, string> = {
      png: 'image/png',
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      gif: 'image/gif',
      webp: 'image/webp',
    };

    return mimeTypes[ext] || 'image/png';
  }

  /**
   * Handle and format errors from OpenAI API
   * @param error - The error to handle
   * @returns Formatted error
   */
  private handleError(error: unknown): Error {
    if (error instanceof OpenAI.APIError) {
      const message = `OpenAI API error (${error.status}): ${error.message}`;
      const formattedError = new Error(message);
      
      // Preserve status code for retry logic
      (formattedError as any).status = error.status;
      (formattedError as any).code = error.code;
      
      return formattedError;
    }

    if (error instanceof Error) {
      return error;
    }

    return new Error(`Unknown error: ${String(error)}`);
  }
}
