/**
 * HookTypeRegistry — 插件化 Hook 类型注册系统
 *
 * 设计理念：
 * - 每种 hook 类型（function, fetch, xhr, property, event…）是一个插件
 * - 插件通过 HookTypePlugin 接口描述如何为该类型配置 builder
 * - 内置所有常用类型，支持运行时注册新类型
 * - HookManager 通过 registry 查找类型，无需 switch-case 硬编码
 */

import { HookCodeBuilder, type BuilderConfig } from './HookCodeBuilder.js';

// ==================== 插件接口 ====================

export interface HookTypePlugin {
  /** 类型唯一标识 */
  name: string;
  /** 类型说明 */
  description: string;
  /**
   * 给 builder 注入该类型特定的配置
   * @param builder - 已初始化的 builder 实例
   * @param params  - 用户传入的类型特定参数
   * @returns 配置好的 builder
   */
  apply(builder: HookCodeBuilder, params: Record<string, unknown>): HookCodeBuilder;
  /**
   * 可选：生成完整的独立脚本（某些类型如 property getter/setter 不适合通用模板）
   * 如果返回 string，则跳过 builder.build()，直接使用此脚本
   */
  customBuild?(builder: HookCodeBuilder, params: Record<string, unknown>): string | null;
}

// ==================== 注册表 ====================

export class HookTypeRegistry {
  private plugins: Map<string, HookTypePlugin> = new Map();

  constructor() {
    this.registerBuiltins();
  }

  /** 注册一个 hook 类型插件 */
  register(plugin: HookTypePlugin): void {
    if (this.plugins.has(plugin.name)) {
      console.warn(`[HookTypeRegistry] Overwriting existing plugin: ${plugin.name}`);
    }
    this.plugins.set(plugin.name, plugin);
  }

  /** 获取插件 */
  get(name: string): HookTypePlugin | undefined {
    return this.plugins.get(name);
  }

  /** 检查类型是否已注册 */
  has(name: string): boolean {
    return this.plugins.has(name);
  }

  /** 获取所有已注册类型 */
  list(): HookTypePlugin[] {
    return Array.from(this.plugins.values());
  }

  /** 注销插件 */
  unregister(name: string): boolean {
    return this.plugins.delete(name);
  }

  // ==================== 内置类型注册 ====================

  private registerBuiltins(): void {
    this.register(createFunctionPlugin());
    this.register(createFetchPlugin());
    this.register(createXHRPlugin());
    this.register(createWebSocketPlugin());
    this.register(createPropertyPlugin());
    this.register(createEventPlugin());
    this.register(createTimerPlugin());
    this.register(createLocalStoragePlugin());
    this.register(createCookiePlugin());
    this.register(createEvalPlugin());
    this.register(createObjectMethodPlugin());
    this.register(createCustomPlugin());
  }
}

// ==================== 内置插件工厂 ====================

/**
 * function 类型 — Hook 全局/任意函数
 * params: { target: string }
 */
function createFunctionPlugin(): HookTypePlugin {
  return {
    name: 'function',
    description: 'Hook any function by its global expression path',
    apply(builder, params) {
      const target = params.target as string;
      if (!target) throw new Error('[function] params.target is required');
      return builder.intercept(target);
    },
  };
}

/**
 * fetch 类型 — Hook window.fetch
 * params: { urlPattern?: string }
 */
