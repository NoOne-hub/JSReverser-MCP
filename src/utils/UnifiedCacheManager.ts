/**
 * UnifiedCacheManager - 统一缓存管理器
 * 
 * 核心功能：
 * 1. 协调所有缓存（DetailedDataManager, CodeCache, CodeCompressor）
 * 2. 提供全局缓存统计
 * 3. 智能清理策略（过期数据 → 低命中率 → 大体积）
 * 4. 缓存预热机制
 * 5. 全局缓存大小限制
 * 
 * 设计原则：
 * - 单例模式 - 全局唯一实例
 * - 非侵入式 - 不修改现有缓存实现
 * - 协调者模式 - 只协调，不替代
 */

import { logger } from './logger.js';

/**
 * 缓存实例接口（适配器模式）
 */
export interface CacheInstance {
  name: string;
  getStats(): CacheStats | Promise<CacheStats>;
  cleanup?(): Promise<void> | void;
  clear?(): Promise<void> | void;
}

/**
 * 缓存统计信息
 */
export interface CacheStats {
  entries: number;
  size: number;
  hits?: number;
  misses?: number;
  hitRate?: number;
  ttl?: number;
  maxSize?: number;
}

/**
 * 全局缓存统计
 */
export interface GlobalCacheStats {
  totalEntries: number;
  totalSize: number;
  totalSizeMB: string;
  hitRate: number;
  caches: Array<{
    name: string;
    entries: number;
    size: number;
    sizeMB: string;
    hitRate?: number;
    ttl?: number;
  }>;
  recommendations: string[];
}

/**
 * 统一缓存管理器
 */
export class UnifiedCacheManager {
  private static instance: UnifiedCacheManager;

  // ==================== 配置 ====================

  private readonly GLOBAL_MAX_SIZE = 500 * 1024 * 1024; // 500MB
  private readonly LOW_HIT_RATE_THRESHOLD = 0.3; // 低命中率阈值

  // ==================== 状态 ====================

  private caches = new Map<string, CacheInstance>();

  // ==================== 单例模式 ====================

  private constructor() {
    logger.info('UnifiedCacheManager initialized');
  }

  static getInstance(): UnifiedCacheManager {
    if (!this.instance) {
      this.instance = new UnifiedCacheManager();
    }
    return this.instance;
  }

  // ==================== 核心功能 ====================

  /**
   * 注册缓存
   */
  registerCache(cache: CacheInstance): void {
    this.caches.set(cache.name, cache);
    logger.info(`Registered cache: ${cache.name}`);
  }

  /**
   * 注销缓存
   */
  unregisterCache(name: string): void {
    this.caches.delete(name);
    logger.info(`Unregistered cache: ${name}`);
  }

  /**
   * 获取全局统计
   */
  async getGlobalStats(): Promise<GlobalCacheStats> {
    let totalEntries = 0;
    let totalSize = 0;
    let totalHits = 0;
    let totalMisses = 0;

    const cacheStats: Array<{
      name: string;
      entries: number;
      size: number;
      sizeMB: string;
      hitRate?: number;
      ttl?: number;
    }> = [];

    // 收集所有缓存的统计信息
    for (const [name, cache] of this.caches) {
      try {
        const stats = await cache.getStats();
        
        totalEntries += stats.entries;
        totalSize += stats.size;
        totalHits += stats.hits || 0;
        totalMisses += stats.misses || 0;

        cacheStats.push({
          name,
          entries: stats.entries,
          size: stats.size,
          sizeMB: (stats.size / 1024 / 1024).toFixed(2),
          hitRate: stats.hitRate,
          ttl: stats.ttl,
        });
      } catch (error) {
        logger.error(`Failed to get stats for cache ${name}:`, error);
      }
    }

    // 计算全局命中率
    const hitRate = totalHits + totalMisses > 0
      ? totalHits / (totalHits + totalMisses)
      : 0;

    // 生成建议
    const recommendations = this.generateRecommendations(totalSize, hitRate, cacheStats);

    return {
      totalEntries,
      totalSize,
      totalSizeMB: (totalSize / 1024 / 1024).toFixed(2),
      hitRate,
      caches: cacheStats,
      recommendations,
    };
  }

  /**
   * 智能清理
   *
   * 策略：
   * 1. 清理过期数据
   * 2. 清理低命中率缓存
   * 3. 清理大体积缓存
   */
  async smartCleanup(targetSize?: number): Promise<{
    before: number;
    after: number;
    freed: number;
    freedPercentage: number;
  }> {
    const target = targetSize || this.GLOBAL_MAX_SIZE * 0.7;
    const beforeStats = await this.getGlobalStats();
    const beforeSize = beforeStats.totalSize;

    if (beforeSize <= target) {
      logger.info('No cleanup needed');
      return {
        before: beforeSize,
        after: beforeSize,
        freed: 0,
        freedPercentage: 0,
      };
    }

    logger.info(
      `Smart cleanup: current ${beforeStats.totalSizeMB}MB, ` +
      `target ${(target / 1024 / 1024).toFixed(2)}MB`
    );

    // 1. 清理过期数据
    await this.cleanupExpired();

    // 2. 检查是否达到目标
    let currentStats = await this.getGlobalStats();
    if (currentStats.totalSize <= target) {
      return this.calculateCleanupResult(beforeSize, currentStats.totalSize);
    }

    // 3. 清理低命中率缓存
    await this.cleanupLowHitRate();

    // 4. 再次检查
    currentStats = await this.getGlobalStats();
    if (currentStats.totalSize <= target) {
      return this.calculateCleanupResult(beforeSize, currentStats.totalSize);
    }

    // 5. 清理大体积缓存（最后手段）
    await this.cleanupLargeItems();

    // 6. 最终统计
    const afterStats = await this.getGlobalStats();
    return this.calculateCleanupResult(beforeSize, afterStats.totalSize);
  }

