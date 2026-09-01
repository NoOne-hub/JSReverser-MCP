/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import assert from 'node:assert';
import {describe, it} from 'node:test';

import {networkRequest} from '../../../src/tools/network.js';
import {
  listPages,
  navigatePage,
  newPage,
  selectPage,
} from '../../../src/tools/pages.js';
import {getJSHookRuntime} from '../../../src/tools/runtime.js';
import {screenshot} from '../../../src/tools/screenshot.js';
import {evaluateScript} from '../../../src/tools/script.js';

interface BasicResponseState {
  includePages: boolean;
  includeNetwork: boolean;
  includeNetworkOpts?: {
    pageSize?: number;
    pageIdx?: number;
    resourceTypes?: string[];
    includePreservedRequests?: boolean;
    networkRequestIdInDevToolsUI?: number;
  };
}

interface ImageAttachment {
  mimeType: string;
  data?: string;
}

interface NetworkAttachment {
  reqid: number;
}

interface BasicResponseHarness {
  lines: string[];
  attached: Array<NetworkAttachment | ImageAttachment>;
  state: BasicResponseState;
  appendResponseLine(value: string): void;
  setIncludePages(value: boolean): void;
  setIncludeNetworkRequests(
    value: boolean,
    options?: BasicResponseState['includeNetworkOpts'],
  ): void;
  setIncludeConsoleData(value: boolean): void;
  attachImage(value: ImageAttachment): void;
  attachNetworkRequest(id: number): void;
  attachConsoleMessage(id: number): void;
  setIncludeWebSocketConnections(value: boolean): void;
  attachWebSocket(id: number): void;
}

interface TestPageHarness {
  currentUrl?: string;
  bringToFront(): Promise<void>;
  goto(url: string, options?: unknown): Promise<void>;
  goBack(options?: unknown): Promise<void>;
  goForward(options?: unknown): Promise<void>;
  reload(options?: unknown): Promise<void>;
  url(): string;
  screenshot(options: unknown): Promise<Uint8Array>;
  evaluateHandle(script: string): Promise<{dispose(): Promise<void>}>;
  evaluate(fnHandle: unknown): Promise<string>;
}

interface TestFrameHarness {
  evaluateHandle(script: string): Promise<{dispose(): Promise<void>}>;
  evaluate(fn: unknown, arg: unknown): Promise<string>;
}

interface PageToolContextHarness {
  getPageByIdx(idx: number): TestPageHarness;
  getPageByOptionalIdx(idx?: number): TestPageHarness;
  selectPage(page: TestPageHarness): void;
  newPage(): Promise<TestPageHarness>;
  waitForEventsAfterAction(action: () => Promise<void>): Promise<void>;
  getSelectedPage(): TestPageHarness;
}

interface NetworkContextHarness {
  getDevToolsData(): Promise<{cdpRequestId?: string}>;
  resolveCdpRequestId(id: string): number | undefined;
}

interface ScreenshotContextHarness {
  getSelectedPage(): TestPageHarness;
  getPageByOptionalIdx(idx?: number): TestPageHarness;
  saveFile(data: Uint8Array, filename: string): Promise<{filename: string}>;
  saveTemporaryFile(
    data: Uint8Array,
    mimeType: 'image/png' | 'image/jpeg' | 'image/webp',
  ): Promise<{filename: string}>;
}

interface ScriptContextHarness {
  getSelectedPage(): TestPageHarness;
  getSelectedFrame(): TestFrameHarness;
  waitForEventsAfterAction(action: () => Promise<void>): Promise<void>;
}

function makeResponse(): BasicResponseHarness {
  const lines: string[] = [];
  const attached: Array<NetworkAttachment | ImageAttachment> = [];
  const state: BasicResponseState = {
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
    setIncludeNetworkRequests: (
      v: boolean,
      opts?: BasicResponseState['includeNetworkOpts'],
    ) => {
      state.includeNetwork = v;
      state.includeNetworkOpts = opts;
    },
    setIncludeConsoleData: () => undefined,
    attachImage: (v: ImageAttachment) => attached.push(v),
    attachNetworkRequest: (id: number) => attached.push({reqid: id}),
    attachConsoleMessage: () => undefined,
    setIncludeWebSocketConnections: () => undefined,
    attachWebSocket: () => undefined,
  };
}

