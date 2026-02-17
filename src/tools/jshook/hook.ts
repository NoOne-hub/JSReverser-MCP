import {zod} from '../../third_party/index.js';
import {defineTool} from '../ToolDefinition.js';
import {ToolCategory} from '../categories.js';
import {getJSHookRuntime} from './runtime.js';

export const createHook = defineTool({
  name: 'create_hook',
  description: 'Create hook script for function/fetch/xhr/property/cookie/websocket/eval/timer.',
  annotations: {category: ToolCategory.REVERSE_ENGINEERING, readOnlyHint: false},
  schema: {
    type: zod.string(),
    params: zod.record(zod.string(), zod.unknown()).optional(),
    description: zod.string().optional(),
    action: zod.enum(['log', 'block', 'modify', 'passthrough']).optional(),
  },
  handler: async (request, response) => {
    const runtime = getJSHookRuntime();
    const result = runtime.hookManager.create(request.params);
    response.appendResponseLine('```json');
    response.appendResponseLine(JSON.stringify(result, null, 2));
    response.appendResponseLine('```');
  },
});

export const injectHook = defineTool({
  name: 'inject_hook',
  description: 'Inject an existing hook into the current page.',
  annotations: {category: ToolCategory.REVERSE_ENGINEERING, readOnlyHint: false},
  schema: {hookId: zod.string()},
  handler: async (request, response) => {
    const runtime = getJSHookRuntime();
    const hook = runtime.hookManager.getHook(request.params.hookId);
    if (!hook) {
      throw new Error(`Hook not found: ${request.params.hookId}`);
    }
    await runtime.pageController.injectScript(hook.script);
    response.appendResponseLine(`Hook injected: ${hook.hookId}`);
  },
});

export const listHooks = defineTool({
  name: 'list_hooks',
  description: 'List all created hooks and statuses.',
  annotations: {category: ToolCategory.REVERSE_ENGINEERING, readOnlyHint: true},
  schema: {},
  handler: async (_request, response) => {
    const runtime = getJSHookRuntime();
    const hooks = runtime.hookManager.getAllHooks();
    response.appendResponseLine('```json');
    response.appendResponseLine(JSON.stringify(hooks, null, 2));
    response.appendResponseLine('```');
  },
});

export const getHookData = defineTool({
  name: 'get_hook_data',
  description: 'Get captured data for one hook or all hooks.',
  annotations: {category: ToolCategory.REVERSE_ENGINEERING, readOnlyHint: true},
  schema: {hookId: zod.string().optional()},
  handler: async (request, response) => {
    const runtime = getJSHookRuntime();
    const data = request.params.hookId
      ? runtime.hookManager.getRecords(request.params.hookId)
      : runtime.hookManager.exportData('json');
    response.appendResponseLine('```json');
    response.appendResponseLine(typeof data === 'string' ? data : JSON.stringify(data, null, 2));
    response.appendResponseLine('```');
  },
});

export const removeHook = defineTool({
  name: 'remove_hook',
  description: 'Remove a hook by id.',
  annotations: {category: ToolCategory.REVERSE_ENGINEERING, readOnlyHint: false},
  schema: {hookId: zod.string()},
  handler: async (request, response) => {
    const runtime = getJSHookRuntime();
    const removed = runtime.hookManager.remove(request.params.hookId);
    response.appendResponseLine(removed ? 'Hook removed.' : 'Hook not found.');
  },
});