function createFetchPlugin(): HookTypePlugin {
  return {
    name: 'fetch',
    description: 'Hook window.fetch API with URL filtering',
    apply(builder, params) {
      builder.intercept('window.fetch', 'fetch');
      builder.async(true);
      builder.captureArgs().captureReturn();

      const urlPattern = params.urlPattern as string | undefined;
      if (urlPattern) {
        builder.when(`(typeof args[0] === 'string' ? args[0] : (args[0] && args[0].url) || '').match(new RegExp(${JSON.stringify(urlPattern)}))`);
      }

      return builder;
    },
    customBuild(builder, params) {
      const config = builder.getConfig();
      const hookId = config.hookId;
      const label = 'fetch';
      const storeKey = config.store.globalKey || '__hookStore';
      const max = config.store.maxRecords || 500;
      const urlPattern = params.urlPattern as string | undefined;

      const lines: string[] = [
        `// Hook: fetch API`,
        `// ID: ${hookId}`,
        `(function() {`,
        `  'use strict';`,
        `  if (!window.${storeKey}) window.${storeKey} = {};`,
        `  if (!window.${storeKey}['${hookId}']) window.${storeKey}['${hookId}'] = [];`,
        `  const __originalFetch = window.fetch;`,
        `  let __callCount = 0;`,
        ``,
        `  window.fetch = async function(...args) {`,
        `    __callCount++;`,
        `    const url = typeof args[0] === 'string' ? args[0] : (args[0] && args[0].url) || '';`,
        `    const method = (args[1] && args[1].method) || (typeof args[0] !== 'string' && args[0] && args[0].method) || 'GET';`,
      ];

      if (urlPattern) {
        lines.push(`    if (!url.match(new RegExp(${JSON.stringify(urlPattern)}))) {`);
        lines.push(`      return __originalFetch.apply(this, args);`);
        lines.push(`    }`);
      }

      lines.push(`    const hookData = {`);
      lines.push(`      hookId: '${hookId}', target: '${label}', timestamp: Date.now(),`);
      lines.push(`      callCount: __callCount, url, method,`);

      if (config.capture.args) {
        lines.push(`      body: args[1] && args[1].body,`);
        lines.push(`      headers: args[1] && args[1].headers,`);
      }
      if (config.capture.stack) {
        const maxFrames = typeof config.capture.stack === 'number' ? config.capture.stack : 10;
        lines.push(`      stack: new Error().stack.split('\\n').slice(2, ${2 + maxFrames}).join('\\n'),`);
      }

      lines.push(`    };`);

      // before lifecycle
      if (config.lifecycle.before) {
        lines.push(`    // [before]`);
        lines.push(`    ${config.lifecycle.before}`);
      }

      // block action
      if (config.action === 'block') {
        lines.push(`    hookData.blocked = true;`);
        lines.push(`    window.${storeKey}['${hookId}'].push(hookData);`);
        lines.push(`    return new Response('', { status: 200 });`);
      } else {
        lines.push(`    try {`);
        if (config.capture.timing) {
          lines.push(`      const __start = performance.now();`);
        }
        lines.push(`      const response = await __originalFetch.apply(this, args);`);
        if (config.capture.timing) {
          lines.push(`      hookData.duration = +(performance.now() - __start).toFixed(2);`);
        }
        lines.push(`      hookData.status = response.status;`);
        lines.push(`      hookData.statusText = response.statusText;`);

        if (config.capture.returnValue) {
          lines.push(`      try {`);
          lines.push(`        const cloned = response.clone();`);
          lines.push(`        hookData.responseBody = await cloned.text();`);
          lines.push(`        try { hookData.responseJson = JSON.parse(hookData.responseBody); } catch(e) {}`);
          lines.push(`      } catch(e) { hookData.responseReadError = e.message; }`);
        }

        // after lifecycle
        if (config.lifecycle.after) {
          lines.push(`      // [after]`);
          lines.push(`      ${config.lifecycle.after}`);
        }

        lines.push(`      const __records = window.${storeKey}['${hookId}'];`);
        lines.push(`      if (__records.length >= ${max}) __records.shift();`);
        lines.push(`      __records.push(hookData);`);

        if (config.store.console) {
          lines.push(`      console.log('[${hookId}] fetch', method, url, hookData);`);
        }

        lines.push(`      return response;`);
        lines.push(`    } catch (error) {`);
        lines.push(`      hookData.error = error.message;`);

        if (config.lifecycle.onError) {
          lines.push(`      // [onError]`);
          lines.push(`      ${config.lifecycle.onError}`);
        }

        lines.push(`      window.${storeKey}['${hookId}'].push(hookData);`);
        lines.push(`      throw error;`);
        lines.push(`    }`);
      }

      lines.push(`  };`);
      lines.push(`  console.log('[${hookId}] ✅ Hooked: fetch');`);
      lines.push(`})();`);

      return lines.join('\n');
    },
  };
}

/**
 * xhr 类型 — Hook XMLHttpRequest
 * params: { urlPattern?: string }
 */
