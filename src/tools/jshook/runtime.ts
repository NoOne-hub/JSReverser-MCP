import {BrowserModeManager} from '../../modules/browser/BrowserModeManager.js';
import {CodeCollector} from '../../modules/collector/CodeCollector.js';
import {DOMInspector} from '../../modules/collector/DOMInspector.js';
import {PageController} from '../../modules/collector/PageController.js';
import {HookManager} from '../../modules/hook/HookManager.js';
import {CodeAnalyzer} from '../../modules/analyzer/CodeAnalyzer.js';
import {AISummarizer} from '../../modules/analyzer/AISummarizer.js';
import {Deobfuscator} from '../../modules/deobfuscator/Deobfuscator.js';
import {CryptoDetector} from '../../modules/crypto/CryptoDetector.js';
import {LLMService} from '../../services/LLMService.js';
import {DetailedDataManager} from '../../utils/detailedDataManager.js';
import {UnifiedCacheManager} from '../../utils/UnifiedCacheManager.js';
import {
  CodeCacheAdapter,
  CodeCompressorAdapter,
  DetailedDataManagerAdapter,
} from '../../utils/CacheAdapters.js';
import {getBrowserConfig} from '../../utils/config.js';
import type {PuppeteerConfig} from '../../types/index.js';

let runtime: JSHookRuntime | undefined;

export interface JSHookRuntime {
  browserManager: BrowserModeManager;
  collector: CodeCollector;
  domInspector: DOMInspector;
  pageController: PageController;
  hookManager: HookManager;
  llmService: LLMService;
  analyzer: CodeAnalyzer;
  summarizer: AISummarizer;
  deobfuscator: Deobfuscator;
  cryptoDetector: CryptoDetector;
}

function toCollectorConfig(): PuppeteerConfig {
  const browser = getBrowserConfig();
  return {
    headless: browser.headless ?? true,
    timeout: 30000,
    remoteDebuggingUrl: browser.remoteDebuggingUrl,
    useStealthScripts: browser.useStealthScripts,
  };
}

export function getJSHookRuntime(): JSHookRuntime {
  if (runtime) {
    return runtime;
  }

  const browserManager = new BrowserModeManager({
    remoteDebuggingUrl: process.env.REMOTE_DEBUGGING_URL,
    remoteDebuggingPort: process.env.REMOTE_DEBUGGING_PORT
      ? Number(process.env.REMOTE_DEBUGGING_PORT)
      : 9222,
    useStealthScripts: process.env.USE_STEALTH_SCRIPTS !== 'false',
    autoLaunch: true,
  });

  const collector = new CodeCollector(toCollectorConfig(), browserManager);
  const domInspector = new DOMInspector(collector);
  const pageController = new PageController(collector);
  const hookManager = new HookManager();
  const llmService = new LLMService();
  const detailedDataManager = DetailedDataManager.getInstance();
  const unifiedCacheManager = UnifiedCacheManager.getInstance();

  unifiedCacheManager.registerCache(new DetailedDataManagerAdapter(detailedDataManager));
  unifiedCacheManager.registerCache(new CodeCacheAdapter(collector.getCache()));
  unifiedCacheManager.registerCache(new CodeCompressorAdapter(collector.getCompressor()));

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
  };

  return runtime;
}
