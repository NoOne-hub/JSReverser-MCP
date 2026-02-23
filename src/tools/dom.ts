import {zod} from '../third_party/index.js';
import {defineTool} from './ToolDefinition.js';
import {ToolCategory} from './categories.js';
import {getJSHookRuntime} from './runtime.js';

export const queryDom = defineTool({
  name: 'query_dom',
  description: 'Query one or multiple elements by CSS selector.',
  annotations: {category: ToolCategory.NAVIGATION, readOnlyHint: true},
  schema: {
    selector: zod.string(),
    all: zod.boolean().optional(),
    limit: zod.number().int().positive().optional(),
  },
  handler: async (request, response) => {
    const runtime = getJSHookRuntime();
    const result = request.params.all
      ? await runtime.domInspector.querySelectorAll(request.params.selector, request.params.limit)
      : await runtime.domInspector.querySelector(request.params.selector);
    response.appendResponseLine('```json');
    response.appendResponseLine(JSON.stringify(result, null, 2));
    response.appendResponseLine('```');
  },
});

export const getDomStructure = defineTool({
  name: 'get_dom_structure',
  description: 'Get DOM tree structure for current page.',
  annotations: {category: ToolCategory.NAVIGATION, readOnlyHint: true},
  schema: {
    maxDepth: zod.number().int().positive().optional(),
    includeText: zod.boolean().optional(),
  },
  handler: async (request, response) => {
    const runtime = getJSHookRuntime();
    const result = await runtime.domInspector.getStructure(request.params.maxDepth, request.params.includeText);
    response.appendResponseLine('```json');
    response.appendResponseLine(JSON.stringify(result, null, 2));
    response.appendResponseLine('```');
  },
});

export const findClickableElements = defineTool({
  name: 'find_clickable_elements',
  description: 'Find clickable buttons/links, optionally filtered by text.',
  annotations: {category: ToolCategory.NAVIGATION, readOnlyHint: true},
  schema: {
    filterText: zod.string().optional(),
  },
  handler: async (request, response) => {
    const runtime = getJSHookRuntime();
    const result = await runtime.domInspector.findClickable(request.params.filterText);
    response.appendResponseLine('```json');
    response.appendResponseLine(JSON.stringify(result, null, 2));
    response.appendResponseLine('```');
  },
});