function createXHRPlugin(): HookTypePlugin {
  return {
    name: 'xhr',
    description: 'Hook XMLHttpRequest with URL filtering',
    apply(builder, params) {
      return builder.intercept('XMLHttpRequest.prototype.open', 'XHR.open');
    },
    customBuild(builder, params) {
      const config = builder.getConfig();
      const hookId = config.hookId;
      const storeKey = config.store.globalKey || '__hookStore';
      const max = config.store.maxRecords || 500;
      const urlPattern = params.urlPattern as string | undefined;

      const lines: string[] = [
        `// Hook: XMLHttpRequest`,
        `// ID: ${hookId}`,
        `(function() {`,
        `  'use strict';`,
        `  if (!window.${storeKey}) window.${storeKey} = {};`,
        `  if (!window.${storeKey}['${hookId}']) window.${storeKey}['${hookId}'] = [];`,
        `  const __origOpen = XMLHttpRequest.prototype.open;`,
        `  const __origSend = XMLHttpRequest.prototype.send;`,
        `  let __callCount = 0;`,
        ``,
        `  XMLHttpRequest.prototype.open = function(method, url, ...rest) {`,
        `    this.__hookMeta = { method, url: String(url), timestamp: Date.now() };`,
        `    return __origOpen.call(this, method, url, ...rest);`,
        `  };`,
        ``,
        `  XMLHttpRequest.prototype.send = function(body) {`,
        `    __callCount++;`,
        `    const meta = this.__hookMeta || {};`,
      ];

      if (urlPattern) {
        lines.push(`    if (!meta.url.match(new RegExp(${JSON.stringify(urlPattern)}))) {`);
        lines.push(`      return __origSend.call(this, body);`);
        lines.push(`    }`);
      }

      lines.push(`    const hookData = {`);
      lines.push(`      hookId: '${hookId}', target: 'xhr', timestamp: Date.now(),`);
      lines.push(`      callCount: __callCount, method: meta.method, url: meta.url,`);

      if (config.capture.args) {
        lines.push(`      requestBody: body,`);
      }
      if (config.capture.stack) {
        const maxFrames = typeof config.capture.stack === 'number' ? config.capture.stack : 10;
        lines.push(`      stack: new Error().stack.split('\\n').slice(2, ${2 + maxFrames}).join('\\n'),`);
      }

      lines.push(`    };`);

      // before lifecycle
      if (config.lifecycle.before) {
        lines.push(`    ${config.lifecycle.before}`);
      }

      if (config.action === 'block') {
        lines.push(`    hookData.blocked = true;`);
        lines.push(`    window.${storeKey}['${hookId}'].push(hookData);`);
        lines.push(`    return;`);
      } else {
        lines.push(`    const __xhr = this;`);
        lines.push(`    __xhr.addEventListener('load', function() {`);
        lines.push(`      hookData.status = __xhr.status;`);
        if (config.capture.returnValue) {
          lines.push(`      try { hookData.response = __xhr.responseText; } catch(e) {}`);
        }
        if (config.lifecycle.after) {
          lines.push(`      ${config.lifecycle.after}`);
        }
        lines.push(`      const __records = window.${storeKey}['${hookId}'];`);
        lines.push(`      if (__records.length >= ${max}) __records.shift();`);
        lines.push(`      __records.push(hookData);`);
        if (config.store.console) {
          lines.push(`      console.log('[${hookId}] xhr', meta.method, meta.url, hookData);`);
        }
        lines.push(`    });`);
        lines.push(`    __xhr.addEventListener('error', function(e) {`);
        lines.push(`      hookData.error = 'Network error';`);
        if (config.lifecycle.onError) {
          lines.push(`      ${config.lifecycle.onError}`);
        }
        lines.push(`      window.${storeKey}['${hookId}'].push(hookData);`);
        lines.push(`    });`);
        lines.push(`    return __origSend.call(this, body);`);
      }

      lines.push(`  };`);
      lines.push(`  console.log('[${hookId}] ✅ Hooked: XMLHttpRequest');`);
      lines.push(`})();`);

      return lines.join('\n');
    },
  };
}

/**
 * websocket 类型 — Hook WebSocket
 * params: { urlPattern?: string }
 */
