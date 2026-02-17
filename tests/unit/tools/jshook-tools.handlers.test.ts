import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  analyzeTarget,
  deobfuscateCode,
  detectCrypto,
  exportSessionReport,
  riskPanel,
  summarizeCode,
  understandCode,
} from '../../../src/tools/jshook/analyzer.js';
import { collectCode, collectionDiff, searchInScripts } from '../../../src/tools/jshook/collector.js';
import { findClickableElements, getDomStructure, queryDom } from '../../../src/tools/jshook/dom.js';
import { createHook, getHookData, injectHook, listHooks, removeHook } from '../../../src/tools/jshook/hook.js';
import {
  clickElement,
  getPerformanceMetrics,
  navigatePage as navigateJSHookPage,
  takeScreenshot,
  typeText,
  waitForElement,
} from '../../../src/tools/jshook/page.js';
import { getJSHookRuntime } from '../../../src/tools/jshook/runtime.js';
import {
  injectStealth,
  listStealthFeatures,
  listStealthPresets,
  setUserAgent,
} from '../../../src/tools/jshook/stealth.js';
import { StealthScripts2025 } from '../../../src/modules/stealth/StealthScripts2025.js';

function makeResponse() {
  const lines: string[] = [];
  return {
    lines,
    appendResponseLine: (v: string) => lines.push(v),
    setIncludePages: () => {},
    setIncludeNetworkRequests: () => {},
    setIncludeConsoleData: () => {},
    attachImage: () => {},
    attachNetworkRequest: () => {},
    attachConsoleMessage: () => {},
    setIncludeWebSocketConnections: () => {},
    attachWebSocket: () => {},
  };
}

