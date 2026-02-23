import { describe, it } from 'node:test';
import assert from 'node:assert';
import { listPages, navigatePage, newPage, selectPage } from '../../../src/tools/pages.js';
import { getNetworkRequest, listNetworkRequests } from '../../../src/tools/network.js';
import { screenshot } from '../../../src/tools/screenshot.js';
import { evaluateScript } from '../../../src/tools/script.js';
import { getJSHookRuntime } from '../../../src/tools/runtime.js';

function makeResponse() {
  const lines: string[] = [];
  const attached: any[] = [];
  const state: any = {
    includePages: false,
    includeNetwork: false,
    includeNetworkOpts: undefined,
  };

  return {
    lines,
    attached,
    state,
    appendResponseLine: (v: string) => lines.push(v),
    setIncludePages: (v: boolean) => {
      state.includePages = v;
    },
    setIncludeNetworkRequests: (v: boolean, opts?: any) => {
      state.includeNetwork = v;
      state.includeNetworkOpts = opts;
    },
    setIncludeConsoleData: () => {},
    attachImage: (v: any) => attached.push(v),
    attachNetworkRequest: (id: number) => attached.push({ reqid: id }),
    attachConsoleMessage: () => {},
    setIncludeWebSocketConnections: () => {},
    attachWebSocket: () => {},
  };
}

