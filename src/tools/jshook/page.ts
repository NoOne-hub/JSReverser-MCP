import {zod} from '../../third_party/index.js';
import {defineTool} from '../ToolDefinition.js';
import {ToolCategory} from '../categories.js';
import {getJSHookRuntime} from './runtime.js';

export const navigatePage = defineTool({
  name: 'navigate_page',
  description: 'Navigate current page to a URL.',
  annotations: {category: ToolCategory.NAVIGATION, readOnlyHint: false},
  schema: {
    url: zod.string().url(),
    timeout: zod.number().int().positive().optional(),
  },
  handler: async (request, response) => {
    const runtime = getJSHookRuntime();
    const result = await runtime.pageController.navigate(request.params.url, {
      timeout: request.params.timeout,
    });
    response.appendResponseLine('```json');
    response.appendResponseLine(JSON.stringify(result, null, 2));
    response.appendResponseLine('```');
  },
});

export const clickElement = defineTool({
  name: 'click_element',
  description: 'Click an element by selector.',
  annotations: {category: ToolCategory.NAVIGATION, readOnlyHint: false},
  schema: {selector: zod.string()},
  handler: async (request, response) => {
    const runtime = getJSHookRuntime();
    await runtime.pageController.click(request.params.selector);
    response.appendResponseLine('Element clicked.');
  },
});

export const typeText = defineTool({
  name: 'type_text',
  description: 'Type text into an input element.',
  annotations: {category: ToolCategory.NAVIGATION, readOnlyHint: false},
  schema: {
    selector: zod.string(),
    text: zod.string(),
    delay: zod.number().int().nonnegative().optional(),
  },
  handler: async (request, response) => {
    const runtime = getJSHookRuntime();
    await runtime.pageController.type(request.params.selector, request.params.text, {
      delay: request.params.delay,
    });
    response.appendResponseLine('Text typed.');
  },
});

export const waitForElement = defineTool({
  name: 'wait_for_element',
  description: 'Wait for selector to appear.',
  annotations: {category: ToolCategory.NAVIGATION, readOnlyHint: true},
  schema: {
    selector: zod.string(),
    timeout: zod.number().int().positive().optional(),
  },
  handler: async (request, response) => {
    const runtime = getJSHookRuntime();
    const result = await runtime.pageController.waitForSelector(request.params.selector, request.params.timeout);
    response.appendResponseLine('```json');
    response.appendResponseLine(JSON.stringify(result, null, 2));
    response.appendResponseLine('```');
  },
});

export const takeScreenshot = defineTool({
  name: 'take_screenshot',
  description: 'Take screenshot of current page.',
  annotations: {category: ToolCategory.NAVIGATION, readOnlyHint: false},
  schema: {
    path: zod.string().optional(),
    fullPage: zod.boolean().optional(),
    type: zod.enum(['png', 'jpeg']).optional(),
  },
  handler: async (request, response) => {
    const runtime = getJSHookRuntime();
    const buffer = await runtime.pageController.screenshot({
      path: request.params.path,
      fullPage: request.params.fullPage,
      type: request.params.type,
    });
    response.appendResponseLine(`Screenshot taken (${buffer.length} bytes).`);
  },
});

export const getPerformanceMetrics = defineTool({
  name: 'get_performance_metrics',
  description: 'Get page performance metrics from Performance API.',
  annotations: {category: ToolCategory.NAVIGATION, readOnlyHint: true},
  schema: {},
  handler: async (_request, response) => {
    const runtime = getJSHookRuntime();
    const metrics = await runtime.pageController.getPerformanceMetrics();
    response.appendResponseLine('```json');
    response.appendResponseLine(JSON.stringify(metrics, null, 2));
    response.appendResponseLine('```');
  },
});
