/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import {AISummarizer} from '../modules/analyzer/AISummarizer.js';
import {CodeAnalyzer} from '../modules/analyzer/CodeAnalyzer.js';
import {
  getBrowserManager,
  type BrowserManager,
} from '../browser.js';
import {CodeCollector} from '../modules/collector/CodeCollector.js';
import {DOMInspector} from '../modules/collector/DOMInspector.js';
import {PageController} from '../modules/collector/PageController.js';
import {CryptoDetector} from '../modules/crypto/CryptoDetector.js';
import {Deobfuscator} from '../modules/deobfuscator/Deobfuscator.js';
import {HookManager} from '../modules/hook/HookManager.js';
import {ReverseTaskStore} from '../reverse/ReverseTaskStore.js';
import {LLMService} from '../services/LLMService.js';
import type {Page} from '../third_party/index.js';
import type {PuppeteerConfig} from '../types/index.js';
import {
  CodeCacheAdapter,
  CodeCompressorAdapter,
  DetailedDataManagerAdapter,
} from '../utils/CacheAdapters.js';
import {getBrowserConfig} from '../utils/config.js';
import {DetailedDataManager} from '../utils/detailedDataManager.js';
import {UnifiedCacheManager} from '../utils/UnifiedCacheManager.js';

let runtime: JSHookRuntime | undefined;

export interface JSHookRuntime {
  /** 主浏览器管理器（主栈单例；CLI 命令等未启动浏览器的场景为 undefined，使用方判空） */
  browserManager: BrowserManager | undefined;
  collector: CodeCollector;
  domInspector: DOMInspector;
  pageController: PageController;
  hookManager: HookManager;
  llmService: LLMService;
  analyzer: CodeAnalyzer;
  summarizer: AISummarizer;
  deobfuscator: Deobfuscator;
  cryptoDetector: CryptoDetector;
  reverseTaskStore: ReverseTaskStore;
  bindPageContext: (resolver: () => Page) => void;
  syncPageContext: (page: Page) => void;
  clearPageContext: () => void;
}

function toCollectorConfig(): PuppeteerConfig {
  const browser = getBrowserConfig();
  return {
    headless: browser.headless!,
    timeout: 30000,
    remoteDebuggingUrl: browser.remoteDebuggingUrl,
    useStealthScripts: browser.useStealthScripts,
  };
}

export function getJSHookRuntime(): JSHookRuntime {
  if (runtime) {
    return runtime;
  }

  // 双栈合并（2026-09-02）：采集栈直接复用主栈 BrowserManager 单例——
  // 不再自启/自连第二浏览器，消除 --isolated 状态分裂。MCP 主模式在
  // getContext()（getBrowserManager 已初始化）之后才首次触达 runtime。
  const browserManager = getBrowserManager();

  const collector = new CodeCollector(toCollectorConfig(), browserManager);
  const domInspector = new DOMInspector(collector);
  const pageController = new PageController(collector);
  const hookManager = new HookManager();
  const llmService = new LLMService();
  const detailedDataManager = DetailedDataManager.getInstance();
  const unifiedCacheManager = UnifiedCacheManager.getInstance();
  const reverseTaskStore = new ReverseTaskStore();

  unifiedCacheManager.registerCache(
    new DetailedDataManagerAdapter(detailedDataManager),
  );
  unifiedCacheManager.registerCache(new CodeCacheAdapter(collector.getCache()));
  unifiedCacheManager.registerCache(
    new CodeCompressorAdapter(collector.getCompressor()),
  );

  runtime = {
    browserManager,
    collector,
    domInspector,
    pageController,
    hookManager,
    llmService,
    analyzer: new CodeAnalyzer(llmService),
    summarizer: new AISummarizer(llmService),
    deobfuscator: new Deobfuscator(llmService),
    cryptoDetector: new CryptoDetector(llmService),
    reverseTaskStore,
    bindPageContext: resolver => {
      collector.setPageResolver(() => resolver());
    },
    syncPageContext: page => {
      collector.setPageResolver(() => page);
      browserManager?.setCurrentPage(page);
    },
    clearPageContext: () => {
      collector.setPageResolver(undefined);
      browserManager?.setCurrentPage(null);
    },
  };

  return runtime;
}
