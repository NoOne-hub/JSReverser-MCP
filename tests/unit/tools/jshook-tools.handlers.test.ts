/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import assert from 'node:assert';
import {mkdtemp, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {describe, it} from 'node:test';

import {StealthScripts2025} from '../../../src/modules/stealth/StealthScripts2025.js';
import {
  analyzeTarget,
  deobfuscateCode,
  detectCrypto,
  exportSessionReport,
  locateSignatureFunction,
  riskPanel,
  summarizeCode,
  understandCode,
} from '../../../src/tools/analyzer.js';
import {
  collectCode,
  collectionDiff,
  searchInScripts,
} from '../../../src/tools/collector.js';
import {
  findClickableElements,
  getDomStructure,
  queryDom,
} from '../../../src/tools/dom.js';
import {
  createHook,
  getHookData,
  injectHook,
  removeHook,
} from '../../../src/tools/hook.js';
import {
  checkBrowserHealth,
  clickElement,
  emulateDevice,
  getAllLinks,
  getPerformanceMetrics,
  hoverElement,
  pressKey,
  scrollPage,
  selectOption,
  sessionState,
  setViewport,
  typeText,
  uploadFile,
  waitForNetworkIdle,
  waitForElement,
} from '../../../src/tools/page.js';
import {getJSHookRuntime} from '../../../src/tools/runtime.js';
import {
  injectStealth,
  listStealthFeatures,
  listStealthPresets,
  setUserAgent,
} from '../../../src/tools/stealth.js';

type RuntimeMethod = (...args: unknown[]) => unknown;

interface ToolResponseHarness {
  lines: string[];
  appendResponseLine(value: string): void;
  setIncludePages(): void;
  setIncludeNetworkRequests(): void;
  setIncludeConsoleData(): void;
  attachImage(): void;
  attachNetworkRequest(): void;
  attachConsoleMessage(): void;
  setIncludeWebSocketConnections(): void;
  attachWebSocket(): void;
}

interface ToolDefinitionHarness {
  handler(
    request: {params: unknown},
    response: ToolResponseHarness,
    context: object,
  ): Promise<void>;
}

interface RuntimeHarness {
  deobfuscator: {deobfuscate: RuntimeMethod};
  analyzer: {understand: RuntimeMethod};
  summarizer: {
    summarizeFile: RuntimeMethod;
    summarizeBatch: RuntimeMethod;
    summarizeProject: RuntimeMethod;
  };
  cryptoDetector: {detect: RuntimeMethod};
  collector: {
    collect: RuntimeMethod;
    getFilesByPattern: RuntimeMethod;
    getCollectedFilesSummary: RuntimeMethod;
    getTopPriorityFiles: RuntimeMethod;
    getActivePage: RuntimeMethod;
    getStatus: RuntimeMethod;
  };
  domInspector: {
    querySelector: RuntimeMethod;
    querySelectorAll: RuntimeMethod;
    getStructure: RuntimeMethod;
    findClickable: RuntimeMethod;
  };
  hookManager: {
    create: RuntimeMethod;
    getHook: RuntimeMethod;
    getAllHooks: RuntimeMethod;
    getRecords: RuntimeMethod;
    exportData: RuntimeMethod;
    getStats: RuntimeMethod;
    remove: RuntimeMethod;
  };
  pageController: {
    injectScript: RuntimeMethod;
    navigate: RuntimeMethod;
    click: RuntimeMethod;
    hover: RuntimeMethod;
    select: RuntimeMethod;
    scroll: RuntimeMethod;
    type: RuntimeMethod;
    pressKey: RuntimeMethod;
    uploadFile: RuntimeMethod;
    waitForSelector: RuntimeMethod;
    waitForNetworkIdle: RuntimeMethod;
    screenshot: RuntimeMethod;
    getPerformanceMetrics: RuntimeMethod;
    setViewport: RuntimeMethod;
    emulateDevice: RuntimeMethod;
    getAllLinks: RuntimeMethod;
    getPage: RuntimeMethod;
    getCookies: RuntimeMethod;
    getLocalStorage: RuntimeMethod;
    getSessionStorage: RuntimeMethod;
    clearCookies: RuntimeMethod;
    clearLocalStorage: RuntimeMethod;
    clearSessionStorage: RuntimeMethod;
    setCookies: RuntimeMethod;
    setLocalStorage: RuntimeMethod;
    setSessionStorage: RuntimeMethod;
    replayActions: RuntimeMethod;
    evaluate: RuntimeMethod;
  };
  browserManager: {
    getConnectedBrowser: RuntimeMethod;
  };
}

interface StealthStaticHarness {
  injectAll: RuntimeMethod;
  getPresets: RuntimeMethod;
}

const invokeTool = async (
  tool: ToolDefinitionHarness,
  params: Record<string, unknown>,
  response: ToolResponseHarness,
): Promise<void> => {
  await tool.handler({params}, response, {});
};

function makeResponse(): ToolResponseHarness {
  const lines: string[] = [];
  return {
    lines,
    appendResponseLine: (v: string) => lines.push(v),
    setIncludePages: () => undefined,
    setIncludeNetworkRequests: () => undefined,
    setIncludeConsoleData: () => undefined,
    attachImage: () => undefined,
    attachNetworkRequest: () => undefined,
    attachConsoleMessage: () => undefined,
    setIncludeWebSocketConnections: () => undefined,
    attachWebSocket: () => undefined,
  };
}

describe('jshook tools handlers', () => {
  it('covers analyzer/collector/dom/hook/page/stealth handlers', async () => {
    const runtime = getJSHookRuntime() as unknown as RuntimeHarness;
    // 双栈合并（2026-09-02）：未初始化主浏览器时 browserManager 为 undefined——
    // 测试补 stub（模拟有 manager 但浏览器未连接）
    (runtime as {browserManager?: unknown}).browserManager = {
      getConnectedBrowser: () => undefined,
    };
    const stealth = StealthScripts2025 as unknown as StealthStaticHarness;

    const originals = {
      deobfuscate: runtime.deobfuscator.deobfuscate,
      understand: runtime.analyzer.understand,
      summarizeFile: runtime.summarizer.summarizeFile,
      summarizeBatch: runtime.summarizer.summarizeBatch,
      summarizeProject: runtime.summarizer.summarizeProject,
      detectCrypto: runtime.cryptoDetector.detect,
      collect: runtime.collector.collect,
      getFilesByPattern: runtime.collector.getFilesByPattern,
      getCollectedFilesSummary: runtime.collector.getCollectedFilesSummary,
      getTopPriorityFiles: runtime.collector.getTopPriorityFiles,
      querySelector: runtime.domInspector.querySelector,
      querySelectorAll: runtime.domInspector.querySelectorAll,
      getStructure: runtime.domInspector.getStructure,
      findClickable: runtime.domInspector.findClickable,
      createHook: runtime.hookManager.create,
      getHook: runtime.hookManager.getHook,
      getAllHooks: runtime.hookManager.getAllHooks,
      getRecords: runtime.hookManager.getRecords,
      exportData: runtime.hookManager.exportData,
      getStats: runtime.hookManager.getStats,
      removeHook: runtime.hookManager.remove,
      injectScript: runtime.pageController.injectScript,
      navigate: runtime.pageController.navigate,
      click: runtime.pageController.click,
      hover: runtime.pageController.hover,
      select: runtime.pageController.select,
      scroll: runtime.pageController.scroll,
      type: runtime.pageController.type,
      pressKey: runtime.pageController.pressKey,
      uploadFile: runtime.pageController.uploadFile,
      waitForSelector: runtime.pageController.waitForSelector,
      waitForNetworkIdle: runtime.pageController.waitForNetworkIdle,
      screenshot: runtime.pageController.screenshot,
      metrics: runtime.pageController.getPerformanceMetrics,
      setViewport: runtime.pageController.setViewport,
      emulateDevice: runtime.pageController.emulateDevice,
      getAllLinks: runtime.pageController.getAllLinks,
      getPage: runtime.pageController.getPage,
      getCookies: runtime.pageController.getCookies,
      getLocalStorage: runtime.pageController.getLocalStorage,
      getSessionStorage: runtime.pageController.getSessionStorage,
      clearCookies: runtime.pageController.clearCookies,
      clearLocalStorage: runtime.pageController.clearLocalStorage,
      clearSessionStorage: runtime.pageController.clearSessionStorage,
      setCookies: runtime.pageController.setCookies,
      setLocalStorage: runtime.pageController.setLocalStorage,
      setSessionStorage: runtime.pageController.setSessionStorage,
      replayActions: runtime.pageController.replayActions,
      evaluate: runtime.pageController.evaluate,
      getActivePage: runtime.collector.getActivePage,
      getStatus: runtime.collector.getStatus,
      getConnectedBrowser: runtime.browserManager.getConnectedBrowser,
      injectAll: stealth.injectAll,
      getPresets: stealth.getPresets,
    };

    runtime.deobfuscator.deobfuscate = async () => ({
      code: 'deobf',
      readabilityScore: 72,
      confidence: 0.91,
      obfuscationType: ['unknown'],
      transformations: [{type: 'noop', description: 'x', success: true}],
      analysis: 'ok',
    });
    runtime.analyzer.understand = async () => ({
      ok: true,
      mode: 'understand',
      qualityScore: 88,
      securityRisks: [],
    });
    runtime.summarizer.summarizeFile = async () => ({scope: 'single'});
    runtime.summarizer.summarizeBatch = async () => ({scope: 'batch'});
    runtime.summarizer.summarizeProject = async () => ({scope: 'project'});
    runtime.cryptoDetector.detect = async () => ({
      algorithms: [{name: 'MD5', confidence: 0.9}],
      libraries: [],
      confidence: 0.9,
      securityIssues: [],
    });

    runtime.collector.collect = async () => ({files: [{url: 'a.js'}]});
    runtime.collector.getFilesByPattern = () => [{url: 'b.js'}];
    runtime.collector.getCollectedFilesSummary = () => [
      {url: 'b.js', size: 10, type: 'external'},
    ];
    runtime.collector.getTopPriorityFiles = () => ({
      files: [
        {
          url: 'top.js',
          content:
            'function signPayload(token, nonce){ return token + nonce; }\nfetch("/api/order/sign", {method:"POST"});',
          size: 120,
          type: 'external',
        },
      ],
      totalSize: 1,
      totalFiles: 1,
    });
    runtime.collector.getStatus = async () => ({
      running: true,
      pagesCount: 1,
      version: 'Chrome/145',
    });

    runtime.domInspector.querySelector = async () => ({
      found: true,
      nodeName: 'DIV',
    });
    runtime.domInspector.querySelectorAll = async () => [
      {found: true, nodeName: 'SPAN'},
    ];
    runtime.domInspector.getStructure = async () => ({tag: 'BODY'});
    runtime.domInspector.findClickable = async () => [
      {selector: '#x', text: 'x', type: 'button', visible: true},
    ];

    let hookCounter = 0;
    const baseTs = Date.now();
    runtime.hookManager.create = (({type}: {type: string}) => {
      hookCounter += 1;
      return {
        hookId: hookCounter === 1 ? 'h1' : `${type}-hook-${hookCounter}`,
        script: `/* ${type} hook */`,
      };
    }) as RuntimeMethod;
    runtime.hookManager.getHook = ((id: string) =>
      id === 'missing'
        ? undefined
        : {hookId: id, script: 'console.log(1)'}) as RuntimeMethod;
    runtime.hookManager.getAllHooks = () => [
      {hookId: 'h1'},
      {hookId: 'xhr-hook-2'},
      {hookId: 'websocket-hook-3'},
    ];
    runtime.hookManager.getRecords = ((hookId: string) => {
      if (hookId.includes('xhr')) {
        return [
          {
            id: 11,
            target: undefined,
            event: 'open',
            timestamp: undefined,
          },
        ];
      }
      if (hookId.includes('websocket')) {
        return [
          {
            id: 12,
            target: 'websocket',
            url: 'wss://api.example.com/ws/sign?nonce=1',
            event: 'send',
            data: '{"token":"ws-token"}',
            timestamp: baseTs + 150,
          },
        ];
      }
      return [
        {
          id: 1,
          target: 'fetch',
          url: 'https://api.example.com/sign/12345?nonce=1&token=abc',
          method: 'POST',
          body: '{"token":"abc","sign":"xyz"}',
          status: 200,
          timestamp: baseTs + 100,
        },
        {
          id: 2,
          target: 'fetch',
          url: 'https://api.example.com/sign/12345?nonce=1&token=abc',
          method: 'POST',
          requestBody: '{"auth":"yes"}',
          status: 201,
          timestamp: baseTs + 130,
        },
        {
          id: 22,
          target: 'fetch',
          url: 'https://api.example.com/sign/12345?nonce=1&token=abc',
          method: 'POST',
          requestBody: '{"auth":"yes"}',
          status: 201,
          timestamp: baseTs + 131,
        },
        {
          id: 3,
          target: 'fetch',
          url: 'https://api.example.com/sign/67890?nonce=2&token=def',
          method: 'POST',
          body: '{"token":"next"}',
          status: 403,
          timestamp: baseTs + 2500,
        },
        {
          id: 4,
          target: 'fetch',
          url: '/relative/sign/99999?token=abc',
          method: 'POST',
          data: '{"x-sign":"v"}',
          status: 200,
          timestamp: baseTs + 2600,
        },
      ];
    }) as RuntimeMethod;
    runtime.hookManager.exportData = () => 'hook-data-export';
    runtime.hookManager.getStats = () => ({
      totalHooks: 1,
      enabledHooks: 1,
      disabledHooks: 0,
      registeredTypes: ['fetch'],
      hooks: [
        {
          hookId: 'h1',
          type: 'fetch',
          description: 'd',
          enabled: true,
          callCount: 1,
        },
      ],
    });
    runtime.hookManager.remove = ((id: string) => id === 'h1') as RuntimeMethod;

    runtime.pageController.injectScript = async () => undefined;
    runtime.pageController.navigate = async () => ({
      ok: true,
      url: 'https://a.com',
    });
    runtime.pageController.click = async () => undefined;
    runtime.pageController.hover = async () => undefined;
    runtime.pageController.select = async () => undefined;
    runtime.pageController.scroll = async () => undefined;
    runtime.pageController.type = async () => undefined;
    runtime.pageController.pressKey = async () => undefined;
    runtime.pageController.uploadFile = async () => undefined;
    runtime.pageController.waitForSelector = async () => ({found: true});
    runtime.pageController.waitForNetworkIdle = async () => undefined;
    runtime.pageController.screenshot = async () => Buffer.from('shot');
    runtime.pageController.getPerformanceMetrics = async () => ({fcp: 100});
    runtime.pageController.setViewport = async () => undefined;
    runtime.pageController.emulateDevice = async () => undefined;
    runtime.pageController.getAllLinks = async () => [
      {text: 'Home', href: 'https://example.com/'},
    ];
    runtime.pageController.getCookies = async () => [{name: 'sid', value: '1'}];
    runtime.pageController.getLocalStorage = async () => ({token: 'abc'});
    runtime.pageController.getSessionStorage = async () => ({nonce: 'n'});
    runtime.pageController.clearCookies = async () => undefined;
    runtime.pageController.clearLocalStorage = async () => undefined;
    runtime.pageController.clearSessionStorage = async () => undefined;
    runtime.pageController.setCookies = async () => undefined;
    runtime.pageController.setLocalStorage = async () => undefined;
    runtime.pageController.setSessionStorage = async () => undefined;
    runtime.pageController.replayActions = (async (
      actions: Array<{action: string}>,
    ) =>
      actions.map((action, index) => ({
        index,
        action: action.action,
        success: true,
        message: 'ok',
      }))) as RuntimeMethod;
    runtime.pageController.evaluate = async () => 2;

    const activePage = {
      setUserAgent: async () => undefined,
      url: () => 'https://example.com/dashboard',
      title: async () => 'Dashboard',
    };
    runtime.pageController.getPage = async () => activePage;
    runtime.collector.getActivePage = async () => activePage;

    stealth.injectAll = async () => undefined;
    stealth.getPresets = () => ({'windows-chrome': {preset: 'windows-chrome'}});

    try {
      const res = makeResponse();

      await invokeTool(
        deobfuscateCode as unknown as ToolDefinitionHarness,
        {code: 'x'},
        res,
      );
      await invokeTool(
        understandCode as unknown as ToolDefinitionHarness,
        {code: 'x', focus: 'all'},
        res,
      );

      await invokeTool(
        summarizeCode as unknown as ToolDefinitionHarness,
        {mode: 'single', code: 'const x=1;'},
        res,
      );
      await invokeTool(
        summarizeCode as unknown as ToolDefinitionHarness,
        {mode: 'batch', files: []},
        res,
      );
      await invokeTool(
        summarizeCode as unknown as ToolDefinitionHarness,
        {mode: 'project', files: []},
        res,
      );

      await invokeTool(
        detectCrypto as unknown as ToolDefinitionHarness,
        {code: 'md5(x)'},
        res,
      );
      await invokeTool(
        analyzeTarget as unknown as ToolDefinitionHarness,
        {url: 'https://example.com', hookPreset: 'api-signature'},
        res,
      );
      await invokeTool(
        analyzeTarget as unknown as ToolDefinitionHarness,
        {
          url: 'https://example.com',
          hookPreset: 'none',
          autoInjectHooks: false,
          autoReplayActions: [
            {action: 'click', selector: '#submit'},
            {action: 'type', selector: '#k', text: 'v'},
          ],
        },
        res,
      );
      runtime.collector.collect = async () => null;
      await invokeTool(
        analyzeTarget as unknown as ToolDefinitionHarness,
        {
          url: 'https://example.com',
          hookPreset: 'none',
          autoInjectHooks: false,
        },
        res,
      );
      runtime.collector.collect = async () => ({files: 'bad-shape'});
      await invokeTool(
        analyzeTarget as unknown as ToolDefinitionHarness,
        {
          url: 'https://example.com',
          hookPreset: 'none',
          autoInjectHooks: false,
        },
        res,
      );
      runtime.collector.collect = async () => ({files: [{url: 'a.js'}]});
      runtime.collector.getTopPriorityFiles = () => ({
        files: [],
        totalSize: 0,
        totalFiles: 0,
      });
      await invokeTool(
        analyzeTarget as unknown as ToolDefinitionHarness,
        {
          url: 'https://example.com',
          hookPreset: 'none',
          autoInjectHooks: false,
          runDeobfuscation: true,
          correlationWindowMs: 500,
          maxCorrelatedFlows: 3,
        },
        res,
      );
      runtime.collector.getTopPriorityFiles = () => ({
        files: [
          {
            url: 'top-sign.js',
            content:
              'function signOnly(token, nonce){ return `${token}:${nonce}`; }',
            size: 64,
            type: 'external',
          },
        ],
        totalSize: 64,
        totalFiles: 1,
      });
      await invokeTool(
        analyzeTarget as unknown as ToolDefinitionHarness,
        {
          url: 'https://example.com',
          hookPreset: 'none',
          autoInjectHooks: false,
          waitAfterHookMs: 1,
          maxFingerprints: 4,
        },
        res,
      );
      runtime.collector.collect = async () => ({
        files: [
          {
            url: 'https://example.com/app.js',
            content: `
            function helper(){ return Date.now(); }
            function genH5st(appid, body, functionId){
              const t = helper();
              const raw = appid + body + functionId + t;
              return crypto.subtle.digest('SHA-256', raw);
            }
            function noop(){ return "x"; }
          `,
            size: 280,
            type: 'external',
          },
        ],
      });
      runtime.collector.getTopPriorityFiles = () => ({
        files: [
          {
            url: 'https://example.com/app.js',
            content: `
            function helper(){ return Date.now(); }
            function genH5st(appid, body, functionId){
              const t = helper();
              const raw = appid + body + functionId + t;
              return crypto.subtle.digest('SHA-256', raw);
            }
            function noop(){ return "x"; }
          `,
            size: 280,
            type: 'external',
          },
        ],
        totalSize: 280,
        totalFiles: 1,
      });
      await invokeTool(
        locateSignatureFunction as unknown as ToolDefinitionHarness,
        {
          url: 'https://example.com',
          targetParam: 'h5st',
          relatedParams: ['appid', 'body', 'functionId'],
          candidateScripts: ['app.js'],
          observedFunctions: ['genH5st'],
          preferredUrlPatterns: ['example.com/app.js'],
        },
        res,
      );
      await invokeTool(
        riskPanel as unknown as ToolDefinitionHarness,
        {code: 'md5(x)'},
        res,
      );
      await invokeTool(
        riskPanel as unknown as ToolDefinitionHarness,
        {hookId: 'h1'},
        res,
      );
      await invokeTool(
        riskPanel as unknown as ToolDefinitionHarness,
        {hookId: 'h1', includeHookSignals: false},
        res,
      );
      runtime.collector.getTopPriorityFiles = () => ({
        files: [],
        totalSize: 0,
        totalFiles: 0,
      });
      await assert.rejects(async () => {
        await invokeTool(
          riskPanel as unknown as ToolDefinitionHarness,
          {},
          res,
        );
      });
      runtime.collector.getTopPriorityFiles = () => ({
        files: [{url: 'top.js', content: 'x', size: 1, type: 'external'}],
        totalSize: 1,
        totalFiles: 1,
      });
      await invokeTool(
        exportSessionReport as unknown as ToolDefinitionHarness,
        {format: 'json'},
        res,
      );
      await invokeTool(
        exportSessionReport as unknown as ToolDefinitionHarness,
        {format: 'markdown', includeHookData: true},
        res,
      );

      await invokeTool(
        collectCode as unknown as ToolDefinitionHarness,
        {url: 'https://example.com'},
        res,
      );
      await invokeTool(
        collectCode as unknown as ToolDefinitionHarness,
        {url: 'https://example.com', returnMode: 'summary'},
        res,
      );
      await invokeTool(
        collectCode as unknown as ToolDefinitionHarness,
        {url: 'https://example.com', returnMode: 'pattern', pattern: 'b'},
        res,
      );
      await invokeTool(
        collectCode as unknown as ToolDefinitionHarness,
        {url: 'https://example.com', returnMode: 'pattern'},
        res,
      );
      await invokeTool(
        collectCode as unknown as ToolDefinitionHarness,
        {url: 'https://example.com', returnMode: 'top-priority'},
        res,
      );
      await invokeTool(
        searchInScripts as unknown as ToolDefinitionHarness,
        {pattern: 'abc', limit: 1},
        res,
      );
      await invokeTool(
        collectionDiff as unknown as ToolDefinitionHarness,
        {
          previous: [{url: 'old.js', size: 1, type: 'external'}],
          includeUnchanged: true,
        },
        res,
      );
      await invokeTool(
        collectionDiff as unknown as ToolDefinitionHarness,
        {
          previous: [
            {url: 'a.js', size: 1, type: 'external'},
            {url: 'same.js', size: 2, type: 'external'},
          ],
          current: [
            {url: 'a.js', size: 3, type: 'external'},
            {url: 'same.js', size: 2, type: 'external'},
          ],
          includeUnchanged: true,
        },
        res,
      );
      await invokeTool(
        collectionDiff as unknown as ToolDefinitionHarness,
        {
          previous: [{url: 'same.js', size: 2, type: 'external'}],
          current: [{url: 'same.js', size: 2, type: 'external'}],
          includeUnchanged: false,
        },
        res,
      );

      await invokeTool(
        queryDom as unknown as ToolDefinitionHarness,
        {selector: '#x', all: false},
        res,
      );
      await invokeTool(
        queryDom as unknown as ToolDefinitionHarness,
        {selector: '.x', all: true, limit: 2},
        res,
      );
      await invokeTool(
        getDomStructure as unknown as ToolDefinitionHarness,
        {maxDepth: 2, includeText: true},
        res,
      );
      await invokeTool(
        findClickableElements as unknown as ToolDefinitionHarness,
        {filterText: 'x'},
        res,
      );

      await invokeTool(
        createHook as unknown as ToolDefinitionHarness,
        {type: 'fetch'},
        res,
      );
      await invokeTool(
        injectHook as unknown as ToolDefinitionHarness,
        {hookId: 'h1'},
        res,
      );
      await invokeTool(
        getHookData as unknown as ToolDefinitionHarness,
        {hookId: 'h1'},
        res,
      );
      await invokeTool(
        getHookData as unknown as ToolDefinitionHarness,
        {},
        res,
      );
      await invokeTool(
        getHookData as unknown as ToolDefinitionHarness,
        {hookId: 'h1', view: 'summary', maxRecords: 2},
        res,
      );
      await invokeTool(
        getHookData as unknown as ToolDefinitionHarness,
        {view: 'summary', maxRecords: 1},
        res,
      );
      await invokeTool(
        removeHook as unknown as ToolDefinitionHarness,
        {hookId: 'h1'},
        res,
      );
      await invokeTool(
        removeHook as unknown as ToolDefinitionHarness,
        {hookId: 'missing'},
        res,
      );

      await invokeTool(
        clickElement as unknown as ToolDefinitionHarness,
        {selector: '#x'},
        res,
      );
      await invokeTool(
        hoverElement as unknown as ToolDefinitionHarness,
        {selector: '#menu'},
        res,
      );
      await invokeTool(
        selectOption as unknown as ToolDefinitionHarness,
        {selector: 'select', values: ['a', 'b']},
        res,
      );
      await invokeTool(
        scrollPage as unknown as ToolDefinitionHarness,
        {x: 0, y: 400},
        res,
      );
      await invokeTool(
        typeText as unknown as ToolDefinitionHarness,
        {selector: '#x', text: 'abc', delay: 10},
        res,
      );
      await invokeTool(
        pressKey as unknown as ToolDefinitionHarness,
        {key: 'Enter'},
        res,
      );
      await invokeTool(
        uploadFile as unknown as ToolDefinitionHarness,
        {selector: 'input[type=file]', filePath: '/tmp/a.txt'},
        res,
      );
      await invokeTool(
        waitForElement as unknown as ToolDefinitionHarness,
        {selector: '#x', timeout: 100},
        res,
      );
      await invokeTool(
        waitForNetworkIdle as unknown as ToolDefinitionHarness,
        {timeout: 100},
        res,
      );
      await invokeTool(
        getPerformanceMetrics as unknown as ToolDefinitionHarness,
        {},
        res,
      );
      await invokeTool(
        setViewport as unknown as ToolDefinitionHarness,
        {width: 390, height: 844},
        res,
      );
      await invokeTool(
        emulateDevice as unknown as ToolDefinitionHarness,
        {deviceName: 'Android'},
        res,
      );
      await invokeTool(
        getAllLinks as unknown as ToolDefinitionHarness,
        {},
        res,
      );
      await invokeTool(
        sessionState as unknown as ToolDefinitionHarness,
        {action: 'save', sessionId: 's1'},
        res,
      );
      await invokeTool(
        sessionState as unknown as ToolDefinitionHarness,
        {
          action: 'save',
          sessionId: 's-empty',
          includeCookies: false,
          includeLocalStorage: false,
          includeSessionStorage: false,
        },
        res,
      );
      await invokeTool(
        sessionState as unknown as ToolDefinitionHarness,
        {action: 'restore', sessionId: 's1', clearStorageBeforeRestore: true},
        res,
      );
      await invokeTool(
        sessionState as unknown as ToolDefinitionHarness,
        {action: 'restore', sessionId: 's1', navigateToSavedUrl: false},
        res,
      );
      await invokeTool(
        sessionState as unknown as ToolDefinitionHarness,
        {action: 'list'},
        res,
      );
      await invokeTool(
        sessionState as unknown as ToolDefinitionHarness,
        {action: 'dump', sessionId: 's1', pretty: false},
        res,
      );
      const tempDir = await mkdtemp(join(tmpdir(), 'jsreverser-mcp-'));
      const snapshotPath = join(tempDir, 'session-s1.json');
      const encryptedSnapshotPath = join(tempDir, 'session-s1.encrypted.json');
      const originalEncryptionKey = process.env.SESSION_STATE_ENCRYPTION_KEY;
      try {
        await invokeTool(
          sessionState as unknown as ToolDefinitionHarness,
          {action: 'dump', sessionId: 's1', path: snapshotPath},
          res,
        );
        const snapshotJson = await readFile(snapshotPath, 'utf8');
        process.env.SESSION_STATE_ENCRYPTION_KEY = 'unit-test-session-key';
        await invokeTool(
          sessionState as unknown as ToolDefinitionHarness,
          {
            action: 'dump',
            sessionId: 's1',
            path: encryptedSnapshotPath,
            encrypt: true,
          },
          res,
        );
        await invokeTool(
          sessionState as unknown as ToolDefinitionHarness,
          {
            action: 'load',
            path: encryptedSnapshotPath,
            sessionId: 's1-encrypted',
            overwrite: true,
          },
          res,
        );
        process.env.SESSION_STATE_ENCRYPTION_KEY = '';
        await assert.rejects(async () => {
          await invokeTool(
            sessionState as unknown as ToolDefinitionHarness,
            {
              action: 'dump',
              sessionId: 's1',
              path: encryptedSnapshotPath,
              encrypt: true,
            },
            res,
          );
        });
        await assert.rejects(async () => {
          await invokeTool(
            sessionState as unknown as ToolDefinitionHarness,
            {
              action: 'load',
              path: encryptedSnapshotPath,
              sessionId: 's1-encrypted-2',
              overwrite: true,
            },
            res,
          );
        });
        await invokeTool(
          sessionState as unknown as ToolDefinitionHarness,
          {action: 'delete', sessionId: 's1'},
          res,
        );
        await invokeTool(
          sessionState as unknown as ToolDefinitionHarness,
          {action: 'load', snapshotJson, sessionId: 's1'},
          res,
        );
        await assert.rejects(async () => {
          await invokeTool(
            sessionState as unknown as ToolDefinitionHarness,
            {action: 'load', snapshotJson, sessionId: 's1'},
            res,
          );
        });
        await invokeTool(
          sessionState as unknown as ToolDefinitionHarness,
          {
            action: 'load',
            path: snapshotPath,
            sessionId: 's1',
            overwrite: true,
          },
          res,
        );

        const expiredSnapshotJson = JSON.stringify({
          id: 'expired-one',
          savedAt: new Date().toISOString(),
          expiresAt: new Date(Date.now() - 5_000).toISOString(),
          url: 'https://expired.example.com',
          title: 'expired',
          cookies: [],
          localStorage: {},
          sessionStorage: {},
        });
        await invokeTool(
          sessionState as unknown as ToolDefinitionHarness,
          {action: 'load', snapshotJson: expiredSnapshotJson, overwrite: true},
          res,
        );
        await invokeTool(
          sessionState as unknown as ToolDefinitionHarness,
          {action: 'list'},
          res,
        );
      } finally {
        process.env.SESSION_STATE_ENCRYPTION_KEY = originalEncryptionKey;
        await rm(tempDir, {recursive: true, force: true});
      }
      await assert.rejects(async () => {
        await invokeTool(
          sessionState as unknown as ToolDefinitionHarness,
          {action: 'restore', sessionId: 'missing-session'},
          res,
        );
      });
      await assert.rejects(async () => {
        await invokeTool(
          sessionState as unknown as ToolDefinitionHarness,
          {action: 'dump', sessionId: 'missing-session'},
          res,
        );
      });
      await assert.rejects(async () => {
        await invokeTool(
          sessionState as unknown as ToolDefinitionHarness,
          {action: 'load'},
          res,
        );
      });
      await assert.rejects(async () => {
        await invokeTool(
          sessionState as unknown as ToolDefinitionHarness,
          {action: 'load', snapshotJson: '{bad json}'},
          res,
        );
      });
      await assert.rejects(async () => {
        await invokeTool(
          sessionState as unknown as ToolDefinitionHarness,
          {action: 'load', snapshotJson: '1'},
          res,
        );
      });
      await invokeTool(
        checkBrowserHealth as unknown as ToolDefinitionHarness,
        {},
        res,
      );
      runtime.browserManager.getConnectedBrowser = () => ({
        isConnected: () => false,
      });
      runtime.pageController.getPage = async () => activePage;
      runtime.pageController.evaluate = async () => 2;
      runtime.collector.getStatus = async () => ({
        running: true,
        pagesCount: 1,
        version: 'Chrome/145',
      });
      const falseNegativeHealthStart = res.lines.length;
      await invokeTool(
        checkBrowserHealth as unknown as ToolDefinitionHarness,
        {},
        res,
      );
      const falseNegativeHealth = res.lines
        .slice(falseNegativeHealthStart)
        .join('\n');
      assert.ok(falseNegativeHealth.includes('"pageReady": true'));
      assert.ok(!falseNegativeHealth.includes('BROWSER_DISCONNECTED'));
      runtime.browserManager.getConnectedBrowser = () => ({
        isConnected: () => false,
      });
      runtime.collector.getStatus = async () => ({
        running: false,
        pagesCount: 0,
      });
      runtime.pageController.getPage = async () => {
        throw new Error('no page');
      };
      await invokeTool(
        checkBrowserHealth as unknown as ToolDefinitionHarness,
        {},
        res,
      );
      runtime.pageController.getPage = async () => activePage;

      await invokeTool(
        injectStealth as unknown as ToolDefinitionHarness,
        {preset: 'windows-chrome'},
        res,
      );
      await invokeTool(
        listStealthPresets as unknown as ToolDefinitionHarness,
        {},
        res,
      );
      await invokeTool(
        listStealthFeatures as unknown as ToolDefinitionHarness,
        {},
        res,
      );
      await invokeTool(
        setUserAgent as unknown as ToolDefinitionHarness,
        {userAgent: 'ua-test'},
        res,
      );

      await assert.rejects(async () => {
        await invokeTool(
          injectHook as unknown as ToolDefinitionHarness,
          {hookId: 'missing'},
          res,
        );
      });

      assert.ok(res.lines.some(line => line.includes('Hook injected: h1')));
      assert.ok(res.lines.some(line => line.includes('Element clicked.')));
      assert.ok(res.lines.some(line => line.includes('User-Agent updated.')));
      assert.ok(res.lines.some(line => line.includes('"signatureChain"')));
      assert.ok(res.lines.some(line => line.includes('"actionPlan"')));
      assert.ok(res.lines.some(line => line.includes('"requestFingerprints"')));
      assert.ok(res.lines.some(line => line.includes('"priorityTargets"')));
      assert.ok(res.lines.some(line => line.includes('"candidates"')));
      assert.ok(res.lines.some(line => line.includes('"followUpPlan"')));
      assert.ok(
        res.lines.some(line => line.includes('"extract_function_tree"')),
      );
      assert.ok(
        res.lines.some(line => line.includes('"observedFunctionHit": true')),
      );
      assert.ok(
        res.lines.some(line => line.includes('"candidateScriptHit": true')),
      );
      assert.ok(res.lines.some(line => line.includes('"search_in_sources"')));
      assert.ok(res.lines.some(line => line.includes('genH5st')));
      assert.ok(res.lines.some(line => line.includes('"replay"')));
      assert.ok(res.lines.some(line => line.includes('"healthy"')));
      assert.ok(res.lines.some(line => line.includes('BROWSER_DISCONNECTED')));
      assert.ok(res.lines.some(line => line.includes('"unique"')));
      assert.ok(res.lines.some(line => line.includes('"overwritten"')));
      assert.ok(res.lines.some(line => line.includes('"remaining"')));
      assert.ok(res.lines.some(line => line.includes('"bodySnippet"')));
      assert.ok(res.lines.some(line => line.includes('"encrypted": true')));
      assert.ok(res.lines.some(line => line.includes('"cleanedExpired":')));
      assert.ok(res.lines.some(line => line.includes('hook-data-export')));
      assert.ok(res.lines.some(line => line.includes('"method": "WS"')));
      assert.ok(res.lines.some(line => line.includes('"type": "function"')));
    } finally {
      runtime.deobfuscator.deobfuscate = originals.deobfuscate;
      runtime.analyzer.understand = originals.understand;
      runtime.summarizer.summarizeFile = originals.summarizeFile;
      runtime.summarizer.summarizeBatch = originals.summarizeBatch;
      runtime.summarizer.summarizeProject = originals.summarizeProject;
      runtime.cryptoDetector.detect = originals.detectCrypto;
      runtime.collector.collect = originals.collect;
      runtime.collector.getFilesByPattern = originals.getFilesByPattern;
      runtime.collector.getCollectedFilesSummary =
        originals.getCollectedFilesSummary;
      runtime.collector.getTopPriorityFiles = originals.getTopPriorityFiles;
      runtime.domInspector.querySelector = originals.querySelector;
      runtime.domInspector.querySelectorAll = originals.querySelectorAll;
      runtime.domInspector.getStructure = originals.getStructure;
      runtime.domInspector.findClickable = originals.findClickable;
      runtime.hookManager.create = originals.createHook;
      runtime.hookManager.getHook = originals.getHook;
      runtime.hookManager.getAllHooks = originals.getAllHooks;
      runtime.hookManager.getRecords = originals.getRecords;
      runtime.hookManager.exportData = originals.exportData;
      runtime.hookManager.getStats = originals.getStats;
      runtime.hookManager.remove = originals.removeHook;
      runtime.pageController.injectScript = originals.injectScript;
      runtime.pageController.navigate = originals.navigate;
      runtime.pageController.click = originals.click;
      runtime.pageController.hover = originals.hover;
      runtime.pageController.select = originals.select;
      runtime.pageController.scroll = originals.scroll;
      runtime.pageController.type = originals.type;
      runtime.pageController.pressKey = originals.pressKey;
      runtime.pageController.uploadFile = originals.uploadFile;
      runtime.pageController.waitForSelector = originals.waitForSelector;
      runtime.pageController.waitForNetworkIdle = originals.waitForNetworkIdle;
      runtime.pageController.screenshot = originals.screenshot;
      runtime.pageController.getPerformanceMetrics = originals.metrics;
      runtime.pageController.setViewport = originals.setViewport;
      runtime.pageController.emulateDevice = originals.emulateDevice;
      runtime.pageController.getAllLinks = originals.getAllLinks;
      runtime.pageController.getPage = originals.getPage;
      runtime.pageController.getCookies = originals.getCookies;
      runtime.pageController.getLocalStorage = originals.getLocalStorage;
      runtime.pageController.getSessionStorage = originals.getSessionStorage;
      runtime.pageController.clearCookies = originals.clearCookies;
      runtime.pageController.clearLocalStorage = originals.clearLocalStorage;
      runtime.pageController.clearSessionStorage =
        originals.clearSessionStorage;
      runtime.pageController.setCookies = originals.setCookies;
      runtime.pageController.setLocalStorage = originals.setLocalStorage;
      runtime.pageController.setSessionStorage = originals.setSessionStorage;
      runtime.pageController.replayActions = originals.replayActions;
      runtime.pageController.evaluate = originals.evaluate;
      runtime.collector.getActivePage = originals.getActivePage;
      runtime.collector.getStatus = originals.getStatus;
      runtime.browserManager.getConnectedBrowser = originals.getConnectedBrowser;
      stealth.injectAll = originals.injectAll;
      stealth.getPresets = originals.getPresets;
    }
  });
});
