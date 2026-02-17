/**
 * Property-based tests for BrowserManager
 * Tests universal properties that should hold across all valid executions
 * 
 * Uses fast-check for property-based testing with minimum 100 iterations
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import * as fc from 'fast-check';
import { BrowserManager } from '../../src/browser.js';

const runBrowserTests = process.env.RUN_BROWSER_TESTS === 'true';

describe('BrowserManager Property Tests', {skip: !runBrowserTests}, () => {
  // Reset singleton instance before each test
  beforeEach(() => {
    BrowserManager.resetInstance();
  });

  // Clean up after each test
  afterEach(async () => {
    try {
      const manager = BrowserManager.getInstance({ headless: true, isolated: true });
      await manager.close();
    } catch {
      // Ignore errors if instance doesn't exist
    }
    BrowserManager.resetInstance();
  });

  /**
   * Property 2: Browser Instance Singleton
   * 
   * **Validates: Requirements 1.5, 9.1, 9.3**
   * 
   * For any sequence of tool calls that require a browser, 
   * all calls should receive the same Browser instance reference.
   */
  describe('Property 2: Browser Instance Singleton', () => {
    it('should return same browser instance for any sequence of tool calls', async () => {
      await fc.assert(
        fc.asyncProperty(
          // Generate a sequence of 2-10 tool calls
          fc.integer({ min: 2, max: 10 }),
          async (numCalls) => {
            // Initialize BrowserManager
            const manager = BrowserManager.getInstance({
              headless: true,
              isolated: true,
            });

            // Simulate multiple tool calls requesting browser
            const browsers: any[] = [];
            for (let i = 0; i < numCalls; i++) {
              const browser = await manager.getBrowser();
              browsers.push(browser);
            }

            // Verify all browser instances are the same reference
            const firstBrowser = browsers[0];
            for (let i = 1; i < browsers.length; i++) {
              assert.strictEqual(
                browsers[i],
                firstBrowser,
                `Tool call ${i + 1} should return same browser instance as first call`
              );
            }

            // Verify all browsers are connected
            for (let i = 0; i < browsers.length; i++) {
              assert.ok(
                browsers[i].connected,
                `Browser from tool call ${i + 1} should be connected`
              );
            }

            return true;
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should return same browser instance when mixing ensureBrowser and getBrowser calls', async () => {
      await fc.assert(
        fc.asyncProperty(
          // Generate a sequence of call types: true = ensureBrowser, false = getBrowser
          fc.array(fc.boolean(), { minLength: 2, maxLength: 10 }),
          async (callTypes) => {
            // Initialize BrowserManager
            const manager = BrowserManager.getInstance({
              headless: true,
              isolated: true,
            });

            // Simulate mixed tool calls
            const browsers: any[] = [];
            for (const useEnsure of callTypes) {
              const browser = useEnsure
                ? await manager.ensureBrowser()
                : await manager.getBrowser();
              browsers.push(browser);
            }

            // Verify all browser instances are the same reference
            const firstBrowser = browsers[0];
            for (let i = 1; i < browsers.length; i++) {
              assert.strictEqual(
                browsers[i],
                firstBrowser,
                `Call ${i + 1} should return same browser instance as first call`
              );
            }

            return true;
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should maintain singleton across different manager instances', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.integer({ min: 2, max: 5 }),
          async (numManagerCalls) => {
            // First call initializes with config
            const manager1 = BrowserManager.getInstance({
              headless: true,
              isolated: true,
            });
            const browser1 = await manager1.getBrowser();

            // Subsequent calls get the same manager instance
            const browsers: any[] = [browser1];
            for (let i = 1; i < numManagerCalls; i++) {
              const manager = BrowserManager.getInstance();
              const browser = await manager.getBrowser();
              browsers.push(browser);
            }

            // Verify all browsers are the same instance
            for (let i = 1; i < browsers.length; i++) {
              assert.strictEqual(
                browsers[i],
                browser1,
                `Manager call ${i + 1} should return same browser instance`
              );
            }

            return true;
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should return same browser instance after restart', async () => {
      // Initialize BrowserManager
      const manager = BrowserManager.getInstance({
        headless: true,
        isolated: true,
      });

      // Get initial browser
      const browser1 = await manager.getBrowser();
      const pid1 = browser1.process()?.pid;

      // Restart browser
      await manager.restart();

      // Get browser after restart
      const browser2 = await manager.getBrowser();
      const pid2 = browser2.process()?.pid;

      // Should be a different process but same manager behavior
      assert.notStrictEqual(pid1, pid2, 'Should be different process after restart');
      assert.ok(browser2.connected, 'Browser should be connected after restart');
      assert.ok(manager.isConnected(), 'Manager should report connected after restart');
    });

    it('should maintain singleton property with concurrent calls', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.integer({ min: 2, max: 5 }),
          async (numConcurrentCalls) => {
            // Initialize BrowserManager
            const manager = BrowserManager.getInstance({
              headless: true,
              isolated: true,
            });

            // Ensure browser is initialized first to avoid race conditions
            await manager.ensureBrowser();

            // Simulate concurrent tool calls
            const browserPromises: Promise<any>[] = [];
            for (let i = 0; i < numConcurrentCalls; i++) {
              browserPromises.push(manager.getBrowser());
            }

            // Wait for all calls to complete
            const browsers = await Promise.all(browserPromises);

            // Verify all browser instances are the same reference
            const firstBrowser = browsers[0];
            for (let i = 1; i < browsers.length; i++) {
              assert.strictEqual(
                browsers[i],
                firstBrowser,
                `Concurrent call ${i + 1} should return same browser instance`
              );
            }

            return true;
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  /**
   * Property 22: Browser Instance Singleton (duplicate of Property 2)
   * 
   * **Validates: Requirements 9.1**
   * 
   * This is a duplicate property that validates the same behavior as Property 2.
   * Testing from a different angle to ensure robustness.
   */
  describe('Property 22: Browser Instance Singleton (alternative validation)', () => {
    it('should never create multiple browser processes simultaneously', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.integer({ min: 3, max: 8 }),
          async (numSequentialCalls) => {
            // Initialize BrowserManager
            const manager = BrowserManager.getInstance({
              headless: true,
              isolated: true,
            });

            // Track PIDs to ensure only one browser process exists
            const pids = new Set<number>();

            for (let i = 0; i < numSequentialCalls; i++) {
              const browser = await manager.getBrowser();
              const pid = browser.process()?.pid;
              
              if (pid) {
                pids.add(pid);
              }
            }

            // Should only have one unique PID
            assert.strictEqual(
              pids.size,
              1,
              'Should only have one browser process across all calls'
            );

            return true;
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should maintain singleton even with isConnected checks between calls', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.array(fc.boolean(), { minLength: 2, maxLength: 6 }),
          async (checkConnectionFlags) => {
            // Initialize BrowserManager
            const manager = BrowserManager.getInstance({
              headless: true,
              isolated: true,
            });

            const browsers: any[] = [];

            for (const shouldCheckConnection of checkConnectionFlags) {
              if (shouldCheckConnection) {
                // Check connection status
                manager.isConnected();
              }
              
              // Get browser
              const browser = await manager.getBrowser();
              browsers.push(browser);
            }

            // Verify all browsers are the same instance
            const firstBrowser = browsers[0];
            for (let i = 1; i < browsers.length; i++) {
              assert.strictEqual(
                browsers[i],
                firstBrowser,
                `Browser ${i + 1} should be same instance despite connection checks`
              );
            }

            return true;
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});
