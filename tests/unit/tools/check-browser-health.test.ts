/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert';
import {describe, it} from 'node:test';

import {checkBrowserHealth} from '../../../src/tools/page.js';
import {getJSHookRuntime} from '../../../src/tools/runtime.js';

function makeResponse() {
  return {
    lines: [] as string[],
    appendResponseLine(value: string) {
      this.lines.push(value);
    },
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

describe('check_browser_health', () => {
  it('returns fail status when browser is disconnected', async () => {
    const runtime = getJSHookRuntime() as unknown as {
      browserManager: {getConnectedBrowser(): undefined};
      collector: {getStatus(): Promise<{running: boolean}>};
      pageController: {getPage(): Promise<never>};
    };
    // 双栈合并（2026-09-02）：未初始化主浏览器时 browserManager 为 undefined——
    // 测试补 stub（模拟有 manager 但浏览器未连接）
    const originalBrowserManager = (runtime as {browserManager?: unknown})
      .browserManager;
    (runtime as {browserManager: {getConnectedBrowser(): undefined}})
      .browserManager = {
      getConnectedBrowser: () => undefined,
    };
    const response = makeResponse();
    const context = {
      getSelectedPage: () => {
        throw new Error('no page');
      },
      getPageByIdx: () => {
        throw new Error('no page');
      },
      getPageByOptionalIdx: () => {
        throw new Error('no page');
      },
    };

    const originalGetBrowser = runtime.browserManager.getConnectedBrowser;
    const originalGetStatus = runtime.collector.getStatus;
    const originalGetPage = runtime.pageController.getPage;

    runtime.browserManager.getConnectedBrowser = () => undefined;
    runtime.collector.getStatus = async () => ({running: false});
    runtime.pageController.getPage = async () => {
      throw new Error('No active page');
    };

    try {
      await checkBrowserHealth.handler(
        {params: {}},
        response as unknown as Parameters<typeof checkBrowserHealth.handler>[1],
        context as unknown as Parameters<typeof checkBrowserHealth.handler>[2],
      );
    } finally {
      runtime.browserManager.getConnectedBrowser = originalGetBrowser;
      runtime.collector.getStatus = originalGetStatus;
      runtime.pageController.getPage = originalGetPage;
      (runtime as {browserManager?: unknown}).browserManager =
        originalBrowserManager;
    }

    const parsed = JSON.parse(response.lines[1] ?? '{}') as {
      status: string;
      healthy: boolean;
      recommendations: string[];
      issues: Array<{code: string; message: string}>;
    };

    assert.strictEqual(parsed.status, 'fail');
    assert.strictEqual(parsed.healthy, false);
    assert.ok(parsed.recommendations.length > 0);
    assert.ok(parsed.issues.some(item => item.code === 'BROWSER_DISCONNECTED'));
  });
});