describe('jshook tools handlers', () => {
  it('covers analyzer/collector/dom/hook/page/stealth handlers', async () => {
    const runtime = getJSHookRuntime() as any;

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
      type: runtime.pageController.type,
      waitForSelector: runtime.pageController.waitForSelector,
      screenshot: runtime.pageController.screenshot,
      metrics: runtime.pageController.getPerformanceMetrics,
      getActivePage: runtime.collector.getActivePage,
      injectAll: (StealthScripts2025 as any).injectAll,
      getPresets: (StealthScripts2025 as any).getPresets,
    };

    runtime.deobfuscator.deobfuscate = async () => ({
      code: 'deobf',
      readabilityScore: 72,
      confidence: 0.91,
      obfuscationType: ['unknown'],
      transformations: [{ type: 'noop', description: 'x', success: true }],
      analysis: 'ok',
    });
    runtime.analyzer.understand = async () => ({ ok: true, mode: 'understand', qualityScore: 88, securityRisks: [] });
    runtime.summarizer.summarizeFile = async () => ({ scope: 'single' });
    runtime.summarizer.summarizeBatch = async () => ({ scope: 'batch' });
    runtime.summarizer.summarizeProject = async () => ({ scope: 'project' });
    runtime.cryptoDetector.detect = async () => ({
      algorithms: [{ name: 'MD5', confidence: 0.9 }],
      libraries: [],
      confidence: 0.9,
      securityIssues: [],
    });

    runtime.collector.collect = async () => ({ files: [{ url: 'a.js' }] });
    runtime.collector.getFilesByPattern = () => [{ url: 'b.js' }];
    runtime.collector.getCollectedFilesSummary = () => [{ url: 'b.js', size: 10, type: 'external' }];
    runtime.collector.getTopPriorityFiles = () => ({
      files: [{
        url: 'top.js',
        content: 'function signPayload(token, nonce){ return token + nonce; }\nfetch("/api/order/sign", {method:"POST"});',
        size: 120,
        type: 'external',
      }],
      totalSize: 1,
      totalFiles: 1,
    });

    runtime.domInspector.querySelector = async () => ({ found: true, nodeName: 'DIV' });
    runtime.domInspector.querySelectorAll = async () => [{ found: true, nodeName: 'SPAN' }];
    runtime.domInspector.getStructure = async () => ({ tag: 'BODY' });
    runtime.domInspector.findClickable = async () => [{ selector: '#x', text: 'x', type: 'button', visible: true }];

    let hookCounter = 0;
    const baseTs = Date.now();
    runtime.hookManager.create = ({ type }: { type: string }) => {
      hookCounter += 1;
      return {
        hookId: hookCounter === 1 ? 'h1' : `${type}-hook-${hookCounter}`,
        script: `/* ${type} hook */`,
      };
    };
    runtime.hookManager.getHook = (id: string) => (id === 'missing' ? undefined : { hookId: id, script: 'console.log(1)' });
    runtime.hookManager.getAllHooks = () => [{ hookId: 'h1' }, { hookId: 'xhr-hook-2' }, { hookId: 'websocket-hook-3' }];
    runtime.hookManager.getRecords = (hookId: string) => {
      if (hookId.includes('xhr')) {
        return [{
          id: 11,
          target: 'xhr',
          event: 'open',
          timestamp: baseTs + 120,
        }];
      }
      if (hookId.includes('websocket')) {
        return [{
          id: 12,
          target: 'websocket',
          url: 'wss://api.example.com/ws/sign?nonce=1',
          event: 'send',
          data: '{"token":"ws-token"}',
          timestamp: baseTs + 150,
        }];
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
    };
    runtime.hookManager.exportData = () => ({ all: true });
    runtime.hookManager.getStats = () => ({
      totalHooks: 1,
      enabledHooks: 1,
      disabledHooks: 0,
      registeredTypes: ['fetch'],
      hooks: [{ hookId: 'h1', type: 'fetch', description: 'd', enabled: true, callCount: 1 }],
    });
    runtime.hookManager.remove = (id: string) => id === 'h1';

    runtime.pageController.injectScript = async () => {};
    runtime.pageController.navigate = async () => ({ ok: true, url: 'https://a.com' });
    runtime.pageController.click = async () => {};
    runtime.pageController.type = async () => {};
    runtime.pageController.waitForSelector = async () => ({ found: true });
    runtime.pageController.screenshot = async () => Buffer.from('shot');
    runtime.pageController.getPerformanceMetrics = async () => ({ fcp: 100 });

    const activePage = {
      setUserAgent: async () => {},
    };
    runtime.collector.getActivePage = async () => activePage;

    (StealthScripts2025 as any).injectAll = async () => {};
    (StealthScripts2025 as any).getPresets = () => ({ 'windows-chrome': { preset: 'windows-chrome' } });

    try {
      const res = makeResponse();

      await deobfuscateCode.handler({ params: { code: 'x' } } as any, res as any, {} as any);
      await understandCode.handler({ params: { code: 'x', focus: 'all' } } as any, res as any, {} as any);

      await summarizeCode.handler({ params: { mode: 'single', code: 'const x=1;' } } as any, res as any, {} as any);
      await summarizeCode.handler({ params: { mode: 'batch', files: [] } } as any, res as any, {} as any);
      await summarizeCode.handler({ params: { mode: 'project', files: [] } } as any, res as any, {} as any);

      await detectCrypto.handler({ params: { code: 'md5(x)' } } as any, res as any, {} as any);
      await analyzeTarget.handler({ params: { url: 'https://example.com', hookPreset: 'api-signature' } } as any, res as any, {} as any);
      runtime.collector.collect = async () => null;
      await analyzeTarget.handler({
        params: { url: 'https://example.com', hookPreset: 'none', autoInjectHooks: false },
      } as any, res as any, {} as any);
      runtime.collector.collect = async () => ({ files: 'bad-shape' });
      await analyzeTarget.handler({
        params: { url: 'https://example.com', hookPreset: 'none', autoInjectHooks: false },
      } as any, res as any, {} as any);
      runtime.collector.collect = async () => ({ files: [{ url: 'a.js' }] });
      runtime.collector.getTopPriorityFiles = () => ({ files: [], totalSize: 0, totalFiles: 0 });
      await analyzeTarget.handler({
        params: {
          url: 'https://example.com',
          hookPreset: 'none',
          autoInjectHooks: false,
          runDeobfuscation: true,
          correlationWindowMs: 500,
          maxCorrelatedFlows: 3,
        },
      } as any, res as any, {} as any);
      runtime.collector.getTopPriorityFiles = () => ({
        files: [{
          url: 'top-sign.js',
          content: 'function signOnly(token, nonce){ return `${token}:${nonce}`; }',
          size: 64,
          type: 'external',
        }],
        totalSize: 64,
        totalFiles: 1,
      });
      await analyzeTarget.handler({
        params: {
          url: 'https://example.com',
          hookPreset: 'none',
          autoInjectHooks: false,
          waitAfterHookMs: 1,
          maxFingerprints: 4,
        },
      } as any, res as any, {} as any);
      await riskPanel.handler({ params: { code: 'md5(x)' } } as any, res as any, {} as any);
      await riskPanel.handler({ params: { hookId: 'h1' } } as any, res as any, {} as any);
      await riskPanel.handler({ params: { hookId: 'h1', includeHookSignals: false } } as any, res as any, {} as any);
      runtime.collector.getTopPriorityFiles = () => ({ files: [], totalSize: 0, totalFiles: 0 });
      await assert.rejects(async () => {
        await riskPanel.handler({ params: {} } as any, res as any, {} as any);
      });
      runtime.collector.getTopPriorityFiles = () => ({
        files: [{ url: 'top.js', content: 'x', size: 1, type: 'external' }],
        totalSize: 1,
        totalFiles: 1,
      });
      await exportSessionReport.handler({ params: { format: 'json' } } as any, res as any, {} as any);
      await exportSessionReport.handler({ params: { format: 'markdown', includeHookData: true } } as any, res as any, {} as any);

      await collectCode.handler({ params: { url: 'https://example.com' } } as any, res as any, {} as any);
      await collectCode.handler({ params: { url: 'https://example.com', returnMode: 'summary' } } as any, res as any, {} as any);
      await collectCode.handler({ params: { url: 'https://example.com', returnMode: 'pattern', pattern: 'b' } } as any, res as any, {} as any);
      await collectCode.handler({ params: { url: 'https://example.com', returnMode: 'top-priority' } } as any, res as any, {} as any);
      await searchInScripts.handler({ params: { pattern: 'abc', limit: 1 } } as any, res as any, {} as any);
      await collectionDiff.handler({
        params: { previous: [{ url: 'old.js', size: 1, type: 'external' }], includeUnchanged: true },
      } as any, res as any, {} as any);
      await collectionDiff.handler({
        params: {
          previous: [
            { url: 'a.js', size: 1, type: 'external' },
            { url: 'same.js', size: 2, type: 'external' },
          ],
          current: [
            { url: 'a.js', size: 3, type: 'external' },
            { url: 'same.js', size: 2, type: 'external' },
          ],
          includeUnchanged: true,
        },
      } as any, res as any, {} as any);

      await queryDom.handler({ params: { selector: '#x', all: false } } as any, res as any, {} as any);
      await queryDom.handler({ params: { selector: '.x', all: true, limit: 2 } } as any, res as any, {} as any);
      await getDomStructure.handler({ params: { maxDepth: 2, includeText: true } } as any, res as any, {} as any);
      await findClickableElements.handler({ params: { filterText: 'x' } } as any, res as any, {} as any);

      await createHook.handler({ params: { type: 'fetch' } } as any, res as any, {} as any);
      await injectHook.handler({ params: { hookId: 'h1' } } as any, res as any, {} as any);
      await listHooks.handler({ params: {} } as any, res as any, {} as any);
      await getHookData.handler({ params: { hookId: 'h1' } } as any, res as any, {} as any);
      await getHookData.handler({ params: {} } as any, res as any, {} as any);
      await removeHook.handler({ params: { hookId: 'h1' } } as any, res as any, {} as any);
      await removeHook.handler({ params: { hookId: 'missing' } } as any, res as any, {} as any);

      await navigateJSHookPage.handler({ params: { url: 'https://a.com', timeout: 1000 } } as any, res as any, {} as any);
      await clickElement.handler({ params: { selector: '#x' } } as any, res as any, {} as any);
      await typeText.handler({ params: { selector: '#x', text: 'abc', delay: 10 } } as any, res as any, {} as any);
      await waitForElement.handler({ params: { selector: '#x', timeout: 100 } } as any, res as any, {} as any);
      await takeScreenshot.handler({ params: { type: 'png', fullPage: true } } as any, res as any, {} as any);
      await getPerformanceMetrics.handler({ params: {} } as any, res as any, {} as any);

      await injectStealth.handler({ params: { preset: 'windows-chrome' } } as any, res as any, {} as any);
      await listStealthPresets.handler({ params: {} } as any, res as any, {} as any);
      await listStealthFeatures.handler({ params: {} } as any, res as any, {} as any);
      await setUserAgent.handler({ params: { userAgent: 'ua-test' } } as any, res as any, {} as any);

      await assert.rejects(async () => {
        await injectHook.handler({ params: { hookId: 'missing' } } as any, res as any, {} as any);
      });

      assert.ok(res.lines.some((line) => line.includes('Hook injected: h1')));
      assert.ok(res.lines.some((line) => line.includes('Element clicked.')));
      assert.ok(res.lines.some((line) => line.includes('User-Agent updated.')));
      assert.ok(res.lines.some((line) => line.includes('Screenshot taken')));
      assert.ok(res.lines.some((line) => line.includes('"signatureChain"')));
      assert.ok(res.lines.some((line) => line.includes('"actionPlan"')));
      assert.ok(res.lines.some((line) => line.includes('"requestFingerprints"')));
      assert.ok(res.lines.some((line) => line.includes('"priorityTargets"')));
      assert.ok(res.lines.some((line) => line.includes('"method": "WS"')));
      assert.ok(res.lines.some((line) => line.includes('"type": "function"')));
    } finally {
      runtime.deobfuscator.deobfuscate = originals.deobfuscate;
      runtime.analyzer.understand = originals.understand;
      runtime.summarizer.summarizeFile = originals.summarizeFile;
      runtime.summarizer.summarizeBatch = originals.summarizeBatch;
      runtime.summarizer.summarizeProject = originals.summarizeProject;
      runtime.cryptoDetector.detect = originals.detectCrypto;
      runtime.collector.collect = originals.collect;
      runtime.collector.getFilesByPattern = originals.getFilesByPattern;
      runtime.collector.getCollectedFilesSummary = originals.getCollectedFilesSummary;
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
      runtime.pageController.type = originals.type;
      runtime.pageController.waitForSelector = originals.waitForSelector;
      runtime.pageController.screenshot = originals.screenshot;
      runtime.pageController.getPerformanceMetrics = originals.metrics;
      runtime.collector.getActivePage = originals.getActivePage;
      (StealthScripts2025 as any).injectAll = originals.injectAll;
      (StealthScripts2025 as any).getPresets = originals.getPresets;
    }
  });
});
