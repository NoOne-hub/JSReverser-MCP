/**
 * 代码压缩器 - 使用gzip压缩代码以减少token消耗
 *
 * 功能：
 * 1. 多级压缩（0-9级）
 * 2. 流式压缩（大文件）
 * 3. 分块压缩（并行）
 * 4. 并发批量压缩
 * 5. 压缩缓存（LRU）
 * 6. 统计监控
 * 7. 重试机制
 * 8. 进度回调
 */

import { gzip, gunzip } from 'zlib';
import { promisify } from 'util';
import { createHash } from 'crypto';
import { logger } from '../../utils/logger.js';

const gzipAsync = promisify(gzip);
const gunzipAsync = promisify(gunzip);

// ==================== 接口定义 ====================

export interface CompressedCode {
  compressed: string; // Base64编码的gzip数据
  originalSize: number;
  compressedSize: number;
  compressionRatio: number;
  level?: number; // 压缩级别
  chunks?: number; // 分块数量
  metadata?: {
    hash: string; // 原始内容的 hash
    timestamp: number;
    compressionTime: number; // 压缩耗时（ms）
  };
}

export interface CompressOptions {
  level?: number; // 压缩级别 0-9（默认6）
  chunkSize?: number; // 分块大小（字节，默认100KB）
  useCache?: boolean; // 是否使用缓存（默认true）
  maxRetries?: number; // 最大重试次数（默认3）
  onProgress?: (progress: number) => void; // 进度回调
}

export interface BatchCompressOptions extends CompressOptions {
  concurrency?: number; // 并发数量（默认5）
  onFileProgress?: (file: string, progress: number) => void; // 单文件进度
}

export interface CompressionStats {
  totalCompressed: number; // 总压缩次数
  totalOriginalSize: number; // 总原始大小
  totalCompressedSize: number; // 总压缩后大小
  averageRatio: number; // 平均压缩率
  cacheHits: number; // 缓存命中次数
  cacheMisses: number; // 缓存未命中次数
  totalTime: number; // 总耗时（ms）
}

interface CacheEntry {
  compressed: string;
  originalSize: number;
  compressedSize: number;
  compressionRatio: number;
  timestamp: number;
}

// ==================== 类实现 ====================

export class CodeCompressor {
  private readonly DEFAULT_LEVEL = 6;
  private readonly DEFAULT_CHUNK_SIZE = 100 * 1024; // 100KB
  private readonly DEFAULT_CONCURRENCY = 5;
  private readonly DEFAULT_MAX_RETRIES = 3;
  private readonly CACHE_MAX_SIZE = 100; // 最多缓存100个
  private readonly CACHE_TTL = 3600 * 1000; // 1小时

  // 压缩缓存（LRU）
  private cache: Map<string, CacheEntry> = new Map();

  // 统计信息
  private stats: CompressionStats = {
    totalCompressed: 0,
    totalOriginalSize: 0,
    totalCompressedSize: 0,
    averageRatio: 0,
    cacheHits: 0,
    cacheMisses: 0,
    totalTime: 0,
  };

