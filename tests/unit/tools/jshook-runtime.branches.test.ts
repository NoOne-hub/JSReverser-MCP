/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import assert from 'node:assert';
import {describe, it} from 'node:test';

import {BrowserManager} from '../../../src/browser.js';

async function importFreshRuntime(tag: string) {
  return import(`../../../src/tools/runtime.js?branch=${tag}_${Date.now()}`);
}

describe('jshook runtime branch coverage', () => {
  it('bootstraps runtime and reuses the main BrowserManager singleton', async () => {
    const originalPort = process.env.REMOTE_DEBUGGING_PORT;
    const originalHeadless = process.env.BROWSER_HEADLESS;
    const originalStealth = process.env.USE_STEALTH_SCRIPTS;
    BrowserManager.resetInstance();
    try {
      delete process.env.REMOTE_DEBUGGING_PORT;
      delete process.env.BROWSER_HEADLESS;
      process.env.USE_STEALTH_SCRIPTS = 'true';
      const runtimeDefault = await importFreshRuntime('default');
      const defaultInstance = runtimeDefault.getJSHookRuntime();
      // 双栈合并（2026-09-02）：未初始化主浏览器时 browserManager 为 undefined，
      // 不抛错（CLI 命令等场景可用 runtime 的非浏览器能力）
      assert.strictEqual(defaultInstance.browserManager, undefined);
      assert.ok(defaultInstance.collector);

      // 主浏览器初始化后，runtime 复用同一单例
      BrowserManager.getInstance({headless: true, isolated: true});
      const runtimeMain = await importFreshRuntime('main');
      const mainInstance = runtimeMain.getJSHookRuntime();
      assert.ok(mainInstance.browserManager);
    } finally {
      process.env.REMOTE_DEBUGGING_PORT = originalPort;
      process.env.BROWSER_HEADLESS = originalHeadless;
      process.env.USE_STEALTH_SCRIPTS = originalStealth;
      BrowserManager.resetInstance();
    }
  });
});