function createWebSocketPlugin(): HookTypePlugin {
  return {
    name: 'websocket',
    description: 'Hook WebSocket connections and messages',
    apply(builder) {
      return builder.intercept('window.WebSocket', 'WebSocket');
    },
    customBuild(builder, params) {
      const config = builder.getConfig();
      const hookId = config.hookId;
      const storeKey = config.store.globalKey || '__hookStore';
      const max = config.store.maxRecords || 500;
      const urlPattern = params.urlPattern as string | undefined;

      const lines: string[] = [
        `// Hook: WebSocket`,
        `// ID: ${hookId}`,
        `(function() {`,
        `  'use strict';`,
        `  if (!window.${storeKey}) window.${storeKey} = {};`,
        `  if (!window.${storeKey}['${hookId}']) window.${storeKey}['${hookId}'] = [];`,
        `  const __OrigWS = window.WebSocket;`,
        `  let __callCount = 0;`,
        ``,
        `  window.WebSocket = function(url, protocols) {`,
        `    __callCount++;`,
        `    const wsUrl = String(url);`,
      ];

      if (urlPattern) {
        lines.push(`    if (!wsUrl.match(new RegExp(${JSON.stringify(urlPattern)}))) {`);
        lines.push(`      return new __OrigWS(url, protocols);`);
        lines.push(`    }`);
      }

      if (config.lifecycle.before) {
        lines.push(`    const args = [url, protocols];`);
        lines.push(`    const hookData = { hookId: '${hookId}', target: 'websocket', url: wsUrl, timestamp: Date.now() };`);
        lines.push(`    ${config.lifecycle.before}`);
      }

      lines.push(`    const ws = new __OrigWS(url, protocols);`);
      lines.push(`    const __store = function(data) {`);
      lines.push(`      const __records = window.${storeKey}['${hookId}'];`);
      lines.push(`      if (__records.length >= ${max}) __records.shift();`);
      lines.push(`      __records.push(data);`);
      if (config.store.console) {
        lines.push(`      console.log('[${hookId}] ws', data);`);
      }
      lines.push(`    };`);

      lines.push(`    __store({ hookId: '${hookId}', target: 'websocket', event: 'connect', url: wsUrl, timestamp: Date.now() });`);

      // Hook send
      lines.push(`    const __origSend = ws.send.bind(ws);`);
      lines.push(`    ws.send = function(data) {`);
      lines.push(`      __store({ hookId: '${hookId}', target: 'websocket', event: 'send', url: wsUrl, data, timestamp: Date.now() });`);
      lines.push(`      return __origSend(data);`);
      lines.push(`    };`);

      // Hook onmessage
      lines.push(`    ws.addEventListener('message', function(e) {`);
      lines.push(`      __store({ hookId: '${hookId}', target: 'websocket', event: 'message', url: wsUrl, data: e.data, timestamp: Date.now() });`);
      lines.push(`    });`);
      lines.push(`    ws.addEventListener('close', function(e) {`);
      lines.push(`      __store({ hookId: '${hookId}', target: 'websocket', event: 'close', url: wsUrl, code: e.code, reason: e.reason, timestamp: Date.now() });`);
      lines.push(`    });`);

      lines.push(`    return ws;`);
      lines.push(`  };`);
      lines.push(`  window.WebSocket.prototype = __OrigWS.prototype;`);
      lines.push(`  window.WebSocket.CONNECTING = __OrigWS.CONNECTING;`);
      lines.push(`  window.WebSocket.OPEN = __OrigWS.OPEN;`);
      lines.push(`  window.WebSocket.CLOSING = __OrigWS.CLOSING;`);
      lines.push(`  window.WebSocket.CLOSED = __OrigWS.CLOSED;`);
      lines.push(`  console.log('[${hookId}] ✅ Hooked: WebSocket');`);
      lines.push(`})();`);

      return lines.join('\n');
    },
  };
}

/**
 * property 类型 — Hook 对象属性的 getter/setter
 * params: { object: string, property: string }
 */
function createPropertyPlugin(): HookTypePlugin {
  return {
    name: 'property',
    description: 'Hook property getter/setter via Object.defineProperty',
    apply(builder, params) {
      const obj = params.object as string;
      const prop = params.property as string;
      if (!obj || !prop) throw new Error('[property] params.object and params.property are required');
      return builder.intercept(`${obj}.${prop}`, `${obj}.${prop}`);
    },
    customBuild(builder, params) {
      const config = builder.getConfig();
      const hookId = config.hookId;
      const storeKey = config.store.globalKey || '__hookStore';
      const max = config.store.maxRecords || 500;
      const obj = params.object as string;
      const prop = params.property as string;

      if (!obj || !prop) throw new Error('[property] params.object and params.property are required');

      const lines: string[] = [
        `// Hook: property ${obj}.${prop}`,
        `// ID: ${hookId}`,
        `(function() {`,
        `  'use strict';`,
        `  if (!window.${storeKey}) window.${storeKey} = {};`,
        `  if (!window.${storeKey}['${hookId}']) window.${storeKey}['${hookId}'] = [];`,
        `  const __target = ${obj};`,
        `  const __desc = Object.getOwnPropertyDescriptor(__target, '${prop}') || {};`,
        `  let __value = __target['${prop}'];`,
        `  let __callCount = 0;`,
        ``,
        `  const __store = function(data) {`,
        `    const __records = window.${storeKey}['${hookId}'];`,
        `    if (__records.length >= ${max}) __records.shift();`,
        `    __records.push(data);`,
      ];

      if (config.store.console) {
        lines.push(`    console.log('[${hookId}] prop', data);`);
      }

      lines.push(`  };`);
      lines.push(``);
      lines.push(`  Object.defineProperty(__target, '${prop}', {`);
      lines.push(`    configurable: true,`);
      lines.push(`    enumerable: __desc.enumerable !== false,`);
      lines.push(`    get() {`);
      lines.push(`      __callCount++;`);
      lines.push(`      const val = __desc.get ? __desc.get.call(this) : __value;`);
      lines.push(`      const hookData = {`);
      lines.push(`        hookId: '${hookId}', target: '${obj}.${prop}', operation: 'get',`);
      lines.push(`        value: val, timestamp: Date.now(), callCount: __callCount,`);

      if (config.capture.stack) {
        const maxFrames = typeof config.capture.stack === 'number' ? config.capture.stack : 10;
        lines.push(`        stack: new Error().stack.split('\\n').slice(2, ${2 + maxFrames}).join('\\n'),`);
      }

      lines.push(`      };`);

      if (config.lifecycle.before) {
        lines.push(`      ${config.lifecycle.before}`);
      }

      lines.push(`      __store(hookData);`);
      lines.push(`      return val;`);
      lines.push(`    },`);
      lines.push(`    set(newVal) {`);
      lines.push(`      __callCount++;`);
      lines.push(`      const hookData = {`);
      lines.push(`        hookId: '${hookId}', target: '${obj}.${prop}', operation: 'set',`);
      lines.push(`        oldValue: __desc.get ? __desc.get.call(this) : __value,`);
      lines.push(`        newValue: newVal, timestamp: Date.now(), callCount: __callCount,`);

      if (config.capture.stack) {
        const maxFrames = typeof config.capture.stack === 'number' ? config.capture.stack : 10;
        lines.push(`        stack: new Error().stack.split('\\n').slice(2, ${2 + maxFrames}).join('\\n'),`);
      }

      lines.push(`      };`);

      if (config.lifecycle.after) {
        lines.push(`      ${config.lifecycle.after}`);
      }

      if (config.action === 'block') {
        lines.push(`      hookData.blocked = true;`);
        lines.push(`      __store(hookData);`);
        lines.push(`      return;`);
      } else {
        lines.push(`      __store(hookData);`);
        lines.push(`      if (__desc.set) { __desc.set.call(this, newVal); } else { __value = newVal; }`);
      }

      lines.push(`    },`);
      lines.push(`  });`);
      lines.push(`  console.log('[${hookId}] ✅ Hooked: ${obj}.${prop} (property)');`);
      lines.push(`})();`);

      return lines.join('\n');
    },
  };
}