describe('tools extended coverage', () => {
  it('covers list/select/new page and navigate branches', async () => {
    const response = makeResponse();

    const selected = { idx: -1 };
    const page: any = {
      currentUrl: 'https://now.example',
      bringToFront: async () => {
        selected.idx = 1;
      },
      goto: async () => {},
      goBack: async () => {},
      goForward: async () => {},
      reload: async () => {},
      url: () => page.currentUrl,
    };

    const context: any = {
      getPageByIdx: () => page,
      selectPage: (p: any) => {
        selected.idx = p === page ? 2 : -2;
      },
      newPage: async () => page,
      waitForEventsAfterAction: async (action: () => Promise<void>) => {
        await action();
      },
      getSelectedPage: () => page,
    };

    await listPages.handler({ params: {} } as any, response as any, context);
    assert.strictEqual(response.state.includePages, true);

    await selectPage.handler({ params: { pageIdx: 0 } } as any, response as any, context);
    assert.strictEqual(selected.idx, 2);

    await newPage.handler({ params: { url: 'https://a.com' } } as any, response as any, context);
    assert.strictEqual(response.state.includePages, true);

    await assert.rejects(async () => {
      await navigatePage.handler({ params: {} } as any, response as any, context);
    });

    await navigatePage.handler({ params: { url: 'https://b.com' } } as any, response as any, context);
    assert.ok(response.lines.some((x) => x.includes('Successfully navigated')));

    page.goto = async () => {
      throw new Error('goto failed');
    };
    await navigatePage.handler({ params: { type: 'url', url: 'https://c.com' } } as any, response as any, context);
    assert.ok(response.lines.some((x) => x.includes('Unable to navigate in')));

    page.goBack = async () => {
      throw new Error('back failed');
    };
    await navigatePage.handler({ params: { type: 'back' } } as any, response as any, context);
    assert.ok(response.lines.some((x) => x.includes('Unable to navigate back')));

    page.goForward = async () => {
      throw new Error('forward failed');
    };
    await navigatePage.handler({ params: { type: 'forward' } } as any, response as any, context);
    assert.ok(response.lines.some((x) => x.includes('Unable to navigate forward')));

    page.reload = async () => {
      throw new Error('reload failed');
    };
    await navigatePage.handler({ params: { type: 'reload', ignoreCache: true } } as any, response as any, context);
    assert.ok(response.lines.some((x) => x.includes('Unable to reload')));
  });

  it('covers network list/get branches', async () => {
    const response = makeResponse();

    const context: any = {
      getDevToolsData: async () => ({ cdpRequestId: 'abc' }),
      resolveCdpRequestId: (id: string) => (id === 'abc' ? 12 : undefined),
    };

    await listNetworkRequests.handler(
      {
        params: {
          pageSize: 10,
          pageIdx: 1,
          resourceTypes: ['xhr'],
          includePreservedRequests: true,
        },
      } as any,
      response as any,
      context,
    );

    assert.strictEqual(response.state.includeNetwork, true);
    assert.strictEqual(response.state.includeNetworkOpts.networkRequestIdInDevToolsUI, 12);

    await getNetworkRequest.handler({ params: { reqid: 33 } } as any, response as any, context);
    assert.ok(response.attached.some((x) => x.reqid === 33));

    await getNetworkRequest.handler({ params: {} } as any, response as any, context);
    assert.ok(response.attached.some((x) => x.reqid === 12));

    const contextNoReq: any = {
      getDevToolsData: async () => ({}),
      resolveCdpRequestId: () => undefined,
    };
    await getNetworkRequest.handler({ params: {} } as any, response as any, contextNoReq);
    assert.ok(response.lines.some((x) => x.includes('Nothing is currently selected')));
  });

  it('covers screenshot branches: save file, temp file and attach image', async () => {
    const response = makeResponse();

    const small = Buffer.from('small-image');
    const large = Buffer.alloc(2_000_001, 1);
    let call = 0;

    const page: any = {
      screenshot: async () => {
        call += 1;
        return call === 2 ? large : small;
      },
    };

    const context: any = {
      getSelectedPage: () => page,
      saveFile: async (_data: Uint8Array, filename: string) => ({ filename }),
      saveTemporaryFile: async () => ({ filename: '/tmp/shot.png' }),
    };

    await screenshot.handler(
      { params: { format: 'png', fullPage: true, filePath: '/tmp/a.png' } } as any,
      response as any,
      context,
    );
    assert.ok(response.lines.some((x) => x.includes('full current page')));
    assert.ok(response.lines.some((x) => x.includes('/tmp/a.png')));

    await screenshot.handler(
      { params: { format: 'jpeg', quality: 80, fullPage: false } } as any,
      response as any,
      context,
    );
    assert.ok(response.lines.some((x) => x.includes('/tmp/shot.png')));

    await screenshot.handler(
      { params: { format: 'webp', fullPage: false } } as any,
      response as any,
      context,
    );
    assert.ok(response.attached.some((x) => x.mimeType === 'image/webp'));
  });

  it('covers evaluateScript success and dispose-on-error path', async () => {
    const response = makeResponse();
    let disposed = 0;

    const fnHandle = {
      dispose: async () => {
        disposed += 1;
      },
    };

    const pageSuccess: any = {
      evaluateHandle: async () => fnHandle,
      evaluate: async () => '{"ok":true}',
    };

    const contextSuccess: any = {
      getSelectedPage: () => pageSuccess,
      waitForEventsAfterAction: async (action: () => Promise<void>) => {
        await action();
      },
    };

    await evaluateScript.handler(
      { params: { function: '() => ({ ok: true })' } } as any,
      response as any,
      contextSuccess,
    );

    assert.ok(response.lines.some((x) => x.includes('Script ran on page and returned')));
    assert.strictEqual(disposed, 1);

    const pageError: any = {
      evaluateHandle: async () => fnHandle,
      evaluate: async () => {
        throw new Error('eval failed');
      },
    };

    const contextError: any = {
      getSelectedPage: () => pageError,
      waitForEventsAfterAction: async (action: () => Promise<void>) => {
        await action();
      },
    };

    await assert.rejects(async () => {
      await evaluateScript.handler(
        { params: { function: '() => { throw new Error("x") }' } } as any,
        response as any,
        contextError,
      );
    });
    assert.strictEqual(disposed, 2);
  });

  it('covers jshook runtime singleton creation', () => {
    const first = getJSHookRuntime();
    const second = getJSHookRuntime();

    assert.ok(first.browserManager);
    assert.ok(first.collector);
    assert.ok(first.hookManager);
    assert.strictEqual(first, second);
  });
});
