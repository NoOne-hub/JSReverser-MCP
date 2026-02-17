/**
 * AIHookGenerator — AI 驱动的 Hook 代码生成器
 *
 * 设计理念：
 * - 完全基于 HookManager 的能力，不重复实现 hook 逻辑
 * - 接收自然语言描述或结构化请求，转化为 HookCreateOptions
 * - 支持所有 HookManager 已注册的类型
 * - 生成的代码可直接注入浏览器执行
 */

import { HookManager, type HookCreateOptions } from './HookManager.js';

// ==================== AI Hook 请求类型 ====================

export interface AIHookRequest {
  /** 自然语言描述（如 "Hook 所有 fetch 请求，捕获请求和响应"） */
  description: string;
  /** Hook 目标配置 */
  target: AIHookTarget;
  /** Hook 行为配置 */
  behavior: AIHookBehavior;
  /** 条件过滤 */
  condition?: AIHookCondition;
  /** 自定义代码片段 */
  customCode?: AIHookCustomCode;
}

export interface AIHookTarget {
  /** hook 类型（对应注册表中的类型名） */
  type: string;
  /** 目标函数或对象名（如 "btoa", "fetch"） */
  name?: string;
  /** 对象路径（如 "window.crypto.subtle"），用于 object-method 类型 */
  object?: string;
  /** 属性名或方法名 */
  property?: string;
  /** 正则匹配模式（用于匹配多个函数） */
  pattern?: string;
}

export interface AIHookBehavior {
  captureArgs?: boolean;
  captureReturn?: boolean;
  captureStack?: boolean | number;
  captureTiming?: boolean;
  logToConsole?: boolean;
  consoleFormat?: 'full' | 'compact' | 'json';
  blockExecution?: boolean;
  modifyArgs?: boolean;
  modifyReturn?: boolean;
}

export interface AIHookCondition {
  /** 通用 JS 条件表达式 */
  expression?: string;
  urlPattern?: string;
  argFilter?: string;
  returnFilter?: string;
  maxCalls?: number;
  minInterval?: number;
}

export interface AIHookCustomCode {
  before?: string;
  after?: string;
  replace?: string;
  onError?: string;
}

export interface AIHookResult {
  hookId: string;
  code: string;
  description: string;
  type: string;
  metadata: {
    target: AIHookTarget;
    behavior: AIHookBehavior;
    generatedAt: number;
  };
}

// ==================== AIHookGenerator ====================

export class AIHookGenerator {
  private manager: HookManager;

  constructor(manager?: HookManager) {
    this.manager = manager || new HookManager();
  }

  /** 获取内部的 HookManager 实例 */
  getManager(): HookManager {
    return this.manager;
  }

  /**
   * 生成 hook 代码
   * 核心方法：将 AIHookRequest 转化为 HookCreateOptions，委托给 HookManager
   */
  generate(request: AIHookRequest): AIHookResult {
    // 1. 将 AI 请求转化为 HookManager 的配置
    const options = this.translateRequest(request);

    // 2. 委托给 HookManager 创建
    const { hookId, script } = this.manager.create(options);

    // 3. 构建结果
    return {
      hookId,
      code: script,
      description: request.description,
      type: request.target.type,
      metadata: {
        target: request.target,
        behavior: request.behavior,
        generatedAt: Date.now(),
      },
    };
  }

  /**
   * 批量生成 hook
   */
  generateBatch(requests: AIHookRequest[]): AIHookResult[] {
    return requests.map(req => this.generate(req));
  }

  /**
   * 快捷方法：生成函数 hook
   */
  hookFunction(
    target: string,
    options?: {
      description?: string;
      captureAll?: boolean;
      action?: 'log' | 'block';
      before?: string;
      after?: string;
    }
  ): AIHookResult {
    return this.generate({
      description: options?.description || `Hook ${target}`,
      target: { type: 'function', name: target },
      behavior: {
        captureArgs: options?.captureAll ?? true,
        captureReturn: options?.captureAll ?? true,
        captureStack: options?.captureAll ? 5 : false,
        captureTiming: options?.captureAll ?? false,
        logToConsole: true,
        blockExecution: options?.action === 'block',
      },
      customCode: {
        before: options?.before,
        after: options?.after,
      },
    });
  }

  /**
   * 快捷方法：Hook fetch 请求
   */
  hookFetch(options?: {
    urlPattern?: string;
    captureBody?: boolean;
    captureResponse?: boolean;
    action?: 'log' | 'block';
    description?: string;
  }): AIHookResult {
    return this.generate({
      description: options?.description || 'Hook fetch API',
      target: { type: 'fetch' },
      behavior: {
        captureArgs: options?.captureBody ?? true,
        captureReturn: options?.captureResponse ?? true,
        captureStack: 3,
        logToConsole: true,
        blockExecution: options?.action === 'block',
      },
      condition: {
        urlPattern: options?.urlPattern,
      },
    });
  }

