/**
 * Gemini Provider Implementation
 * 
 * Implements the AIProvider interface for Google's Gemini API
 * Supports both API mode (with API key) and CLI mode (using gemini-cli)
 */

import { spawn, spawnSync } from 'child_process';
import { existsSync } from 'fs';
import type { AIProvider, AIMessage, AIResponse, ChatOptions } from './AIService.js';

/**
 * Gemini provider configuration
 */
export interface GeminiConfig {
  apiKey?: string;
  cliPath?: string;
  useAPI?: boolean;
  model?: string;
}

/**
 * Gemini provider implementation
 * Supports both API mode and CLI mode
 */
export class GeminiProvider implements AIProvider {
  private static cliAvailabilityCache = new Map<string, boolean>();
  private apiKey?: string;
  private cliPath: string;
  private useAPI: boolean;
  private defaultModel: string;
  private cliAvailable?: boolean;

  /**
   * Create a new Gemini provider
   * @param config - Gemini configuration
   */
  constructor(config: GeminiConfig) {
    this.apiKey = config.apiKey;
    this.cliPath = config.cliPath || 'gemini-cli';
    this.useAPI = config.useAPI ?? !!config.apiKey;
    this.defaultModel = config.model || 'gemini-2.0-flash-exp';

    // If API mode is requested but no API key, fall back to CLI
    if (this.useAPI && !this.apiKey) {
      this.useAPI = false;
    }

    // CLI availability check is intentionally lazy to avoid startup overhead.
  }

  /**
   * Send a chat request to Gemini
   * @param messages - Array of messages in the conversation
   * @param options - Optional chat configuration
   * @returns AI response with content and usage information
   */
  async chat(messages: AIMessage[], options?: ChatOptions): Promise<AIResponse> {
    if (this.useAPI) {
      return this.chatAPI(messages, options);
    } else {
      return this.chatCLI(messages, options);
    }
  }

  /**
   * Analyze an image with Gemini's vision capabilities
   * @param imageInput - Image data (base64 string or file path)
   * @param prompt - Text prompt describing what to analyze
   * @param isFilePath - Whether imageInput is a file path (default: false)
   * @returns Analysis result as text
   */
  async analyzeImage(imageInput: string, prompt: string, isFilePath = false): Promise<string> {
    if (this.useAPI) {
      return this.analyzeImageAPI(imageInput, prompt, isFilePath);
    } else {
      return this.analyzeImageCLI(imageInput, prompt, isFilePath);
    }
  }

  /**
   * Chat using Gemini API
   * @param messages - Array of messages
   * @param options - Chat options
   * @returns AI response
   */
  private async chatAPI(messages: AIMessage[], options?: ChatOptions): Promise<AIResponse> {
    throw new Error('Gemini API mode not yet implemented. Please use CLI mode or install gemini-cli.');
  }

