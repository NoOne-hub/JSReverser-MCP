/**
 * Configuration management for jshook-integration
 * Handles environment variables and system configuration
 */

import { config as dotenvConfig } from 'dotenv';
import { existsSync } from 'fs';
import { resolve } from 'path';
import { AIService } from '../services/AIService.js';
import { OpenAIProvider } from '../services/OpenAIProvider.js';
import { AnthropicProvider } from '../services/AnthropicProvider.js';
import { GeminiProvider } from '../services/GeminiProvider.js';

// Load .env file if it exists
const envPath = resolve(process.cwd(), '.env');
if (existsSync(envPath)) {
  dotenvConfig({ path: envPath });
}

/**
 * LLM Provider types
 */
export type LLMProvider = 'openai' | 'anthropic' | 'gemini';

/**
 * AI Service Configuration
 */
export interface AIConfig {
  provider: LLMProvider;
  openai?: {
    apiKey: string;
    baseURL?: string;
    model?: string;
  };
  anthropic?: {
    apiKey: string;
    baseURL?: string;
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
 * Browser Configuration
 */
export interface BrowserConfig {
  headless?: boolean;
  executablePath?: string;
  channel?: 'chrome' | 'chrome-beta' | 'chrome-dev' | 'chrome-canary' | 'msedge';
  isolated?: boolean;
  remoteDebuggingUrl?: string;
  remoteDebuggingPort?: number;
  useStealthScripts?: boolean;
}

/**
 * System Configuration
 */
export interface SystemConfig {
  ai?: AIConfig;
  browser: BrowserConfig;
  debug?: boolean;
}

/**
 * Get the default LLM provider from environment
 */
export function getDefaultLLMProvider(): LLMProvider {
  const provider = process.env.DEFAULT_LLM_PROVIDER?.toLowerCase();
  if (provider === 'openai' || provider === 'anthropic' || provider === 'gemini') {
    return provider;
  }
  // Default to gemini if no provider specified
  return 'gemini';
}

/**
 * Get AI configuration from environment variables
 */
export function getAIConfig(): AIConfig | undefined {
  const provider = getDefaultLLMProvider();
  
  const config: AIConfig = {
    provider,
  };

  // OpenAI configuration
  if (process.env.OPENAI_API_KEY) {
    config.openai = {
      apiKey: process.env.OPENAI_API_KEY,
      baseURL: process.env.OPENAI_BASE_URL,
      model: process.env.OPENAI_MODEL || 'gpt-4o',
    };
  }

  // Anthropic configuration
  if (process.env.ANTHROPIC_API_KEY) {
    config.anthropic = {
      apiKey: process.env.ANTHROPIC_API_KEY,
      baseURL: process.env.ANTHROPIC_BASE_URL,
      model: process.env.ANTHROPIC_MODEL || 'claude-3-5-sonnet-20241022',
    };
  }

  // Gemini configuration
  const geminiApiKey = process.env.GEMINI_API_KEY;
  const geminiCliPath = process.env.GEMINI_CLI_PATH || 'gemini-cli';
  
  config.gemini = {
    apiKey: geminiApiKey,
    cliPath: geminiCliPath,
    useAPI: !!geminiApiKey,
    model: process.env.GEMINI_MODEL || 'gemini-2.0-flash-exp',
  };

  // Check if any provider is configured
  const hasAnyProvider = config.openai || config.anthropic || config.gemini;
  
  return hasAnyProvider ? config : undefined;
}

/**
 * Get browser configuration from environment variables
 */
export function getBrowserConfig(): BrowserConfig {
  const config: BrowserConfig = {
    headless: process.env.BROWSER_HEADLESS !== 'false',
    isolated: process.env.BROWSER_ISOLATED !== 'false',
    useStealthScripts: process.env.USE_STEALTH_SCRIPTS === 'true',
  };

  if (process.env.BROWSER_EXECUTABLE_PATH) {
    config.executablePath = process.env.BROWSER_EXECUTABLE_PATH;
  }

  if (process.env.BROWSER_CHANNEL) {
    config.channel = process.env.BROWSER_CHANNEL as BrowserConfig['channel'];
  }

  if (process.env.REMOTE_DEBUGGING_URL) {
    config.remoteDebuggingUrl = process.env.REMOTE_DEBUGGING_URL;
  }

  if (process.env.REMOTE_DEBUGGING_PORT) {
    config.remoteDebuggingPort = parseInt(process.env.REMOTE_DEBUGGING_PORT, 10);
  }

  return config;
}

/**
 * Get complete system configuration
 */
export function getSystemConfig(): SystemConfig {
  return {
    ai: getAIConfig(),
    browser: getBrowserConfig(),
    debug: isDebugEnabled(),
  };
}

/**
 * Validate configuration
 */
export function validateConfig(config: SystemConfig): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  // Validate browser config
  if (config.browser.remoteDebuggingPort !== undefined) {
    const port = config.browser.remoteDebuggingPort;
    if (port < 1 || port > 65535) {
      errors.push(`Invalid REMOTE_DEBUGGING_PORT: ${port}. Must be between 1 and 65535.`);
    }
  }

  // Validate AI config if present
  if (config.ai) {
    const { provider } = config.ai;
    
    if (provider === 'openai' && !config.ai.openai) {
      errors.push('OpenAI provider selected but OPENAI_API_KEY not configured');
    }
    
    if (provider === 'anthropic' && !config.ai.anthropic) {
      errors.push('Anthropic provider selected but ANTHROPIC_API_KEY not configured');
    }
    
    if (provider === 'gemini' && !config.ai.gemini) {
      errors.push('Gemini provider selected but no configuration found');
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Get environment variable with fallback
 */
export function getEnv(key: string, defaultValue?: string): string | undefined {
  return process.env[key] || defaultValue;
}

/**
 * Check if debug mode is enabled
 */
export function isDebugEnabled(): boolean {
  return process.env.DEBUG === 'true' || process.env.DEBUG?.includes('mcp') || false;
}

/**
 * Create an AI service instance based on configuration
 * @param config - Optional AI configuration (uses environment if not provided)
 * @returns AIService instance or undefined if no provider is configured
 */
export function createAIService(config?: AIConfig): AIService | undefined {
  const aiConfig = config || getAIConfig();
  
  if (!aiConfig) {
    return undefined;
  }

  const { provider } = aiConfig;

  try {
    switch (provider) {
      case 'openai': {
        if (!aiConfig.openai) {
          throw new Error('OpenAI configuration not found');
        }
        const openaiProvider = new OpenAIProvider({
          apiKey: aiConfig.openai.apiKey,
          baseURL: aiConfig.openai.baseURL,
          model: aiConfig.openai.model,
        });
        return new AIService(openaiProvider);
      }

      case 'anthropic': {
        if (!aiConfig.anthropic) {
          throw new Error('Anthropic configuration not found');
        }
        const anthropicProvider = new AnthropicProvider({
          apiKey: aiConfig.anthropic.apiKey,
          baseURL: aiConfig.anthropic.baseURL,
          model: aiConfig.anthropic.model,
        });
        return new AIService(anthropicProvider);
      }

      case 'gemini': {
        if (!aiConfig.gemini) {
          throw new Error('Gemini configuration not found');
        }
        const geminiProvider = new GeminiProvider({
          apiKey: aiConfig.gemini.apiKey,
          cliPath: aiConfig.gemini.cliPath,
          useAPI: aiConfig.gemini.useAPI,
          model: aiConfig.gemini.model,
        });
        return new AIService(geminiProvider);
      }

      default: {
        throw new Error(`Unknown provider: ${provider}`);
      }
    }
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(`Failed to create AI service: ${error.message}`);
    }
    throw error;
  }
}