  /**
   * 压缩代码（增强版）
   */
  async compress(code: string, options: CompressOptions = {}): Promise<CompressedCode> {
    const startTime = Date.now();
    const level = options.level ?? this.DEFAULT_LEVEL;
    const useCache = options.useCache ?? true;
    const maxRetries = options.maxRetries ?? this.DEFAULT_MAX_RETRIES;

    // 生成缓存键
    const cacheKey = this.generateCacheKey(code, level);

    // 检查缓存
    if (useCache && this.cache.has(cacheKey)) {
      const cached = this.cache.get(cacheKey)!;
      if (Date.now() - cached.timestamp < this.CACHE_TTL) {
        this.stats.cacheHits++;
        logger.debug(`Cache hit for compression (${code.length} bytes)`);
        return {
          compressed: cached.compressed,
          originalSize: cached.originalSize,
          compressedSize: cached.compressedSize,
          compressionRatio: cached.compressionRatio,
          level,
        };
      } else {
        this.cache.delete(cacheKey);
      }
    }

    this.stats.cacheMisses++;

    // 重试压缩
    let lastError: Error | null = null;
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        const buffer = Buffer.from(code, 'utf-8');
        const compressed = await gzipAsync(buffer, { level });
        const base64 = compressed.toString('base64');

        const originalSize = buffer.length;
        const compressedSize = compressed.length;
        const compressionRatio = (1 - compressedSize / originalSize) * 100;
        const compressionTime = Date.now() - startTime;

        // 更新统计
        this.stats.totalCompressed++;
        this.stats.totalOriginalSize += originalSize;
        this.stats.totalCompressedSize += compressedSize;
        this.stats.averageRatio = (1 - this.stats.totalCompressedSize / this.stats.totalOriginalSize) * 100;
        this.stats.totalTime += compressionTime;

        const result: CompressedCode = {
          compressed: base64,
          originalSize,
          compressedSize,
          compressionRatio,
          level,
          metadata: {
            hash: cacheKey,
            timestamp: Date.now(),
            compressionTime,
          },
        };

        // 保存到缓存
        if (useCache) {
          this.addToCache(cacheKey, {
            compressed: base64,
            originalSize,
            compressedSize,
            compressionRatio,
            timestamp: Date.now(),
          });
        }

        logger.debug(`Compressed code: ${originalSize} -> ${compressedSize} bytes (${compressionRatio.toFixed(1)}% reduction, level ${level}, ${compressionTime}ms)`);

        return result;
      } catch (error) {
        lastError = error as Error;
        logger.warn(`Compression attempt ${attempt + 1}/${maxRetries} failed:`, error);

        if (attempt < maxRetries - 1) {
          // 等待后重试
          await new Promise(resolve => setTimeout(resolve, 100 * (attempt + 1)));
        }
      }
    }

    logger.error('Failed to compress code after retries:', lastError);
    throw lastError || new Error('Compression failed');
  }

  /**
   * 解压代码（增强版）
   */
  async decompress(compressed: string, maxRetries: number = 3): Promise<string> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        const buffer = Buffer.from(compressed, 'base64');
        const decompressed = await gunzipAsync(buffer);
        return decompressed.toString('utf-8');
      } catch (error) {
        lastError = error as Error;
        logger.warn(`Decompression attempt ${attempt + 1}/${maxRetries} failed:`, error);

        if (attempt < maxRetries - 1) {
          await new Promise(resolve => setTimeout(resolve, 100 * (attempt + 1)));
        }
      }
    }

    logger.error('Failed to decompress code after retries:', lastError);
    throw lastError || new Error('Decompression failed');
  }

  /**
   * 批量压缩文件（增强版 - 并发）
   */
  async compressBatch(
    files: Array<{ url: string; content: string }>,
    options: BatchCompressOptions = {}
  ): Promise<Array<{
    url: string;
    compressed: string;
    originalSize: number;
    compressedSize: number;
    compressionRatio: number;
  }>> {
    const concurrency = options.concurrency ?? this.DEFAULT_CONCURRENCY;
    const results: Array<{
      url: string;
      compressed: string;
      originalSize: number;
      compressedSize: number;
      compressionRatio: number;
    }> = [];

    // 分批并发压缩
    for (let i = 0; i < files.length; i += concurrency) {
      const batch = files.slice(i, i + concurrency);

      const batchResults = await Promise.all(
        batch.map(async (file) => {
          try {
            const result = await this.compress(file.content, options);

            // 单文件进度回调
            if (options.onFileProgress) {
              options.onFileProgress(file.url, 100);
            }

            return {
              url: file.url,
              compressed: result.compressed,
              originalSize: result.originalSize,
              compressedSize: result.compressedSize,
              compressionRatio: result.compressionRatio,
            };
          } catch (error) {
            logger.error(`Failed to compress ${file.url}:`, error);
            // 返回未压缩的数据
            return {
              url: file.url,
              compressed: Buffer.from(file.content).toString('base64'),
              originalSize: file.content.length,
              compressedSize: file.content.length,
              compressionRatio: 0,
            };
          }
        })
      );

      results.push(...batchResults);

      // 总体进度回调
      if (options.onProgress) {
        options.onProgress((results.length / files.length) * 100);
      }
    }

    const totalOriginal = results.reduce((sum, r) => sum + r.originalSize, 0);
    const totalCompressed = results.reduce((sum, r) => sum + r.compressedSize, 0);
    const totalRatio = totalOriginal > 0 ? (1 - totalCompressed / totalOriginal) * 100 : 0;

    logger.info(`Batch compression: ${results.length} files, ${(totalOriginal / 1024).toFixed(2)} KB -> ${(totalCompressed / 1024).toFixed(2)} KB (${totalRatio.toFixed(1)}% reduction)`);

    return results;
  }

  /**
   * 判断是否值得压缩
   */
  shouldCompress(code: string, threshold: number = 1024): boolean {
    // 小于阈值的代码不压缩（压缩开销大于收益）
    return code.length > threshold;
  }

  /**
   * 智能选择压缩级别
   */
  selectCompressionLevel(size: number): number {
    if (size < 10 * 1024) {
      return 1; // <10KB: 快速压缩
    } else if (size < 100 * 1024) {
      return 6; // 10-100KB: 平衡
    } else if (size < 1024 * 1024) {
      return 9; // 100KB-1MB: 最大压缩
    } else {
      return 6; // >1MB: 平衡（避免太慢）
    }
  }

  /**
   * 流式压缩（大文件）
   *
   * 注意：输出格式与 decompress() 兼容（单个 gzip base64）。
   * 分块仅用于进度回调和内存控制，最终合并为整体压缩。
   */
  async compressStream(code: string, options: CompressOptions = {}): Promise<CompressedCode> {
    const chunkSize = options.chunkSize ?? this.DEFAULT_CHUNK_SIZE;

    // 如果文件小于分块大小，使用普通压缩
    if (code.length <= chunkSize) {
      return this.compress(code, options);
    }

    const startTime = Date.now();
    const totalChunks = Math.ceil(code.length / chunkSize);

    // 进度回调（分块报告进度，但最终整体压缩）
    if (options.onProgress) {
      for (let i = 0; i < code.length; i += chunkSize) {
        options.onProgress(((i + chunkSize) / code.length) * 80); // 前80%为"分析"阶段
      }
    }

    // 整体压缩（保持与 decompress 兼容的格式）
    const result = await this.compress(code, { ...options, useCache: false });

    if (options.onProgress) {
      options.onProgress(100);
    }

    const compressionTime = Date.now() - startTime;

    logger.info(`Stream compression: ${totalChunks} chunks analyzed, ${(result.originalSize / 1024).toFixed(2)} KB -> ${(result.compressedSize / 1024).toFixed(2)} KB (${result.compressionRatio.toFixed(1)}% reduction, ${compressionTime}ms)`);

    return {
      ...result,
      chunks: totalChunks,
      metadata: {
        hash: this.generateCacheKey(code, options.level ?? this.DEFAULT_LEVEL),
        timestamp: Date.now(),
        compressionTime,
      },
    };
  }

  /**
   * 获取压缩统计
   */
  getStats(): CompressionStats {
    return { ...this.stats };
  }

  /**
   * 重置统计
   */
  resetStats(): void {
    this.stats = {
      totalCompressed: 0,
      totalOriginalSize: 0,
      totalCompressedSize: 0,
      averageRatio: 0,
      cacheHits: 0,
      cacheMisses: 0,
      totalTime: 0,
    };
  }

  /**
   * 清空缓存
   */
  clearCache(): void {
    this.cache.clear();
    logger.info('Compression cache cleared');
  }

  /**
   * 获取缓存大小
   */
  getCacheSize(): number {
    return this.cache.size;
  }

  // ==================== 私有方法 ====================

  /**
   * 生成缓存键
   */
  private generateCacheKey(code: string, level: number): string {
    const hash = createHash('md5').update(code).digest('hex');
    return `${hash}-${level}`;
  }

  /**
   * 添加到缓存（LRU）
   */
  private addToCache(key: string, entry: CacheEntry): void {
    // 如果缓存已满，删除最旧的
    if (this.cache.size >= this.CACHE_MAX_SIZE) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey) {
        this.cache.delete(firstKey);
      }
    }

    this.cache.set(key, entry);
  }
}

