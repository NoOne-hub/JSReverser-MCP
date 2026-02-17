/**
 * AI Service Abstraction Layer
 * 
 * Provides a unified interface for interacting with different LLM providers
 * (OpenAI, Anthropic, Gemini) with support for chat and image analysis.
 */

/**
 * Message role in a conversation
 */
export type MessageRole = 'system' | 'user' | 'assistant';

/**
 * A single message in a conversation
 */
export interface AIMessage {
  role: MessageRole;
  content: string;
}

/**
 * Token usage information for a response
 */
export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

/**
 * Response from an AI provider
 */
export interface AIResponse {
  content: string;
  usage?: TokenUsage;
}

/**
 * Options for chat requests
 */
export interface ChatOptions {
  temperature?: number;
  maxTokens?: number;
  model?: string;
}

/**
 * Interface that all AI providers must implement
 */
export interface AIProvider {
  /**
   * Send a chat request to the AI provider
   * @param messages - Array of messages in the conversation
   * @param options - Optional chat configuration
   * @returns AI response with content and usage information
   */
  chat(messages: AIMessage[], options?: ChatOptions): Promise<AIResponse>;

  /**
   * Analyze an image with a text prompt
   * @param imageInput - Image data (base64 string or file path)
   * @param prompt - Text prompt describing what to analyze
   * @param isFilePath - Whether imageInput is a file path (default: false)
   * @returns Analysis result as text
   */
  analyzeImage(imageInput: string, prompt: string, isFilePath?: boolean): Promise<string>;
}

/**
 * Configuration for AI service
 */
export interface AIConfig {
  provider: 'openai' | 'anthropic' | 'gemini';
  openai?: {
    apiKey: string;
    baseURL?: string;
    model?: string;
  };
  anthropic?: {
    apiKey: string;
    model?: string;
  };
  gemini?: {
    apiKey?: string;
    cliPath?: string;
    useAPI?: boolean;
    model?: string;
  };
}

/**
 * Retry configuration
 */
interface RetryConfig {
  maxRetries: number;
  initialDelay: number;
  maxDelay: number;
  backoffMultiplier: number;
}

/**
 * Default retry configuration
 */
const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 3,
  initialDelay: 1000,
  maxDelay: 10000,
  backoffMultiplier: 2,
};

/**
 * Main AI Service class that manages providers and handles retries
 */
export class AIService {
  private provider: AIProvider;
  private retryConfig: RetryConfig;

  /**
   * Create a new AI service instance
   * @param provider - The AI provider implementation to use
   * @param retryConfig - Optional retry configuration
   */
  constructor(provider: AIProvider, retryConfig?: Partial<RetryConfig>) {
    this.provider = provider;
    this.retryConfig = { ...DEFAULT_RETRY_CONFIG, ...retryConfig };
  }

  /**
   * Send a chat request with automatic retry on transient failures
   * @param messages - Array of messages in the conversation
   * @param options - Optional chat configuration
   * @returns AI response with content and usage information
   */
  async chat(messages: AIMessage[], options?: ChatOptions): Promise<AIResponse> {
    return this.withRetry(() => this.provider.chat(messages, options));
  }

  /**
   * Analyze an image with automatic retry on transient failures
   * @param imageInput - Image data (base64 string or file path)
   * @param prompt - Text prompt describing what to analyze
   * @param isFilePath - Whether imageInput is a file path (default: false)
   * @returns Analysis result as text
   */
  async analyzeImage(imageInput: string, prompt: string, isFilePath?: boolean): Promise<string> {
    return this.withRetry(() => this.provider.analyzeImage(imageInput, prompt, isFilePath));
  }

  /**
   * Execute a function with exponential backoff retry logic
   * @param fn - Function to execute
   * @returns Result of the function
   */
  private async withRetry<T>(fn: () => Promise<T>): Promise<T> {
    let lastError: Error | undefined;
    let delay = this.retryConfig.initialDelay;

    for (let attempt = 0; attempt <= this.retryConfig.maxRetries; attempt++) {
      try {
        return await fn();
      } catch (error) {
        lastError = error as Error;

        // Don't retry on the last attempt
        if (attempt === this.retryConfig.maxRetries) {
          break;
        }

        // Check if error is retryable
        if (!this.isRetryableError(error)) {
          throw error;
        }

        // Wait before retrying
        await this.sleep(delay);

        // Increase delay for next attempt (exponential backoff)
        delay = Math.min(delay * this.retryConfig.backoffMultiplier, this.retryConfig.maxDelay);
      }
    }

    // All retries exhausted
    throw new Error(
      `AI service request failed after ${this.retryConfig.maxRetries} retries: ${lastError?.message}`
    );
  }

  /**
   * Determine if an error is retryable
   * @param error - The error to check
   * @returns True if the error should be retried
   */
  private isRetryableError(error: unknown): boolean {
    if (!error || typeof error !== 'object') {
      return false;
    }

    const err = error as any;

    // Retry on network errors
    if (err.code === 'ECONNRESET' || err.code === 'ETIMEDOUT' || err.code === 'ENOTFOUND') {
      return true;
    }

    // Retry on rate limit errors (429)
    if (err.status === 429 || err.statusCode === 429) {
      return true;
    }

    // Retry on server errors (5xx)
    if (err.status >= 500 || err.statusCode >= 500) {
      return true;
    }

    return false;
  }

  /**
   * Sleep for a specified duration
   * @param ms - Duration in milliseconds
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
