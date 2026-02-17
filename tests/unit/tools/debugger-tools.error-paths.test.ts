import {describe, it} from 'node:test';
import assert from 'node:assert';
import {
  breakOnXhr,
  evaluateOnCallframe,
  findInScript,
  getPausedInfo,
  getRequestInitiator,
  getScriptSource,
  hookFunction,
  inspectObject,
  listBreakpoints,
  listHooks,
  listScripts,
  monitorEvents,
  pause,
  removeBreakpoint,
  removeXhrBreakpoint,
  resume,
  searchInSources,
  setBreakpoint,
  setBreakpointOnText,
  stepInto,
  stepOut,
  stepOver,
  stopMonitor,
  traceFunction,
  unhookFunction,
  getStorage,
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

function makeDisabledContext() {
  return {
    debuggerContext: {
      isEnabled: () => false,
    },
    getSelectedPage: () => ({evaluate: async () => ({})}),
    getNetworkRequestById: () => ({url: () => 'https://example.com'}),
    getRequestInitiator: () => undefined,
  } as any;
}

describe('debugger tools error paths', () => {
  it('covers debugger-disabled early-return branches', async () => {
    const response = makeResponse();
    const context = makeDisabledContext();

    await listScripts.handler({params: {}} as any, response as any, context);
    await getScriptSource.handler({params: {scriptId: '1'}} as any, response as any, context);
    await findInScript.handler({params: {scriptId: '1', query: 'x'}} as any, response as any, context);
    await searchInSources.handler({params: {query: 'x'}} as any, response as any, context);
    await setBreakpoint.handler({params: {url: 'a.js', lineNumber: 1}} as any, response as any, context);
    await removeBreakpoint.handler({params: {breakpointId: 'bp'}} as any, response as any, context);
    await listBreakpoints.handler({params: {}} as any, response as any, context);
    await getPausedInfo.handler({params: {}} as any, response as any, context);
    await resume.handler({params: {}} as any, response as any, context);
    await pause.handler({params: {}} as any, response as any, context);
    await stepOver.handler({params: {}} as any, response as any, context);
    await stepInto.handler({params: {}} as any, response as any, context);
    await stepOut.handler({params: {}} as any, response as any, context);
    await evaluateOnCallframe.handler({params: {expression: 'x', frameIndex: 0}} as any, response as any, context);
    await setBreakpointOnText.handler({params: {text: 'token'}} as any, response as any, context);
    await breakOnXhr.handler({params: {url: '/api'}} as any, response as any, context);
    await removeXhrBreakpoint.handler({params: {url: '/api'}} as any, response as any, context);
    await traceFunction.handler({params: {functionName: 'sign'}} as any, response as any, context);

    assert.ok(response.lines.filter((line) => line.includes('Debugger is not enabled')).length >= 10);
  });

  it('covers runtime error and failure response branches', async () => {
    const response = makeResponse();
    const context = {
      debuggerContext: {
        isEnabled: () => true,
        getPausedState: () => ({
          isPaused: true,
          callFrames: [{callFrameId: 'cf-1', location: {scriptId: '1', lineNumber: 0, columnNumber: 0}}],
        }),
        evaluateOnCallFrame: async () => ({
          exceptionDetails: {
            text: 'boom',
            exception: {description: 'stack boom'},
          },
        }),
        getClient: () => null,
      },
      getSelectedPage: () => ({
        evaluate: async (script: string) => {
          if (script.includes('__mcp_hooks__') && script.includes('return [];')) {
            throw new Error('list hook fail');
          }
          if (script.includes('hookId') && script.includes('Hook already exists')) {
            return {success: false, message: 'Hook already exists with id: h1'};
          }
          if (script.includes('Hook not found')) {
            return {success: false, message: 'Hook not found: missing'};
          }
          if (script.includes('Cannot evaluate')) {
            return {error: 'Cannot evaluate: x'};
          }
          if (script.includes('Monitor already exists')) {
            return {success: false, message: 'Monitor already exists: m1'};
          }
          if (script.includes('Monitor not found')) {
            return {success: false, message: 'Monitor not found: m1'};
          }
          if (script.includes('const type =')) {
            throw new Error('storage fail');
          }
          return {};
        },
      }),
      getNetworkRequestById: () => {
        throw new Error('request missing');
      },
      getRequestInitiator: () => undefined,
    } as any;

    await getRequestInitiator.handler({params: {requestId: 1}} as any, response as any, context);
    await hookFunction.handler({params: {target: 'window.fetch', hookId: 'h1'}} as any, response as any, context);
    await unhookFunction.handler({params: {hookId: 'missing'}} as any, response as any, context);
    await assert.doesNotReject(async () => {
      await listHooks.handler({params: {}} as any, response as any, context);
    });
    await inspectObject.handler({params: {expression: 'window.__not_found__'}} as any, response as any, context);
    await getStorage.handler({params: {type: 'all'}} as any, response as any, context);
    await monitorEvents.handler({params: {selector: '#missing', monitorId: 'm1'}} as any, response as any, context);
    await stopMonitor.handler({params: {monitorId: 'm1'}} as any, response as any, context);
    await breakOnXhr.handler({params: {url: '/api'}} as any, response as any, context);
    await removeXhrBreakpoint.handler({params: {url: '/api'}} as any, response as any, context);

    assert.ok(response.lines.some((line) => line.includes('Error getting initiator')));
    assert.ok(response.lines.some((line) => line.includes('Hook already exists')));
    assert.ok(response.lines.some((line) => line.includes('Hook not found')));
    assert.ok(response.lines.some((line) => line.includes('Error: list hook fail')));
    assert.ok(response.lines.some((line) => line.includes('Cannot evaluate')));
    assert.ok(response.lines.some((line) => line.includes('Error: storage fail')));
    assert.ok(response.lines.some((line) => line.includes('Monitor already exists')));
    assert.ok(response.lines.some((line) => line.includes('Monitor not found')));
    assert.ok(response.lines.filter((line) => line.includes('Debugger client not available')).length >= 2);
  });
});
