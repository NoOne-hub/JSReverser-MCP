/**
 * TokenBudgetManager - 全局 Token 预算管理器
 * 
 * 核心功能：
 * 1. 追踪每次工具调用的 Token 使用
 * 2. 维护会话级别的 Token 累计
 * 3. 提供三级预警机制（80%、90%、95%）
 * 4. 自动触发数据清理
 * 5. 提供智能优化建议
 * 
 * 设计原则：
 * - 单例模式 - 全局唯一实例
 * - 实时监控 - 每次工具调用后更新
 * - 主动预警 - 不等待溢出错误
 * - 自动清理 - 90% 时自动触发
 */

import { logger } from './logger.js';
import { DetailedDataManager } from './detailedDataManager.js';
import { safeStringify } from './safeJson.js';

/**
 * 工具调用记录
 */
export interface ToolCallRecord {
  toolName: string;
  timestamp: number;
  requestSize: number;
  responseSize: number;
  estimatedTokens: number;
  cumulativeTokens: number;
}

/**
 * Token 预算统计
 */
export interface TokenBudgetStats {
  currentUsage: number;
  maxTokens: number;
  usagePercentage: number;
  toolCallCount: number;
  topTools: Array<{ tool: string; tokens: number; percentage: number }>;
  warnings: number[];
  recentCalls: ToolCallRecord[];
  suggestions: string[];
}

/**
 * 全局 Token 预算管理器
 */
export class TokenBudgetManager {
  private static instance: TokenBudgetManager;

  // ==================== 配置 ====================
  
  private readonly MAX_TOKENS = 200000; // Claude 上下文窗口
  private readonly WARNING_THRESHOLDS = [0.8, 0.9, 0.95]; // 预警阈值
  private readonly BYTES_PER_TOKEN = 4; // 1 token ≈ 4 bytes (经验值)
  private readonly AUTO_CLEANUP_THRESHOLD = 0.9; // 自动清理阈值
  private readonly HISTORY_RETENTION = 5 * 60 * 1000; // 保留最近 5 分钟的历史

  // ==================== 状态 ====================
  
  private currentUsage = 0; // 当前 Token 使用量
  private toolCallHistory: ToolCallRecord[] = []; // 工具调用历史
  private warnings = new Set<number>(); // 已触发的预警
  private sessionStartTime = Date.now(); // 会话开始时间

  // ==================== 单例模式 ====================

  private constructor() {
    logger.info('TokenBudgetManager initialized');
  }

  static getInstance(): TokenBudgetManager {
    if (!this.instance) {
      this.instance = new TokenBudgetManager();
    }
    return this.instance;
  }

  // ==================== 核心功能 ====================

  /**
   * 记录工具调用
   * 
   * @param toolName 工具名称
   * @param request 请求参数
   * @param response 响应数据
   */
  recordToolCall(toolName: string, request: any, response: any): void {
    try {
      // 计算大小
      const requestSize = this.calculateSize(request);
      const responseSize = this.calculateSize(response);
      const totalSize = requestSize + responseSize;
      const estimatedTokens = this.estimateTokens(totalSize);

      // 累计使用量
      this.currentUsage += estimatedTokens;

      // 记录历史
      const record: ToolCallRecord = {
        toolName,
        timestamp: Date.now(),
        requestSize,
        responseSize,
        estimatedTokens,
        cumulativeTokens: this.currentUsage,
      };
      this.toolCallHistory.push(record);

      // 日志
      logger.debug(
        `Token usage: ${this.currentUsage}/${this.MAX_TOKENS} (${this.getUsagePercentage()}%) | ` +
        `Tool: ${toolName} | Size: ${(totalSize / 1024).toFixed(1)}KB | Tokens: ${estimatedTokens}`
      );

      // 检查预警
      this.checkWarnings();

      // 自动清理
      if (this.shouldAutoCleanup()) {
        this.autoCleanup();
      }
    } catch (error) {
      logger.error('Failed to record tool call:', error);
    }
  }

  /**
   * 计算数据大小（字节）
   */
  private calculateSize(data: any): number {
    try {
      return safeStringify(data).length;
    } catch (error) {
      logger.warn('Failed to calculate data size:', error);
      return 0;
    }
  }

  /**
   * 估算 Token 数量
   * 
   * 经验公式：1 token ≈ 4 bytes
   * 这是一个保守估计，实际可能更少
   */
  private estimateTokens(bytes: number): number {
    return Math.ceil(bytes / this.BYTES_PER_TOKEN);
  }

  /**
   * 获取使用百分比
   */
  getUsagePercentage(): number {
    return Math.round((this.currentUsage / this.MAX_TOKENS) * 100);
  }

  /**
   * 检查预警
   */
  private checkWarnings(): void {
    const ratio = this.currentUsage / this.MAX_TOKENS;

    for (const threshold of this.WARNING_THRESHOLDS) {
      if (ratio >= threshold && !this.warnings.has(threshold)) {
        this.emitWarning(threshold);
        this.warnings.add(threshold);
      }
    }
  }

  /**
   * 发出预警
   */
  private emitWarning(threshold: number): void {
    const percentage = Math.round(threshold * 100);
    const remaining = this.MAX_TOKENS - this.currentUsage;

    logger.warn(
      `⚠️  Token Budget Warning: ${percentage}% used! ` +
      `(${this.currentUsage}/${this.MAX_TOKENS}, ${remaining} tokens remaining)`
    );

    // 提供建议
    if (threshold >= 0.95) {
      logger.warn('🚨 CRITICAL: Consider clearing caches or starting a new session!');
    } else if (threshold >= 0.9) {
      logger.warn('⚠️  HIGH: Auto-cleanup will trigger soon. Consider using summary modes.');
    } else if (threshold >= 0.8) {
      logger.warn('ℹ️  MODERATE: Monitor usage. Use get_token_budget_stats for details.');
    }
  }