/**
 * event 类型 — Hook addEventListener
 * params: { eventName?: string, targetSelector?: string }
 */
function createEventPlugin(): HookTypePlugin {
  return {
    name: 'event',
    description: 'Hook addEventListener to monitor event bindings',
    apply(builder) {
      return builder.intercept('EventTarget.prototype.addEventListener', 'addEventListener');
    },
    customBuild(builder, params) {
      const config = builder.getConfig();
      const hookId = config.hookId;
      const storeKey = config.store.globalKey || '__hookStore';
      const max = config.store.maxRecords || 500;
      const eventName = params.eventName as string | undefined;

      const lines: string[] = [
        `// Hook: addEventListener`,
        `// ID: ${hookId}`,
        `(function() {`,
        `  'use strict';`,
        `  if (!window.${storeKey}) window.${storeKey} = {};`,
        `  if (!window.${storeKey}['${hookId}']) window.${storeKey}['${hookId}'] = [];`,
        `  const __origAdd = EventTarget.prototype.addEventListener;`,
        `  let __callCount = 0;`,
        ``,
        `  EventTarget.prototype.addEventListener = function(type, listener, options) {`,
        `    __callCount++;`,
      ];

      if (eventName) {
        lines.push(`    if (type !== ${JSON.stringify(eventName)}) {`);
        lines.push(`      return __origAdd.call(this, type, listener, options);`);
        lines.push(`    }`);
      }

      lines.push(`    const hookData = {`);
      lines.push(`      hookId: '${hookId}', target: 'addEventListener',`);
      lines.push(`      eventType: type, element: this.tagName || this.constructor.name,`);
      lines.push(`      timestamp: Date.now(), callCount: __callCount,`);

      if (config.capture.stack) {
        const maxFrames = typeof config.capture.stack === 'number' ? config.capture.stack : 10;
        lines.push(`      stack: new Error().stack.split('\\n').slice(2, ${2 + maxFrames}).join('\\n'),`);
      }

      lines.push(`    };`);

      if (config.lifecycle.before) {
        lines.push(`    const args = [type, listener, options];`);
        lines.push(`    ${config.lifecycle.before}`);
      }

      lines.push(`    const __records = window.${storeKey}['${hookId}'];`);
      lines.push(`    if (__records.length >= ${max}) __records.shift();`);
      lines.push(`    __records.push(hookData);`);

      if (config.store.console) {
        lines.push(`    console.log('[${hookId}] event', type, hookData);`);
      }

      if (config.action === 'block') {
        lines.push(`    hookData.blocked = true;`);
        lines.push(`    return;`);
      } else {
        // 包装 listener 以监控事件触发
        lines.push(`    const __wrappedListener = function(e) {`);
        lines.push(`      const fireData = {`);
        lines.push(`        hookId: '${hookId}', target: 'eventFired', eventType: type,`);
        lines.push(`        timestamp: Date.now(),`);
        lines.push(`      };`);
        lines.push(`      if (__records.length >= ${max}) __records.shift();`);
        lines.push(`      __records.push(fireData);`);
        lines.push(`      return listener.call(this, e);`);
        lines.push(`    };`);
        lines.push(`    return __origAdd.call(this, type, __wrappedListener, options);`);
      }

      lines.push(`  };`);
      lines.push(`  console.log('[${hookId}] ✅ Hooked: addEventListener${eventName ? ' (' + eventName + ')' : ''}');`);
      lines.push(`})();`);

      return lines.join('\n');
    },
  };
}

