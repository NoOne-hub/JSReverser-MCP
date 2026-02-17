/**
 * Unit tests for BrowserManager
 * Tests browser launch, close, singleton pattern, and crash recovery
 * 
 * Requirements: 9.1, 9.2, 9.3, 9.4, 9.7
 */

import { describe, it, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert';
import { BrowserManager } from '../../../src/browser.js';
import type { Browser } from '../../../src/third_party/index.js';

const runBrowserTests = process.env.RUN_BROWSER_TESTS === 'true';

describe('BrowserManager', {skip: !runBrowserTests}, () => {
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

  describe('Singleton Pattern (Requirement 9.1, 9.2)', () => {
    it('should return the same instance when called multiple times', () => {
      const manager1 = BrowserManager.getInstance({
        headless: true,
        isolated: true,
      });
      const manager2 = BrowserManager.getInstance();

      assert.strictEqual(manager1, manager2, 'Should return the same instance');
    });

    it('should throw error if getInstance called without config on first call', () => {
      assert.throws(
        () => {
          BrowserManager.getInstance();
        },
        {
          message: /BrowserManager must be initialized with config on first call/,
        }
      );
    });

    it('should allow getInstance without config after initialization', () => {
      const manager1 = BrowserManager.getInstance({
        headless: true,
        isolated: true,
      });
      
      // Should not throw
      const manager2 = BrowserManager.getInstance();
      
      assert.strictEqual(manager1, manager2);
    });

    it('should reset instance with resetInstance method', () => {
      const manager1 = BrowserManager.getInstance({
        headless: true,
        isolated: true,
      });

      BrowserManager.resetInstance();

      // After reset, should require config again
      assert.throws(
        () => {
          BrowserManager.getInstance();
        },
        {
          message: /BrowserManager must be initialized with config on first call/,
        }
      );
    });
  });

  describe('Browser Launch and Close (Requirement 9.1, 9.7)', () => {
    it('should launch browser successfully', async () => {
      const manager = BrowserManager.getInstance({
        headless: true,
        isolated: true,
      });

      const browser = await manager.ensureBrowser();

      assert.ok(browser, 'Browser should be launched');
      assert.ok(browser.connected, 'Browser should be connected');
    });

    it('should return same browser instance on multiple ensureBrowser calls', async () => {
      const manager = BrowserManager.getInstance({
        headless: true,
        isolated: true,
      });

      const browser1 = await manager.ensureBrowser();
      const browser2 = await manager.ensureBrowser();

      assert.strictEqual(browser1, browser2, 'Should return same browser instance');
    });

    it('should return same browser instance via getBrowser', async () => {
      const manager = BrowserManager.getInstance({
        headless: true,
        isolated: true,
      });

      const browser1 = await manager.ensureBrowser();
      const browser2 = await manager.getBrowser();

      assert.strictEqual(browser1, browser2, 'getBrowser should return same instance');
    });

    it('should close browser successfully', async () => {
      const manager = BrowserManager.getInstance({
        headless: true,
        isolated: true,
      });

      await manager.ensureBrowser();
      assert.ok(manager.isConnected(), 'Browser should be connected before close');

      await manager.close();
      assert.ok(!manager.isConnected(), 'Browser should be disconnected after close');
    });

    it('should handle close when browser is not launched', async () => {
      const manager = BrowserManager.getInstance({
        headless: true,
        isolated: true,
      });

      // Should not throw
      await manager.close();
      assert.ok(!manager.isConnected());
    });

    it('should launch browser with custom config', async () => {
      const manager = BrowserManager.getInstance({
        headless: true,
        isolated: true,
        channel: 'stable',
        devtools: false,
      });

      const browser = await manager.ensureBrowser();

      assert.ok(browser.connected);
    });
  });

  describe('Connection Status (Requirement 9.1)', () => {
    it('should return false when browser is not launched', () => {
      const manager = BrowserManager.getInstance({
        headless: true,
        isolated: true,
      });

      assert.strictEqual(manager.isConnected(), false);
    });

    it('should return true when browser is connected', async () => {
      const manager = BrowserManager.getInstance({
        headless: true,
        isolated: true,
      });

      await manager.ensureBrowser();

      assert.strictEqual(manager.isConnected(), true);
    });

    it('should return false after browser is closed', async () => {
      const manager = BrowserManager.getInstance({
        headless: true,
        isolated: true,
      });

      await manager.ensureBrowser();
      await manager.close();

      assert.strictEqual(manager.isConnected(), false);
    });
  });

  describe('Browser Restart (Requirement 9.3, 9.4)', () => {
    it('should restart browser successfully', async () => {
      const manager = BrowserManager.getInstance({
        headless: true,
        isolated: true,
      });

      const browser1 = await manager.ensureBrowser();
      const pid1 = browser1.process()?.pid;

      await manager.restart();

      const browser2 = await manager.getBrowser();
      const pid2 = browser2.process()?.pid;

      assert.ok(browser2.connected, 'Browser should be connected after restart');
      assert.notStrictEqual(pid1, pid2, 'Should be a different browser process');
    });

    it('should maintain connection after restart', async () => {
      const manager = BrowserManager.getInstance({
        headless: true,
        isolated: true,
      });

      await manager.ensureBrowser();
      await manager.restart();

      assert.ok(manager.isConnected(), 'Browser should be connected after restart');
    });
  });

  describe('Stealth Features (Requirement 9.7)', () => {
    it('should inject stealth scripts', async () => {
      const manager = BrowserManager.getInstance({
        headless: true,
        isolated: true,
      });

      const browser = await manager.ensureBrowser();
      
      // Should not throw
      await manager.injectStealth();

      // Verify stealth is injected by creating a new page
      const page = await browser.newPage();
      await page.goto('about:blank');
      
      // Check if webdriver is hidden (should be false or undefined after stealth injection)
      const webdriverValue = await page.evaluate(() => navigator.webdriver);
      assert.ok(webdriverValue === false || webdriverValue === undefined, 
        'Webdriver should be hidden or undefined after stealth injection');
      
      await page.close();
    });

    it('should not inject stealth twice', async () => {
      const manager = BrowserManager.getInstance({
        headless: true,
        isolated: true,
      });

      await manager.ensureBrowser();
      await manager.injectStealth();
      
      // Second injection should be skipped (no error)
      await manager.injectStealth();
    });

    it('should inject stealth with custom preset', async () => {
      const manager = BrowserManager.getInstance({
        headless: true,
        isolated: true,
      });

      await manager.ensureBrowser();
      
      // Should not throw
      await manager.injectStealth('mac-chrome');
    });

    it('should throw error when injecting stealth without browser', async () => {
      const manager = BrowserManager.getInstance({
        headless: true,
        isolated: true,
      });

      await assert.rejects(
        async () => {
          await manager.injectStealth();
        },
        {
          message: /Browser not initialized/,
        }
      );
    });

    it('should get stealth presets', () => {
      const manager = BrowserManager.getInstance({
        headless: true,
        isolated: true,
      });

      const presets = manager.getStealthPresets();

      assert.ok(Array.isArray(presets), 'Should return array of presets');
      assert.ok(presets.length > 0, 'Should have at least one preset');
      assert.ok(presets[0].name, 'Preset should have name');
      assert.ok(presets[0].userAgent, 'Preset should have userAgent');
      assert.ok(presets[0].platform, 'Preset should have platform');
    });

    it('should get stealth features', () => {
      const manager = BrowserManager.getInstance({
        headless: true,
        isolated: true,
      });

      const features = manager.getStealthFeatures();

      assert.ok(Array.isArray(features), 'Should return array of features');
      assert.ok(features.length > 0, 'Should have at least one feature');
      assert.ok(features.includes('hideWebDriver'), 'Should include hideWebDriver feature');
      assert.ok(features.includes('mockChrome'), 'Should include mockChrome feature');
    });

    it('should launch with stealth enabled from start', async () => {
      const manager = BrowserManager.getInstance({
        headless: true,
        isolated: true,
        useStealthScripts: true,
      });

      const browser = await manager.ensureBrowser();
      const pages = await browser.pages();

      if (pages.length > 0) {
        const page = pages[0];
        await page.goto('about:blank');
        
        // Check if webdriver is hidden (stealth should be auto-injected)
        const webdriverValue = await page.evaluate(() => navigator.webdriver);
        assert.strictEqual(webdriverValue, false, 'Webdriver should be hidden with useStealthScripts');
      }
    });
  });

  describe('Error Handling', () => {
    it('should handle browser launch failure gracefully', async () => {
      const manager = BrowserManager.getInstance({
        headless: true,
        isolated: true,
        executablePath: '/invalid/path/to/chrome',
      });

      await assert.rejects(
        async () => {
          await manager.ensureBrowser();
        },
        {
          message: /Failed to launch browser/,
        }
      );
    });

    it('should handle close errors gracefully', async () => {
      const manager = BrowserManager.getInstance({
        headless: true,
        isolated: true,
      });

      const browser = await manager.ensureBrowser();
      
      // Force close the browser to simulate error
      await browser.close();

      // Should not throw
      await manager.close();
    });
  });

  describe('Multiple Browser Instances (Requirement 9.3)', () => {
    it('should reuse same browser instance across multiple tool calls', async () => {
      const manager = BrowserManager.getInstance({
        headless: true,
        isolated: true,
      });

      // Simulate multiple tool calls requesting browser
      const browser1 = await manager.getBrowser();
      const browser2 = await manager.getBrowser();
      const browser3 = await manager.ensureBrowser();

      assert.strictEqual(browser1, browser2, 'Tool call 1 and 2 should get same browser');
      assert.strictEqual(browser2, browser3, 'Tool call 2 and 3 should get same browser');
      assert.strictEqual(browser1, browser3, 'Tool call 1 and 3 should get same browser');
    });
  });

  describe('Configuration Options', () => {
    it('should accept headless option', async () => {
      const manager = BrowserManager.getInstance({
        headless: true,
        isolated: true,
      });

      const browser = await manager.ensureBrowser();
      assert.ok(browser.connected);
    });

    it('should accept isolated option', async () => {
      const manager = BrowserManager.getInstance({
        headless: true,
        isolated: true,
      });

      const browser = await manager.ensureBrowser();
      assert.ok(browser.connected);
    });

    it('should accept channel option', async () => {
      const manager = BrowserManager.getInstance({
        headless: true,
        isolated: true,
        channel: 'stable',
      });

      const browser = await manager.ensureBrowser();
      assert.ok(browser.connected);
    });

    it('should accept devtools option', async () => {
      const manager = BrowserManager.getInstance({
        headless: true,
        isolated: true,
        devtools: false,
      });

      const browser = await manager.ensureBrowser();
      assert.ok(browser.connected);
    });

    it('should accept custom args', async () => {
      const manager = BrowserManager.getInstance({
        headless: true,
        isolated: true,
        args: ['--disable-gpu'],
      });

      const browser = await manager.ensureBrowser();
      assert.ok(browser.connected);
    });
  });
});
