/**
 * AI代码摘要生成器 - 使用LLM生成代码摘要
 */

import type { LLMService } from '../../services/LLMService.js';
import { logger } from '../../utils/logger.js';
import type { CodeFile } from '../../types/index.js';

export interface CodeSummary {
  url: string;
  type: string;
  size: number;
  
  // AI生成的摘要
  summary: string;
  purpose: string;
  keyFunctions: string[];
  dependencies: string[];
  
  // 特征检测
  hasEncryption: boolean;
  encryptionMethods?: string[];
  hasAPI: boolean;
  apiEndpoints?: string[];
  hasObfuscation: boolean;
  obfuscationType?: string;
  
  // 安全评估
  securityIssues?: string[];
  suspiciousPatterns?: string[];
  
  // 复杂度评估
  complexity: 'low' | 'medium' | 'high';
  linesOfCode: number;
  
  // 建议
  recommendations?: string[];
}

export class AISummarizer {
  constructor(private llmService: LLMService) {}

  /**
   * 生成单个文件的摘要
   */
  async summarizeFile(file: CodeFile): Promise<CodeSummary> {
    logger.info(`Generating AI summary for: ${file.url}`);

    // 截取代码片段（避免token溢出）
    const maxLength = 10000; // 约2000 tokens
    const codeSnippet = file.content.length > maxLength
      ? file.content.substring(0, maxLength) + '\n\n... (truncated)'
      : file.content;

    const prompt = this.buildSummaryPrompt(file.url, codeSnippet);

    try {
      const response = await this.llmService.chat([
        {
          role: 'system',
          content: 'You are an expert JavaScript reverse engineer. Analyze code and provide concise, accurate summaries.',
        },
        {
          role: 'user',
          content: prompt,
        },
      ]);

      const responseText = typeof response === 'string' ? response : response.content;
      const summary = this.parseSummaryResponse(responseText, file);
      logger.debug(`AI summary generated for: ${file.url}`);

      return summary;
    } catch (error) {
      logger.error(`Failed to generate AI summary for ${file.url}:`, error);

      // 降级到基础分析
      return this.basicAnalysis(file);
    }
  }

  /**
   * 批量生成摘要
   */
  async summarizeBatch(files: CodeFile[], maxConcurrent: number = 3): Promise<CodeSummary[]> {
    logger.info(`Generating AI summaries for ${files.length} files...`);

    const results: CodeSummary[] = [];
    
    // 分批处理，避免并发过多
    for (let i = 0; i < files.length; i += maxConcurrent) {
      const batch = files.slice(i, i + maxConcurrent);
      const batchResults = await Promise.all(
        batch.map(file => this.summarizeFile(file))
      );
      results.push(...batchResults);
      
      logger.debug(`Processed batch ${Math.floor(i / maxConcurrent) + 1}/${Math.ceil(files.length / maxConcurrent)}`);
    }

    return results;
  }

  /**
   * 生成整体项目摘要
   */
  async summarizeProject(files: CodeFile[]): Promise<{
    totalFiles: number;
    totalSize: number;
    mainPurpose: string;
    architecture: string;
    technologies: string[];
    securityConcerns: string[];
    recommendations: string[];
  }> {
    logger.info('Generating project-level AI summary...');

    // 收集所有文件的基础信息
    const fileInfos = files.map(f => ({
      url: f.url,
      size: f.size,
      type: f.type,
      preview: f.content.substring(0, 200),
    }));

    const prompt = `Analyze this JavaScript project based on the following files:

${JSON.stringify(fileInfos, null, 2)}

Provide a high-level summary including:
1. Main purpose of the project
2. Architecture pattern (MVC, SPA, etc.)
3. Key technologies used
4. Security concerns
5. Recommendations for reverse engineering

Format your response as JSON.`;

    try {
      const response = await this.llmService.chat([
        {
          role: 'system',
          content: 'You are an expert software architect and security analyst.',
        },
        {
          role: 'user',
          content: prompt,
        },
      ]);

      const responseText = typeof response === 'string' ? response : response.content;
      const parsed = JSON.parse(responseText);
      
      return {
        totalFiles: files.length,
        totalSize: files.reduce((sum, f) => sum + f.size, 0),
        mainPurpose: parsed.mainPurpose || 'Unknown',
        architecture: parsed.architecture || 'Unknown',
        technologies: parsed.technologies || [],
        securityConcerns: parsed.securityConcerns || [],
        recommendations: parsed.recommendations || [],
      };
    } catch (error) {
      logger.error('Failed to generate project summary:', error);
      
      return {
        totalFiles: files.length,
        totalSize: files.reduce((sum, f) => sum + f.size, 0),
        mainPurpose: 'Analysis failed',
        architecture: 'Unknown',
        technologies: [],
        securityConcerns: [],
        recommendations: [],
      };
    }
  }