/**
 * timer 类型 — Hook setTimeout/setInterval
 * params: { timerType?: 'setTimeout' | 'setInterval' | 'both' }
 */
function createTimerPlugin(): HookTypePlugin {
  return {
    name: 'timer',
    description: 'Hook setTimeout and/or setInterval',
    apply(builder) {
      return builder.intercept('window.setTimeout', 'timer');
    },
    customBuild(builder, params) {
      const config = builder.getConfig();
      const hookId = config.hookId;
      const storeKey = config.store.globalKey || '__hookStore';
      const max = config.store.maxRecords || 500;
      const timerType = (params.timerType as string) || 'both';

      const lines: string[] = [
        `// Hook: timers (${timerType})`,
        `// ID: ${hookId}`,
        `(function() {`,
        `  'use strict';`,
        `  if (!window.${storeKey}) window.${storeKey} = {};`,
        `  if (!window.${storeKey}['${hookId}']) window.${storeKey}['${hookId}'] = [];`,
        `  let __callCount = 0;`,
        ``,
        `  function __hookTimer(name) {`,
        `    const __orig = window[name];`,
        `    window[name] = function(fn, delay, ...rest) {`,
        `      __callCount++;`,
        `      const hookData = {`,
        `        hookId: '${hookId}', target: name, delay: delay || 0,`,
        `        timestamp: Date.now(), callCount: __callCount,`,
        `        fnPreview: typeof fn === 'function' ? fn.toString().slice(0, 200) : String(fn).slice(0, 200),`,
      ];

      if (config.capture.stack) {
        const maxFrames = typeof config.capture.stack === 'number' ? config.capture.stack : 10;
        lines.push(`        stack: new Error().stack.split('\\n').slice(2, ${2 + maxFrames}).join('\\n'),`);
      }

      lines.push(`      };`);
      lines.push(`      const __records = window.${storeKey}['${hookId}'];`);
      lines.push(`      if (__records.length >= ${max}) __records.shift();`);
      lines.push(`      __records.push(hookData);`);

      if (config.store.console) {
        lines.push(`      console.log('[${hookId}]', name, delay + 'ms', hookData);`);
      }

      if (config.action === 'block') {
        lines.push(`      hookData.blocked = true;`);
        lines.push(`      return -1;`);
      } else {
        lines.push(`      return __orig.call(window, fn, delay, ...rest);`);
      }

      lines.push(`    };`);
      lines.push(`  }`);

      if (timerType === 'setTimeout' || timerType === 'both') {
        lines.push(`  __hookTimer('setTimeout');`);
      }
      if (timerType === 'setInterval' || timerType === 'both') {
        lines.push(`  __hookTimer('setInterval');`);
      }

      lines.push(`  console.log('[${hookId}] ✅ Hooked: timers (${timerType})');`);
      lines.push(`})();`);

      return lines.join('\n');
    },
  };
}

/**
 * localstorage 类型
 */
