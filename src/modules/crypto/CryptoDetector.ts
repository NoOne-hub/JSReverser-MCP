/**
 * 加密检测模块 - 优化版本
 *
 * 功能:
 * - 动态规则引擎 (支持自定义规则)
 * - 关键字匹配检测 (AES, RSA, SHA256等)
 * - 代码模式识别 (S-box, 大数运算, 位运算)
 * - AI深度分析 (LLM辅助识别自定义加密)
 * - 加密库检测 (CryptoJS, JSEncrypt, forge等)
 * - 常量检测 (魔数、初始化向量)
 * - 参数提取 (密钥长度、模式、填充)
 * - 安全性评估 (弱算法检测、不安全配置)
 * - 加密强度分析
 * - 使用场景分析
 * - 性能优化 (单次AST解析、结果缓存)
 */

import type { DetectCryptoOptions, DetectCryptoResult, CryptoAlgorithm, CryptoLibrary } from '../../types/index.js';
import { LLMService } from '../../services/LLMService.js';
import { logger } from '../../utils/logger.js';
import { CryptoRulesManager } from './CryptoRules.js';
import {
  SecurityIssue,
  CryptoStrength,
  detectByAST,
  mergeParameters,
  evaluateSecurity,
  analyzeStrength,
} from './CryptoDetectorEnhanced.js';

export class CryptoDetector {
  private llm: LLMService;
  private rulesManager: CryptoRulesManager;

  constructor(llm: LLMService, customRules?: CryptoRulesManager) {
    this.llm = llm;
    this.rulesManager = customRules || new CryptoRulesManager();
  }

  /**
   * 加载自定义规则
   */
  loadCustomRules(json: string): void {
    this.rulesManager.loadFromJSON(json);
  }

  /**
   * 导出当前规则
   */
  exportRules(): string {
    return this.rulesManager.exportToJSON();
  }

  /**
   * 检测加密算法（优化版本 - 单次AST解析）
   */
  async detect(options: DetectCryptoOptions): Promise<DetectCryptoResult & {
    securityIssues?: SecurityIssue[];
    strength?: CryptoStrength;
  }> {
    logger.info('Starting crypto detection...');
    const startTime = Date.now();

    try {
      const { code } = options;
      const algorithms: CryptoAlgorithm[] = [];
      const libraries: CryptoLibrary[] = [];
      const securityIssues: SecurityIssue[] = [];

      // 1. 关键字匹配（快速检测）
      const keywordResults = this.detectByKeywords(code);
      algorithms.push(...keywordResults);
      logger.debug(`Found ${keywordResults.length} algorithms by keywords`);

      // 2. 检测加密库（快速检测）
      const libraryResults = this.detectLibraries(code);
      libraries.push(...libraryResults);
      logger.debug(`Found ${libraryResults.length} libraries`);

      // 3. 统一AST解析和检测（性能优化）
      const astResults = detectByAST(code, this.rulesManager);
      algorithms.push(...astResults.algorithms);
      if (astResults.parameters) {
        mergeParameters(algorithms, astResults.parameters);
      }
      logger.debug(`Found ${astResults.algorithms.length} algorithms by AST analysis`);

      // 4. AI深度分析（默认关闭，需显式启用，避免不必要的 LLM 调用）
      const useAI = (options as any).useAI === true;
      if (useAI) {
        const aiResults = await this.detectByAI(code);
        algorithms.push(...aiResults);
        logger.debug(`AI detected ${aiResults.length} algorithms`);
      }

      // 5. 合并和去重
      const mergedAlgorithms = this.mergeResults(algorithms);

      // 6. 安全性评估
      const securityResults = evaluateSecurity(mergedAlgorithms, code, this.rulesManager);
      securityIssues.push(...securityResults);
      logger.debug(`Found ${securityIssues.length} security issues`);

      // 7. 加密强度分析
      const strength = analyzeStrength(mergedAlgorithms, securityIssues);

      // 8. 计算总体置信度
      const confidence =
        mergedAlgorithms.length > 0
          ? mergedAlgorithms.reduce((sum, algo) => sum + algo.confidence, 0) / mergedAlgorithms.length
          : 0;

      const duration = Date.now() - startTime;
      logger.success(`Crypto detection completed in ${duration}ms, found ${mergedAlgorithms.length} algorithms`);

      return {
        algorithms: mergedAlgorithms,
        libraries,
        confidence,
        securityIssues,
        strength,
      };
    } catch (error) {
      logger.error('Crypto detection failed', error);
      throw error;
    }
  }