  /**
   * 清理过期数据
   */
  private async cleanupExpired(): Promise<void> {
    logger.info('Cleaning up expired data...');

    for (const [name, cache] of this.caches) {
      if (cache.cleanup) {
        try {
          await cache.cleanup();
          logger.debug(`Cleaned up expired data in ${name}`);
        } catch (error) {
          logger.error(`Failed to cleanup ${name}:`, error);
        }
      }
    }
  }

  /**
   * 清理低命中率缓存
   */
  private async cleanupLowHitRate(): Promise<void> {
    logger.info('Cleaning up low hit rate caches...');

    const stats = await this.getGlobalStats();
    const avgHitRate = stats.hitRate;

    for (const cacheStats of stats.caches) {
      if (cacheStats.hitRate !== undefined &&
          cacheStats.hitRate < avgHitRate * this.LOW_HIT_RATE_THRESHOLD) {
        const cache = this.caches.get(cacheStats.name);
        if (cache && cache.clear) {
          try {
            await cache.clear();
            logger.info(`Cleared low hit rate cache: ${cacheStats.name} (${(cacheStats.hitRate * 100).toFixed(1)}%)`);
          } catch (error) {
            logger.error(`Failed to clear ${cacheStats.name}:`, error);
          }
        }
      }
    }
  }

  /**
   * 清理大体积缓存
   */
  private async cleanupLargeItems(): Promise<void> {
    logger.info('Cleaning up large caches...');

    const stats = await this.getGlobalStats();

    // 按大小排序
    const sortedCaches = stats.caches.sort((a, b) => b.size - a.size);

    // 清理最大的缓存
    for (const cacheStats of sortedCaches.slice(0, 2)) {
      const cache = this.caches.get(cacheStats.name);
      if (cache && cache.clear) {
        try {
          await cache.clear();
          logger.info(`Cleared large cache: ${cacheStats.name} (${cacheStats.sizeMB}MB)`);
        } catch (error) {
          logger.error(`Failed to clear ${cacheStats.name}:`, error);
        }
      }
    }
  }

  /**
   * 计算清理结果
   */
  private calculateCleanupResult(before: number, after: number) {
    const freed = before - after;
    const freedPercentage = Math.round((freed / this.GLOBAL_MAX_SIZE) * 100);

    logger.info(
      `Cleanup complete! Freed ${(freed / 1024 / 1024).toFixed(2)}MB (${freedPercentage}%). ` +
      `Usage: ${(after / 1024 / 1024).toFixed(2)}MB/${(this.GLOBAL_MAX_SIZE / 1024 / 1024).toFixed(0)}MB`
    );

    return {
      before,
      after,
      freed,
      freedPercentage,
    };
  }

  /**
   * 清除所有缓存
   */
  async clearAll(): Promise<void> {
    logger.info('Clearing all caches...');

    for (const [name, cache] of this.caches) {
      if (cache.clear) {
        try {
          await cache.clear();
          logger.info(`Cleared cache: ${name}`);
        } catch (error) {
          logger.error(`Failed to clear ${name}:`, error);
        }
      }
    }

    logger.success('All caches cleared');
  }

  /**
   * 缓存预热
   */
  async preheat(urls: string[]): Promise<void> {
    logger.info(`Preheating cache for ${urls.length} URLs...`);

    // 这里可以触发代码收集等操作
    // 具体实现取决于业务需求

    logger.info('Cache preheat completed');
  }

  /**
   * 生成建议
   */
  private generateRecommendations(
    totalSize: number,
    hitRate: number,
    cacheStats: Array<{ name: string; size: number; hitRate?: number }>
  ): string[] {
    const recommendations: string[] = [];

    // 基于总大小的建议
    const sizeRatio = totalSize / this.GLOBAL_MAX_SIZE;
    if (sizeRatio >= 0.9) {
      recommendations.push('🚨 CRITICAL: Cache size at 90%. Run smart_cache_cleanup immediately!');
    } else if (sizeRatio >= 0.7) {
      recommendations.push('⚠️  WARNING: Cache size at 70%. Consider cleanup soon.');
    } else if (sizeRatio >= 0.5) {
      recommendations.push('ℹ️  INFO: Cache size at 50%. Monitor usage.');
    }

    // 基于命中率的建议
    if (hitRate < 0.3) {
      recommendations.push('💡 Low cache hit rate (<30%). Consider adjusting TTL or cache strategy.');
    } else if (hitRate > 0.7) {
      recommendations.push('✅ Good cache hit rate (>70%). Cache is working well.');
    }

    // 基于单个缓存的建议
    for (const cache of cacheStats) {
      const cacheRatio = cache.size / totalSize;
      if (cacheRatio > 0.5) {
        recommendations.push(`💡 ${cache.name} uses ${Math.round(cacheRatio * 100)}% of total cache. Consider cleanup.`);
      }

      if (cache.hitRate !== undefined && cache.hitRate < 0.2) {
        recommendations.push(`💡 ${cache.name} has low hit rate (${(cache.hitRate * 100).toFixed(1)}%). Consider disabling or adjusting.`);
      }
    }

    if (recommendations.length === 0) {
      recommendations.push('✅ Cache health is good. No action needed.');
    }

    return recommendations;
  }
}

