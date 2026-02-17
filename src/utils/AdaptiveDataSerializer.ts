/**
 * AdaptiveDataSerializer - 自适应数据序列化器
 * 
 * 核心功能：
 * 1. 自动检测数据类型（大数组、深层对象、代码字符串、网络请求等）
 * 2. 根据类型选择最优序列化策略
 * 3. 智能截断和采样
 * 4. 保留关键信息，减少 Token 浪费
 * 
 * 设计原则：
 * - 类型检测优先 - 先识别类型再处理
 * - 保留结构 - 保留数据的关键结构信息
 * - 渐进式加载 - 支持按需获取完整数据
 */

import { DetailedDataManager } from './detailedDataManager.js';
import { safeStringify } from './safeJson.js';

/**
 * 序列化上下文
 */
export interface SerializationContext {
  maxDepth?: number; // 最大深度（默认3）
  maxArrayLength?: number; // 最大数组长度（默认10）
  maxStringLength?: number; // 最大字符串长度（默认1000）
  maxObjectKeys?: number; // 最大对象键数量（默认20）
  threshold?: number; // 大数据阈值（默认50KB）
}

/**
 * 数据类型
 */
type DataType =
  | 'large-array'
  | 'deep-object'
  | 'code-string'
  | 'network-requests'
  | 'dom-structure'
  | 'function-tree'
  | 'primitive'
  | 'unknown';

/**
 * 自适应数据序列化器
 */
export class AdaptiveDataSerializer {
  private readonly DEFAULT_CONTEXT: Required<SerializationContext> = {
    maxDepth: 3,
    maxArrayLength: 10,
    maxStringLength: 1000,
    maxObjectKeys: 20,
    threshold: 50 * 1024,
  };

  /**
   * 序列化数据
   */
  serialize(data: any, context: SerializationContext = {}): string {
    const ctx = { ...this.DEFAULT_CONTEXT, ...context };

    // 检测数据类型
    const type = this.detectType(data);

    // 根据类型选择序列化策略
    switch (type) {
      case 'large-array':
        return this.serializeLargeArray(data, ctx);
      case 'deep-object':
        return this.serializeDeepObject(data, ctx);
      case 'code-string':
        return this.serializeCodeString(data, ctx);
      case 'network-requests':
        return this.serializeNetworkRequests(data, ctx);
      case 'dom-structure':
        return this.serializeDOMStructure(data, ctx);
      case 'function-tree':
        return this.serializeFunctionTree(data, ctx);
      case 'primitive':
        return safeStringify(data);
      default:
        return this.serializeDefault(data, ctx);
    }
  }

  /**
   * 检测数据类型
   */
  private detectType(data: any): DataType {
    if (data === null || data === undefined) {
      return 'primitive';
    }

    const type = typeof data;

    // 基本类型
    if (type === 'string' || type === 'number' || type === 'boolean') {
      // 检查是否是代码字符串
      if (type === 'string' && this.isCodeString(data)) {
        return 'code-string';
      }
      return 'primitive';
    }

    // 数组
    if (Array.isArray(data)) {
      // 检查是否是网络请求数组
      if (data.length > 0 && this.isNetworkRequest(data[0])) {
        return 'network-requests';
      }
      // 检查是否是大数组
      if (data.length > 100) {
        return 'large-array';
      }
    }

    // 对象
    if (type === 'object') {
      // 检查是否是 DOM 结构
      if (this.isDOMStructure(data)) {
        return 'dom-structure';
      }
      // 检查是否是函数树
      if (this.isFunctionTree(data)) {
        return 'function-tree';
      }
      // 检查是否是深层对象
      if (this.getDepth(data) > 3) {
        return 'deep-object';
      }
    }

    return 'unknown';
  }

  /**
   * 序列化大数组
   */
  private serializeLargeArray(arr: any[], ctx: Required<SerializationContext>): string {
    if (arr.length <= ctx.maxArrayLength) {
      return safeStringify(arr);
    }

    // 采样：前5个 + 后5个
    const sample = [
      ...arr.slice(0, 5),
      ...arr.slice(-5),
    ];

    const detailId = DetailedDataManager.getInstance().store(arr);

    return safeStringify({
      type: 'large-array',
      length: arr.length,
      sample,
      detailId,
      hint: `Use get_detailed_data("${detailId}") to get full array`,
    });
  }

  /**
   * 序列化深层对象
   */
  private serializeDeepObject(obj: any, ctx: Required<SerializationContext>): string {
    const limited = this.limitDepth(obj, ctx.maxDepth);
    return safeStringify(limited);
  }

  /**
   * 序列化代码字符串
   */
  private serializeCodeString(code: string, _ctx: Required<SerializationContext>): string {
    const lines = code.split('\n');

    if (lines.length <= 100) {
      return safeStringify(code);
    }

    // 只返回前50行
    const preview = lines.slice(0, 50).join('\n');
    const detailId = DetailedDataManager.getInstance().store(code);

    return safeStringify({
      type: 'code-string',
      totalLines: lines.length,
      preview,
      detailId,
      hint: `Use get_detailed_data("${detailId}") to get full code`,
    });
  }

