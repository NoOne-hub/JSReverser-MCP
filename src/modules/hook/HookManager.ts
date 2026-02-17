/**
 * HookManager — 统一的 Hook 管理器
 *
 * 作为 hook 模块的门面（Facade），对外提供：
 * - 创建/生成 hook 脚本（基于 HookCodeBuilder + HookTypeRegistry）
 * - 管理 hook 元数据（启用/禁用、统计）
 * - 数据回传和导出
 * - 反调试脚本生成
 *
 * 设计原则：
 * - 不硬编码任何 hook 类型逻辑（全部委托给 Registry 中的插件）
 * - 用户可以通过 Builder 直接构建，也可以通过声明式配置构建
 * - 可扩展：运行时注册新的 hook 类型
 */

import { HookCodeBuilder, type BuilderConfig } from './HookCodeBuilder.js';
import { HookTypeRegistry, type HookTypePlugin } from './HookTypeRegistry.js';

// ==================== 公共类型 ====================

export interface HookCreateOptions {
  /** hook 类型名称（对应 registry 中的插件名） */
  type: string;
  /** 类型特定参数（传给插件的 params） */
  params?: Record<string, unknown>;
  /** hook ID（可选，自动生成） */
  hookId?: string;
  /** 描述 */
  description?: string;
  /** 行为: log(默认) / block / modify / passthrough */
  action?: 'log' | 'block' | 'modify' | 'passthrough';
  /** 捕获配置 */
  capture?: {
    args?: boolean;
    returnValue?: boolean;
    stack?: boolean | number;
    timing?: boolean;
    thisContext?: boolean;
  };
  /** 条件 */
  condition?: {
    expression?: string;
    maxCalls?: number;
    minInterval?: number;
    urlPattern?: string;
  };
  /** 生命周期代码 */
  lifecycle?: {
    before?: string;
    after?: string;
    onError?: string;
    onFinally?: string;
    replace?: string;
  };
  /** 存储配置 */
  store?: {
    globalKey?: string;
    maxRecords?: number;
    console?: boolean;
    consoleFormat?: 'full' | 'compact' | 'json';
    serializer?: string;
  };
  /** 是否启用 async 感知 */
  asyncAware?: boolean;
}

export interface HookMeta {
  hookId: string;
  type: string;
  description: string;
  enabled: boolean;
  createdAt: number;
  callCount: number;
  script: string;
  config: HookCreateOptions;
}

export interface HookDataRecord {
  hookId: string;
  timestamp: number;
  [key: string]: unknown;
}

export interface HookManagerStats {
  totalHooks: number;
  enabledHooks: number;
  disabledHooks: number;
  registeredTypes: string[];
  hooks: Array<{
    hookId: string;
    type: string;
    description: string;
    enabled: boolean;
    callCount: number;
  }>;
}

// ==================== HookManager ====================

export class HookManager {
  private registry: HookTypeRegistry;
  private hooks: Map<string, HookMeta> = new Map();
  private hookData: Map<string, HookDataRecord[]> = new Map();
  private maxRecordsPerHook: number;

  constructor(maxRecordsPerHook = 1000) {
    this.registry = new HookTypeRegistry();
    this.maxRecordsPerHook = maxRecordsPerHook;
  }

  // ==================== Registry 代理 ====================

  /** 注册自定义 hook 类型 */
  registerType(plugin: HookTypePlugin): void {
    this.registry.register(plugin);
  }

  /** 获取所有已注册的类型 */
  getRegisteredTypes(): HookTypePlugin[] {
    return this.registry.list();
  }

  /** 检查类型是否已注册 */
  hasType(name: string): boolean {
    return this.registry.has(name);
  }

  // ==================== 创建 Hook ====================

