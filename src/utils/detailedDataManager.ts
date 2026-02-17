/**
 * 详细数据管理器 - 解决上下文溢出问题
 * 
 * 核心思想：
 * 1. 大数据不直接返回，而是缓存到服务器
 * 2. 返回摘要 + 访问令牌（detailId）
 * 3. AI 可以用令牌按需获取完整数据
 */

import { logger } from './logger.js';
import { safeStringify } from './safeJson.js';

export interface DataSummary {
  type: string;
  size: number;
  sizeKB: string;
  preview: string;
  structure?: {
    keys?: string[];
    methods?: string[];
    properties?: string[];
    length?: number;
  };
}

export interface DetailedDataResponse {
  summary: DataSummary;
  detailId: string;
  hint: string;
  expiresAt: number;
}

interface CacheEntry {
  data: any;
  expiresAt: number;
  createdAt: number;
  lastAccessedAt: number;
  accessCount: number;
  size: number;
}

export class DetailedDataManager {
  private static instance: DetailedDataManager;
  private cache = new Map<string, CacheEntry>();

  // 🆕 优化：延长 TTL，减少令牌过期问题
  private readonly DEFAULT_TTL = 30 * 60 * 1000; // 30分钟过期（原来10分钟）
  private readonly MAX_TTL = 60 * 60 * 1000; // 最大1小时
  private readonly MAX_CACHE_SIZE = 100; // 最多缓存100个对象

  // 🆕 自动续期配置
  private readonly AUTO_EXTEND_ON_ACCESS = true; // 访问时自动续期
  private readonly EXTEND_DURATION = 15 * 60 * 1000; // 续期15分钟

  private constructor() {
    // 🆕 优化：减少清理频率，从60秒改为5分钟
    const timer = setInterval(() => this.cleanup(), 5 * 60 * 1000);
    timer.unref();
  }

  static getInstance(): DetailedDataManager {
    if (!this.instance) {
      this.instance = new DetailedDataManager();
    }
    return this.instance;
  }

  /**
   * 智能处理数据：自动判断是否需要分层返回
   */
  smartHandle(data: any, threshold = 50 * 1024): any {
    const jsonStr = safeStringify(data);
    const size = jsonStr.length;

    // 小数据直接返回
    if (size <= threshold) {
      return data;
    }

    // 大数据返回摘要 + detailId
    logger.info(`Data too large (${(size / 1024).toFixed(1)}KB), returning summary with detailId`);
    return this.createDetailedResponse(data);
  }

  /**
   * 创建详细数据响应（摘要 + detailId）
   */
  private createDetailedResponse(data: any): DetailedDataResponse {
    const detailId = this.store(data);
    const summary = this.generateSummary(data);

    return {
      summary,
      detailId,
      hint: `⚠️ Data too large. Use get_detailed_data("${detailId}") to retrieve full data, or get_detailed_data("${detailId}", path="key.subkey") for specific part.`,
      expiresAt: Date.now() + this.DEFAULT_TTL,
    };
  }

