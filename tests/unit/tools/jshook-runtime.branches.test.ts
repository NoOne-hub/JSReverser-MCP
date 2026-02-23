import {describe, it} from 'node:test';
import assert from 'node:assert';

async function importFreshRuntime(tag: string) {
  return import(`../../../src/tools/jshook/runtime.js?branch=${tag}_${Date.now()}`);
}

describe('jshook runtime branch coverage', () => {
  it('covers default and explicit env branches in runtime bootstrap', async () => {
    const originalPort = process.env.REMOTE_DEBUGGING_PORT;
    const originalHeadless = process.env.BROWSER_HEADLESS;
    const originalStealth = process.env.USE_STEALTH_SCRIPTS;
    try {
      delete process.env.REMOTE_DEBUGGING_PORT;
      delete process.env.BROWSER_HEADLESS;
      process.env.USE_STEALTH_SCRIPTS = 'true';
      const runtimeDefault = await importFreshRuntime('default');
      const defaultInstance = runtimeDefault.getJSHookRuntime();
      assert.ok(defaultInstance.browserManager);

      process.env.REMOTE_DEBUGGING_PORT = '9333';
      process.env.BROWSER_HEADLESS = 'false';
      process.env.USE_STEALTH_SCRIPTS = 'false';
      const runtimeExplicit = await importFreshRuntime('explicit');
      const explicitInstance = runtimeExplicit.getJSHookRuntime();
      assert.ok(explicitInstance.browserManager);
    } finally {
      process.env.REMOTE_DEBUGGING_PORT = originalPort;
      process.env.BROWSER_HEADLESS = originalHeadless;
      process.env.USE_STEALTH_SCRIPTS = originalStealth;
    }
  });
});
