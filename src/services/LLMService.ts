import type {AIMessage, AIResponse, ChatOptions} from './AIService.js';
import {createAIService} from '../utils/config.js';

export type LLMMessage = AIMessage;
export type LLMResponse = AIResponse;

export class LLMService {
  constructor(
    private readonly serviceFactory: typeof createAIService = createAIService,
  ) {}

  async chat(
    messages: LLMMessage[],
    options?: {temperature?: number; maxTokens?: number},
  ): Promise<LLMResponse> {
    const service = this.serviceFactory();
    if (!service) {
      throw new Error('No AI provider configured. Set DEFAULT_LLM_PROVIDER and provider API key or Gemini CLI.');
    }

    const chatOptions: ChatOptions = {
      temperature: options?.temperature,
      maxTokens: options?.maxTokens,
    };

    return service.chat(messages, chatOptions);
  }

  generateCodeAnalysisPrompt(code: string, focus: string): LLMMessage[] {
    return [
      {
        role: 'system',
        content:
          'You are an expert JavaScript reverse engineer. Analyze code and return strict JSON only.',
      },
      {
        role: 'user',
        content: [
          `Focus: ${focus}`,
          'Return JSON with: techStack, businessLogic, securityRisks, summary.',
          'Code:',
          code,
        ].join('\n\n'),
      },
    ];
  }

  generateCryptoDetectionPrompt(code: string): LLMMessage[] {
    return [
      {
        role: 'system',
        content:
          'You are a cryptography code auditor. Detect algorithms and return strict JSON only.',
      },
      {
        role: 'user',
        content: [
          'Return JSON with: algorithms[] where each item contains name, type, confidence, usage, parameters.',
          'Code:',
          code,
        ].join('\n\n'),
      },
    ];
  }

  generateDeobfuscationPrompt(code: string): LLMMessage[] {
    return [
      {
        role: 'system',
        content:
          'You are an advanced JavaScript deobfuscation expert. Explain transformations and produce cleaned code guidance.',
      },
      {
        role: 'user',
        content: [
          'Analyze obfuscation techniques and provide a concise remediation strategy.',
          'Code:',
          code,
        ].join('\n\n'),
      },
    ];
  }

  generateTaintAnalysisPrompt(
    code: string,
    sources: string[],
    sinks: string[],
  ): LLMMessage[] {
    return [
      {
        role: 'system',
        content:
          'You are a JavaScript taint-analysis assistant. Return strict JSON only.',
      },
      {
        role: 'user',
        content: [
          `Sources: ${sources.join(', ') || 'none'}`,
          `Sinks: ${sinks.join(', ') || 'none'}`,
          'Return JSON with taintPaths and highRiskFlows.',
          'Code:',
          code,
        ].join('\n\n'),
      },
    ];
  }
}
