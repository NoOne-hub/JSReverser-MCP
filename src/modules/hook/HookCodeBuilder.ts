/**
 * HookCodeBuilder — 可组合的 Hook 代码构建器
 *
 * 设计理念：
 * - 用声明式链式调用取代硬编码模板字符串
 * - 每个阶段（before/condition/execute/after/store）都可以插入自定义代码
 * - 支持 async 函数感知
 * - 支持灵活的数据捕获和存储策略
 * - 生成的代码是自包含的 IIFE，可直接注入浏览器
 */

// ==================== 构建器配置类型 ====================

export interface HookTarget {
  /** 目标表达式，如 'window.fetch'、'document.cookie'、'navigator.sendBeacon' */
  expression: string;
  /** 用于日志显示的友好名称 */
  label?: string;
}

export interface CaptureOptions {
  args?: boolean;
  returnValue?: boolean;
  stack?: boolean | number; // true = 全栈, number = 限制帧数
  timing?: boolean;
  thisContext?: boolean;
}

export interface ConditionConfig {
  /** JS 表达式字符串，在 hook 内部求值；可访问 args, callCount, timestamp */
  expression?: string;
  maxCalls?: number;
  minInterval?: number;
  /** URL 匹配模式（用于 fetch/xhr 类型），正则字符串 */
  urlPattern?: string;
}

export interface StoreConfig {
  /** 全局存储的键名，默认 '__hookStore' */
  globalKey?: string;
  /** 单个 hook 的最大记录数，默认 500 */
  maxRecords?: number;
  /** 是否输出到 console，默认 true */
  console?: boolean;
  /** console 输出格式: 'full' | 'compact' | 'json' */
  consoleFormat?: 'full' | 'compact' | 'json';
  /** 自定义序列化函数体（可访问 hookData），返回要存储的对象 */
  serializer?: string;
}

export interface LifecycleCode {
  /** 在原始函数调用前执行的代码，可访问 args, hookData, originalFn */
  before?: string;
  /** 在原始函数调用后执行的代码，可访问 args, result, hookData, originalFn */
  after?: string;
  /** 错误处理代码，可访问 error, args, hookData */
  onError?: string;
  /** 无论成功失败都会执行的代码 */
  onFinally?: string;
  /** 完全替换原始函数的代码（使用后 before/after 不生效） */
  replace?: string;
}

export type HookAction = 'log' | 'block' | 'modify' | 'passthrough';

export interface BuilderConfig {
  target: HookTarget;
  capture: CaptureOptions;
  condition: ConditionConfig;
  store: StoreConfig;
  lifecycle: LifecycleCode;
  action: HookAction;
  hookId: string;
  asyncAware: boolean;
  /** 用于描述此 hook 的注释说明 */
  description?: string;
}

// ==================== HookCodeBuilder ====================

export class HookCodeBuilder {
  private config: BuilderConfig;

