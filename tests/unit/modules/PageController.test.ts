import { describe, it } from 'node:test';
import assert from 'node:assert';
import { PageController } from '../../../src/modules/collector/PageController.js';

function makePage() {
  const page: Record<string, any> = {
    goto: async () => {},
    title: async () => 'Example',
    url: () => 'https://example.com',
    reload: async () => {},
    goBack: async () => {},
    goForward: async () => {},
    click: async () => {},
    type: async () => {},
    select: async () => {},
    hover: async () => {},
    evaluate: async () => ({}),
    waitForSelector: async () => {},
    waitForNavigation: async () => {},
    content: async () => '<html></html>',
    screenshot: async () => Buffer.from('img'),
    setCookie: async () => {},
    cookies: async () => [{ name: 'sid', value: '1' }],
    deleteCookie: async () => {},
    setViewport: async () => {},
    setUserAgent: async () => {},
    waitForNetworkIdle: async () => {},
    keyboard: {
      press: async () => {},
    },
    $: async () => ({
      uploadFile: async () => {},
    }),
  };
  return page;
}

describe('PageController', () => {
  it('covers navigation and interaction wrappers', async () => {
    const page = makePage();
    const controller = new PageController({ getActivePage: async () => page } as any);

    const nav = await controller.navigate('https://example.com', {
      waitUntil: 'load',
      timeout: 1234,
    });
    assert.strictEqual(nav.url, 'https://example.com');
    assert.strictEqual(nav.title, 'Example');
    assert.ok(nav.loadTime >= 0);

    await controller.reload({ timeout: 100 });
    await controller.goBack();
    await controller.goForward();
    await controller.click('#btn', { button: 'left', clickCount: 2, delay: 1 });
    await controller.type('#input', 'hello', { delay: 1 });
    await controller.select('#sel', 'a', 'b');
    await controller.hover('#menu');
    await controller.scroll({ x: 10, y: 20 });

    const waited = await controller.waitForSelector('#ready', 100);
    assert.strictEqual(waited.success, true);

    await controller.waitForNavigation(100);
    const evaluated = await controller.evaluate<Record<string, unknown>>('({ ok: true })');
    assert.deepStrictEqual(evaluated, {});
    assert.strictEqual(await controller.getURL(), 'https://example.com');
    assert.strictEqual(await controller.getTitle(), 'Example');
    assert.strictEqual(await controller.getContent(), '<html></html>');
  });

  it('covers screenshot, metrics, storage, cookies and device helpers', async () => {
    const page = makePage();
    let deleteCookieArgsLen = 0;
    page.deleteCookie = async (...args: unknown[]) => {
      deleteCookieArgsLen = args.length;
    };
    const evaluateResults: unknown[] = [
      {
        domContentLoaded: 1,
        loadComplete: 2,
        dns: 1,
        tcp: 1,
        request: 1,
        response: 1,
        total: 6,
        resources: 3,
      },
      undefined,
      undefined,
      undefined,
      { k: 'v' },
      [{ text: 'Home', href: 'https://example.com' }],
    ];
    page.evaluate = async () => evaluateResults.shift();

    const controller = new PageController({ getActivePage: async () => page } as any);
    const shot = await controller.screenshot({
      path: 'tests/.tmp/page-controller/snap.png',
      type: 'png',
      fullPage: true,
    });
    assert.ok(Buffer.isBuffer(shot));

    const metrics = await controller.getPerformanceMetrics();
    assert.strictEqual(metrics.total, 6);

    await controller.injectScript('window.__x=1');
    await controller.setCookies([{ name: 'sid', value: '1' }]);
    const cookies = await controller.getCookies();
    assert.strictEqual(cookies.length, 1);
    await controller.clearCookies();
    assert.strictEqual(deleteCookieArgsLen, 1);

    await controller.setViewport(800, 600);
    await controller.emulateDevice('iPhone');
    await controller.emulateDevice('iPad');
    await controller.emulateDevice('Android');
    await controller.waitForNetworkIdle(100);

    await controller.setLocalStorage('k', 'v');
    await controller.clearLocalStorage();
    const storage = await controller.getLocalStorage();
    assert.strictEqual(typeof storage, 'object');

    await controller.pressKey('Enter');
    await controller.uploadFile('#file', '/tmp/a.txt');
    const links = await controller.getAllLinks();
    assert.strictEqual(Array.isArray(links), true);

    const activePage = await controller.getPage();
    assert.strictEqual(activePage, page as any);
  });

  it('returns failure result for waitForSelector timeout and upload errors', async () => {
    const page = makePage();
    page.waitForSelector = async () => {
      throw new Error('timeout');
    };

    const controller = new PageController({ getActivePage: async () => page } as any);
    const waited = await controller.waitForSelector('#missing', 10);
    assert.strictEqual(waited.success, false);

    page.$ = async () => null;
    await assert.rejects(
      async () => {
        await controller.uploadFile('#missing', '/tmp/nope');
      },
      /File input not found/,
    );
  });
});