describe('tools extended coverage', () => {
  it('covers list/select/new page and navigate branches', async () => {
    const response = makeResponse();

    const selected = {idx: -1};
    const syncedPages: TestPageHarness[] = [];
    const page: TestPageHarness = {
      currentUrl: 'https://now.example',
      bringToFront: async () => {
        selected.idx = 1;
      },
      goto: async () => undefined,
      goBack: async () => undefined,
      goForward: async () => undefined,
      reload: async () => undefined,
      url: () => page.currentUrl ?? '',
      screenshot: async () => new Uint8Array(),
      evaluateHandle: async () => ({dispose: async () => undefined}),
      evaluate: async () => '',
    };

    const context: PageToolContextHarness = {
      getPageByIdx: () => page,
      getPageByOptionalIdx: () => page,
      selectPage: (p: TestPageHarness) => {
        selected.idx = p === page ? 2 : -2;
      },
      newPage: async () => page,
      waitForEventsAfterAction: async (action: () => Promise<void>) => {
        await action();
      },
      getSelectedPage: () => page,
    };

    const runtime = getJSHookRuntime() as unknown as {
      syncPageContext?: (page: TestPageHarness, frame?: unknown) => void;
    };
    const originalSyncPageContext = runtime.syncPageContext;
    runtime.syncPageContext = (selectedPage: TestPageHarness) => {
      syncedPages.push(selectedPage);
    };

    try {
      await listPages.handler(
        {params: {}},
        response as unknown as Parameters<typeof listPages.handler>[1],
        context as unknown as Parameters<typeof listPages.handler>[2],
      );
      assert.strictEqual(response.state.includePages, true);

      await selectPage.handler(
        {params: {pageIdx: 0}},
        response as unknown as Parameters<typeof selectPage.handler>[1],
        context as unknown as Parameters<typeof selectPage.handler>[2],
      );
      assert.strictEqual(selected.idx, 2);
      assert.deepStrictEqual(syncedPages, [page]);

      await newPage.handler(
        {params: {url: 'https://a.com'}},
        response as unknown as Parameters<typeof newPage.handler>[1],
        context as unknown as Parameters<typeof newPage.handler>[2],
      );
      assert.strictEqual(response.state.includePages, true);

      await assert.rejects(async () => {
        await navigatePage.handler(
          {params: {}},
          response as unknown as Parameters<typeof navigatePage.handler>[1],
          context as unknown as Parameters<typeof navigatePage.handler>[2],
        );
      });

      await navigatePage.handler(
        {params: {url: 'https://b.com'}},
        response as unknown as Parameters<typeof navigatePage.handler>[1],
        context as unknown as Parameters<typeof navigatePage.handler>[2],
      );
      assert.ok(response.lines.some(x => x.includes('Successfully navigated')));

      page.goto = async () => {
        throw new Error('goto failed');
      };
      await navigatePage.handler(
        {params: {type: 'url', url: 'https://c.com'}},
        response as unknown as Parameters<typeof navigatePage.handler>[1],
        context as unknown as Parameters<typeof navigatePage.handler>[2],
      );
      assert.ok(response.lines.some(x => x.includes('Unable to navigate in')));

      page.goBack = async () => {
        throw new Error('back failed');
      };
      await navigatePage.handler(
        {params: {type: 'back'}},
        response as unknown as Parameters<typeof navigatePage.handler>[1],
        context as unknown as Parameters<typeof navigatePage.handler>[2],
      );
      assert.ok(
        response.lines.some(x => x.includes('Unable to navigate back')),
      );

      page.goForward = async () => {
        throw new Error('forward failed');
      };
      await navigatePage.handler(
        {params: {type: 'forward'}},
        response as unknown as Parameters<typeof navigatePage.handler>[1],
        context as unknown as Parameters<typeof navigatePage.handler>[2],
      );
      assert.ok(
        response.lines.some(x => x.includes('Unable to navigate forward')),
      );

      page.reload = async () => {
        throw new Error('reload failed');
      };
      await navigatePage.handler(
        {params: {type: 'reload', ignoreCache: true}},
        response as unknown as Parameters<typeof navigatePage.handler>[1],
        context as unknown as Parameters<typeof navigatePage.handler>[2],
      );
      assert.ok(response.lines.some(x => x.includes('Unable to reload')));

      const explicitPage: TestPageHarness = {
        ...page,
        currentUrl: 'https://explicit.example',
        goto: async (url: string) => {
          explicitPage.currentUrl = url;
        },
      };
      context.getPageByIdx = (idx: number) => {
        assert.strictEqual(idx, 1);
        return explicitPage;
      };
      context.getPageByOptionalIdx = (idx?: number) =>
        idx === undefined ? page : explicitPage;
      await navigatePage.handler(
        {params: {pageIdx: 1, url: 'https://target.example'}},
        response as unknown as Parameters<typeof navigatePage.handler>[1],
        context as unknown as Parameters<typeof navigatePage.handler>[2],
      );
      assert.strictEqual(explicitPage.currentUrl, 'https://target.example');
    } finally {
      runtime.syncPageContext = originalSyncPageContext;
    }
  });

  it('covers network list/get branches', async () => {
    const response = makeResponse();

    const context: NetworkContextHarness = {
      getDevToolsData: async () => ({cdpRequestId: 'abc'}),
      resolveCdpRequestId: (id: string) => (id === 'abc' ? 12 : undefined),
    };

    await networkRequest.handler(
      {
        params: {
          action: 'list',
          pageSize: 10,
          pageIdx: 1,
          resourceTypes: ['xhr'],
          includePreservedRequests: true,
        },
      },
      response as unknown as Parameters<typeof networkRequest.handler>[1],
      context as unknown as Parameters<typeof networkRequest.handler>[2],
    );

    assert.strictEqual(response.state.includeNetwork, true);
    assert.ok(response.state.includeNetworkOpts);
    assert.strictEqual(
      response.state.includeNetworkOpts.networkRequestIdInDevToolsUI,
      12,
    );

    await networkRequest.handler(
      {params: {action: 'get', reqid: 33}},
      response as unknown as Parameters<typeof networkRequest.handler>[1],
      context as unknown as Parameters<typeof networkRequest.handler>[2],
    );
    assert.ok(response.attached.some(x => 'reqid' in x && x.reqid === 33));

    await networkRequest.handler(
      {params: {action: 'get'}},
      response as unknown as Parameters<typeof networkRequest.handler>[1],
      context as unknown as Parameters<typeof networkRequest.handler>[2],
    );
    assert.ok(response.attached.some(x => 'reqid' in x && x.reqid === 12));

    const contextNoReq: NetworkContextHarness = {
      getDevToolsData: async () => ({}),
      resolveCdpRequestId: () => undefined,
    };
    await networkRequest.handler(
      {params: {action: 'get'}},
      response as unknown as Parameters<typeof networkRequest.handler>[1],
      contextNoReq as unknown as Parameters<typeof networkRequest.handler>[2],
    );
    assert.ok(
      response.lines.some(x => x.includes('Nothing is currently selected')),
    );
  });

  it('covers screenshot branches: save file, temp file and attach image', async () => {
    const response = makeResponse();

    const small = Buffer.from('small-image');
    const large = Buffer.alloc(2_000_001, 1);
    let call = 0;

    const page: TestPageHarness = {
      screenshot: async () => {
        call += 1;
        return call === 2 ? large : small;
      },
      bringToFront: async () => undefined,
      goto: async () => undefined,
      goBack: async () => undefined,
      goForward: async () => undefined,
      reload: async () => undefined,
      url: () => '',
      evaluateHandle: async () => ({dispose: async () => undefined}),
      evaluate: async () => '',
    };

    const context: ScreenshotContextHarness = {
      getSelectedPage: () => page,
      getPageByOptionalIdx: () => page,
      saveFile: async (_data: Uint8Array, filename: string) => ({filename}),
      saveTemporaryFile: async () => ({filename: '/tmp/shot.png'}),
    };

    await screenshot.handler(
      {params: {format: 'png', fullPage: true, filePath: '/tmp/a.png'}},
      response as unknown as Parameters<typeof screenshot.handler>[1],
      context as unknown as Parameters<typeof screenshot.handler>[2],
    );
    assert.ok(response.lines.some(x => x.includes('full current page')));
    assert.ok(response.lines.some(x => x.includes('/tmp/a.png')));

    await screenshot.handler(
      {params: {format: 'jpeg', quality: 80, fullPage: false}},
      response as unknown as Parameters<typeof screenshot.handler>[1],
      context as unknown as Parameters<typeof screenshot.handler>[2],
    );
    assert.ok(response.lines.some(x => x.includes('/tmp/shot.png')));

    await screenshot.handler(
      {params: {format: 'webp', fullPage: false}},
      response as unknown as Parameters<typeof screenshot.handler>[1],
      context as unknown as Parameters<typeof screenshot.handler>[2],
    );
    assert.ok(
      response.attached.some(
        x => 'mimeType' in x && x.mimeType === 'image/webp',
      ),
    );
  });

  it('covers evaluateScript success and dispose-on-error path', async () => {
    const response = makeResponse();
    let disposed = 0;

    const fnHandle = {
      dispose: async () => {
        disposed += 1;
      },
    };

    const frameSuccess: TestFrameHarness = {
      evaluateHandle: async () => fnHandle,
      evaluate: async () => '{"ok":true}',
    };

    const pageSuccess: TestPageHarness = {
      bringToFront: async () => undefined,
      goto: async () => undefined,
      goBack: async () => undefined,
      goForward: async () => undefined,
      reload: async () => undefined,
      url: () => '',
      screenshot: async () => new Uint8Array(),
      evaluateHandle: async () => fnHandle,
      evaluate: async () => '{"ok":true}',
    };

    const contextSuccess: ScriptContextHarness = {
      getSelectedPage: () => pageSuccess,
      getSelectedFrame: () => frameSuccess,
      waitForEventsAfterAction: async (action: () => Promise<void>) => {
        await action();
      },
    };

    await evaluateScript.handler(
      {params: {function: '() => ({ ok: true })'}},
      response as unknown as Parameters<typeof evaluateScript.handler>[1],
      contextSuccess as unknown as Parameters<typeof evaluateScript.handler>[2],
    );

    assert.ok(
      response.lines.some(x => x.includes('Script ran on page and returned')),
    );
    assert.strictEqual(disposed, 1);

    const frameError: TestFrameHarness = {
      evaluateHandle: async () => fnHandle,
      evaluate: async () => {
        throw new Error('eval failed');
      },
    };

    const pageError: TestPageHarness = {
      bringToFront: async () => undefined,
      goto: async () => undefined,
      goBack: async () => undefined,
      goForward: async () => undefined,
      reload: async () => undefined,
      url: () => '',
      screenshot: async () => new Uint8Array(),
      evaluateHandle: async () => fnHandle,
      evaluate: async () => {
        throw new Error('eval failed');
      },
    };

    const contextError: ScriptContextHarness = {
      getSelectedPage: () => pageError,
      getSelectedFrame: () => frameError,
      waitForEventsAfterAction: async (action: () => Promise<void>) => {
        await action();
      },
    };

    await assert.rejects(async () => {
      await evaluateScript.handler(
        {params: {function: '() => { throw new Error("x") }'}},
        response as unknown as Parameters<typeof evaluateScript.handler>[1],
        contextError as unknown as Parameters<typeof evaluateScript.handler>[2],
      );
    });
    assert.strictEqual(disposed, 2);
  });

  it('covers jshook runtime singleton creation', () => {
    const first = getJSHookRuntime();
    const second = getJSHookRuntime();

    assert.ok(first.collector);
    assert.ok(first.hookManager);
    assert.strictEqual(first, second);
  });
});