  /**
   * 快捷方法：Hook XHR 请求
   */
  hookXHR(options?: {
    urlPattern?: string;
    captureBody?: boolean;
    captureResponse?: boolean;
    action?: 'log' | 'block';
    description?: string;
  }): AIHookResult {
    return this.generate({
      description: options?.description || 'Hook XMLHttpRequest',
      target: { type: 'xhr' },
      behavior: {
        captureArgs: options?.captureBody ?? true,
        captureReturn: options?.captureResponse ?? true,
        captureStack: 3,
        logToConsole: true,
        blockExecution: options?.action === 'block',
      },
      condition: {
        urlPattern: options?.urlPattern,
      },
    });
  }

  /**
   * 快捷方法：Hook WebSocket
   */
  hookWebSocket(options?: {
    urlPattern?: string;
    description?: string;
  }): AIHookResult {
    return this.generate({
      description: options?.description || 'Hook WebSocket',
      target: { type: 'websocket' },
      behavior: {
        captureArgs: true,
        captureReturn: true,
        logToConsole: true,
      },
      condition: {
        urlPattern: options?.urlPattern,
      },
    });
  }

  /**
   * 快捷方法：Hook 对象属性
   */
  hookProperty(
    object: string,
    property: string,
    options?: {
      description?: string;
      action?: 'log' | 'block';
      captureStack?: boolean | number;
    }
  ): AIHookResult {
    return this.generate({
      description: options?.description || `Hook ${object}.${property}`,
      target: { type: 'property', object, property },
      behavior: {
        captureStack: options?.captureStack ?? 3,
        logToConsole: true,
        blockExecution: options?.action === 'block',
      },
    });
  }

  /**
   * 快捷方法：Hook 事件监听
   */
  hookEvent(
    eventName?: string,
    options?: {
      description?: string;
      action?: 'log' | 'block';
    }
  ): AIHookResult {
    return this.generate({
      description: options?.description || `Hook addEventListener${eventName ? ` (${eventName})` : ''}`,
      target: { type: 'event', name: eventName },
      behavior: {
        captureStack: 3,
        logToConsole: true,
        blockExecution: options?.action === 'block',
      },
    });
  }

  /**
   * 快捷方法：Hook 对象方法
   */
  hookObjectMethod(
    object: string,
    method: string,
    options?: {
      description?: string;
      captureAll?: boolean;
      action?: 'log' | 'block';
      before?: string;
      after?: string;
    }
  ): AIHookResult {
    return this.generate({
      description: options?.description || `Hook ${object}.${method}`,
      target: { type: 'object-method', object, property: method },
      behavior: {
        captureArgs: options?.captureAll ?? true,
        captureReturn: options?.captureAll ?? true,
        captureStack: options?.captureAll ? 5 : 3,
        captureTiming: options?.captureAll ?? false,
        logToConsole: true,
        blockExecution: options?.action === 'block',
      },
      customCode: {
        before: options?.before,
        after: options?.after,
      },
    });
  }

  /**
   * 快捷方法：Hook eval / Function
   */
  hookEval(options?: {
    action?: 'log' | 'block';
    description?: string;
  }): AIHookResult {
    return this.generate({
      description: options?.description || 'Hook eval & Function',
      target: { type: 'eval' },
      behavior: {
        captureArgs: true,
        captureStack: 5,
        logToConsole: true,
        blockExecution: options?.action === 'block',
      },
    });
  }

  /**
   * 快捷方法：Hook localStorage
   */
  hookLocalStorage(options?: {
    keyPattern?: string;
    action?: 'log' | 'block';
    description?: string;
  }): AIHookResult {
    return this.generate({
      description: options?.description || 'Hook localStorage',
      target: { type: 'localstorage' },
      behavior: {
        captureArgs: true,
        captureReturn: true,
        captureStack: 3,
        logToConsole: true,
        blockExecution: options?.action === 'block',
      },
      condition: {
        urlPattern: options?.keyPattern, // 复用 urlPattern 存放 keyPattern
      },
    });
  }

  /**
   * 快捷方法：Hook cookie
   */
  hookCookie(options?: {
    action?: 'log' | 'block';
    description?: string;
  }): AIHookResult {
    return this.generate({
      description: options?.description || 'Hook document.cookie',
      target: { type: 'cookie' },
      behavior: {
        captureStack: 5,
        logToConsole: true,
        blockExecution: options?.action === 'block',
      },
    });
  }