  /**
   * 🆕 存储大数据，返回访问令牌（优化版 - 支持 LRU）
   */
  store(data: any, customTTL?: number): string {
    // 🆕 智能清理：缓存满时使用 LRU 策略，而不是清空所有
    if (this.cache.size >= this.MAX_CACHE_SIZE) {
      this.evictLRU();
    }

    const detailId = `detail_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    const now = Date.now();
    const ttl = customTTL || this.DEFAULT_TTL;
    const expiresAt = now + ttl;
    const size = safeStringify(data).length;

    const entry: CacheEntry = {
      data,
      expiresAt,
      createdAt: now,
      lastAccessedAt: now,
      accessCount: 0,
      size,
    };

    this.cache.set(detailId, entry);
    logger.debug(`Stored detailed data: ${detailId}, size: ${(size / 1024).toFixed(1)}KB, expires in ${ttl / 1000}s`);

    return detailId;
  }

  /**
   * 🆕 获取完整数据或部分数据（优化版 - 支持自动续期）
   */
  retrieve(detailId: string, path?: string): any {
    const cached = this.cache.get(detailId);

    if (!cached) {
      throw new Error(`DetailId not found or expired: ${detailId}`);
    }

    const now = Date.now();

    // 检查是否过期
    if (now > cached.expiresAt) {
      this.cache.delete(detailId);
      throw new Error(`DetailId expired: ${detailId}`);
    }

    // 🆕 更新访问统计
    cached.lastAccessedAt = now;
    cached.accessCount++;

    // 🆕 自动续期：如果启用且剩余时间少于5分钟，自动延长
    if (this.AUTO_EXTEND_ON_ACCESS) {
      const remainingTime = cached.expiresAt - now;
      if (remainingTime < 5 * 60 * 1000) {
        cached.expiresAt = Math.min(now + this.EXTEND_DURATION, now + this.MAX_TTL);
        logger.debug(`Auto-extended detailId ${detailId}, new expiry: ${new Date(cached.expiresAt).toISOString()}`);
      }
    }

    // 如果指定了路径，返回部分数据
    if (path) {
      return this.getByPath(cached.data, path);
    }

    // 返回完整数据
    return cached.data;
  }

  /**
   * 根据路径获取对象的部分数据
   * 例如：path="window.byted_acrawler.frontierSign"
   */
  private getByPath(obj: any, path: string): any {
    const keys = path.split('.');
    let current = obj;

    for (const key of keys) {
      if (current === null || current === undefined) {
        throw new Error(`Path not found: ${path} (stopped at ${key})`);
      }
      current = current[key];
    }

    return current;
  }

  /**
   * 生成数据摘要
   */
  private generateSummary(data: any): DataSummary {
    const jsonStr = safeStringify(data);
    const size = jsonStr.length;
    const type = Array.isArray(data) ? 'array' : typeof data;

    const summary: DataSummary = {
      type,
      size,
      sizeKB: (size / 1024).toFixed(1) + 'KB',
      preview: jsonStr.substring(0, 200) + (size > 200 ? '...' : ''),
    };

    // 对象结构分析
    if (typeof data === 'object' && data !== null) {
      const keys = Object.keys(data);
      summary.structure = {
        keys: keys.slice(0, 50), // 最多显示50个键
      };

      if (!Array.isArray(data)) {
        // 区分方法和属性
        const methods = keys.filter((k) => typeof data[k] === 'function');
        const properties = keys.filter((k) => typeof data[k] !== 'function');

        summary.structure.methods = methods.slice(0, 30);
        summary.structure.properties = properties.slice(0, 30);
      } else {
        summary.structure.length = data.length;
      }
    }

    return summary;
  }

  /**
   * 🆕 清理过期数据（优化版 - 移除 force 参数）
   */
  private cleanup(): void {
    const now = Date.now();
    let cleaned = 0;

    for (const [id, cached] of this.cache.entries()) {
      if (now > cached.expiresAt) {
        this.cache.delete(id);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      logger.debug(`Cleaned ${cleaned} expired detailed data entries`);
    }
  }

  /**
   * 🆕 LRU 驱逐策略：删除最久未访问的条目
   */
  private evictLRU(): void {
    if (this.cache.size === 0) return;

    // 找到最久未访问的条目
    let oldestId: string | null = null;
    let oldestAccessTime = Infinity;

    for (const [id, entry] of this.cache.entries()) {
      if (entry.lastAccessedAt < oldestAccessTime) {
        oldestAccessTime = entry.lastAccessedAt;
        oldestId = id;
      }
    }

    if (oldestId) {
      const entry = this.cache.get(oldestId)!;
      this.cache.delete(oldestId);
      logger.info(`Evicted LRU entry: ${oldestId}, last accessed: ${new Date(entry.lastAccessedAt).toISOString()}, access count: ${entry.accessCount}`);
    }
  }

  /**
   * 🆕 手动延长 detailId 的过期时间
   */
  extend(detailId: string, additionalTime?: number): void {
    const cached = this.cache.get(detailId);

    if (!cached) {
      throw new Error(`DetailId not found: ${detailId}`);
    }

    const now = Date.now();
    if (now > cached.expiresAt) {
      throw new Error(`DetailId already expired: ${detailId}`);
    }

    const extendBy = additionalTime || this.EXTEND_DURATION;
    const newExpiresAt = Math.min(cached.expiresAt + extendBy, now + this.MAX_TTL);
    cached.expiresAt = newExpiresAt;

    logger.info(`Extended detailId ${detailId} by ${extendBy / 1000}s, new expiry: ${new Date(newExpiresAt).toISOString()}`);
  }

  /**
   * 🆕 获取缓存统计（增强版）
   */
  getStats() {
    let totalSize = 0;
    let totalAccessCount = 0;
    const entries = Array.from(this.cache.values());

    for (const entry of entries) {
      totalSize += entry.size;
      totalAccessCount += entry.accessCount;
    }

    return {
      cacheSize: this.cache.size,
      maxCacheSize: this.MAX_CACHE_SIZE,
      defaultTTLSeconds: this.DEFAULT_TTL / 1000,
      maxTTLSeconds: this.MAX_TTL / 1000,
      totalSizeKB: (totalSize / 1024).toFixed(1),
      avgAccessCount: entries.length > 0 ? (totalAccessCount / entries.length).toFixed(1) : '0',
      autoExtendEnabled: this.AUTO_EXTEND_ON_ACCESS,
      extendDurationSeconds: this.EXTEND_DURATION / 1000,
    };
  }

  /**
   * 🆕 获取详细的缓存条目信息
   */
  getDetailedStats() {
    const now = Date.now();
    const entries = Array.from(this.cache.entries()).map(([id, entry]) => ({
      detailId: id,
      sizeKB: (entry.size / 1024).toFixed(1),
      createdAt: new Date(entry.createdAt).toISOString(),
      lastAccessedAt: new Date(entry.lastAccessedAt).toISOString(),
      expiresAt: new Date(entry.expiresAt).toISOString(),
      remainingSeconds: Math.max(0, Math.floor((entry.expiresAt - now) / 1000)),
      accessCount: entry.accessCount,
      isExpired: now > entry.expiresAt,
    }));

    // 按最后访问时间排序
    entries.sort((a, b) => new Date(b.lastAccessedAt).getTime() - new Date(a.lastAccessedAt).getTime());

    return entries;
  }

  /**
   * 清空所有缓存
   */
  clear(): void {
    this.cache.clear();
    logger.info('Cleared all detailed data cache');
  }
}