function createLocalStoragePlugin(): HookTypePlugin {
  return {
    name: 'localstorage',
    description: 'Hook localStorage getItem/setItem/removeItem',
    apply(builder) {
      return builder.intercept('Storage.prototype.setItem', 'localStorage');
    },
    customBuild(builder, params) {
      const config = builder.getConfig();
      const hookId = config.hookId;
      const storeKey = config.store.globalKey || '__hookStore';
      const max = config.store.maxRecords || 500;
      const keyPattern = params.keyPattern as string | undefined;

      const lines: string[] = [
        `// Hook: localStorage`,
        `// ID: ${hookId}`,
        `(function() {`,
        `  'use strict';`,
        `  if (!window.${storeKey}) window.${storeKey} = {};`,
        `  if (!window.${storeKey}['${hookId}']) window.${storeKey}['${hookId}'] = [];`,
        `  let __callCount = 0;`,
        ``,
        `  const __methods = ['getItem', 'setItem', 'removeItem'];`,
        `  const __originals = {};`,
        `  __methods.forEach(function(m) { __originals[m] = Storage.prototype[m]; });`,
        ``,
        `  __methods.forEach(function(method) {`,
        `    Storage.prototype[method] = function(key, ...rest) {`,
        `      if (this !== localStorage) return __originals[method].call(this, key, ...rest);`,
        `      __callCount++;`,
      ];

      if (keyPattern) {
        lines.push(`      if (!String(key).match(new RegExp(${JSON.stringify(keyPattern)}))) {`);
        lines.push(`        return __originals[method].call(this, key, ...rest);`);
        lines.push(`      }`);
      }

      lines.push(`      const hookData = {`);
      lines.push(`        hookId: '${hookId}', target: 'localStorage.' + method,`);
      lines.push(`        key, value: rest[0], timestamp: Date.now(), callCount: __callCount,`);

      if (config.capture.stack) {
        const maxFrames = typeof config.capture.stack === 'number' ? config.capture.stack : 10;
        lines.push(`        stack: new Error().stack.split('\\n').slice(2, ${2 + maxFrames}).join('\\n'),`);
      }

      lines.push(`      };`);

      if (config.lifecycle.before) {
        lines.push(`      const args = [key, ...rest];`);
        lines.push(`      ${config.lifecycle.before}`);
      }

      lines.push(`      const __records = window.${storeKey}['${hookId}'];`);
      lines.push(`      if (__records.length >= ${max}) __records.shift();`);
      lines.push(`      __records.push(hookData);`);

      if (config.store.console) {
        lines.push(`      console.log('[${hookId}] localStorage.' + method, key, hookData);`);
      }

      if (config.action === 'block') {
        lines.push(`      hookData.blocked = true;`);
        lines.push(`      return method === 'getItem' ? null : undefined;`);
      } else {
        lines.push(`      const result = __originals[method].call(this, key, ...rest);`);
        lines.push(`      if (method === 'getItem') hookData.result = result;`);
        lines.push(`      return result;`);
      }

      lines.push(`    };`);
      lines.push(`  });`);
      lines.push(`  console.log('[${hookId}] ✅ Hooked: localStorage');`);
      lines.push(`})();`);

      return lines.join('\n');
    },
  };
}

/**
 * cookie 类型 — Hook document.cookie
 */
function createCookiePlugin(): HookTypePlugin {
  return {
    name: 'cookie',
    description: 'Hook document.cookie getter/setter',
    apply(builder) {
      return builder.intercept('document.cookie', 'cookie');
    },
    customBuild(builder) {
      const config = builder.getConfig();
      const hookId = config.hookId;
      const storeKey = config.store.globalKey || '__hookStore';
      const max = config.store.maxRecords || 500;

      return [
        `// Hook: document.cookie`,
        `// ID: ${hookId}`,
        `(function() {`,
        `  'use strict';`,
        `  if (!window.${storeKey}) window.${storeKey} = {};`,
        `  if (!window.${storeKey}['${hookId}']) window.${storeKey}['${hookId}'] = [];`,
        `  const __desc = Object.getOwnPropertyDescriptor(Document.prototype, 'cookie') || Object.getOwnPropertyDescriptor(HTMLDocument.prototype, 'cookie');`,
        `  if (!__desc) { console.warn('[${hookId}] Cannot hook document.cookie'); return; }`,
        `  let __callCount = 0;`,
        ``,
        `  Object.defineProperty(document, 'cookie', {`,
        `    configurable: true,`,
        `    get() {`,
        `      __callCount++;`,
        `      const val = __desc.get.call(this);`,
        `      const hookData = {`,
        `        hookId: '${hookId}', target: 'document.cookie', operation: 'get',`,
        `        value: val, timestamp: Date.now(), callCount: __callCount,`,
        config.capture.stack
          ? `        stack: new Error().stack.split('\\n').slice(2, ${typeof config.capture.stack === 'number' ? 2 + config.capture.stack : 12}).join('\\n'),`
          : '',
        `      };`,
        `      const __records = window.${storeKey}['${hookId}'];`,
        `      if (__records.length >= ${max}) __records.shift();`,
        `      __records.push(hookData);`,
        config.store.console ? `      console.log('[${hookId}] cookie get', hookData);` : '',
        `      return val;`,
        `    },`,
        `    set(val) {`,
        `      __callCount++;`,
        `      const hookData = {`,
        `        hookId: '${hookId}', target: 'document.cookie', operation: 'set',`,
        `        value: val, timestamp: Date.now(), callCount: __callCount,`,
        config.capture.stack
          ? `        stack: new Error().stack.split('\\n').slice(2, ${typeof config.capture.stack === 'number' ? 2 + config.capture.stack : 12}).join('\\n'),`
          : '',
        `      };`,
        config.lifecycle.before ? `      const args = [val]; ${config.lifecycle.before}` : '',
        config.action === 'block'
          ? `      hookData.blocked = true;`
          : `      __desc.set.call(this, val);`,
        `      const __records = window.${storeKey}['${hookId}'];`,
        `      if (__records.length >= ${max}) __records.shift();`,
        `      __records.push(hookData);`,
        config.store.console ? `      console.log('[${hookId}] cookie set', hookData);` : '',
        `    },`,
        `  });`,
        `  console.log('[${hookId}] ✅ Hooked: document.cookie');`,
        `})();`,
      ].filter(Boolean).join('\n');
    },
  };
}