  /**
   * 基于关键字检测（使用动态规则）
   */
  private detectByKeywords(code: string): CryptoAlgorithm[] {
    const algorithms: CryptoAlgorithm[] = [];
    const keywordRules = this.rulesManager.getKeywordRules();

    keywordRules.forEach((rule) => {
      rule.keywords.forEach((keyword) => {
        // 使用词边界匹配，避免误匹配
        const regex = new RegExp(`\\b${this.escapeRegex(keyword)}\\b`, 'gi');
        const matches = code.match(regex);

        if (matches) {
          // 跳过 mode 和 padding，它们不是独立的算法
          if (rule.category === 'mode' || rule.category === 'padding') {
            return;
          }

          algorithms.push({
            name: keyword,
            type: rule.category as CryptoAlgorithm['type'],
            confidence: rule.confidence,
            location: {
              file: 'current',
              line: this.findLineNumber(code, keyword),
            },
            usage: `Found ${matches.length} occurrence(s) of ${keyword}${rule.description ? ` (${rule.description})` : ''}`,
          });
        }
      });
    });

    return algorithms;
  }

  /**
   * 转义正则表达式特殊字符
   */
  private escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  // detectByPatterns 和 detectByConstants 已被统一的 detectByAST 替代
  // 参见 CryptoDetectorEnhanced.ts

  /**
   * 基于AI检测
   */
  private async detectByAI(code: string): Promise<CryptoAlgorithm[]> {
    try {
      const messages = this.llm.generateCryptoDetectionPrompt(code);
      const response = await this.llm.chat(messages, { temperature: 0.2, maxTokens: 2000 });

      // 解析JSON响应
      const jsonMatch = response.content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        return [];
      }

      const result = JSON.parse(jsonMatch[0]) as { algorithms?: unknown[] };
      if (!Array.isArray(result.algorithms)) {
        return [];
      }

      return result.algorithms.map((algo: unknown) => {
        const a = algo as Record<string, unknown>;
        return {
          name: (a.name as string) || 'Unknown',
          type: (a.type as CryptoAlgorithm['type']) || 'other',
          confidence: (a.confidence as number) || 0.5,
          location: {
            file: 'current',
            line: 0,
          },
          parameters: a.parameters as CryptoAlgorithm['parameters'],
          usage: (a.usage as string) || '',
        };
      });
    } catch (error) {
      logger.warn('AI crypto detection failed', error);
      return [];
    }
  }

  /**
   * 检测加密库（使用动态规则）
   */
  private detectLibraries(code: string): CryptoLibrary[] {
    const libraries: CryptoLibrary[] = [];
    const libraryRules = this.rulesManager.getLibraryRules();

    libraryRules.forEach((rule) => {
      const found = rule.patterns.some((pattern) => code.includes(pattern));

      if (found) {
        // 尝试提取版本号
        let version: string | undefined;
        if (rule.versionPattern) {
          const versionMatch = code.match(rule.versionPattern);
          version = versionMatch?.[1];
        }

        libraries.push({
          name: rule.name,
          version,
          confidence: rule.confidence,
          // features 存储在 rule 中，不需要添加到 library 对象
        });
      }
    });

    return libraries;
  }

  // detectByConstants 已被统一的 detectByAST 替代
  // 参见 CryptoDetectorEnhanced.ts

  // extractParameters 和 getCalleeFullName 已被 detectByAST 中的实现替代
  // 参见 CryptoDetectorEnhanced.ts

  /**
   * 合并和去重检测结果
   */
  private mergeResults(algorithms: CryptoAlgorithm[]): CryptoAlgorithm[] {
    const merged = new Map<string, CryptoAlgorithm>();

    algorithms.forEach((algo) => {
      const key = `${algo.name}-${algo.type}`;
      const existing = merged.get(key);

      if (!existing || algo.confidence > existing.confidence) {
        merged.set(key, algo);
      }
    });

    return Array.from(merged.values()).sort((a, b) => b.confidence - a.confidence);
  }

  /**
   * 查找关键字所在行号
   */
  private findLineNumber(code: string, keyword: string): number {
    const lines = code.split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (lines[i]?.includes(keyword)) {
        return i + 1;
      }
    }
    return 0;
  }
}

