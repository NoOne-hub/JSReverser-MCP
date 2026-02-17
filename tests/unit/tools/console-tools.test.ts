import { describe, it } from 'node:test';
import assert from 'node:assert';
import { zod } from '../../../src/third_party/index.js';
import { getConsoleMessage, listConsoleMessages } from '../../../src/tools/console.js';
import { setIssuesEnabled } from '../../../src/features.js';

describe('console tools', () => {
  it('lists console messages with filters and defaults', async () => {
    const schema = zod.object(listConsoleMessages.schema);
    const parsed = schema.parse({ pageSize: 20, pageIdx: 1, types: ['error'] });

    let include = false;
    let options: any;
    const response = {
      setIncludeConsoleData: (value: boolean, opts?: any) => {
        include = value;
        options = opts;
      },
      appendResponseLine: () => {},
      setIncludePages: () => {},
      setIncludeNetworkRequests: () => {},
      attachImage: () => {},
      attachNetworkRequest: () => {},
      attachConsoleMessage: () => {},
      setIncludeWebSocketConnections: () => {},
      attachWebSocket: () => {},
    };

    await listConsoleMessages.handler({ params: parsed } as any, response as any, {} as any);

    assert.strictEqual(include, true);
    assert.strictEqual(options.pageSize, 20);
    assert.strictEqual(options.pageIdx, 1);
    assert.deepStrictEqual(options.types, ['error']);
    assert.strictEqual(options.includePreservedMessages, undefined);
  });

  it('attaches single console message by msgid', async () => {
    let attached: number | undefined;
    const response = {
      attachConsoleMessage: (id: number) => {
        attached = id;
      },
      appendResponseLine: () => {},
      setIncludeConsoleData: () => {},
      setIncludePages: () => {},
      setIncludeNetworkRequests: () => {},
      attachImage: () => {},
      attachNetworkRequest: () => {},
      setIncludeWebSocketConnections: () => {},
      attachWebSocket: () => {},
    };

    await getConsoleMessage.handler({ params: { msgid: 42 } } as any, response as any, {} as any);
    assert.strictEqual(attached, 42);
  });

  it('covers issues feature branch in console message types', async () => {
    setIssuesEnabled(true);
    try {
      const url = new URL('../../../src/tools/console.js', import.meta.url);
      const mod = await import(`${url.href}?issues=on`);
      const schema = zod.object(mod.listConsoleMessages.schema);
      const parsed = schema.parse({ types: ['issue'] });
      assert.deepStrictEqual(parsed.types, ['issue']);
    } finally {
      setIssuesEnabled(false);
    }
  });
});