  /**
   * 是否应该自动清理
   */
  private shouldAutoCleanup(): boolean {
    const ratio = this.currentUsage / this.MAX_TOKENS;
    return ratio >= this.AUTO_CLEANUP_THRESHOLD;
  }

  /**
   * 自动清理
   */
  private autoCleanup(): void {
    logger.info('🧹 Auto-cleanup triggered at 90% usage...');

    const beforeUsage = this.currentUsage;

    // 1. 清理 DetailedDataManager
    const detailedDataManager = DetailedDataManager.getInstance();
    detailedDataManager.clear();
    logger.info('✅ Cleared DetailedDataManager cache');

    // 2. 清理旧的工具调用记录（保留最近 5 分钟）
    const cutoff = Date.now() - this.HISTORY_RETENTION;
    const beforeCount = this.toolCallHistory.length;
    this.toolCallHistory = this.toolCallHistory.filter(
      call => call.timestamp > cutoff
    );
    const removedCount = beforeCount - this.toolCallHistory.length;
    logger.info(`✅ Removed ${removedCount} old tool call records`);

    // 3. 重新计算使用量
    this.recalculateUsage();

    const afterUsage = this.currentUsage;
    const freed = beforeUsage - afterUsage;
    const freedPercentage = Math.round((freed / this.MAX_TOKENS) * 100);

    logger.info(
      `✅ Cleanup complete! Freed ${freed} tokens (${freedPercentage}%). ` +
      `Usage: ${afterUsage}/${this.MAX_TOKENS} (${this.getUsagePercentage()}%)`
    );

    // 重置预警（如果使用率降低）
    const newRatio = afterUsage / this.MAX_TOKENS;
    this.warnings = new Set(
      Array.from(this.warnings).filter(threshold => newRatio >= threshold)
    );
  }

  /**
   * 重新计算使用量
   */
  private recalculateUsage(): void {
    this.currentUsage = this.toolCallHistory.reduce(
      (sum, call) => sum + call.estimatedTokens,
      0
    );
  }

  /**
   * 获取统计信息
   */
  getStats(): TokenBudgetStats & { sessionStartTime: number } {
    // 计算每个工具的使用量
    const toolUsage = new Map<string, number>();
    for (const call of this.toolCallHistory) {
      const current = toolUsage.get(call.toolName) || 0;
      toolUsage.set(call.toolName, current + call.estimatedTokens);
    }

    // 排序并取前 10
    const topTools = Array.from(toolUsage.entries())
      .map(([tool, tokens]) => ({
        tool,
        tokens,
        percentage: Math.round((tokens / this.currentUsage) * 100),
      }))
      .sort((a, b) => b.tokens - a.tokens)
      .slice(0, 10);

    // 生成建议
    const suggestions = this.generateSuggestions(topTools);

    // 最近的调用（最多 20 条）
    const recentCalls = this.toolCallHistory.slice(-20);

    return {
      currentUsage: this.currentUsage,
      maxTokens: this.MAX_TOKENS,
      usagePercentage: this.getUsagePercentage(),
      toolCallCount: this.toolCallHistory.length,
      topTools,
      warnings: Array.from(this.warnings).map(t => Math.round(t * 100)),
      recentCalls,
      suggestions,
      sessionStartTime: this.sessionStartTime,
    };
  }

  /**
   * 生成优化建议
   */
  private generateSuggestions(topTools: Array<{ tool: string; tokens: number; percentage: number }>): string[] {
    const suggestions: string[] = [];
    const ratio = this.currentUsage / this.MAX_TOKENS;

    // 基于使用率的建议
    if (ratio >= 0.95) {
      suggestions.push('🚨 CRITICAL: Clear all caches immediately or start a new session');
    } else if (ratio >= 0.9) {
      suggestions.push('⚠️  HIGH: Auto-cleanup triggered. Consider manual cleanup for better control');
    } else if (ratio >= 0.8) {
      suggestions.push('ℹ️  MODERATE: Monitor usage closely. Use summary modes for large data');
    }

    // 基于工具使用的建议
    for (const { tool, percentage } of topTools) {
      if (percentage > 30) {
        if (tool.includes('collect_code')) {
          suggestions.push(`💡 ${tool} uses ${percentage}% tokens. Try smartMode="summary" or "priority"`);
        } else if (tool.includes('get_script_source')) {
          suggestions.push(`💡 ${tool} uses ${percentage}% tokens. Try preview=true first`);
        } else if (tool.includes('network_get_requests')) {
          suggestions.push(`💡 ${tool} uses ${percentage}% tokens. Reduce limit or use filters`);
        } else if (tool.includes('page_evaluate')) {
          suggestions.push(`💡 ${tool} uses ${percentage}% tokens. Query specific properties instead of full objects`);
        }
      }
    }

    // 通用建议
    if (suggestions.length === 0) {
      suggestions.push('✅ Token usage is healthy. Continue monitoring.');
    }

    return suggestions;
  }

  /**
   * 手动清理
   */
  manualCleanup(): void {
    logger.info('🧹 Manual cleanup requested...');
    this.autoCleanup();
  }

  /**
   * 重置会话
   */
  reset(): void {
    logger.info('🔄 Resetting token budget...');
    this.currentUsage = 0;
    this.toolCallHistory = [];
    this.warnings.clear();
    this.sessionStartTime = Date.now();
    logger.info('✅ Token budget reset complete');
  }
}