  constructor(hookId?: string) {
    this.config = {
      target: { expression: '' },
      capture: {},
      condition: {},
      store: {
        globalKey: '__hookStore',
        maxRecords: 500,
        console: true,
        consoleFormat: 'compact',
      },
      lifecycle: {},
      action: 'log',
      hookId: hookId || `hook-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      asyncAware: false,
    };
  }

  // ==================== 链式配置方法 ====================

  /** 设置 hook 目标 */
  intercept(expression: string, label?: string): this {
    this.config.target = { expression, label: label || expression };
    return this;
  }

  /** 设置 hook ID */
  id(hookId: string): this {
    this.config.hookId = hookId;
    return this;
  }

  /** 设置描述 */
  describe(description: string): this {
    this.config.description = description;
    return this;
  }

  /** 设置行为 */
  action(action: HookAction): this {
    this.config.action = action;
    return this;
  }

  /** 捕获参数 */
  captureArgs(): this {
    this.config.capture.args = true;
    return this;
  }

  /** 捕获返回值 */
  captureReturn(): this {
    this.config.capture.returnValue = true;
    return this;
  }

  /** 捕获调用栈 */
  captureStack(maxFrames?: number): this {
    this.config.capture.stack = maxFrames || true;
    return this;
  }

  /** 捕获执行时间 */
  captureTiming(): this {
    this.config.capture.timing = true;
    return this;
  }

  /** 捕获 this 上下文 */
  captureThis(): this {
    this.config.capture.thisContext = true;
    return this;
  }

  /** 全部捕获 */
  captureAll(stackFrames?: number): this {
    this.config.capture = {
      args: true,
      returnValue: true,
      stack: stackFrames || 5,
      timing: true,
      thisContext: true,
    };
    return this;
  }

  /** 设置条件表达式 */
  when(expression: string): this {
    this.config.condition.expression = expression;
    return this;
  }

  /** 设置最大调用次数 */
  maxCalls(n: number): this {
    this.config.condition.maxCalls = n;
    return this;
  }

  /** 设置最小调用间隔 */
  minInterval(ms: number): this {
    this.config.condition.minInterval = ms;
    return this;
  }

  /** 设置 URL 匹配模式 */
  urlPattern(pattern: string): this {
    this.config.condition.urlPattern = pattern;
    return this;
  }

  /** 插入 before 生命周期代码 */
  before(code: string): this {
    this.config.lifecycle.before = code;
    return this;
  }

  /** 插入 after 生命周期代码 */
  after(code: string): this {
    this.config.lifecycle.after = code;
    return this;
  }

  /** 插入 error 处理代码 */
  onError(code: string): this {
    this.config.lifecycle.onError = code;
    return this;
  }

  /** 插入 finally 代码 */
  onFinally(code: string): this {
    this.config.lifecycle.onFinally = code;
    return this;
  }

  /** 完全替换原始函数 */
  replace(code: string): this {
    this.config.lifecycle.replace = code;
    return this;
  }

  /** 设置存储配置 */
  storeTo(globalKey: string, maxRecords?: number): this {
    this.config.store.globalKey = globalKey;
    if (maxRecords !== undefined) this.config.store.maxRecords = maxRecords;
    return this;
  }

  /** 设置 console 输出 */
  console(enabled: boolean, format?: StoreConfig['consoleFormat']): this {
    this.config.store.console = enabled;
    if (format) this.config.store.consoleFormat = format;
    return this;
  }

  /** 自定义序列化 */
  serializer(code: string): this {
    this.config.store.serializer = code;
    return this;
  }

  /** 启用 async 感知（自动 await Promise 返回值） */
  async(enabled = true): this {
    this.config.asyncAware = enabled;
    return this;
  }

  /** 获取当前配置（用于调试或序列化） */
  getConfig(): Readonly<BuilderConfig> {
    return { ...this.config };
  }

  /** 从配置对象构建（用于反序列化） */
  static fromConfig(config: BuilderConfig): HookCodeBuilder {
    const builder = new HookCodeBuilder();
    builder.config = { ...config };
    return builder;
  }

  // ==================== 代码生成 ====================

  /**
   * 构建最终的 hook 代码字符串
   * 生成的是自包含的 IIFE，可直接注入浏览器
   */
  build(): string {
    if (!this.config.target.expression) {
      throw new Error('Hook target is required. Call .intercept() first.');
    }

    const { target, hookId, description, action, capture, condition, store, lifecycle, asyncAware } = this.config;
    const label = target.label || target.expression;

    // 如果是完全替换模式
    if (lifecycle.replace) {
      return this.buildReplaceHook();
    }

    const lines: string[] = [];

    // -- 头部注释 --
    lines.push(`// Hook: ${description || label}`);
    lines.push(`// ID: ${hookId}`);
    lines.push(`// Generated: ${new Date().toISOString()}`);
    lines.push(`(function() {`);
    lines.push(`  'use strict';`);
    lines.push(``);

    // -- 初始化全局存储 --
    lines.push(...this.buildStorageInit());

    // -- 保存原始引用 --
    lines.push(`  const __original = ${target.expression};`);
    lines.push(`  if (typeof __original !== 'function') {`);
    lines.push(`    console.warn('[${hookId}] Target is not a function: ${label}');`);
    lines.push(`    return;`);
    lines.push(`  }`);
    lines.push(``);

    // -- 条件状态变量 --
    lines.push(...this.buildConditionState());

    // -- Hook 函数体 --
    const isAsync = asyncAware;
    const fnKeyword = isAsync ? 'async function' : 'function';

    lines.push(`  ${target.expression} = ${fnKeyword}(...args) {`);

    // 条件检查
    lines.push(...this.buildConditionCheck());

    // 构建 hookData
    lines.push(`    const hookData = {`);
    lines.push(`      hookId: '${hookId}',`);
    lines.push(`      target: '${label}',`);
    lines.push(`      timestamp: Date.now(),`);
    lines.push(`      callCount: __callCount,`);
    if (capture.args) lines.push(`      args: args,`);
    if (capture.thisContext) lines.push(`      thisArg: this,`);
    if (capture.stack) {
      const maxFrames = typeof capture.stack === 'number' ? capture.stack : 10;
      lines.push(`      stack: new Error().stack.split('\\n').slice(2, ${2 + maxFrames}).join('\\n'),`);
    }
    lines.push(`    };`);
    lines.push(``);

    // console 输出（调用前）
    if (store.console) {
      lines.push(...this.buildConsoleLog('called', store.consoleFormat || 'compact'));
    }

    // before 生命周期
    if (lifecycle.before) {
      lines.push(`    // [before]`);
      lines.push(`    ${lifecycle.before}`);
      lines.push(``);
    }

    // action: block
    if (action === 'block') {
      lines.push(`    // [blocked]`);
      lines.push(`    hookData.blocked = true;`);
      lines.push(...this.buildStore());
      lines.push(`    return undefined;`);
    } else {
      // 执行原始函数（try-catch-finally）
      if (capture.timing) {
        lines.push(`    const __startTime = performance.now();`);
      }

      lines.push(`    try {`);
      const callExpr = isAsync
        ? `await __original.apply(this, args)`
        : `__original.apply(this, args)`;
      lines.push(`      const result = ${callExpr};`);

      if (capture.timing) {
        lines.push(`      hookData.duration = +(performance.now() - __startTime).toFixed(2);`);
      }
      if (capture.returnValue) {
        lines.push(`      hookData.returnValue = result;`);
      }

      // after 生命周期
      if (lifecycle.after) {
        lines.push(`      // [after]`);
        lines.push(`      ${lifecycle.after}`);
      }

      // 存储
      lines.push(...this.buildStore().map(l => `  ${l}`));

      lines.push(`      return result;`);
      lines.push(`    } catch (error) {`);
      lines.push(`      hookData.error = error.message || String(error);`);

      if (lifecycle.onError) {
        lines.push(`      // [onError]`);
        lines.push(`      ${lifecycle.onError}`);
      }

      lines.push(...this.buildStore().map(l => `  ${l}`));
      lines.push(`      throw error;`);

      if (lifecycle.onFinally) {
        lines.push(`    } finally {`);
        lines.push(`      // [onFinally]`);
        lines.push(`      ${lifecycle.onFinally}`);
      }

      lines.push(`    }`);
    }

    lines.push(`  };`);
    lines.push(``);

    // 保留原始函数属性
    lines.push(`  try { Object.defineProperty(${target.expression}, 'length', { value: __original.length }); } catch(e) {}`);
    lines.push(`  try { Object.defineProperty(${target.expression}, 'name', { value: __original.name }); } catch(e) {}`);
    lines.push(``);

    lines.push(`  console.log('[${hookId}] ✅ Hooked: ${label}');`);
    lines.push(`})();`);

    return lines.join('\n');
  }

  // ==================== 内部构建方法 ====================

  private buildReplaceHook(): string {
    const { target, hookId, lifecycle, description } = this.config;
    const label = target.label || target.expression;

    return [
      `// Hook (replace): ${description || label}`,
      `// ID: ${hookId}`,
      `(function() {`,
      `  'use strict';`,
      `  const __original = ${target.expression};`,
      `  ${target.expression} = function(...args) {`,
      `    const originalFn = __original.bind(this);`,
      `    ${lifecycle.replace}`,
      `  };`,
      `  console.log('[${hookId}] ✅ Replaced: ${label}');`,
      `})();`,
    ].join('\n');
  }

  private buildStorageInit(): string[] {
    const { store, hookId } = this.config;
    const key = store.globalKey || '__hookStore';
    return [
      `  if (!window.${key}) window.${key} = {};`,
      `  if (!window.${key}['${hookId}']) window.${key}['${hookId}'] = [];`,
      ``,
    ];
  }

  private buildConditionState(): string[] {
    const lines: string[] = [];
    lines.push(`  let __callCount = 0;`);

    if (this.config.condition.minInterval) {
      lines.push(`  let __lastCallTime = 0;`);
    }

    lines.push(``);
    return lines;
  }

  private buildConditionCheck(): string[] {
    const { condition, hookId } = this.config;
    const lines: string[] = [];

    lines.push(`    __callCount++;`);

    if (condition.maxCalls) {
      lines.push(`    if (__callCount > ${condition.maxCalls}) {`);
      lines.push(`      return __original.apply(this, args);`);
      lines.push(`    }`);
    }

    if (condition.minInterval) {
      lines.push(`    const __now = Date.now();`);
      lines.push(`    if (__now - __lastCallTime < ${condition.minInterval}) {`);
      lines.push(`      return __original.apply(this, args);`);
      lines.push(`    }`);
      lines.push(`    __lastCallTime = __now;`);
    }

    if (condition.expression) {
      lines.push(`    try {`);
      lines.push(`      const __conditionPassed = (function() { return ${condition.expression}; })();`);
      lines.push(`      if (!__conditionPassed) return __original.apply(this, args);`);
      lines.push(`    } catch (__condErr) {`);
      lines.push(`      console.warn('[${hookId}] Condition error:', __condErr.message);`);
      lines.push(`    }`);
    }

    lines.push(``);
    return lines;
  }

  private buildConsoleLog(phase: string, format: string): string[] {
    const { hookId } = this.config;
    const label = this.config.target.label || this.config.target.expression;

    if (format === 'json') {
      return [`    console.log(JSON.stringify(hookData));`];
    }
    if (format === 'compact') {
      return [`    console.log('[${hookId}] ${label} ${phase}', hookData);`];
    }
    // full
    return [
      `    console.group('[${hookId}] ${label} ${phase}');`,
      `    console.log('Data:', hookData);`,
      `    console.groupEnd();`,
    ];
  }

  private buildStore(): string[] {
    const { store, hookId } = this.config;
    const key = store.globalKey || '__hookStore';
    const max = store.maxRecords || 500;
    const lines: string[] = [];

    if (store.serializer) {
      lines.push(`    const __storeData = (function() { ${store.serializer} })(hookData);`);
    } else {
      lines.push(`    const __storeData = hookData;`);
    }

    lines.push(`    const __records = window.${key}['${hookId}'];`);
    lines.push(`    if (__records.length >= ${max}) __records.shift();`);
    lines.push(`    __records.push(__storeData);`);

    return lines;
  }
}