  /**
   * 序列化网络请求
   */
  private serializeNetworkRequests(requests: any[], ctx: Required<SerializationContext>): string {
    if (requests.length <= ctx.maxArrayLength) {
      return safeStringify(requests);
    }

    // 只返回关键信息
    const summary = requests.map(req => ({
      requestId: req.requestId,
      url: req.url,
      method: req.method,
      type: req.type,
      timestamp: req.timestamp,
    }));

    const detailId = DetailedDataManager.getInstance().store(requests);

    return safeStringify({
      type: 'network-requests',
      count: requests.length,
      summary: summary.slice(0, ctx.maxArrayLength),
      detailId,
      hint: `Use get_detailed_data("${detailId}") to get full requests`,
    });
  }

  /**
   * 序列化 DOM 结构
   */
  private serializeDOMStructure(dom: any, ctx: Required<SerializationContext>): string {
    // 限制深度
    const limited = this.limitDepth(dom, ctx.maxDepth);
    return safeStringify(limited);
  }

  /**
   * 序列化函数树
   */
  private serializeFunctionTree(tree: any, ctx: Required<SerializationContext>): string {
    // 只保留函数名和调用关系
    const simplified = this.simplifyFunctionTree(tree, ctx.maxDepth);
    return safeStringify(simplified);
  }

  /**
   * 默认序列化
   */
  private serializeDefault(data: any, ctx: Required<SerializationContext>): string {
    const jsonStr = safeStringify(data);

    if (jsonStr.length <= ctx.threshold) {
      return jsonStr;
    }

    // 大数据返回摘要
    const detailId = DetailedDataManager.getInstance().store(data);

    return safeStringify({
      type: 'large-data',
      size: jsonStr.length,
      sizeKB: (jsonStr.length / 1024).toFixed(1),
      preview: jsonStr.substring(0, 500),
      detailId,
      hint: `Use get_detailed_data("${detailId}") to get full data`,
    });
  }

  // ==================== 辅助方法 ====================

  /**
   * 检查是否是代码字符串
   */
  private isCodeString(str: string): boolean {
    if (str.length < 100) return false;

    // 检查是否包含代码特征
    const codePatterns = [
      /function\s+\w+\s*\(/,
      /const\s+\w+\s*=/,
      /let\s+\w+\s*=/,
      /var\s+\w+\s*=/,
      /class\s+\w+/,
      /import\s+.*from/,
      /export\s+(default|const|function)/,
    ];

    return codePatterns.some(pattern => pattern.test(str));
  }

  /**
   * 检查是否是网络请求
   */
  private isNetworkRequest(obj: any): boolean {
    return obj && typeof obj === 'object' &&
      ('requestId' in obj || 'url' in obj) &&
      ('method' in obj || 'type' in obj);
  }

  /**
   * 检查是否是 DOM 结构
   */
  private isDOMStructure(obj: any): boolean {
    return obj && typeof obj === 'object' &&
      ('tag' in obj || 'tagName' in obj) &&
      ('children' in obj || 'childNodes' in obj);
  }

  /**
   * 检查是否是函数树
   */
  private isFunctionTree(obj: any): boolean {
    return obj && typeof obj === 'object' &&
      ('functionName' in obj || 'name' in obj) &&
      ('dependencies' in obj || 'calls' in obj || 'callGraph' in obj);
  }

  /**
   * 获取对象深度
   */
  private getDepth(obj: any, currentDepth = 0): number {
    if (obj === null || typeof obj !== 'object') {
      return currentDepth;
    }

    if (currentDepth > 10) return currentDepth; // 防止无限递归

    let maxDepth = currentDepth;

    for (const key in obj) {
      if (obj.hasOwnProperty(key)) {
        const depth = this.getDepth(obj[key], currentDepth + 1);
        maxDepth = Math.max(maxDepth, depth);
      }
    }

    return maxDepth;
  }

  /**
   * 限制对象深度
   */
  private limitDepth(obj: any, maxDepth: number, currentDepth = 0): any {
    if (currentDepth >= maxDepth) {
      return '[Max depth reached]';
    }

    if (obj === null || typeof obj !== 'object') {
      return obj;
    }

    if (Array.isArray(obj)) {
      return obj.map(item => this.limitDepth(item, maxDepth, currentDepth + 1));
    }

    const result: any = {};
    for (const key in obj) {
      if (obj.hasOwnProperty(key)) {
        result[key] = this.limitDepth(obj[key], maxDepth, currentDepth + 1);
      }
    }

    return result;
  }

  /**
   * 简化函数树
   */
  private simplifyFunctionTree(tree: any, maxDepth: number, currentDepth = 0): any {
    if (currentDepth >= maxDepth) {
      return { name: tree.functionName || tree.name, truncated: true };
    }

    return {
      name: tree.functionName || tree.name,
      dependencies: (tree.dependencies || []).map((dep: any) =>
        this.simplifyFunctionTree(dep, maxDepth, currentDepth + 1)
      ),
    };
  }
}