/**
 * eval 类型 — Hook eval 和 Function 构造函数
 */
function createEvalPlugin(): HookTypePlugin {
  return {
    name: 'eval',
    description: 'Hook eval() and Function() constructor',
    apply(builder) {
      return builder.intercept('window.eval', 'eval');
    },
    customBuild(builder) {
      const config = builder.getConfig();
      const hookId = config.hookId;
      const storeKey = config.store.globalKey || '__hookStore';
      const max = config.store.maxRecords || 500;

      const lines: string[] = [
        `// Hook: eval & Function`,
        `// ID: ${hookId}`,
        `(function() {`,
        `  'use strict';`,
        `  if (!window.${storeKey}) window.${storeKey} = {};`,
        `  if (!window.${storeKey}['${hookId}']) window.${storeKey}['${hookId}'] = [];`,
        `  const __origEval = window.eval;`,
        `  const __origFunction = window.Function;`,
        `  let __callCount = 0;`,
        ``,
        `  window.eval = function(code) {`,
        `    __callCount++;`,
        `    const hookData = {`,
        `      hookId: '${hookId}', target: 'eval', timestamp: Date.now(),`,
        `      callCount: __callCount,`,
        `      codePreview: String(code).slice(0, 500),`,
        `      codeLength: String(code).length,`,
      ];

      if (config.capture.stack) {
        const maxFrames = typeof config.capture.stack === 'number' ? config.capture.stack : 10;
        lines.push(`      stack: new Error().stack.split('\\n').slice(2, ${2 + maxFrames}).join('\\n'),`);
      }

      lines.push(`    };`);

      if (config.store.console) {
        lines.push(`    console.log('[${hookId}] eval', hookData);`);
      }

      lines.push(`    const __records = window.${storeKey}['${hookId}'];`);
      lines.push(`    if (__records.length >= ${max}) __records.shift();`);
      lines.push(`    __records.push(hookData);`);

      if (config.action === 'block') {
        lines.push(`    hookData.blocked = true;`);
        lines.push(`    return undefined;`);
      } else {
        lines.push(`    return __origEval.call(this, code);`);
      }
      lines.push(`  };`);

      // Function constructor
      lines.push(`  window.Function = function(...funcArgs) {`);
      lines.push(`    __callCount++;`);
      lines.push(`    const hookData = {`);
      lines.push(`      hookId: '${hookId}', target: 'Function', timestamp: Date.now(),`);
      lines.push(`      callCount: __callCount,`);
      lines.push(`      codePreview: funcArgs.map(a => String(a).slice(0, 200)).join(', '),`);
      lines.push(`    };`);

      if (config.store.console) {
        lines.push(`    console.log('[${hookId}] Function()', hookData);`);
      }

      lines.push(`    const __records = window.${storeKey}['${hookId}'];`);
      lines.push(`    if (__records.length >= ${max}) __records.shift();`);
      lines.push(`    __records.push(hookData);`);
      lines.push(`    return new __origFunction(...funcArgs);`);
      lines.push(`  };`);
      lines.push(`  window.Function.prototype = __origFunction.prototype;`);

      lines.push(`  console.log('[${hookId}] ✅ Hooked: eval & Function');`);
      lines.push(`})();`);

      return lines.join('\n');
    },
  };
}

/**
 * object-method 类型 — Hook 对象的方法
 * params: { object: string, method: string }
 */
function createObjectMethodPlugin(): HookTypePlugin {
  return {
    name: 'object-method',
    description: 'Hook any method on an object',
    apply(builder, params) {
      const obj = params.object as string;
      const method = params.method as string;
      if (!obj || !method) throw new Error('[object-method] params.object and params.method are required');
      return builder.intercept(`${obj}.${method}`, `${obj}.${method}`);
    },
  };
}

/**
 * custom 类型 — 用户完全自定义
 * params: { script: string }
 */
function createCustomPlugin(): HookTypePlugin {
  return {
    name: 'custom',
    description: 'Inject fully custom hook code',
    apply(builder) {
      return builder;
    },
    customBuild(_builder, params) {
      const script = params.script as string;
      if (!script) throw new Error('[custom] params.script is required');
      return script;
    },
  };
}
