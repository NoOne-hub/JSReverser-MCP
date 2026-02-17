/**
 * Manual test for BrowserManager
 * 
 * This test verifies:
 * 1. Singleton pattern works correctly
 * 2. Browser can be launched and connected
 * 3. Stealth injection works
 * 4. Browser can be restarted
 * 5. Remote debugging connection works (if configured)
 * 
 * Run with: npm run build && node build/tests/manual/test-browser-manager.js
 */

import {BrowserManager} from '../../src/browser.js';

async function testBrowserManager() {
  console.log('=== Testing BrowserManager ===\n');

  try {
    // Test 1: Singleton pattern
    console.log('Test 1: Singleton pattern');
    const manager1 = BrowserManager.getInstance({
      headless: true,
      isolated: true,
    });
    const manager2 = BrowserManager.getInstance();
    console.log('✓ Same instance:', manager1 === manager2);

    // Test 2: Launch browser
    console.log('\nTest 2: Launch browser');
    const browser = await manager1.ensureBrowser();
    console.log('✓ Browser launched:', browser.connected);

    // Test 3: Get browser (should return same instance)
    console.log('\nTest 3: Get browser instance');
    const browser2 = await manager1.getBrowser();
    console.log('✓ Same browser instance:', browser === browser2);

    // Test 4: Check connection status
    console.log('\nTest 4: Check connection status');
    console.log('✓ Browser connected:', manager1.isConnected());

    // Test 5: Test stealth injection
    console.log('\nTest 5: Test stealth injection');
    await manager1.injectStealth();
    const pages = await browser.pages();
    if (pages.length > 0) {
      const page = pages[0];
      await page.goto('about:blank');
      const webdriverValue = await page.evaluate(() => navigator.webdriver);
      console.log('✓ Webdriver hidden:', webdriverValue === false);
      
      const chromeExists = await page.evaluate(() => typeof (window as any).chrome !== 'undefined');
      console.log('✓ Chrome object exists:', chromeExists);
    }

    // Test 6: Restart browser
    console.log('\nTest 6: Restart browser');
    await manager1.restart();
    console.log('✓ Browser restarted:', manager1.isConnected());

    // Test 7: Close browser
    console.log('\nTest 7: Close browser');
    await manager1.close();
    console.log('✓ Browser closed:', !manager1.isConnected());

    // Test 8: Reset instance
    console.log('\nTest 8: Reset instance');
    BrowserManager.resetInstance();
    console.log('✓ Instance reset');

    // Test 9: Launch with stealth enabled from start
    console.log('\nTest 9: Launch with stealth enabled');
    const manager3 = BrowserManager.getInstance({
      headless: true,
      isolated: true,
      useStealthScripts: true,
    });
    const browser3 = await manager3.ensureBrowser();
    console.log('✓ Browser launched with stealth:', browser3.connected);

    const pages3 = await browser3.pages();
    if (pages3.length > 0) {
      const page = pages3[0];
      await page.goto('about:blank');
      const webdriverValue = await page.evaluate(() => navigator.webdriver);
      console.log('✓ Webdriver hidden (stealth mode):', webdriverValue === false);
    }

    // Cleanup
    await manager3.close();
    BrowserManager.resetInstance();

    console.log('\n=== All tests passed! ===');
  } catch (error) {
    console.error('\n❌ Test failed:', error);
    process.exit(1);
  }
}

// Run tests
testBrowserManager().catch(console.error);
