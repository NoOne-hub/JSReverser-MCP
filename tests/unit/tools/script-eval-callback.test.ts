import { describe, it } from 'node:test';
import assert from 'node:assert';
import { evaluateScript } from '../../../src/tools/script.js';

describe('evaluate_script callback path', () => {
  it('executes page.evaluate callback body and disposes handle', async () => {
    const lines: string[] = [];
    let disposed = 0;

    const fn = async () => ({ ok: true });

    const handle = {
      dispose: async () => {
        disposed += 1;
      },
    };

    const page: any = {
      evaluateHandle: async () => handle,
      evaluate: async (cb: (x: any) => Promise<string>, passedFn: any) => cb(passedFn),
    };

    const context: any = {
      getSelectedPage: () => page,
      waitForEventsAfterAction: async (action: () => Promise<void>) => {
        await action();
      },
    };

    const response: any = {
      appendResponseLine: (v: string) => lines.push(v),
      setIncludePages: () => {},
      setIncludeNetworkRequests: () => {},
      setIncludeConsoleData: () => {},
      attachImage: () => {},
      attachNetworkRequest: () => {},
      attachConsoleMessage: () => {},
      setIncludeWebSocketConnections: () => {},
      attachWebSocket: () => {},
    };

    await evaluateScript.handler({ params: { function: '() => ({ ok: true })' } } as any, response, {
      ...context,
      getSelectedPage: () => ({
        ...page,
        evaluate: async (cb: (f: any) => Promise<string>) => cb(fn),
      }),
    });

    assert.strictEqual(disposed, 1);
    assert.ok(lines.some((l) => l.includes('Script ran on page and returned')));
    assert.ok(lines.some((l) => l.includes('{"ok":true}')));
  });
});