  /**
   * Chat using Gemini CLI
   * @param messages - Array of messages
   * @param options - Chat options
   * @returns AI response
   */
  private async chatCLI(messages: AIMessage[], options?: ChatOptions): Promise<AIResponse> {
    // Check CLI availability
    if (!this.checkCLIAvailable()) {
      throw new Error(
        'gemini-cli is not available. Please install it:\n' +
        '  npm install -g @google/generative-ai-cli\n' +
        'Or set GEMINI_API_KEY to use API mode.'
      );
    }

    try {
      // Combine messages into a single prompt
      const prompt = this.formatMessagesForCLI(messages);
      
      // Execute CLI command
      const response = await this.executeCLI(prompt, options);
      
      return {
        content: response,
        // CLI mode doesn't provide token usage
        usage: undefined,
      };
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Analyze image using Gemini API
   * @param imageInput - Image data
   * @param prompt - Analysis prompt
   * @param isFilePath - Whether input is a file path
   * @returns Analysis result
   */
  private async analyzeImageAPI(
    imageInput: string,
    prompt: string,
    isFilePath: boolean
  ): Promise<string> {
    throw new Error('Gemini API mode not yet implemented. Please use CLI mode or install gemini-cli.');
  }

  /**
   * Analyze image using Gemini CLI
   * @param imageInput - Image data
   * @param prompt - Analysis prompt
   * @param isFilePath - Whether input is a file path
   * @returns Analysis result
   */
  private async analyzeImageCLI(
    imageInput: string,
    prompt: string,
    isFilePath: boolean
  ): Promise<string> {
    // Check CLI availability
    if (!this.checkCLIAvailable()) {
      throw new Error(
        'gemini-cli is not available. Please install it:\n' +
        '  npm install -g @google/generative-ai-cli\n' +
        'Or set GEMINI_API_KEY to use API mode.'
      );
    }

    try {
      let imagePath: string;

      if (isFilePath) {
        // Use the file path directly
        if (!existsSync(imageInput)) {
          throw new Error(`Image file not found: ${imageInput}`);
        }
        imagePath = imageInput;
      } else {
        // For base64 or data URLs, we need to save to a temp file
        // For now, throw an error as CLI mode works best with file paths
        throw new Error(
          'CLI mode requires image file paths. Please provide a file path or use API mode.'
        );
      }

      // Execute CLI with image
      const response = await this.executeCLI(prompt, undefined, imagePath);
      
      return response;
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Format messages for CLI input
   * @param messages - Array of messages
   * @returns Formatted prompt string
   */
  private formatMessagesForCLI(messages: AIMessage[]): string {
    const parts: string[] = [];

    for (const message of messages) {
      switch (message.role) {
        case 'system':
          parts.push(`System: ${message.content}`);
          break;
        case 'user':
          parts.push(`User: ${message.content}`);
          break;
        case 'assistant':
          parts.push(`Assistant: ${message.content}`);
          break;
      }
    }

    return parts.join('\n\n');
  }

  /**
   * Execute gemini-cli command
   * @param prompt - The prompt to send
   * @param options - Chat options
   * @param imagePath - Optional image file path
   * @returns CLI output
   */
  private async executeCLI(
    prompt: string,
    options?: ChatOptions,
    imagePath?: string
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      let settled = false;
      let timeout: NodeJS.Timeout | undefined;
      const settle = (handler: (value: any) => void, value: any): void => {
        if (settled) {
          return;
        }
        settled = true;
        if (timeout) {
          clearTimeout(timeout);
        }
        handler(value);
      };

      const args: string[] = [];

      // Add model if specified
      const model = options?.model || this.defaultModel;
      if (model) {
        args.push('--model', model);
      }

      // Add temperature if specified
      if (options?.temperature !== undefined) {
        args.push('--temperature', options.temperature.toString());
      }

      // Add max tokens if specified
      if (options?.maxTokens !== undefined) {
        args.push('--max-tokens', options.maxTokens.toString());
      }

      // Add image if provided
      if (imagePath) {
        args.push('--image', imagePath);
      }

      // Add prompt
      args.push(prompt);

      // Spawn the CLI process
      const child = spawn(this.cliPath, args, {
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';

      child.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      child.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      child.once('error', (error) => {
        settle(reject, new Error(`Failed to execute gemini-cli: ${error.message}`));
      });

      child.once('close', (code) => {
        if (code !== 0) {
          settle(
            reject,
            new Error(
              `gemini-cli exited with code ${code}${stderr ? `\nError: ${stderr}` : ''}`
            )
          );
        } else {
          // Parse and clean the output
          const response = this.parseCliOutput(stdout);
          settle(resolve, response);
        }
      });

      // Set timeout (default 60 seconds)
      timeout = setTimeout(() => {
        if (settled) {
          return;
        }
        child.kill();
        settle(reject, new Error('gemini-cli execution timed out after 60 seconds'));
      }, 60000);
    });
  }

  /**
   * Parse CLI output to extract the response
   * @param output - Raw CLI output
   * @returns Cleaned response text
   */
  private parseCliOutput(output: string): string {
    // Remove any CLI formatting or metadata
    // The actual response format depends on gemini-cli implementation
    // For now, return the output as-is, trimmed
    return output.trim();
  }

  /**
   * Check if gemini-cli is available
   * @returns True if CLI is available
   */
  private checkCLIAvailable(): boolean {
    if (this.cliAvailable !== undefined) {
      return this.cliAvailable;
    }

    const cached = GeminiProvider.cliAvailabilityCache.get(this.cliPath);
    if (cached !== undefined) {
      this.cliAvailable = cached;
      return cached;
    }

    try {
      // Try to execute gemini-cli --version
      const result = spawnSync(this.cliPath, ['--version'], {
        stdio: 'pipe',
        timeout: 1500,
      });

      this.cliAvailable = result.status === 0;
      GeminiProvider.cliAvailabilityCache.set(this.cliPath, this.cliAvailable);
      return this.cliAvailable;
    } catch (error) {
      this.cliAvailable = false;
      GeminiProvider.cliAvailabilityCache.set(this.cliPath, false);
      return false;
    }
  }

  /**
   * Handle and format errors
   * @param error - The error to handle
   * @returns Formatted error
   */
  private handleError(error: unknown): Error {
    if (error instanceof Error) {
      return error;
    }

    return new Error(`Unknown error: ${String(error)}`);
  }
}
