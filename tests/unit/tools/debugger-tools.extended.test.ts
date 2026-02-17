import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  listScripts,
  getScriptSource,
  findInScript,
  searchInSources,
  setBreakpoint,
  removeBreakpoint,
  listBreakpoints,
  getRequestInitiator,
  getPausedInfo,
  resume,
  pause,
  stepOver,
  stepInto,
  stepOut,
  evaluateOnCallframe,
  setBreakpointOnText,
  hookFunction,
  unhookFunction,
  listHooks,
  inspectObject,
  getStorage,
  breakOnXhr,
  removeXhrBreakpoint,
  monitorEvents,
  stopMonitor,
  traceFunction,
} from '../../../src/tools/debugger.js';

function makeResponse() {
  const lines: string[] = [];
  return {
    lines,
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
}

function makeContext(overrides: Record<string, any> = {}) {
  const page = {
    evaluate: async () => ({}),
  };

  const debuggerContext = {
    isEnabled: () => true,
    getScripts: () => [],
    getScriptsByUrlPattern: () => [],
    getScriptSource: async () => '',
    getScriptById: () => ({ url: 'https://a.js' }),
    searchInScripts: async () => ({ matches: [] }),
    setBreakpoint: async () => ({ breakpointId: 'bp1', locations: [{ lineNumber: 1 }] }),
    setBreakpointByUrlRegex: async () => ({ breakpointId: 'bp2', locations: [] }),
    removeBreakpoint: async () => {},
    getBreakpoints: () => [],
    getPausedState: () => ({ isPaused: false, callFrames: [] }),
    isPaused: () => false,
    resume: async () => {},
    pause: async () => {},
    stepOver: async () => {},
    stepInto: async () => {},
    stepOut: async () => {},
    evaluateOnCallFrame: async () => ({ result: { value: 1 } }),
    getScopeVariables: async () => [],
    getClient: () => ({ send: async () => {} }),
  };

  return {
    getSelectedPage: () => page,
    getNetworkRequestById: () => ({ url: () => 'https://api.example.com' }),
    getRequestInitiator: () => undefined,
    debuggerContext,
    ...overrides,
  } as any;
}

describe('debugger tools extended', () => {
  it('covers script listing and source operations', async () => {
    const response = makeResponse();
    const context = makeContext();
    context.debuggerContext.getScripts = () => [{ scriptId: '1', url: 'https://a.js' }];
    context.debuggerContext.getScriptsByUrlPattern = () => [{ scriptId: '2', url: 'https://b.js' }];
    context.debuggerContext.getScriptSource = async () => 'line1\nline2\nconst x = 1;';

    await listScripts.handler({ params: {} } as any, response as any, context);
    await listScripts.handler({ params: { filter: 'b' } } as any, response as any, context);
    await getScriptSource.handler({ params: { scriptId: '2', startLine: 1, endLine: 2, length: 1000 } } as any, response as any, context);
    await getScriptSource.handler({ params: { scriptId: '2', offset: 1, length: 5 } } as any, response as any, context);

    assert.ok(response.lines.some((x) => x.includes('Found')));
    assert.ok(response.lines.some((x) => x.includes('Source for script')));
  });

  it('covers find/search/source negative and formatting paths', async () => {
    const response = makeResponse();
    const context = makeContext();
    context.debuggerContext.getScriptSource = async () => 'abc\ndef\nabc';
    context.debuggerContext.searchInScripts = async () => ({
      matches: [
        { scriptId: '1', url: 'https://a.js', lineNumber: 1, lineContent: 'const token = "abc";' },
        { scriptId: '2', url: 'https://m.js', lineNumber: 10, lineContent: 'x'.repeat(12000) },
      ],
    });

    await findInScript.handler(
      { params: { scriptId: '1', query: 'abc', contextChars: 3, occurrence: 2, caseSensitive: true } } as any,
      response as any,
      context,
    );
    await findInScript.handler(
      { params: { scriptId: '1', query: 'zzz', contextChars: 3, occurrence: 1, caseSensitive: true } } as any,
      response as any,
      context,
    );
    await searchInSources.handler(
      { params: { query: 'token', caseSensitive: false, isRegex: false, maxResults: 1, maxLineLength: 20, excludeMinified: true, urlFilter: 'a.js' } } as any,
      response as any,
      context,
    );

    assert.ok(response.lines.some((x) => x.includes('Found "abc"')));
    assert.ok(response.lines.some((x) => x.includes('not found')));
    assert.ok(response.lines.some((x) => x.includes('Tip: Use get_script_source')));
  });

  it('covers breakpoint management and initiator rendering', async () => {
    const response = makeResponse();
    const context = makeContext();
    context.debuggerContext.getBreakpoints = () => [
      { breakpointId: 'bp-1', url: 'https://a.js', lineNumber: 2, columnNumber: 0, condition: 'x>1', locations: [{ x: 1 }] },
    ];
    context.getRequestInitiator = () => ({
      type: 'script',
      url: 'https://a.js',
      lineNumber: 4,
      columnNumber: 2,
      stack: {
        callFrames: [{ functionName: 'fn', url: 'https://a.js', lineNumber: 1, columnNumber: 1 }],
        parent: { callFrames: [{ functionName: 'parent', url: 'https://p.js', lineNumber: 1, columnNumber: 1 }] },
      },
    });

    await setBreakpoint.handler({ params: { url: 'a.js', lineNumber: 3, columnNumber: 0, isRegex: false } } as any, response as any, context);
    await setBreakpoint.handler({ params: { url: '.*a.js', lineNumber: 3, columnNumber: 0, isRegex: true } } as any, response as any, context);
    await listBreakpoints.handler({ params: {} } as any, response as any, context);
    await removeBreakpoint.handler({ params: { breakpointId: 'bp-1' } } as any, response as any, context);
    await getRequestInitiator.handler({ params: { requestId: 1 } } as any, response as any, context);

    assert.ok(response.lines.some((x) => x.includes('Breakpoint set successfully')));
    assert.ok(response.lines.some((x) => x.includes('Active breakpoints')));
    assert.ok(response.lines.some((x) => x.includes('Call Stack')));
  });

  it('covers paused state commands and evaluation branches', async () => {
    const response = makeResponse();
    const context = makeContext();
    context.debuggerContext.getPausedState = () => ({
      isPaused: true,
      reason: 'breakpoint',
      hitBreakpoints: ['bp1'],
      callFrames: [
        {
          functionName: 'fn',
          url: 'https://a.js',
          callFrameId: 'cf-1',
          location: { scriptId: '1', lineNumber: 1, columnNumber: 1 },
          scopeChain: [{ type: 'local', name: 'local', object: { objectId: 'obj-1' } }],
        },
      ],
    });
    context.debuggerContext.isPaused = () => true;
    context.debuggerContext.getScopeVariables = async () => [{ name: 'x', value: 1 }];
    context.debuggerContext.evaluateOnCallFrame = async () => ({ result: { value: { ok: true } } });

    await getPausedInfo.handler({ params: { includeScopes: true, maxScopeDepth: 2 } } as any, response as any, context);
    await evaluateOnCallframe.handler({ params: { expression: 'x', frameIndex: 0 } } as any, response as any, context);
    await resume.handler({ params: {} } as any, response as any, context);
    await stepOver.handler({ params: {} } as any, response as any, context);
    await stepInto.handler({ params: {} } as any, response as any, context);
    await stepOut.handler({ params: {} } as any, response as any, context);

    context.debuggerContext.isPaused = () => false;
    await pause.handler({ params: {} } as any, response as any, context);

    assert.ok(response.lines.some((x) => x.includes('Execution Paused')));
    assert.ok(response.lines.some((x) => x.includes('Result')));
    assert.ok(response.lines.some((x) => x.includes('Execution resumed') || x.includes('Pause requested')));
  });

  it('covers set breakpoint on text and tracing workflows', async () => {
    const response = makeResponse();
    const context = makeContext();
    context.debuggerContext.searchInScripts = async (q: string) => {
      if (q.includes('function targetFn')) {
        return {
          matches: [
            {
              scriptId: '1',
              url: 'https://a.js',
              lineNumber: 0,
              lineContent: 'function targetFn(a){return a;}',
            },
          ],
        };
      }
      if (q === 'targetFn') {
        return {
          matches: [
            {
              scriptId: '1',
              url: 'https://a.js',
              lineNumber: 0,
              lineContent: 'function targetFn(a){return a;}',
            },
          ],
        };
      }
      return { matches: [] };
    };
    context.debuggerContext.getScriptSource = async () => 'function targetFn(a){return a;}';
    context.debuggerContext.setBreakpoint = async () => ({ breakpointId: 'trace-bp', locations: [{}] });

    await setBreakpointOnText.handler(
      { params: { text: 'targetFn', occurrence: 1, condition: 'a>0' } } as any,
      response as any,
      context,
    );
    await traceFunction.handler(
      { params: { functionName: 'targetFn', logArgs: true, logThis: true, pause: false } } as any,
      response as any,
      context,
    );

    assert.ok(response.lines.some((x) => x.includes('Breakpoint set successfully')));
    assert.ok(response.lines.some((x) => x.includes('Function trace installed')));
  });

  it('covers page-eval tools: hook/list/unhook/inspect/storage/monitor', async () => {
    const response = makeResponse();
    let evalCount = 0;
    const context = makeContext({
      getSelectedPage: () => ({
        evaluate: async () => {
          evalCount += 1;
          switch (evalCount) {
            case 1:
              return { success: true, hookId: 'h1' };
            case 2:
              return [{ id: 'h1', target: 'Window.fetch' }];
            case 3:
              return { success: true };
            case 4:
              return { type: 'object', constructor: 'Object', value: { a: 1 } };
            case 5:
              return { localStorage: { token: 'x' } };
            case 6:
              return { success: true, monitorId: 'm1', eventCount: 2 };
            default:
              return { success: true };
          }
        },
      }),
    });

    await hookFunction.handler({ params: { target: 'window.fetch', logArgs: true, logResult: true, logStack: false } } as any, response as any, context);
    await listHooks.handler({ params: {} } as any, response as any, context);
    await unhookFunction.handler({ params: { hookId: 'h1' } } as any, response as any, context);
    await inspectObject.handler({ params: { expression: 'window', depth: 1, showMethods: true, showPrototype: true } } as any, response as any, context);
    await getStorage.handler({ params: { type: 'all', filter: 'tok' } } as any, response as any, context);
    await monitorEvents.handler({ params: { selector: 'window', events: ['click', 'keydown'], monitorId: 'm1' } } as any, response as any, context);
    await stopMonitor.handler({ params: { monitorId: 'm1' } } as any, response as any, context);

    assert.ok(response.lines.some((x) => x.includes('Hook installed successfully')));
    assert.ok(response.lines.some((x) => x.includes('Active hooks')));
    assert.ok(response.lines.some((x) => x.includes('Storage data')));
    assert.ok(response.lines.some((x) => x.includes('Event monitor started')));
    assert.ok(response.lines.some((x) => x.includes('Monitor "m1" stopped')));
  });

  it('covers XHR breakpoint helpers', async () => {
    const response = makeResponse();
    const context = makeContext();
    await breakOnXhr.handler({ params: { url: '/api' } } as any, response as any, context);
    await removeXhrBreakpoint.handler({ params: { url: '/api' } } as any, response as any, context);
    assert.ok(response.lines.some((x) => x.includes('XHR breakpoint set')));
    assert.ok(response.lines.some((x) => x.includes('XHR breakpoint removed')));
  });
});