  /**
   * 快捷方法：Hook 定时器
   */
  hookTimers(options?: {
    timerType?: 'setTimeout' | 'setInterval' | 'both';
    action?: 'log' | 'block';
    description?: string;
  }): AIHookResult {
    return this.generate({
      description: options?.description || 'Hook timers',
      target: { type: 'timer', name: options?.timerType || 'both' },
      behavior: {
        captureStack: 3,
        logToConsole: true,
        blockExecution: options?.action === 'block',
      },
    });
  }

  /**
   * 注入自定义脚本
   */
  injectCustom(script: string, description?: string): AIHookResult {
    return this.generate({
      description: description || 'Custom hook script',
      target: { type: 'custom' },
      behavior: { logToConsole: true },
      customCode: { replace: script },
    });
  }

  /**
   * 获取 hook 数据（代理到 HookManager）
   */
  getHookData(hookId: string): unknown[] {
    return this.manager.getRecords(hookId);
  }

  /**
   * 获取所有 hook 列表
   */
  listHooks(): Array<{
    hookId: string;
    type: string;
    description: string;
    enabled: boolean;
    callCount: number;
  }> {
    return this.manager.getStats().hooks;
  }

  /**
   * 清除 hook 数据
   */
  clearData(hookId?: string): void {
    if (hookId) {
      this.manager.clearRecords(hookId);
    } else {
      for (const hook of this.manager.getAllHooks()) {
        this.manager.clearRecords(hook.hookId);
      }
    }
  }

  /**
   * 启用/禁用 hook
   */
  toggleHook(hookId: string, enabled: boolean): boolean {
    return enabled ? this.manager.enable(hookId) : this.manager.disable(hookId);
  }

  /**
   * 导出数据
   */
  exportData(format: 'json' | 'csv' = 'json'): string {
    return this.manager.exportData(format);
  }

  // ==================== 内部方法 ====================

  /**
   * 将 AIHookRequest 翻译为 HookCreateOptions
   */
  private translateRequest(request: AIHookRequest): HookCreateOptions {
    const { target, behavior, condition, customCode, description } = request;

    // 确定 hook 类型
    const type = target.type;

    // 构建 params（类型特定参数）
    const params: Record<string, unknown> = {};

    // 根据目标类型分配 params
    if (target.name && (type === 'function' || type === 'timer')) {
      if (type === 'function') {
        params.target = target.name;
      } else {
        params.timerType = target.name;
      }
    }

    if (target.object) {
      params.object = target.object;
    }

    if (target.property) {
      params.property = target.property;
      if (type === 'object-method') params.method = target.property;
    }

    if (target.name && type === 'event') {
      params.eventName = target.name;
    }

    // URL pattern
    if (condition?.urlPattern) {
      params.urlPattern = condition.urlPattern;
    }

    // 对于 localstorage 的 keyPattern
    if (type === 'localstorage' && condition?.urlPattern) {
      params.keyPattern = condition.urlPattern;
    }

    // 对于 custom 类型的完全替换
    if (type === 'custom' && customCode?.replace) {
      params.script = customCode.replace;
    }

    // 构建 action
    let action: HookCreateOptions['action'] = 'log';
    if (behavior.blockExecution) {
      action = 'block';
    } else if (behavior.modifyArgs || behavior.modifyReturn) {
      action = 'modify';
    }

    // 构建 capture
    const capture: HookCreateOptions['capture'] = {};
    if (behavior.captureArgs) capture.args = true;
    if (behavior.captureReturn) capture.returnValue = true;
    if (behavior.captureStack) capture.stack = behavior.captureStack;
    if (behavior.captureTiming) capture.timing = true;

    // 构建 condition
    const condOpts: HookCreateOptions['condition'] = {};
    if (condition?.expression || condition?.argFilter) {
      condOpts.expression = condition.expression || condition.argFilter;
    }
    if (condition?.maxCalls) condOpts.maxCalls = condition.maxCalls;
    if (condition?.minInterval) condOpts.minInterval = condition.minInterval;
    if (condition?.urlPattern) condOpts.urlPattern = condition.urlPattern;

    // 构建 lifecycle
    const lifecycle: HookCreateOptions['lifecycle'] = {};
    if (customCode?.before) lifecycle.before = customCode.before;
    if (customCode?.after) lifecycle.after = customCode.after;
    if (customCode?.onError) lifecycle.onError = customCode.onError;
    if (customCode?.replace && type !== 'custom') lifecycle.replace = customCode.replace;

    // 构建 store
    const store: HookCreateOptions['store'] = {
      console: behavior.logToConsole ?? true,
      consoleFormat: behavior.consoleFormat || 'compact',
    };

    return {
      type,
      params,
      description,
      action,
      capture,
      condition: condOpts,
      lifecycle,
      store,
    };
  }
}