  /**
   * 构建摘要提示词
   */
  private buildSummaryPrompt(url: string, code: string): string {
    return `Analyze this JavaScript file and provide a structured summary:

**File**: ${url}

**Code**:
\`\`\`javascript
${code}
\`\`\`

Provide analysis in JSON format with the following structure:
{
  "summary": "Brief description of what this code does",
  "purpose": "Main purpose of this file",
  "keyFunctions": ["function1", "function2"],
  "dependencies": ["dependency1", "dependency2"],
  "hasEncryption": true/false,
  "encryptionMethods": ["AES", "RSA"] (if applicable),
  "hasAPI": true/false,
  "apiEndpoints": ["/api/endpoint1"] (if applicable),
  "hasObfuscation": true/false,
  "obfuscationType": "type" (if applicable),
  "securityIssues": ["issue1", "issue2"],
  "suspiciousPatterns": ["pattern1"],
  "complexity": "low/medium/high",
  "recommendations": ["recommendation1"]
}`;
  }

  /**
   * 解析AI响应
   */
  private parseSummaryResponse(response: string, file: CodeFile): CodeSummary {
    try {
      const parsed = JSON.parse(response);
      
      return {
        url: file.url,
        type: file.type,
        size: file.size,
        summary: parsed.summary || '',
        purpose: parsed.purpose || '',
        keyFunctions: parsed.keyFunctions || [],
        dependencies: parsed.dependencies || [],
        hasEncryption: parsed.hasEncryption || false,
        encryptionMethods: parsed.encryptionMethods,
        hasAPI: parsed.hasAPI || false,
        apiEndpoints: parsed.apiEndpoints,
        hasObfuscation: parsed.hasObfuscation || false,
        obfuscationType: parsed.obfuscationType,
        securityIssues: parsed.securityIssues,
        suspiciousPatterns: parsed.suspiciousPatterns,
        complexity: parsed.complexity || 'medium',
        linesOfCode: file.content.split('\n').length,
        recommendations: parsed.recommendations,
      };
    } catch (error) {
      logger.warn('Failed to parse AI response, using basic analysis');
      return this.basicAnalysis(file);
    }
  }

  /**
   * 基础分析（降级方案）
   */
  private basicAnalysis(file: CodeFile): CodeSummary {
    const content = file.content;
    const lines = content.split('\n');

    // 简单的模式匹配
    const hasEncryption = /encrypt|decrypt|crypto|cipher|aes|rsa/i.test(content);
    const hasAPI = /fetch|xhr|ajax|axios|request/i.test(content);
    const hasObfuscation = /eval\(|\\x[0-9a-f]{2}|\\u[0-9a-f]{4}/i.test(content);

    // 提取函数名
    const functionMatches = content.matchAll(/function\s+([a-zA-Z_$][a-zA-Z0-9_$]*)/g);
    const keyFunctions = Array.from(functionMatches, m => m[1]).filter((name): name is string => !!name).slice(0, 10);

    // 评估复杂度
    const avgLineLength = content.length / lines.length;
    const complexity: 'low' | 'medium' | 'high' = 
      avgLineLength > 100 ? 'high' :
      avgLineLength > 50 ? 'medium' : 'low';

    return {
      url: file.url,
      type: file.type,
      size: file.size,
      summary: 'Basic analysis (AI unavailable)',
      purpose: 'Unknown',
      keyFunctions,
      dependencies: [],
      hasEncryption,
      hasAPI,
      hasObfuscation,
      complexity,
      linesOfCode: lines.length,
    };
  }
}