  /**
   * 通过声明式配置创建 hook
   * 这是最常用的方式，传入配置对象即可生成脚本
   */
  create(options: HookCreateOptions): { hookId: string; script: string } {
    const { type, params = {}, hookId: customId } = options;

    // 查找插件
    const plugin = this.registry.get(type);
    if (!plugin) {
      throw new Error(
        `Unknown hook type: "${type}". Available types: ${this.registry.list().map(p => p.name).join(', ')}`
      );
    }

    // 创建 builder 并应用基础配置
    const hookId = customId || `${type}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const builder = new HookCodeBuilder(hookId);

    // 应用通用配置
    this.applyCommonConfig(builder, options);

    // 让插件注入类型特定配置
    plugin.apply(builder, params);

    // 生成代码
    let script: string;
    if (plugin.customBuild) {
      const customScript = plugin.customBuild(builder, params);
      script = customScript || builder.build();
    } else {
      script = builder.build();
    }

    // 保存元数据
    const meta: HookMeta = {
      hookId,
      type,
      description: options.description || `${type} hook`,
      enabled: true,
      createdAt: Date.now(),
      callCount: 0,
      script,
      config: options,
    };
    this.hooks.set(hookId, meta);
    this.hookData.set(hookId, []);

    return { hookId, script };
  }

  /**
   * 通过 Builder 模式创建 hook（高级用法）
   * 给用户最大自由度，直接操作 builder
   */
  createWithBuilder(
    builderFn: (builder: HookCodeBuilder) => HookCodeBuilder,
    meta?: { type?: string; description?: string }
  ): { hookId: string; script: string } {
    const builder = new HookCodeBuilder();
    const configured = builderFn(builder);
    const config = configured.getConfig();
    const script = configured.build();

    const hookMeta: HookMeta = {
      hookId: config.hookId,
      type: meta?.type || 'custom',
      description: meta?.description || config.description || 'Custom hook',
      enabled: true,
      createdAt: Date.now(),
      callCount: 0,
      script,
      config: { type: meta?.type || 'custom' },
    };

    this.hooks.set(config.hookId, hookMeta);
    this.hookData.set(config.hookId, []);

    return { hookId: config.hookId, script };
  }

  /**
   * 从序列化的 BuilderConfig 恢复 hook
   */
  createFromConfig(config: BuilderConfig): { hookId: string; script: string } {
    const builder = HookCodeBuilder.fromConfig(config);
    const script = builder.build();

    const hookMeta: HookMeta = {
      hookId: config.hookId,
      type: 'restored',
      description: config.description || 'Restored hook',
      enabled: true,
      createdAt: Date.now(),
      callCount: 0,
      script,
      config: { type: 'restored' },
    };

    this.hooks.set(config.hookId, hookMeta);
    this.hookData.set(config.hookId, []);

    return { hookId: config.hookId, script };
  }

  // ==================== Hook 管理 ====================

  /** 获取 hook 元数据 */
  getHook(hookId: string): HookMeta | undefined {
    return this.hooks.get(hookId);
  }

  /** 获取所有 hook */
  getAllHooks(): HookMeta[] {
    return Array.from(this.hooks.values());
  }

  /** 启用 hook */
  enable(hookId: string): boolean {
    const meta = this.hooks.get(hookId);
    if (!meta) return false;
    meta.enabled = true;
    return true;
  }

  /** 禁用 hook */
  disable(hookId: string): boolean {
    const meta = this.hooks.get(hookId);
    if (!meta) return false;
    meta.enabled = false;
    return true;
  }

  /** 删除 hook */
  remove(hookId: string): boolean {
    this.hookData.delete(hookId);
    return this.hooks.delete(hookId);
  }

  /** 清除所有 hook */
  clearAll(): void {
    this.hooks.clear();
    this.hookData.clear();
  }

  // ==================== 数据管理 ====================

  /** 记录 hook 数据（从浏览器回传） */
  addRecord(hookId: string, record: HookDataRecord): void {
    const meta = this.hooks.get(hookId);
    if (meta) meta.callCount++;

    let records = this.hookData.get(hookId);
    if (!records) {
      records = [];
      this.hookData.set(hookId, records);
    }

    if (records.length >= this.maxRecordsPerHook) {
      records.shift();
    }
    records.push(record);
  }

  /** 获取 hook 的所有记录 */
  getRecords(hookId: string): HookDataRecord[] {
    return this.hookData.get(hookId) || [];
  }

  /** 清除 hook 的记录 */
  clearRecords(hookId: string): void {
    this.hookData.set(hookId, []);
    const meta = this.hooks.get(hookId);
    if (meta) meta.callCount = 0;
  }

  /** 导出所有 hook 数据 */
  exportData(format: 'json' | 'csv' = 'json'): string {
    const allData: Record<string, unknown> = {};

    for (const [hookId, records] of this.hookData.entries()) {
      const meta = this.hooks.get(hookId);
      allData[hookId] = {
        meta: meta
          ? {
              type: meta.type,
              description: meta.description,
              enabled: meta.enabled,
              callCount: meta.callCount,
              createdAt: meta.createdAt,
            }
          : null,
        records,
      };
    }

    if (format === 'csv') {
      return this.toCsv(allData);
    }

    return JSON.stringify(allData, null, 2);
  }

  /** 获取统计信息 */
  getStats(): HookManagerStats {
    const hooks = this.getAllHooks();
    return {
      totalHooks: hooks.length,
      enabledHooks: hooks.filter(h => h.enabled).length,
      disabledHooks: hooks.filter(h => !h.enabled).length,
      registeredTypes: this.registry.list().map(p => p.name),
      hooks: hooks.map(h => ({
        hookId: h.hookId,
        type: h.type,
        description: h.description,
        enabled: h.enabled,
        callCount: h.callCount,
      })),
    };
  }

  // ==================== 工具脚本 ====================

  /**
   * 生成反调试绕过脚本
   */
  generateAntiDebugBypass(): string {
    return [
      `// Anti-debug bypass`,
      `(function() {`,
      `  'use strict';`,
      ``,
      `  // 1. 禁用 debugger 语句`,
      `  const __origEval = window.eval;`,
      `  // Rewrite Function constructor to strip debugger`,
      `  const __origFunction = window.Function;`,
      `  window.Function = function(...args) {`,
      `    if (args.length > 0) {`,
      `      args[args.length - 1] = String(args[args.length - 1]).replace(/debugger\\s*;?/g, '');`,
      `    }`,
      `    return new __origFunction(...args);`,
      `  };`,
      `  window.Function.prototype = __origFunction.prototype;`,
      ``,
      `  // 2. 覆盖 console 检测`,
      `  const __noop = function() {};`,
      `  ['log', 'warn', 'error', 'info', 'debug', 'table', 'dir', 'trace'].forEach(function(m) {`,
      `    const orig = console[m];`,
      `    Object.defineProperty(console[m], 'toString', { value: function() { return 'function ' + m + '() { [native code] }'; } });`,
      `  });`,
      ``,
      `  // 3. 阻止 setInterval debugger`,
      `  const __origSetInterval = window.setInterval;`,
      `  window.setInterval = function(fn, delay, ...rest) {`,
      `    const fnStr = typeof fn === 'function' ? fn.toString() : String(fn);`,
      `    if (fnStr.includes('debugger')) {`,
      `      return __origSetInterval.call(window, __noop, delay, ...rest);`,
      `    }`,
      `    return __origSetInterval.call(window, fn, delay, ...rest);`,
      `  };`,
      ``,
      `  // 4. 阻止 setTimeout debugger`,
      `  const __origSetTimeout = window.setTimeout;`,
      `  window.setTimeout = function(fn, delay, ...rest) {`,
      `    const fnStr = typeof fn === 'function' ? fn.toString() : String(fn);`,
      `    if (fnStr.includes('debugger')) {`,
      `      return __origSetTimeout.call(window, __noop, delay, ...rest);`,
      `    }`,
      `    return __origSetTimeout.call(window, fn, delay, ...rest);`,
      `  };`,
      ``,
      `  // 5. 覆盖 DevTools 检测方法`,
      `  Object.defineProperty(window, 'outerHeight', { get() { return window.innerHeight; } });`,
      `  Object.defineProperty(window, 'outerWidth', { get() { return window.innerWidth; } });`,
      ``,
      `  console.log('[anti-debug] ✅ Anti-debug bypass injected');`,
      `})();`,
    ].join('\n');
  }

  /**
   * 生成浏览器端数据收集辅助脚本
   * 用于在浏览器中提取 hook 数据
   */
  generateDataCollectorScript(storeKey = '__hookStore'): string {
    return [
      `// Hook data collector`,
      `(function() {`,
      `  window.__getHookData = function(hookId) {`,
      `    const store = window.${storeKey} || {};`,
      `    if (hookId) return store[hookId] || [];`,
      `    return store;`,
      `  };`,
      `  window.__clearHookData = function(hookId) {`,
      `    const store = window.${storeKey};`,
      `    if (!store) return;`,
      `    if (hookId) { store[hookId] = []; } else {`,
      `      Object.keys(store).forEach(function(k) { store[k] = []; });`,
      `    }`,
      `  };`,
      `  window.__getHookStats = function() {`,
      `    const store = window.${storeKey} || {};`,
      `    const stats = {};`,
      `    Object.keys(store).forEach(function(k) {`,
      `      stats[k] = { count: store[k].length, latest: store[k][store[k].length - 1] };`,
      `    });`,
      `    return stats;`,
      `  };`,
      `})();`,
    ].join('\n');
  }

  // ==================== 内部方法 ====================

  private applyCommonConfig(builder: HookCodeBuilder, options: HookCreateOptions): void {
    if (options.description) builder.describe(options.description);
    if (options.action) builder.action(options.action);
    if (options.asyncAware) builder.async(options.asyncAware);

    // 捕获
    const cap = options.capture;
    if (cap) {
      if (cap.args) builder.captureArgs();
      if (cap.returnValue) builder.captureReturn();
      if (cap.stack) builder.captureStack(typeof cap.stack === 'number' ? cap.stack : undefined);
      if (cap.timing) builder.captureTiming();
      if (cap.thisContext) builder.captureThis();
    }

    // 条件
    const cond = options.condition;
    if (cond) {
      if (cond.expression) builder.when(cond.expression);
      if (cond.maxCalls) builder.maxCalls(cond.maxCalls);
      if (cond.minInterval) builder.minInterval(cond.minInterval);
      if (cond.urlPattern) builder.urlPattern(cond.urlPattern);
    }

    // 生命周期
    const lc = options.lifecycle;
    if (lc) {
      if (lc.before) builder.before(lc.before);
      if (lc.after) builder.after(lc.after);
      if (lc.onError) builder.onError(lc.onError);
      if (lc.onFinally) builder.onFinally(lc.onFinally);
      if (lc.replace) builder.replace(lc.replace);
    }

    // 存储
    const st = options.store;
    if (st) {
      if (st.globalKey || st.maxRecords) builder.storeTo(st.globalKey || '__hookStore', st.maxRecords);
      if (st.console !== undefined || st.consoleFormat) builder.console(st.console ?? true, st.consoleFormat);
      if (st.serializer) builder.serializer(st.serializer);
    }
  }

  private toCsv(allData: Record<string, unknown>): string {
    const lines: string[] = ['hookId,type,timestamp,target,data'];

    for (const [hookId, info] of Object.entries(allData)) {
      const records = (info as Record<string, unknown>).records as HookDataRecord[];
      if (!records) continue;
      for (const rec of records) {
        const target = (rec.target as string) || '';
        const dataStr = JSON.stringify(rec).replace(/"/g, '""');
        lines.push(`"${hookId}","${target}",${rec.timestamp},"${target}","${dataStr}"`);
      }
    }

    return lines.join('\n');
  }
}
